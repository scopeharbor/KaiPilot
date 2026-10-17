import type User from '#models/user'
import RbacService from '#services/rbac_service'
import PmoInvestmentDistributionCache, {
  buildInvestmentCacheKey,
} from '#services/pmo_investment_distribution_cache'
import { PORTFOLIO_VIEW } from '#start/rbac/permissions'
import {
  PMO_INVESTMENT_BUCKET_STATUSES,
  PMO_INVESTMENT_DEFAULT_TOP_N,
  PMO_INVESTMENT_DISPLAY_MODES,
  PMO_INVESTMENT_DISPLAY_MODE_VALUES,
  PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS,
  PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION,
  PMO_INVESTMENT_FINANCIAL_BASIS_VALUES,
  PMO_INVESTMENT_MAX_TOP_N,
  PMO_INVESTMENT_NON_FINANCIAL_BASIS,
  PMO_INVESTMENT_NON_FINANCIAL_BASIS_VALUES,
  PMO_INVESTMENT_SOURCES,
  PMO_INVESTMENT_TREND_WINDOWS,
  PMO_INVESTMENT_TREND_WINDOW_VALUES,
  PMO_INVESTMENT_WARNING_CODES,
  buildRedactedInvestmentBucket,
  buildUnsupportedFinancialInvestmentSummary,
  investmentHoursFromPersonDays,
  isPmoInvestmentFinancialBasis,
  makeInvestmentSourceFreshness,
  makeLowSensitiveInvestmentEvidenceRef,
  mergeLowCardinalityInvestmentBuckets,
  normalizeInvestmentBucketPercentages,
  projectEmptyInvestmentPortfolioWarning,
  projectSourceUnavailableInvestmentWarning,
  type PmoInvestmentBucket,
  type PmoInvestmentDistributionBasis,
  type PmoInvestmentDistributionDimension,
  type PmoInvestmentDistributionDrillDownQuery,
  type PmoInvestmentDistributionDrillDownResponse,
  type PmoInvestmentDistributionMeta,
  type PmoInvestmentDistributionQuery,
  type PmoInvestmentDistributionSummary,
  type PmoInvestmentDistributionWarning,
  type PmoInvestmentDisplayMode,
  type PmoInvestmentSource,
  type PmoInvestmentSupportedCatalogue,
  type PmoInvestmentTrendBucket,
  type PmoInvestmentDistributionTrendResponse,
} from '@aiproj/types'

export interface InvestmentProjectFact {
  id: number
  organizationId: number
  name: string
  category?: string | null
  status?: string | null
  priority?: string | null
  createdBy?: number | null
  updatedAt?: string | null
  settings?: Record<string, unknown> | null
}

export interface InvestmentBasisFact {
  projectId: number
  value: number
  updatedAt?: string | null
}

export interface InvestmentDistributionReaders {
  readProjects?: (organizationId: number, user: User) => Promise<InvestmentProjectFact[]>
  readEstimatedEffortHours?: (
    organizationId: number,
    projectIds: number[],
  ) => Promise<InvestmentBasisFact[]>
  readPlannedEffortHours?: (
    organizationId: number,
    projectIds: number[],
  ) => Promise<InvestmentBasisFact[]>
  readResourceAllocationPercent?: (
    organizationId: number,
    projectIds: number[],
  ) => Promise<InvestmentBasisFact[]>
  /**
   * 来源事实签名（§4.13）：SQLite 友好的轻量查询（count + max(updated_at)），
   * 用于判断派生缓存是否仍然反映当前事实。签名变化即视为缓存未命中。
   */
  readSourceSignature?: (organizationId: number) => Promise<string>
}

interface InvestmentAccess {
  canViewResourceFacts?: boolean
  canViewPeopleDimensions?: boolean
  canViewDepartmentDimension?: boolean
  canViewTrafficLightDimension?: boolean
  canViewStrategicThemeDimension?: boolean
}

interface NormalizedInvestmentQuery {
  basis: PmoInvestmentDistributionBasis
  dimension: PmoInvestmentDistributionDimension
  displayMode: PmoInvestmentDisplayMode
  topN: number
  trendWindow: (typeof PMO_INVESTMENT_TREND_WINDOW_VALUES)[number]
  filterStatus?: string
  filterPriority?: string
  search?: string
}

export interface InvestmentSummaryWithCacheInfo {
  summary: PmoInvestmentDistributionSummary
  cacheHit: boolean
  cacheDegraded: boolean
}

export default class PmoInvestmentDistributionService {
  constructor(
    private readonly readers: InvestmentDistributionReaders = {},
    private readonly cache: PmoInvestmentDistributionCache = new PmoInvestmentDistributionCache(),
  ) {}

  getSupportedCatalogue(): PmoInvestmentSupportedCatalogue {
    return {
      nonFinancialBasis: [...PMO_INVESTMENT_NON_FINANCIAL_BASIS_VALUES],
      unsupportedFinancialBasis: [...PMO_INVESTMENT_FINANCIAL_BASIS_VALUES],
      dimensions: Object.values(PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS),
      displayModes: [...PMO_INVESTMENT_DISPLAY_MODE_VALUES],
      trendWindows: [...PMO_INVESTMENT_TREND_WINDOW_VALUES],
      topN: {
        default: PMO_INVESTMENT_DEFAULT_TOP_N,
        max: PMO_INVESTMENT_MAX_TOP_N,
      },
      metricVersion: PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION,
    }
  }

  async getSummary(
    user: User,
    organizationId: number,
    query: PmoInvestmentDistributionQuery = {},
    access: InvestmentAccess = {},
  ): Promise<PmoInvestmentDistributionSummary> {
    const result = await this.getSummaryWithCacheInfo(user, organizationId, query, access)
    return result.summary
  }

  /**
   * 与 `getSummary` 相同的只读聚合，额外返回派生缓存命中/降级信息（§4.13）。
   * 缓存不可用时读路径照常返回 bounded 结果，并附 `CACHE_DEGRADED` warning。
   */
  async getSummaryWithCacheInfo(
    user: User,
    organizationId: number,
    query: PmoInvestmentDistributionQuery = {},
    access: InvestmentAccess = {},
  ): Promise<InvestmentSummaryWithCacheInfo> {
    const normalized = this.normalizeQuery(query)

    if (isPmoInvestmentFinancialBasis(normalized.basis)) {
      return {
        summary: buildUnsupportedFinancialInvestmentSummary({
          organizationId,
          actorId: Number(user.id),
          basis: normalized.basis,
          dimension: normalized.dimension,
          displayMode: normalized.displayMode,
        }),
        cacheHit: false,
        cacheDegraded: false,
      }
    }

    const redacted = this.redactedSummaryIfNeeded(user, organizationId, normalized, access)
    if (redacted) return { summary: redacted, cacheHit: false, cacheDegraded: false }

    if (!this.cache.isEnabled()) {
      return {
        summary: await this.computeSummary(user, organizationId, normalized, access),
        cacheHit: false,
        cacheDegraded: false,
      }
    }

    const cacheKey = buildInvestmentCacheKey({
      organizationId,
      actorId: Number(user.id),
      metricVersion: PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION,
      basis: normalized.basis,
      dimension: normalized.dimension,
      displayMode: normalized.displayMode,
      topN: normalized.topN,
      trendWindow: normalized.trendWindow,
      filterStatus: normalized.filterStatus,
      filterPriority: normalized.filterPriority,
      search: normalized.search,
    })

    let signature: string | null = null
    let degraded = false
    try {
      signature = await this.readSourceSignature(organizationId)
      const lookup = this.cache.get(cacheKey, signature)
      if (lookup.hit && lookup.summary) {
        return { summary: lookup.summary, cacheHit: true, cacheDegraded: false }
      }
    } catch {
      // 缓存层不可用不得阻断只读聚合（spec「Cache unavailable falls back safely」）
      degraded = true
    }

    const summary = await this.computeSummary(user, organizationId, normalized, access)
    if (!degraded && signature !== null) {
      try {
        this.cache.set(cacheKey, organizationId, summary, signature)
      } catch {
        degraded = true
      }
    }

    if (!degraded) return { summary, cacheHit: false, cacheDegraded: false }

    const warning: PmoInvestmentDistributionWarning = {
      code: PMO_INVESTMENT_WARNING_CODES.CACHE_DEGRADED,
      message: '投入分布派生缓存当前不可用，已直接按来源事实计算',
      basis: normalized.basis,
      dimension: normalized.dimension,
    }
    return {
      summary: { ...summary, warnings: [...summary.warnings, warning] },
      cacheHit: false,
      cacheDegraded: true,
    }
  }

  /** 来源事实签名：默认用 SQLite 友好的 count + max(updated_at) 轻量查询。 */
  private async readSourceSignature(organizationId: number): Promise<string> {
    if (this.readers.readSourceSignature) {
      return this.readers.readSourceSignature(organizationId)
    }

    const { default: ProjectModel } = await import('#models/project')
    const rows = await ProjectModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .count('* as total')
      .max('updated_at as updatedAt')
    const row = (rows[0] as any)?.$extras ?? {}
    return `${Number(row.total ?? 0)}:${row.updatedAt ? String(row.updatedAt) : '-'}`
  }

  private async computeSummary(
    user: User,
    organizationId: number,
    normalized: NormalizedInvestmentQuery,
    access: InvestmentAccess,
  ): Promise<PmoInvestmentDistributionSummary> {
    const projects = this.applyProjectFilters(
      await this.readVisibleProjects(organizationId, user),
      normalized,
    )
    if (projects.length === 0) return this.emptySummary(user, organizationId, normalized)

    const basisValues = await this.readBasisValues(organizationId, projects, normalized, access)
    if (!basisValues.available) {
      const warning = projectSourceUnavailableInvestmentWarning(
        basisValues.source,
        normalized.basis,
      )
      return {
        meta: this.buildMeta(user, organizationId, normalized, projects.length, null, [
          makeInvestmentSourceFreshness({ source: basisValues.source, lastUpdatedAt: null }),
        ]),
        buckets: [],
        warnings: [warning],
      }
    }

    const grouped = new Map<string, { label: string; projectCount: number; total: number }>()
    for (const project of projects) {
      const group = this.resolveDimension(project, normalized.dimension)
      const value = basisValues.values.get(project.id) ?? 0
      const current = grouped.get(group.key) ?? { label: group.label, projectCount: 0, total: 0 }
      current.projectCount += 1
      current.total += value
      grouped.set(group.key, current)
    }

    const sorted = [...grouped.entries()]
      .sort((a, b) => b[1].total - a[1].total || a[1].label.localeCompare(b[1].label))
      .map(([key, bucket]) => ({ key, ...bucket }))
    const buckets = this.toBuckets(sorted, normalized, basisValues.source, basisValues.updatedAt)
    const sourceFreshness = [
      makeInvestmentSourceFreshness({
        source: basisValues.source,
        lastUpdatedAt: basisValues.updatedAt,
      }),
    ]
    const totalBasisValue = roundTwo(sorted.reduce((sum, bucket) => sum + bucket.total, 0))

    return {
      meta: this.buildMeta(
        user,
        organizationId,
        normalized,
        projects.length,
        totalBasisValue,
        sourceFreshness,
      ),
      buckets,
      warnings: buckets.flatMap((bucket) => bucket.warnings),
    }
  }

  async getTrends(
    user: User,
    organizationId: number,
    query: PmoInvestmentDistributionQuery = {},
    access: InvestmentAccess = {},
  ): Promise<PmoInvestmentDistributionTrendResponse> {
    const summary = await this.getSummary(user, organizationId, query, access)
    const normalized = this.normalizeQuery(query)
    const days = normalized.trendWindow === PMO_INVESTMENT_TREND_WINDOWS.LAST_90_DAYS ? 90 : 30
    const now = new Date()
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    const bucket: PmoInvestmentTrendBucket = {
      label: days === 90 ? '最近 90 天' : '最近 30 天',
      startDate: start.toISOString().split('T')[0],
      endDate: now.toISOString().split('T')[0],
      buckets: summary.buckets,
      totalBasisValue: summary.meta.totalBasisValue,
      warnings: summary.warnings,
    }
    return { meta: summary.meta, data: [bucket], warnings: summary.warnings }
  }

  async getDrillDown(
    user: User,
    organizationId: number,
    query: PmoInvestmentDistributionDrillDownQuery,
    access: InvestmentAccess = {},
  ): Promise<PmoInvestmentDistributionDrillDownResponse> {
    const normalized = this.normalizeQuery(query)
    const summary = await this.getSummary(user, organizationId, normalized, access)
    const targetBucket = summary.buckets.find((bucket) => bucket.key === query.bucketKey)
    if (!targetBucket || targetBucket.status === PMO_INVESTMENT_BUCKET_STATUSES.REDACTED) {
      return { meta: summary.meta, data: [], warnings: summary.warnings }
    }

    const projects = this.applyProjectFilters(
      await this.readVisibleProjects(organizationId, user),
      normalized,
    ).filter(
      (project) => this.resolveDimension(project, normalized.dimension).key === query.bucketKey,
    )
    const basisValues = await this.readBasisValues(organizationId, projects, normalized, access)
    const page = query.page ?? 1
    const perPage = Math.min(query.perPage ?? 20, 100)
    const paged = projects.slice((page - 1) * perPage, page * perPage)

    return {
      meta: summary.meta,
      data: paged.map((project) => ({
        projectId: project.id,
        projectName: project.name,
        bucketKey: query.bucketKey,
        basisValue: basisValues.values.get(project.id) ?? null,
        status: PMO_INVESTMENT_BUCKET_STATUSES.OK,
        evidenceRefs: [
          makeLowSensitiveInvestmentEvidenceRef({
            source: basisValues.source,
            refSeed: `${normalized.basis}:${query.bucketKey}:${project.id}`,
            valueSummary: `${normalized.basis}_project`,
            lastUpdatedAt: basisValues.updatedAt,
          }),
        ],
        warnings: [],
      })),
      warnings: summary.warnings,
    }
  }

  private normalizeQuery(query: PmoInvestmentDistributionQuery): NormalizedInvestmentQuery {
    return {
      basis: query.basis ?? PMO_INVESTMENT_NON_FINANCIAL_BASIS.PROJECT_COUNT,
      dimension: query.dimension ?? PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.PROJECT_TYPE,
      displayMode: query.displayMode ?? PMO_INVESTMENT_DISPLAY_MODES.DONUT,
      topN: Math.min(query.topN ?? PMO_INVESTMENT_DEFAULT_TOP_N, PMO_INVESTMENT_MAX_TOP_N),
      trendWindow: query.trendWindow ?? PMO_INVESTMENT_TREND_WINDOWS.LAST_30_DAYS,
      filterStatus: query.filterStatus,
      filterPriority: query.filterPriority,
      search: query.search,
    }
  }

  private redactedSummaryIfNeeded(
    user: User,
    organizationId: number,
    query: NormalizedInvestmentQuery,
    access: InvestmentAccess,
  ): PmoInvestmentDistributionSummary | null {
    const needsResource =
      query.basis === PMO_INVESTMENT_NON_FINANCIAL_BASIS.PLANNED_EFFORT_HOURS ||
      query.basis === PMO_INVESTMENT_NON_FINANCIAL_BASIS.RESOURCE_ALLOCATION_PERCENT
    const needsPeople = query.dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.MANAGER
    const needsDepartment = query.dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.DEPARTMENT
    const needsTrafficLight =
      query.dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.TRAFFIC_LIGHT_STATUS
    const needsTheme = query.dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.STRATEGIC_THEME

    if (
      (needsResource && access.canViewResourceFacts === false) ||
      (needsPeople && access.canViewPeopleDimensions === false) ||
      (needsDepartment && access.canViewDepartmentDimension === false) ||
      (needsTrafficLight && access.canViewTrafficLightDimension === false) ||
      (needsTheme && access.canViewStrategicThemeDimension === false)
    ) {
      const bucket = buildRedactedInvestmentBucket({
        dimension: query.dimension,
        basis: query.basis,
      })
      return {
        meta: this.buildMeta(user, organizationId, query, 0, null, []),
        buckets: [bucket],
        warnings: bucket.warnings,
      }
    }
    return null
  }

  private applyProjectFilters(
    projects: InvestmentProjectFact[],
    query: NormalizedInvestmentQuery,
  ): InvestmentProjectFact[] {
    return projects.filter((project) => {
      if (query.filterStatus && project.status !== query.filterStatus) return false
      if (query.filterPriority && project.priority !== query.filterPriority) return false
      if (query.search && !project.name.toLowerCase().includes(query.search.toLowerCase())) {
        return false
      }
      return true
    })
  }

  private async readVisibleProjects(
    organizationId: number,
    user: User,
  ): Promise<InvestmentProjectFact[]> {
    if (this.readers.readProjects) {
      const projects = await this.readers.readProjects(organizationId, user)
      return projects.filter((project) => Number(project.organizationId) === Number(organizationId))
    }

    const { default: ProjectModel } = await import('#models/project')
    const rbac = new RbacService()
    const projects = await ProjectModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')

    const visible: InvestmentProjectFact[] = []
    for (const project of projects) {
      const projectCheck = await rbac.check(
        user,
        PORTFOLIO_VIEW,
        organizationId,
        Number(project.id),
      )
      if (!projectCheck.allowed && Number(project.createdBy) !== Number(user.id)) continue
      visible.push({
        id: Number(project.id),
        organizationId: Number(project.organizationId),
        name: project.name,
        category: project.category,
        status: project.status,
        priority: project.priority,
        createdBy: Number(project.createdBy),
        updatedAt: project.updatedAt?.toISO() ?? null,
        settings: project.settings,
      })
    }
    return visible
  }

  private async readBasisValues(
    organizationId: number,
    projects: InvestmentProjectFact[],
    query: NormalizedInvestmentQuery,
    access: InvestmentAccess,
  ): Promise<{
    available: boolean
    source: PmoInvestmentSource
    values: Map<number, number>
    updatedAt: string | null
  }> {
    const projectIds = projects.map((project) => project.id)
    if (query.basis === PMO_INVESTMENT_NON_FINANCIAL_BASIS.PROJECT_COUNT) {
      return {
        available: true,
        source: PMO_INVESTMENT_SOURCES.PROJECT,
        values: new Map(projectIds.map((id) => [id, 1])),
        updatedAt: latestUpdatedAt(projects.map((project) => project.updatedAt ?? null)),
      }
    }

    if (query.basis === PMO_INVESTMENT_NON_FINANCIAL_BASIS.ESTIMATED_EFFORT_HOURS) {
      const facts = await this.readEstimatedEffortFacts(organizationId, projectIds)
      return factsToBasisResult(PMO_INVESTMENT_SOURCES.TASK_REQUIREMENT, facts)
    }

    if (access.canViewResourceFacts === false) {
      return {
        available: false,
        source: PMO_INVESTMENT_SOURCES.RESOURCE_ALLOCATION,
        values: new Map(),
        updatedAt: null,
      }
    }

    if (query.basis === PMO_INVESTMENT_NON_FINANCIAL_BASIS.PLANNED_EFFORT_HOURS) {
      const facts = await this.readPlannedEffortFacts(organizationId, projectIds)
      return factsToBasisResult(PMO_INVESTMENT_SOURCES.TASK_REQUIREMENT, facts)
    }

    const facts = await this.readResourceAllocationFacts(organizationId, projectIds)
    return factsToBasisResult(PMO_INVESTMENT_SOURCES.RESOURCE_ALLOCATION, facts)
  }

  private async readEstimatedEffortFacts(
    organizationId: number,
    projectIds: number[],
  ): Promise<InvestmentBasisFact[]> {
    if (this.readers.readEstimatedEffortHours) {
      return this.readers.readEstimatedEffortHours(organizationId, projectIds)
    }
    if (projectIds.length === 0) return []

    const { default: TaskModel } = await import('#models/task')
    const rows = await TaskModel.query()
      .whereIn('project_id', projectIds)
      .whereNull('deleted_at')
      .select('project_id')
      .sum('estimated_hours as value')
      .max('updated_at as updatedAt')
      .groupBy('project_id')
    return rows.map((row: any) => ({
      projectId: Number(row.$extras.project_id ?? row.projectId),
      value: Number(row.$extras.value ?? 0),
      updatedAt: row.$extras.updatedAt ? String(row.$extras.updatedAt) : null,
    }))
  }

  private async readPlannedEffortFacts(
    organizationId: number,
    projectIds: number[],
  ): Promise<InvestmentBasisFact[]> {
    if (this.readers.readPlannedEffortHours) {
      return this.readers.readPlannedEffortHours(organizationId, projectIds)
    }
    if (projectIds.length === 0) return []

    const { default: TaskResourceRequirement } = await import('#models/task_resource_requirement')
    const rows = await TaskResourceRequirement.query()
      .where('organization_id', organizationId)
      .whereIn('project_id', projectIds)
      .select('project_id')
      .sum('estimated_person_days as personDays')
      .max('updated_at as updatedAt')
      .groupBy('project_id')
    return rows.map((row: any) => ({
      projectId: Number(row.$extras.project_id ?? row.projectId),
      value: investmentHoursFromPersonDays(Number(row.$extras.personDays ?? 0)),
      updatedAt: row.$extras.updatedAt ? String(row.$extras.updatedAt) : null,
    }))
  }

  private async readResourceAllocationFacts(
    organizationId: number,
    projectIds: number[],
  ): Promise<InvestmentBasisFact[]> {
    if (this.readers.readResourceAllocationPercent) {
      return this.readers.readResourceAllocationPercent(organizationId, projectIds)
    }
    if (projectIds.length === 0) return []

    const { default: TaskResourceRequirement } = await import('#models/task_resource_requirement')
    const rows = await TaskResourceRequirement.query()
      .where('organization_id', organizationId)
      .whereIn('project_id', projectIds)
      .select('project_id')
      .sum('allocation_percent as value')
      .max('updated_at as updatedAt')
      .groupBy('project_id')
    return rows.map((row: any) => ({
      projectId: Number(row.$extras.project_id ?? row.projectId),
      value: Number(row.$extras.value ?? 0),
      updatedAt: row.$extras.updatedAt ? String(row.$extras.updatedAt) : null,
    }))
  }

  private resolveDimension(
    project: InvestmentProjectFact,
    dimension: PmoInvestmentDistributionDimension,
  ): { key: string; label: string } {
    const settings = project.settings ?? {}
    const raw =
      dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.PROJECT_TYPE
        ? project.category
        : dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.LIFECYCLE_PHASE
          ? settingString(settings, 'lifecyclePhase')
          : dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.PRIORITY
            ? project.priority
            : dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.STATUS
              ? project.status
              : dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.MANAGER
                ? (settingString(settings, 'managerLabel') ?? project.createdBy)
                : dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.DEPARTMENT
                  ? settingString(settings, 'department')
                  : dimension === PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.STRATEGIC_THEME
                    ? settingString(settings, 'strategicTheme')
                    : (settingString(settings, 'trafficLightStatus') ?? 'gray')
    const key = String(raw ?? 'unknown').trim() || 'unknown'
    return { key, label: key === 'unknown' ? '未分类' : key }
  }

  private toBuckets(
    grouped: Array<{ key: string; label: string; total: number; projectCount: number }>,
    query: NormalizedInvestmentQuery,
    source: PmoInvestmentSource,
    updatedAt: string | null,
  ): PmoInvestmentBucket[] {
    const topBuckets = grouped.slice(0, query.topN)
    const overflow = grouped.slice(query.topN)
    if (overflow.length > 0) {
      topBuckets.push({
        key: 'other',
        label: '其他',
        total: overflow.reduce((sum, bucket) => sum + bucket.total, 0),
        projectCount: overflow.reduce((sum, bucket) => sum + bucket.projectCount, 0),
      })
    }

    return mergeLowCardinalityInvestmentBuckets(
      normalizeInvestmentBucketPercentages(
        topBuckets.map((bucket) => ({
          key: bucket.key,
          label: bucket.label,
          total: roundTwo(bucket.total),
          percent: 0,
          projectCount: bucket.projectCount,
          status: PMO_INVESTMENT_BUCKET_STATUSES.OK,
          evidenceRefs: [
            makeLowSensitiveInvestmentEvidenceRef({
              source,
              refSeed: `${query.basis}:${query.dimension}:${bucket.key}`,
              valueSummary: `${query.basis}_bucket`,
              lastUpdatedAt: updatedAt,
            }),
          ],
          warnings: [],
        })),
      ),
      { dimension: query.dimension },
    )
  }

  private emptySummary(
    user: User,
    organizationId: number,
    query: NormalizedInvestmentQuery,
  ): PmoInvestmentDistributionSummary {
    const warning = projectEmptyInvestmentPortfolioWarning()
    return {
      meta: this.buildMeta(user, organizationId, query, 0, 0, []),
      buckets: [],
      warnings: [warning],
    }
  }

  private buildMeta(
    user: User,
    organizationId: number,
    query: NormalizedInvestmentQuery,
    visibleProjectCount: number,
    totalBasisValue: number | null,
    sourceFreshness: PmoInvestmentDistributionMeta['sourceFreshness'],
  ): PmoInvestmentDistributionMeta {
    return {
      calculatedAt: new Date().toISOString(),
      metricVersion: PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION,
      organizationId,
      actorId: Number(user.id),
      visibleProjectCount,
      basis: query.basis,
      dimension: query.dimension,
      displayMode: query.displayMode,
      totalBasisValue,
      sourceFreshness,
      inputSignatureHash: stableHash(
        `${organizationId}:${user.id}:${query.basis}:${query.dimension}:${query.displayMode}:${visibleProjectCount}:${totalBasisValue}`,
      ),
    }
  }
}

function factsToBasisResult(source: PmoInvestmentSource, facts: InvestmentBasisFact[]) {
  if (facts.length === 0) {
    return { available: false, source, values: new Map<number, number>(), updatedAt: null }
  }
  return {
    available: true,
    source,
    values: new Map(facts.map((fact) => [fact.projectId, roundTwo(fact.value)])),
    updatedAt: latestUpdatedAt(facts.map((fact) => fact.updatedAt ?? null)),
  }
}

function settingString(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function latestUpdatedAt(values: Array<string | null>): string | null {
  const latest = values
    .filter((value): value is string => !!value)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0]
  return latest ? new Date(latest).toISOString() : null
}

function roundTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
