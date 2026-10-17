// 资源需求预测服务 —— 组织级只读时间分桶聚合（v3-resource-demand-forecasting §3）。
//
// 红线：
//   - 只读聚合，无副作用。
//   - 预测需求（forecastDemand）与正式分配（actualAllocation）严格分离。
//   - 不从 tasks.assignee_id 推断工作负载。
//   - 不把 resource_requirements 当作 actualAllocation。
//   - 不变异资源、任务、项目、Skill、Compiler、hiring 或分配数据。
//   - 权限先过滤，聚合后脱敏；drill-down 必须重授权。
//   - 所有查询按 organization_id 隔离。
//   - AI 只建议不自动执行。

import type {
  ForecastSummary,
  ForecastDemandCurve,
  ForecastGapAnalysis,
  ForecastProjectDriver,
  ForecastSkillDriver,
  ForecastTrendBaseline,
  ForecastDrillDownResponse,
  ForecastDrillDownQuery,
  ForecastRoleBucket,
  ForecastSkillBucket,
  ForecastProjectBucket,
  ForecastGapEntry,
  ForecastMetricBucket,
  ForecastFreshness,
  ForecastEvidenceRef,
  ForecastConfidenceBand,
  ForecastWarningCode,
  ForecastMethod,
  ForecastGranularity,
  ForecastRedactionState,
  ForecastSourceKey,
  ForecastLoadStatus,
} from '@aiproj/types'
import {
  FORECAST_WARNING_CODES,
  FORECAST_CONFIDENCE_BANDS,
  FORECAST_GAP_TYPES,
  FORECAST_METHODS,
  FORECAST_SOURCE_KEYS,
  FORECAST_REDACTION_STATES,
  RESOURCE_DEMAND_FORECASTING_METRIC_KEYS,
  normalizeDateToBucket,
  computeBucketEnd,
  computeConfidenceBand,
  computeEvidenceHash,
  makeEmptyForecastFreshness,
  normalizeForecastWarnings,
} from '@aiproj/types'

// ─── 内部类型 ──────────────────────────────────────────────────────────────────

interface ProjectFact {
  id: number
  organizationId: number
  name: string
  status: string
  updatedAt: string | null
}

interface ResourceFact {
  id: number
  projectId: number
  userId: number | null
  name: string
  role: string
  dailyCapacityHours: number
  skillTags: string | null
  updatedAt: string | null
}

interface RequirementFact {
  id: number
  projectId: number
  taskId: number
  role: string
  skillTags: string | null
  allocationPercent: number | null
  hours: number
  startDate: string
  endDate: string
  updatedAt: string | null
}

interface AllocationFact {
  id: number
  resourceId: number
  projectId: number
  taskId: number
  allocationPercent: number
  hours: number
  startDate: string
  endDate: string
  updatedAt: string | null
}

interface SkillFact {
  id: number
  resourceId: number
  skillKey: string
  originalLabel: string
  proficiencyLevel: string
  updatedAt: string | null
}

interface NormalizedForecastQuery {
  startDate: string
  endDate: string
  granularity: ForecastGranularity
  projectIds?: number[]
  roles?: string[]
  skills?: string[]
  departments?: string[]
  loadStatuses?: ForecastLoadStatus[]
  confidenceThreshold?: ForecastConfidenceBand
  method?: ForecastMethod
  topN?: number
  sort?: string
  sortDir?: string
  page?: number
  perPage?: number
  freshnessThresholdSeconds?: number
}

interface ForecastAccessContext {
  actor: { id: number; organizationId: number }
  organizationId: number
  visibleProjectIds: number[] | null // null = all
  canViewAllResources: boolean
  canViewAllSkills: boolean
  visibleResourceIds: number[] | null
  visibleSkillKeys: string[] | null
}

interface TimeBucket {
  bucketStart: string
  bucketEnd: string
  index: number
}

interface RoleBucketInternal {
  key: string
  role: string
  demand: number
  allocated: number
  available: number
  requirementCount: number
  allocationCount: number
  sourceUpdateCount: number
  maxSourceUpdatedAt: string | null
}

interface SkillBucketInternal {
  skillKey: string
  demand: number
  allocated: number
  available: number
  requirementCount: number
  allocationCount: number
  resourceCount: number
  sourceUpdateCount: number
  maxSourceUpdatedAt: string | null
}

interface ProjectBucketInternal {
  projectId: number
  demand: number
  allocated: number
  requirementCount: number
  allocationCount: number
  sourceUpdateCount: number
  maxSourceUpdatedAt: string | null
}

type BucketKey = string // "桶编号|维度值" 例如 "0|frontend"

// ─── Readers 接口（DI / 测试注入点）───────────────────────────────────────────

export interface ForecastProjectReader {
  findManyByOrg(organizationId: number, projectIds?: number[]): Promise<ProjectFact[]>
}

export interface ForecastResourceReader {
  findManyByProjects(projectIds: number[], orgId: number): Promise<ResourceFact[]>
}

export interface ForecastRequirementReader {
  findManyByProjects(projectIds: number[]): Promise<RequirementFact[]>
}

export interface ForecastAllocationReader {
  findManyByProjects(projectIds: number[]): Promise<AllocationFact[]>
}

export interface ForecastSkillReader {
  findManyByOrg(organizationId: number): Promise<SkillFact[]>
}

export interface ForecastReaders {
  readVisibleProjects?: ForecastProjectReader['findManyByOrg']
  readResources?: ForecastResourceReader['findManyByProjects']
  readRequirements?: ForecastRequirementReader['findManyByProjects']
  readAllocations?: ForecastAllocationReader['findManyByProjects']
  readSkills?: ForecastSkillReader['findManyByOrg']
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const DEFAULT_FRESHNESS_THRESHOLD_SECONDS = 86400 // 24h
const DEFAULT_TOP_N = 20
const DEFAULT_METHOD: ForecastMethod = FORECAST_METHODS.DETERMINISTIC_BUCKET
const MIN_HISTORY_FOR_TREND = 3

export default class ResourceDemandForecastingService {
  constructor(private readonly readers: ForecastReaders = {}) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary —— KPI 聚合
  // ═══════════════════════════════════════════════════════════════════════════

  async getSummary(
    organizationId: number,
    query: NormalizedForecastQuery,
    access: ForecastAccessContext,
  ): Promise<ForecastSummary> {
    const method = query.method ?? DEFAULT_METHOD
    const freshnessThresholdSeconds =
      query.freshnessThresholdSeconds ?? DEFAULT_FRESHNESS_THRESHOLD_SECONDS

    const projects = await this.fetchAuthorizedProjects(organizationId, access)
    if (projects.length === 0) {
      return this.buildEmptySummary(query, method)
    }

    const projectIds = projects.map((p) => p.id)
    const resources = await this.fetchAuthorizedResources(organizationId, projectIds, access)

    const [requirements, allocations, skillsSummary] = await Promise.all([
      this.fetchResourceRequirements(organizationId, projectIds),
      this.fetchResourceAllocations(organizationId, projectIds),
      this.fetchSkills(organizationId, access),
    ])

    // 时间分桶
    const buckets = this.buildBuckets(query.startDate, query.endDate, query.granularity)

    // 角色聚合
    const roleInternal = this.aggregateRoleDemand(requirements, allocations, resources, buckets)

    // 技能聚合
    const skillInternal = this.aggregateSkillDemand(
      requirements,
      allocations,
      resources,
      buckets,
      skillsSummary,
      access,
    )

    // 缺口
    const gaps = this.computeGaps(roleInternal, skillInternal)

    // Freshness
    const freshness = this.buildFreshness({
      resources,
      requirements,
      allocations,
      projects,
      skills: skillsSummary,
      freshnessThresholdSeconds,
    })

    // 可见覆盖率
    const allProjectIds = await this.fetchAllOrgProjectIds(organizationId)
    const projectCoverage = allProjectIds.length > 0 ? projectIds.length / allProjectIds.length : 0

    const allResourceIds = await this.fetchAllOrgResourceIds(organizationId, allProjectIds)
    const resourceCoverage = allResourceIds.length > 0

    // Warnings
    const warnings = this.buildWarnings(
      projects,
      resources,
      requirements,
      allocations,
      skillsSummary,
      freshness,
      gaps,
      resourceCoverage,
    )

    // 置信度
    const sourceFreshnessDays = freshness.overallFreshness
      ? Math.floor(
          (Date.now() - new Date(freshness.overallFreshness).getTime()) / (1000 * 60 * 60 * 24),
        )
      : null

    const overallConfidence = computeConfidenceBand({
      historicalDataPoints: requirements.length + allocations.length,
      sourceFreshnessDays,
      sourceCoverage: freshness.sourceCoverage,
      visibleProjectCount: projects.length,
    })

    // 汇总指标
    const totalDemand = roleInternal.reduce((sum, b) => sum + b.demand, 0)
    const totalAllocated = roleInternal.reduce((sum, b) => sum + b.allocated, 0)
    const totalAvailable = roleInternal.reduce((sum, b) => sum + b.available, 0)
    const totalRemaining = totalAvailable - totalAllocated
    const projectedGap = totalDemand - totalAvailable

    const shortageCount = gaps.filter((g) => g.gapType === FORECAST_GAP_TYPES.SHORTAGE).length
    const surplusCount = gaps.filter((g) => g.gapType === FORECAST_GAP_TYPES.SURPLUS).length

    const uniqueSkillResources = new Set<number>()
    for (const skill of skillsSummary) {
      uniqueSkillResources.add(skill.resourceId)
    }
    const skillCoverageRatio =
      resources.length > 0 ? uniqueSkillResources.size / resources.length : 0

    const metrics: Record<string, number> = {
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_TOTAL_DEMAND_HOURS]:
        Math.round(totalDemand * 100) / 100,
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_TOTAL_ALLOCATED_HOURS]:
        Math.round(totalAllocated * 100) / 100,
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_TOTAL_AVAILABLE_HOURS]:
        Math.round(totalAvailable * 100) / 100,
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_TOTAL_REMAINING_HOURS]:
        Math.round(totalRemaining * 100) / 100,
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_PROJECTED_GAP_HOURS]:
        Math.round(projectedGap * 100) / 100,
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_VISIBLE_PROJECT_COUNT]: projects.length,
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_VISIBLE_RESOURCE_COUNT]: resources.length,
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_SKILL_COVERAGE_RATIO]:
        Math.round(skillCoverageRatio * 10000) / 10000,
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_SHORTAGE_COUNT]: shortageCount,
      [RESOURCE_DEMAND_FORECASTING_METRIC_KEYS.FORECAST_SURPLUS_COUNT]: surplusCount,
    }

    return {
      window: {
        startDate: query.startDate,
        endDate: query.endDate,
        granularity: query.granularity,
        bucketCount: buckets.length,
      },
      metrics,
      freshness,
      overallConfidence,
      method,
      warnings,
      projectCoverage: Math.round(projectCoverage * 10000) / 10000,
      resourceCoverage: resourceCoverage ? 1 : 0, // 优化：可改为精确 ratio
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Demand Curves —— 角色/技能/项目分桶
  // ═══════════════════════════════════════════════════════════════════════════

  async getDemandCurves(
    organizationId: number,
    query: NormalizedForecastQuery,
    access: ForecastAccessContext,
  ): Promise<ForecastDemandCurve> {
    const projects = await this.fetchAuthorizedProjects(organizationId, access)
    if (projects.length === 0) {
      return {
        roleBuckets: [],
        skillBuckets: [],
        projectBuckets: [],
        warnings: [FORECAST_WARNING_CODES.NO_PROJECTS_VISIBLE],
      }
    }

    const projectIds = projects.map((p) => p.id)
    const resources = await this.fetchAuthorizedResources(organizationId, projectIds, access)
    const [requirements, allocations, skills] = await Promise.all([
      this.fetchResourceRequirements(organizationId, projectIds),
      this.fetchResourceAllocations(organizationId, projectIds),
      this.fetchSkills(organizationId, access),
    ])

    const buckets = this.buildBuckets(query.startDate, query.endDate, query.granularity)

    // 角色分桶
    const roleInternal = this.aggregateRoleDemand(requirements, allocations, resources, buckets)
    // 技能分桶
    const skillInternal = this.aggregateSkillDemand(
      requirements,
      allocations,
      resources,
      buckets,
      skills,
      access,
    )
    // 项目分桶
    const projectInternal = this.aggregateProjectDemand(
      requirements,
      allocations,
      projects,
      buckets,
    )

    const freshnessThresholdSeconds =
      query.freshnessThresholdSeconds ?? DEFAULT_FRESHNESS_THRESHOLD_SECONDS

    const roleBuckets = this.toRoleBuckets(roleInternal, buckets, freshnessThresholdSeconds, access)
    const skillBuckets = this.toSkillBuckets(
      skillInternal,
      buckets,
      freshnessThresholdSeconds,
      access,
    )
    const projectBuckets = this.toProjectBuckets(
      projectInternal,
      projects,
      buckets,
      freshnessThresholdSeconds,
      access,
    )

    const allWarnings = new Set<ForecastWarningCode>()
    // 过滤角色
    if (query.roles && query.roles.length > 0) {
      const filteredRoleBuckets = roleBuckets.filter((rb) => query.roles!.includes(rb.role))
      // apply redaction
      return this.applyQueryFilters(
        {
          roleBuckets: filteredRoleBuckets,
          skillBuckets: this.filterSkillBuckets(skillBuckets, query),
          projectBuckets: this.filterProjectBuckets(projectBuckets, query),
          warnings: normalizeForecastWarnings([...allWarnings]),
        },
        query,
      )
    }

    return this.applyQueryFilters(
      {
        roleBuckets,
        skillBuckets: this.filterSkillBuckets(skillBuckets, query),
        projectBuckets: this.filterProjectBuckets(projectBuckets, query),
        warnings: normalizeForecastWarnings([...allWarnings]),
      },
      query,
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Gap Analysis —— 缺口检测
  // ═══════════════════════════════════════════════════════════════════════════

  async getGapAnalysis(
    organizationId: number,
    query: NormalizedForecastQuery,
    access: ForecastAccessContext,
  ): Promise<ForecastGapAnalysis> {
    const projects = await this.fetchAuthorizedProjects(organizationId, access)
    if (projects.length === 0) {
      return {
        gaps: [],
        totalShortage: 0,
        totalSurplus: 0,
        netGap: 0,
        warnings: [FORECAST_WARNING_CODES.NO_PROJECTS_VISIBLE],
      }
    }

    const projectIds = projects.map((p) => p.id)
    const projectMap = new Map(projects.map((p) => [p.id, p]))
    const resources = await this.fetchAuthorizedResources(organizationId, projectIds, access)
    const [requirements, allocations, skills] = await Promise.all([
      this.fetchResourceRequirements(organizationId, projectIds),
      this.fetchResourceAllocations(organizationId, projectIds),
      this.fetchSkills(organizationId, access),
    ])

    const buckets = this.buildBuckets(query.startDate, query.endDate, query.granularity)

    const roleInternal = this.aggregateRoleDemand(requirements, allocations, resources, buckets)
    const skillInternal = this.aggregateSkillDemand(
      requirements,
      allocations,
      resources,
      buckets,
      skills,
      access,
    )

    const rawGaps = this.computeGaps(roleInternal, skillInternal)

    // 将内部缺口转为 ForecastGapEntry
    const gaps: ForecastGapEntry[] = rawGaps.map((g) => {
      const gapProjectId = g.projectId ? Number(g.projectId) : undefined
      const redaction = this.determineGapRedaction(
        { role: g.role, skill: g.skill, projectId: gapProjectId },
        access,
        projectMap,
      )

      return {
        gapType: g.gapType,
        description: this.buildGapDescription(g),
        gapHours: Math.round(g.gapHours * 100) / 100,
        direction: g.direction,
        role: redaction === FORECAST_REDACTION_STATES.REDACTED ? undefined : g.role,
        skill: redaction === FORECAST_REDACTION_STATES.REDACTED ? undefined : g.skill,
        projectId:
          redaction === FORECAST_REDACTION_STATES.REDACTED ? undefined : g.projectId?.toString(),
        bucketStart: g.bucketStart,
        bucketEnd: g.bucketEnd,
        confidence: g.confidence,
        warnings: g.warnings,
        evidenceRefs: g.evidenceRefs,
        redaction,
      }
    })

    // 用 query 参数过滤
    let filtered = gaps
    if (query.roles && query.roles.length > 0) {
      filtered = filtered.filter((g) => !g.role || query.roles!.includes(g.role))
    }
    if (query.skills && query.skills.length > 0) {
      filtered = filtered.filter((g) => !g.skill || query.skills!.includes(g.skill))
    }
    if (query.projectIds && query.projectIds.length > 0) {
      filtered = filtered.filter(
        (g) => !g.projectId || query.projectIds!.includes(Number(g.projectId)),
      )
    }
    if (query.confidenceThreshold) {
      const thresholdOrder = {
        [FORECAST_CONFIDENCE_BANDS.HIGH]: 3,
        [FORECAST_CONFIDENCE_BANDS.MEDIUM]: 2,
        [FORECAST_CONFIDENCE_BANDS.LOW]: 1,
        [FORECAST_CONFIDENCE_BANDS.UNKNOWN]: 0,
      }
      const minOrder = thresholdOrder[query.confidenceThreshold] ?? 0
      filtered = filtered.filter((g) => (thresholdOrder[g.confidence] ?? 0) >= minOrder)
    }

    const totalShortage = filtered
      .filter((g) => g.direction === 'shortage')
      .reduce((sum, g) => sum + Math.abs(g.gapHours), 0)
    const totalSurplus = filtered
      .filter((g) => g.direction === 'surplus')
      .reduce((sum, g) => sum + Math.abs(g.gapHours), 0)

    let topN = query.topN ?? DEFAULT_TOP_N
    if (query.sort === 'gap' || !query.sort) {
      filtered.sort((a, b) => {
        const byDir = a.direction === 'shortage' ? -1 : 1
        const byBdir = b.direction === 'shortage' ? -1 : 1
        if (byDir !== byBdir) return byDir - byBdir
        return Math.abs(b.gapHours) - Math.abs(a.gapHours)
      })
    }
    if (query.sortDir === 'asc') filtered.reverse()
    if (topN > 0) filtered = filtered.slice(0, topN)

    const warnings = normalizeForecastWarnings(filtered.flatMap((g) => g.warnings))

    return {
      gaps: filtered,
      totalShortage: Math.round(totalShortage * 100) / 100,
      totalSurplus: Math.round(totalSurplus * 100) / 100,
      netGap: Math.round((totalSurplus - totalShortage) * 100) / 100,
      warnings,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Project Drivers —— 项目级需求驱动
  // ═══════════════════════════════════════════════════════════════════════════

  async getProjectDrivers(
    organizationId: number,
    query: NormalizedForecastQuery,
    access: ForecastAccessContext,
  ): Promise<ForecastProjectDriver[]> {
    const projects = await this.fetchAuthorizedProjects(organizationId, access)
    if (projects.length === 0) return []

    const projectIds = projects.map((p) => p.id)
    const projectMap = new Map(projects.map((p) => [p.id, p]))
    const [requirements, allocations] = await Promise.all([
      this.fetchResourceRequirements(organizationId, projectIds),
      this.fetchResourceAllocations(organizationId, projectIds),
    ])

    const buckets = this.buildBuckets(query.startDate, query.endDate, query.granularity)
    const projectInternal = this.aggregateProjectDemand(
      requirements,
      allocations,
      projects,
      buckets,
    )

    const drivers = this.computeProjectDrivers(projectInternal)

    const totalOrgDemand = drivers.reduce((sum, d) => sum + d.totalDemand, 0)

    const freshnessThresholdSeconds =
      query.freshnessThresholdSeconds ?? DEFAULT_FRESHNESS_THRESHOLD_SECONDS

    let result: ForecastProjectDriver[] = drivers.map((d) => {
      const project = projectMap.get(d.projectId)
      const redaction =
        !access.canViewAllResources || !project ? FORECAST_REDACTION_STATES.REDACTED : undefined

      const sourceFreshnessDays = d.maxSourceUpdatedAt
        ? Math.floor(
            (Date.now() - new Date(d.maxSourceUpdatedAt).getTime()) / (1000 * 60 * 60 * 24),
          )
        : null

      const confidence = computeConfidenceBand({
        historicalDataPoints: d.requirementCount + d.allocationCount,
        sourceFreshnessDays,
        sourceCoverage: d.requirementCount > 0 ? 0.5 : 0,
        visibleProjectCount: projects.length,
      })

      const warnings: ForecastWarningCode[] = []
      if (d.sourceUpdateCount === 0) {
        warnings.push(FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY)
      }
      const maxUpdated = new Date(d.maxSourceUpdatedAt ?? 0).getTime()
      if (d.maxSourceUpdatedAt && Date.now() - maxUpdated > freshnessThresholdSeconds * 1000) {
        warnings.push(FORECAST_WARNING_CODES.STALE_SOURCE)
      }
      if (redaction) {
        warnings.push(FORECAST_WARNING_CODES.DIMENSION_REDACTED)
      }

      return {
        projectId: d.projectId.toString(),
        projectName: redaction ? undefined : project?.name,
        totalDemand: Math.round(d.totalDemand * 100) / 100,
        totalAllocated: Math.round(d.totalAllocated * 100) / 100,
        demandShare:
          totalOrgDemand > 0 ? Math.round((d.totalDemand / totalOrgDemand) * 10000) / 10000 : 0,
        peakGap: Math.round(d.peakGap * 100) / 100,
        peakGapBucket: d.peakGapBucket,
        confidence,
        warnings: normalizeForecastWarnings(warnings),
        redaction,
      }
    })

    // 过滤
    if (query.projectIds && query.projectIds.length > 0) {
      result = result.filter((d) => query.projectIds!.includes(Number(d.projectId)))
    }
    if (query.confidenceThreshold) {
      const thresholdOrder: Record<string, number> = {
        high: 3,
        medium: 2,
        low: 1,
        unknown: 0,
      }
      const minOrder = thresholdOrder[query.confidenceThreshold] ?? 0
      result = result.filter((d) => (thresholdOrder[d.confidence] ?? 0) >= minOrder)
    }

    // 排序
    const sortDir = query.sortDir === 'asc' ? -1 : 1
    result.sort((a, b) => (b.totalDemand - a.totalDemand) * sortDir)

    const topN = query.topN ?? DEFAULT_TOP_N
    return result.slice(0, topN)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Skill Drivers —— 技能级需求驱动
  // ═══════════════════════════════════════════════════════════════════════════

  async getSkillDrivers(
    organizationId: number,
    query: NormalizedForecastQuery,
    access: ForecastAccessContext,
  ): Promise<ForecastSkillDriver[]> {
    const projects = await this.fetchAuthorizedProjects(organizationId, access)
    if (projects.length === 0) return []

    const projectIds = projects.map((p) => p.id)
    const resources = await this.fetchAuthorizedResources(organizationId, projectIds, access)
    const [requirements, allocations, skills] = await Promise.all([
      this.fetchResourceRequirements(organizationId, projectIds),
      this.fetchResourceAllocations(organizationId, projectIds),
      this.fetchSkills(organizationId, access),
    ])

    const buckets = this.buildBuckets(query.startDate, query.endDate, query.granularity)
    const skillInternal = this.aggregateSkillDemand(
      requirements,
      allocations,
      resources,
      buckets,
      skills,
      access,
    )

    const drivers = this.computeSkillDrivers(skillInternal)

    const totalOrgDemand = drivers.reduce((sum, d) => sum + d.totalDemand, 0)

    const freshnessThresholdSeconds =
      query.freshnessThresholdSeconds ?? DEFAULT_FRESHNESS_THRESHOLD_SECONDS

    let result: ForecastSkillDriver[] = drivers.map((d) => {
      const redaction = this.shouldRedactSkill(d.skillKey, access)
        ? FORECAST_REDACTION_STATES.REDACTED
        : undefined

      const sourceFreshnessDays = d.maxSourceUpdatedAt
        ? Math.floor(
            (Date.now() - new Date(d.maxSourceUpdatedAt).getTime()) / (1000 * 60 * 60 * 24),
          )
        : null

      const confidence = computeConfidenceBand({
        historicalDataPoints: d.requirementCount + d.allocationCount,
        sourceFreshnessDays,
        sourceCoverage: d.requirementCount > 0 ? 0.5 : 0,
        visibleProjectCount: projects.length,
      })

      const warnings: ForecastWarningCode[] = []
      if (d.sourceUpdateCount === 0) {
        warnings.push(FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY)
      }
      const maxUpdated = new Date(d.maxSourceUpdatedAt ?? 0).getTime()
      if (d.maxSourceUpdatedAt && Date.now() - maxUpdated > freshnessThresholdSeconds * 1000) {
        warnings.push(FORECAST_WARNING_CODES.STALE_SOURCE)
      }
      if (redaction) {
        warnings.push(FORECAST_WARNING_CODES.DIMENSION_REDACTED)
      }

      return {
        skill: d.skillKey,
        originalLabel: d.originalLabel,
        totalDemand: Math.round(d.totalDemand * 100) / 100,
        demandShare:
          totalOrgDemand > 0 ? Math.round((d.totalDemand / totalOrgDemand) * 10000) / 10000 : 0,
        coveredHours: Math.round(d.coveredHours * 100) / 100,
        gapHours: Math.round(d.gapHours * 100) / 100,
        projectCount: d.projectCount,
        confidence,
        warnings: normalizeForecastWarnings(warnings),
        redaction,
      }
    })

    // 过滤
    if (query.skills && query.skills.length > 0) {
      result = result.filter((d) => query.skills!.includes(d.skill))
    }
    if (query.confidenceThreshold) {
      const thresholdOrder: Record<string, number> = {
        high: 3,
        medium: 2,
        low: 1,
        unknown: 0,
      }
      const minOrder = thresholdOrder[query.confidenceThreshold] ?? 0
      result = result.filter((d) => (thresholdOrder[d.confidence] ?? 0) >= minOrder)
    }

    // 排序
    const sortDir = query.sortDir === 'asc' ? -1 : 1
    result.sort((a, b) => (b.totalDemand - a.totalDemand) * sortDir)

    const topN = query.topN ?? DEFAULT_TOP_N
    return result.slice(0, topN)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Trend Baseline —— 历史基线
  // ═══════════════════════════════════════════════════════════════════════════

  async getTrendBaseline(
    organizationId: number,
    query: NormalizedForecastQuery,
    access: ForecastAccessContext,
  ): Promise<ForecastTrendBaseline> {
    const method = query.method ?? FORECAST_METHODS.TREND_PROJECTION

    const projects = await this.fetchAuthorizedProjects(organizationId, access)
    if (projects.length === 0) {
      return {
        buckets: [],
        method,
        historicalDataPoints: 0,
        warnings: [FORECAST_WARNING_CODES.NO_PROJECTS_VISIBLE],
      }
    }

    const projectIds = projects.map((p) => p.id)
    const resources = await this.fetchAuthorizedResources(organizationId, projectIds, access)
    const [requirements, allocations] = await Promise.all([
      this.fetchResourceRequirements(organizationId, projectIds),
      this.fetchResourceAllocations(organizationId, projectIds),
    ])

    const buckets = this.buildBuckets(query.startDate, query.endDate, query.granularity)
    const freshnessThresholdSeconds =
      query.freshnessThresholdSeconds ?? DEFAULT_FRESHNESS_THRESHOLD_SECONDS

    // 历史基线：复用当前已结束/进行中的需求与分配作为历史参考点
    // 按角色维度聚合趋势
    const roleInternal = this.aggregateRoleDemand(requirements, allocations, resources, buckets)

    const warnings: ForecastWarningCode[] = []
    const historicalDataPoints = requirements.length + allocations.length

    if (historicalDataPoints < MIN_HISTORY_FOR_TREND) {
      warnings.push(FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY)
    }
    if (historicalDataPoints === 0) {
      warnings.push(FORECAST_WARNING_CODES.LOW_CONFIDENCE)
    }

    // 将每个角色在每个桶的数据转为 ForecastMetricBucket
    const metricBuckets: ForecastMetricBucket[] = []
    for (const ri of roleInternal) {
      const [bucketIndexStr] = this.splitBucketKey(ri.key)
      const bucketIndex = Number.parseInt(bucketIndexStr, 10)
      const bucket = buckets[bucketIndex]
      if (!bucket) continue

      const sourceFreshnessDays = ri.maxSourceUpdatedAt
        ? Math.floor(
            (Date.now() - new Date(ri.maxSourceUpdatedAt).getTime()) / (1000 * 60 * 60 * 24),
          )
        : null

      const confidence = computeConfidenceBand({
        historicalDataPoints: ri.requirementCount + ri.allocationCount,
        sourceFreshnessDays,
        sourceCoverage: ri.requirementCount > 0 ? 0.5 : 0,
        visibleProjectCount: projects.length,
      })

      const remaining = ri.available - ri.allocated
      const gap = ri.demand - ri.available

      const bucketWarnings: ForecastWarningCode[] = []
      const maxUpdated = new Date(ri.maxSourceUpdatedAt ?? 0).getTime()
      if (ri.maxSourceUpdatedAt && Date.now() - maxUpdated > freshnessThresholdSeconds * 1000) {
        bucketWarnings.push(FORECAST_WARNING_CODES.STALE_SOURCE)
      }

      metricBuckets.push({
        bucketStart: bucket.bucketStart,
        bucketEnd: bucket.bucketEnd,
        forecastDemand: Math.round(ri.demand * 100) / 100,
        actualAllocation: Math.round(ri.allocated * 100) / 100,
        available: Math.round(ri.available * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        gap: Math.round(gap * 100) / 100,
        confidence,
        method,
        sourceFreshness: ri.maxSourceUpdatedAt,
        warnings: normalizeForecastWarnings(bucketWarnings),
        evidenceRefs: this.buildEvidenceRefs(ri),
      })
    }

    return {
      buckets: metricBuckets,
      method,
      historicalDataPoints,
      warnings: normalizeForecastWarnings(warnings),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Drill-Down —— 安全下钻（重授权）
  // ═══════════════════════════════════════════════════════════════════════════

  async getDrillDown(
    organizationId: number,
    drillDownQuery: ForecastDrillDownQuery,
    access: ForecastAccessContext,
  ): Promise<ForecastDrillDownResponse> {
    const { targetType, targetId } = drillDownQuery

    // 重授权：每种目标类型都需要检查对应权限
    switch (targetType) {
      case 'project': {
        const projectId = Number.parseInt(targetId, 10)
        if (Number.isNaN(projectId)) {
          return {
            targetType,
            targetId,
            details: { error: '无效项目 ID' },
            warnings: [],
            redaction: FORECAST_REDACTION_STATES.FORBIDDEN,
          }
        }
        if (access.visibleProjectIds !== null && !access.visibleProjectIds.includes(projectId)) {
          return {
            targetType,
            targetId,
            details: { error: '无权查看该项目' },
            warnings: [FORECAST_WARNING_CODES.PARTIAL_VISIBILITY],
            redaction: FORECAST_REDACTION_STATES.FORBIDDEN,
          }
        }

        const { default: ProjectModel } = await import('#models/project')
        const project = await ProjectModel.query()
          .where('id', projectId)
          .where('organization_id', organizationId)
          .whereNull('deleted_at')
          .first()

        if (!project) {
          return {
            targetType,
            targetId,
            details: { error: '项目不存在' },
            warnings: [],
            redaction: FORECAST_REDACTION_STATES.UNAVAILABLE,
          }
        }

        return {
          targetType,
          targetId,
          details: {
            id: Number(project.id),
            name: project.name,
            status: project.status,
          },
          warnings: [],
        }
      }

      case 'task': {
        const taskId = Number.parseInt(targetId, 10)
        if (Number.isNaN(taskId)) {
          return {
            targetType,
            targetId,
            details: { error: '无效任务 ID' },
            warnings: [],
            redaction: FORECAST_REDACTION_STATES.FORBIDDEN,
          }
        }

        const { default: TaskModel } = await import('#models/task')
        const task = await TaskModel.query()
          .where('id', taskId)
          .where('organization_id', organizationId)
          .first()

        if (!task) {
          return {
            targetType,
            targetId,
            details: { error: '任务不存在' },
            warnings: [],
            redaction: FORECAST_REDACTION_STATES.UNAVAILABLE,
          }
        }

        // 检查任务所属项目是否可见
        const taskProjectId = Number((task as { projectId?: number }).projectId ?? 0)
        if (
          taskProjectId &&
          access.visibleProjectIds !== null &&
          !access.visibleProjectIds.includes(taskProjectId)
        ) {
          return {
            targetType,
            targetId,
            details: { error: '无权查看该任务所属项目' },
            warnings: [FORECAST_WARNING_CODES.PARTIAL_VISIBILITY],
            redaction: FORECAST_REDACTION_STATES.FORBIDDEN,
          }
        }

        return {
          targetType,
          targetId,
          details: {
            id: Number(task.id),
            name: task.name,
            status: task.status,
          },
          warnings: [],
        }
      }

      case 'resource': {
        const resourceId = Number.parseInt(targetId, 10)
        if (Number.isNaN(resourceId)) {
          return {
            targetType,
            targetId,
            details: { error: '无效资源 ID' },
            warnings: [],
            redaction: FORECAST_REDACTION_STATES.FORBIDDEN,
          }
        }
        if (!access.canViewAllResources && access.visibleResourceIds !== null) {
          if (!access.visibleResourceIds.includes(resourceId)) {
            return {
              targetType,
              targetId,
              details: { error: '无权查看该资源' },
              warnings: [FORECAST_WARNING_CODES.PARTIAL_VISIBILITY],
              redaction: FORECAST_REDACTION_STATES.FORBIDDEN,
            }
          }
        }

        const { default: ResourceModel } = await import('#models/resource')
        const resource = await ResourceModel.query()
          .where('id', resourceId)
          .whereNull('deleted_at')
          .first()

        if (!resource) {
          return {
            targetType,
            targetId,
            details: { error: '资源不存在' },
            warnings: [],
            redaction: FORECAST_REDACTION_STATES.UNAVAILABLE,
          }
        }

        return {
          targetType,
          targetId,
          details: {
            id: Number(resource.id),
            name: resource.name,
            role: (resource as { role: string }).role,
            status: (resource as { status: string }).status,
          },
          warnings: [],
        }
      }

      case 'skill': {
        if (!access.canViewAllSkills && access.visibleSkillKeys !== null) {
          if (!access.visibleSkillKeys.includes(targetId)) {
            return {
              targetType,
              targetId,
              details: { error: '无权查看该技能' },
              warnings: [FORECAST_WARNING_CODES.PARTIAL_VISIBILITY],
              redaction: FORECAST_REDACTION_STATES.FORBIDDEN,
            }
          }
        }

        const skills = await this.fetchSkills(organizationId, access)
        const skill = skills.find((s) => s.skillKey === targetId || s.originalLabel === targetId)

        return {
          targetType,
          targetId,
          details: {
            skillKey: skill?.skillKey ?? targetId,
            originalLabel: skill?.originalLabel ?? targetId,
            proficiencyLevel: skill?.proficiencyLevel ?? 'unknown',
            available: !!skill,
          },
          warnings: skill ? [] : [FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY],
        }
      }

      case 'gap': {
        // 缺口下钻：返回关联维度的有限信息
        const gapType = drillDownQuery.gapType
        return {
          targetType,
          targetId,
          details: {
            gapType: gapType ?? 'unknown',
            role: drillDownQuery.role ?? null,
            skill: drillDownQuery.skill ?? null,
            projectId: drillDownQuery.projectId ?? null,
            bucketStart: drillDownQuery.bucketStart ?? null,
            bucketEnd: drillDownQuery.bucketEnd ?? null,
          },
          warnings: gapType ? [] : [FORECAST_WARNING_CODES.LOW_CONFIDENCE],
        }
      }

      case 'driver': {
        // 驱动因素下钻
        return {
          targetType,
          targetId,
          details: {
            driverId: targetId,
            role: drillDownQuery.role ?? null,
            skill: drillDownQuery.skill ?? null,
            projectId: drillDownQuery.projectId ?? null,
          },
          warnings: [],
        }
      }

      case 'evidence': {
        // 证据下钻：返回来源哈希加有限元数据
        return {
          targetType,
          targetId,
          details: {
            evidenceHash: computeEvidenceHash(targetId),
            sourceHint: '来源于已授权的资源需求与分配事实',
          },
          warnings: [],
        }
      }

      default:
        return {
          targetType,
          targetId,
          details: { error: `不支持的下钻类型: ${targetType}` },
          warnings: [],
          redaction: FORECAST_REDACTION_STATES.FORBIDDEN,
        }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：获取已授权项目
  // ═══════════════════════════════════════════════════════════════════════════

  private async fetchAuthorizedProjects(
    organizationId: number,
    access: ForecastAccessContext,
  ): Promise<ProjectFact[]> {
    if (this.readers.readVisibleProjects) {
      const all = await this.readers.readVisibleProjects(organizationId)
      let filtered = all.filter((p) => Number(p.organizationId) === Number(organizationId))
      if (access.visibleProjectIds !== null) {
        filtered = filtered.filter((p) => access.visibleProjectIds!.includes(p.id))
      }
      return filtered
    }

    const { default: ProjectModel } = await import('#models/project')
    const rows = await ProjectModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .orderBy('updated_at', 'desc')
      .limit(2000)

    let projects: ProjectFact[] = rows.map((p) => ({
      id: Number(p.id),
      organizationId: Number(p.organizationId),
      name: p.name,
      status: p.status,
      updatedAt: p.updatedAt?.toISO() ?? null,
    }))

    if (access.visibleProjectIds !== null) {
      projects = projects.filter((p) => access.visibleProjectIds!.includes(p.id))
    }

    return projects
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：获取已授权资源
  // ═══════════════════════════════════════════════════════════════════════════

  private async fetchAuthorizedResources(
    organizationId: number,
    projectIds: number[],
    access: ForecastAccessContext,
  ): Promise<ResourceFact[]> {
    if (projectIds.length === 0) return []

    if (this.readers.readResources) {
      const all = await this.readers.readResources(projectIds, organizationId)
      let filtered = all
      if (access.visibleResourceIds !== null) {
        filtered = filtered.filter((r) => access.visibleResourceIds!.includes(r.id))
      }
      return filtered
    }

    const { default: ResourceModel } = await import('#models/resource')
    const rows = await ResourceModel.query()
      .whereIn('project_id', projectIds)
      .whereNull('deleted_at')
      .select(
        'id',
        'project_id',
        'user_id',
        'name',
        'role',
        'daily_capacity_hours',
        'skill_tags',
        'updated_at',
      )

    let resources: ResourceFact[] = rows.map((r) => ({
      id: Number(r.id),
      projectId: Number((r as { projectId: number }).projectId),
      userId: (r as { userId: number | null }).userId
        ? Number((r as { userId: number | null }).userId)
        : null,
      name: r.name,
      role: (r as { role: string }).role,
      dailyCapacityHours: Number((r as { dailyCapacityHours: number }).dailyCapacityHours ?? 8),
      skillTags: (r as { skillTags: string | null }).skillTags ?? null,
      updatedAt: r.updatedAt?.toISO() ?? null,
    }))

    if (access.visibleResourceIds !== null) {
      resources = resources.filter((r) => access.visibleResourceIds!.includes(r.id))
    }

    return resources
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：获取资源需求事实
  // ═══════════════════════════════════════════════════════════════════════════

  private async fetchResourceRequirements(
    organizationId: number,
    projectIds: number[],
  ): Promise<RequirementFact[]> {
    if (projectIds.length === 0) return []

    if (this.readers.readRequirements) {
      // reader 不提供 startDate/endDate，Service 内部拉全量
      return this.readers.readRequirements(projectIds)
    }

    const { default: TaskResourceRequirementModel } =
      await import('#models/task_resource_requirement')
    const rows = await TaskResourceRequirementModel.query()
      .whereIn('project_id', projectIds)
      .where('organization_id', organizationId)
      .whereNotIn('status', ['fulfilled', 'cancelled'])

    return rows.map((req) => ({
      id: Number(req.id),
      projectId: Number((req as { projectId: number }).projectId),
      taskId: Number((req as { taskId: number }).taskId),
      role: (req as { role: string }).role,
      skillTags: (req as { skillTags: string | null }).skillTags ?? null,
      allocationPercent: (req as { allocationPercent: number | null }).allocationPercent ?? null,
      hours: Number((req as { estimatedPersonDays?: number }).estimatedPersonDays ?? 1) * 8,
      startDate:
        (req as unknown as { startDate: { toString: () => string } }).startDate?.toString() ?? '',
      endDate:
        (req as unknown as { endDate: { toString: () => string } }).endDate?.toString() ?? '',
      updatedAt: req.updatedAt?.toISO() ?? null,
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：获取资源分配事实
  // ═══════════════════════════════════════════════════════════════════════════

  private async fetchResourceAllocations(
    _organizationId: number,
    projectIds: number[],
  ): Promise<AllocationFact[]> {
    if (projectIds.length === 0) return []

    if (this.readers.readAllocations) {
      return this.readers.readAllocations(projectIds)
    }

    const { default: ResourceAllocationModel } = await import('#models/resource_allocation')
    const rows = await ResourceAllocationModel.query().whereIn(
      'resource_id',
      await this.getAllocationResourceIds(projectIds),
    )

    // 构建 resourceId -> projectId 映射
    const resourceProjectMap = await this.buildResourceProjectMap(projectIds)

    return rows.map((a) => {
      const resourceId = Number((a as { resourceId: number }).resourceId)
      return {
        id: Number(a.id),
        resourceId,
        projectId: resourceProjectMap.get(resourceId) ?? 0,
        taskId: Number((a as { taskId: number }).taskId),
        allocationPercent: Number((a as { allocationPercent: number }).allocationPercent ?? 0),
        hours: Number((a as { plannedUnits?: number }).plannedUnits ?? 0),
        startDate: (a as { startDate: string | null }).startDate?.toString() ?? '',
        endDate: (a as { endDate: string | null }).endDate?.toString() ?? '',
        updatedAt: a.updatedAt?.toISO() ?? null,
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：获取 Skill 事实
  // ═══════════════════════════════════════════════════════════════════════════

  private async fetchSkills(
    organizationId: number,
    access: ForecastAccessContext,
  ): Promise<SkillFact[]> {
    if (!access.canViewAllSkills) return []

    if (this.readers.readSkills) {
      return this.readers.readSkills(organizationId)
    }

    // 从 CompilerSkill 表读取规范化技能
    try {
      const { default: CompilerSkill } = await import('#models/compiler_skill')
      const rows = await CompilerSkill.forOrganization(organizationId)

      let skills: SkillFact[] = rows.map((s) => ({
        id: Number(s.id),
        resourceId: 0, // CompilerSkill 是组织级，不绑定单个 resource
        skillKey: s.skillKey,
        originalLabel: s.name,
        proficiencyLevel: 'known',
        updatedAt: s.updatedAt?.toISO() ?? null,
      }))

      if (access.visibleSkillKeys !== null) {
        skills = skills.filter((s) => access.visibleSkillKeys!.includes(s.skillKey))
      }

      return skills
    } catch {
      // CompilerSkill 表可能不存在，回退到从资源 skill_tags 提取
      return []
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：构建时间分桶
  // ═══════════════════════════════════════════════════════════════════════════

  private buildBuckets(
    startDate: string,
    endDate: string,
    granularity: ForecastGranularity,
  ): TimeBucket[] {
    const buckets: TimeBucket[] = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return buckets

    let current = new Date(start)
    let index = 0

    while (current <= end) {
      const bucketStart = normalizeDateToBucket(current.toISOString().slice(0, 10), granularity)
      const bucketEnd = computeBucketEnd(bucketStart, granularity)

      buckets.push({
        bucketStart,
        bucketEnd,
        index,
      })

      index++
      current = new Date(bucketEnd)
    }

    return buckets
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：角色维度聚合（按时间桶 × 角色）
  // ═══════════════════════════════════════════════════════════════════════════

  private aggregateRoleDemand(
    requirements: RequirementFact[],
    allocations: AllocationFact[],
    resources: ResourceFact[],
    buckets: TimeBucket[],
  ): RoleBucketInternal[] {
    const map = new Map<BucketKey, RoleBucketInternal>()

    const ensureEntry = (bucketIndex: number, role: string): RoleBucketInternal => {
      const key = `${bucketIndex}|${role}`
      let entry = map.get(key)
      if (!entry) {
        entry = {
          key,
          role,
          demand: 0,
          allocated: 0,
          available: 0,
          requirementCount: 0,
          allocationCount: 0,
          sourceUpdateCount: 0,
          maxSourceUpdatedAt: null,
        }
        map.set(key, entry)
      }
      return entry
    }

    // 从资源需求聚合 —— 作为预测需求指标
    // 红线：NEVER treat requirements as allocations
    for (const req of requirements) {
      // 找出需求日期跨度覆盖的所有桶
      const reqStart = req.startDate
      const reqEnd = req.endDate
      if (!reqStart || !reqEnd) continue

      for (const [i, bucket] of buckets.entries()) {
        if (bucket.bucketStart > reqEnd || bucket.bucketEnd < reqStart) continue

        // 重叠天数比例
        const overlapStart = new Date(
          Math.max(new Date(bucket.bucketStart).getTime(), new Date(reqStart).getTime()),
        )
        const overlapEnd = new Date(
          Math.min(new Date(bucket.bucketEnd).getTime(), new Date(reqEnd).getTime()),
        )
        const totalReqDays = this.dayDiff(reqStart, reqEnd)
        const overlapDays = this.dayDiff(
          overlapStart.toISOString().slice(0, 10),
          overlapEnd.toISOString().slice(0, 10),
        )
        const ratio = totalReqDays > 0 ? overlapDays / totalReqDays : 1

        const entry = ensureEntry(i, req.role)
        entry.demand += req.hours * ratio
        entry.requirementCount += 1
        entry.sourceUpdateCount += 1
        if (req.updatedAt) {
          const t = new Date(req.updatedAt).getTime()
          const cur = entry.maxSourceUpdatedAt ? new Date(entry.maxSourceUpdatedAt).getTime() : 0
          if (t > cur) entry.maxSourceUpdatedAt = req.updatedAt
        }
      }
    }

    // 从资源分配聚合 —— 作为 actualAllocation
    for (const alloc of allocations) {
      const allocStart = alloc.startDate
      const allocEnd = alloc.endDate
      if (!allocStart || !allocEnd) continue

      // 找到该分配对应的资源
      const resource = resources.find((r) => r.id === alloc.resourceId)
      const role = resource?.role ?? 'unknown'

      for (const [i, bucket] of buckets.entries()) {
        if (bucket.bucketStart > allocEnd || bucket.bucketEnd < allocStart) continue

        const overlapStart = new Date(
          Math.max(new Date(bucket.bucketStart).getTime(), new Date(allocStart).getTime()),
        )
        const overlapEnd = new Date(
          Math.min(new Date(bucket.bucketEnd).getTime(), new Date(allocEnd).getTime()),
        )
        const totalAllocDays = this.dayDiff(allocStart, allocEnd)
        const overlapDays = this.dayDiff(
          overlapStart.toISOString().slice(0, 10),
          overlapEnd.toISOString().slice(0, 10),
        )
        const ratio = totalAllocDays > 0 ? overlapDays / totalAllocDays : 1

        const entry = ensureEntry(i, role)
        entry.allocated += alloc.hours * ratio
        entry.allocationCount += 1
        entry.sourceUpdateCount += 1
        if (alloc.updatedAt) {
          const t = new Date(alloc.updatedAt).getTime()
          const cur = entry.maxSourceUpdatedAt ? new Date(entry.maxSourceUpdatedAt).getTime() : 0
          if (t > cur) entry.maxSourceUpdatedAt = alloc.updatedAt
        }
      }
    }

    // 可用容量：基于资源角色的 daily_capacity_hours × 桶天数
    const roleCapacityMap = new Map<string, number>()
    for (const resource of resources) {
      if (!resource.role) continue
      const existing = roleCapacityMap.get(resource.role) ?? 0
      roleCapacityMap.set(resource.role, existing + resource.dailyCapacityHours)
    }

    for (const [, entry] of map) {
      const [, role] = this.splitBucketKey(`${0}|${entry.role}`)
      const dailyCapacity = roleCapacityMap.get(role) ?? 0
      // 桶天数（按粒度）
      const bucketDays = this.bucketDayCount(entry, buckets)
      entry.available = dailyCapacity * bucketDays
    }

    return [...map.values()]
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：技能维度聚合（含归一化）
  // ═══════════════════════════════════════════════════════════════════════════

  private aggregateSkillDemand(
    requirements: RequirementFact[],
    allocations: AllocationFact[],
    resources: ResourceFact[],
    buckets: TimeBucket[],
    skills: SkillFact[],
    access: ForecastAccessContext,
  ): SkillBucketInternal[] {
    const map = new Map<BucketKey, SkillBucketInternal>()

    const ensureEntry = (bucketIndex: number, skillKey: string): SkillBucketInternal => {
      const key = `${bucketIndex}|${skillKey}`
      let entry = map.get(key)
      if (!entry) {
        entry = {
          skillKey,
          demand: 0,
          allocated: 0,
          available: 0,
          requirementCount: 0,
          allocationCount: 0,
          resourceCount: 0,
          sourceUpdateCount: 0,
          maxSourceUpdatedAt: null,
        }
        map.set(key, entry)
      }
      return entry
    }

    // 归一化映射表（从 CompilerSkill 或资源标签建立）
    const normalizedKeyMap = new Map<string, string>() // 原始标签 → 规范化 key
    for (const skill of skills) {
      normalizedKeyMap.set(skill.originalLabel.toLowerCase(), skill.skillKey)
    }

    const normalizeKey = (raw: string): string => {
      const lower = raw.trim().toLowerCase()
      return normalizedKeyMap.get(lower) ?? lower
    }

    // 资源技能容量（从 skill_tags）
    const skillResourceMap = new Map<string, Set<number>>()
    for (const resource of resources) {
      if (!resource.skillTags) continue
      const tags = resource.skillTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      for (const tag of tags) {
        const key = normalizeKey(tag)
        let set = skillResourceMap.get(key)
        if (!set) {
          set = new Set()
          skillResourceMap.set(key, set)
        }
        set.add(resource.id)
      }
    }

    // 从需求聚合技能需求
    for (const req of requirements) {
      if (!req.startDate || !req.endDate) continue
      const tags = req.skillTags
        ? req.skillTags
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [req.role]
      if (tags.length === 0) continue

      for (const [i, bucket] of buckets.entries()) {
        if (bucket.bucketStart > req.endDate || bucket.bucketEnd < req.startDate) continue

        const overlapStart = new Date(
          Math.max(new Date(bucket.bucketStart).getTime(), new Date(req.startDate).getTime()),
        )
        const overlapEnd = new Date(
          Math.min(new Date(bucket.bucketEnd).getTime(), new Date(req.endDate).getTime()),
        )
        const totalReqDays = this.dayDiff(req.startDate, req.endDate)
        const overlapDays = this.dayDiff(
          overlapStart.toISOString().slice(0, 10),
          overlapEnd.toISOString().slice(0, 10),
        )
        const ratio = totalReqDays > 0 ? overlapDays / totalReqDays : 1

        // 每个技能标签均匀分得需求小时
        const demandPerTag = (req.hours * ratio) / tags.length
        for (const tag of tags) {
          const skillKey = normalizeKey(tag)
          // 技能敏感度——如果不在可见集中且不可见所有技能，跳过
          if (!access.canViewAllSkills && access.visibleSkillKeys !== null) {
            if (!access.visibleSkillKeys.includes(skillKey)) continue
          }

          const entry = ensureEntry(i, skillKey)
          entry.demand += demandPerTag
          entry.requirementCount += 1
          entry.sourceUpdateCount += 1
          if (req.updatedAt) {
            const t = new Date(req.updatedAt).getTime()
            const cur = entry.maxSourceUpdatedAt ? new Date(entry.maxSourceUpdatedAt).getTime() : 0
            if (t > cur) entry.maxSourceUpdatedAt = req.updatedAt
          }
        }
      }
    }

    // 从分配聚合技能分配
    for (const alloc of allocations) {
      if (!alloc.startDate || !alloc.endDate) continue
      const resource = resources.find((r) => r.id === alloc.resourceId)
      if (!resource?.skillTags) continue
      const tags = resource.skillTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (tags.length === 0) continue

      for (const [i, bucket] of buckets.entries()) {
        if (bucket.bucketStart > alloc.endDate || bucket.bucketEnd < alloc.startDate) continue

        const overlapStart = new Date(
          Math.max(new Date(bucket.bucketStart).getTime(), new Date(alloc.startDate).getTime()),
        )
        const overlapEnd = new Date(
          Math.min(new Date(bucket.bucketEnd).getTime(), new Date(alloc.endDate).getTime()),
        )
        const totalAllocDays = this.dayDiff(alloc.startDate, alloc.endDate)
        const overlapDays = this.dayDiff(
          overlapStart.toISOString().slice(0, 10),
          overlapEnd.toISOString().slice(0, 10),
        )
        const ratio = totalAllocDays > 0 ? overlapDays / totalAllocDays : 1

        const allocPerTag = (alloc.hours * ratio) / tags.length
        for (const tag of tags) {
          const skillKey = normalizeKey(tag)
          if (!access.canViewAllSkills && access.visibleSkillKeys !== null) {
            if (!access.visibleSkillKeys.includes(skillKey)) continue
          }

          const entry = ensureEntry(i, skillKey)
          entry.allocated += allocPerTag
          entry.allocationCount += 1
          entry.sourceUpdateCount += 1
          if (alloc.updatedAt) {
            const t = new Date(alloc.updatedAt).getTime()
            const cur = entry.maxSourceUpdatedAt ? new Date(entry.maxSourceUpdatedAt).getTime() : 0
            if (t > cur) entry.maxSourceUpdatedAt = alloc.updatedAt
          }
        }
      }
    }

    // 可用容量
    for (const [, entry] of map) {
      const skillRes = skillResourceMap.get(entry.skillKey)
      entry.resourceCount = skillRes?.size ?? 0
      let capacity = 0
      if (skillRes) {
        for (const resId of skillRes) {
          const resource = resources.find((r) => r.id === resId)
          if (resource) {
            capacity += resource.dailyCapacityHours
          }
        }
      }
      const bucketDays = this.bucketDayCount(entry, buckets)
      entry.available = capacity * bucketDays
    }

    return [...map.values()]
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：项目维度聚合
  // ═══════════════════════════════════════════════════════════════════════════

  private aggregateProjectDemand(
    requirements: RequirementFact[],
    allocations: AllocationFact[],
    _projects: ProjectFact[],
    buckets: TimeBucket[],
  ): Map<BucketKey, ProjectBucketInternal> {
    const map = new Map<BucketKey, ProjectBucketInternal>()

    const ensureEntry = (bucketIndex: number, projectId: number): ProjectBucketInternal => {
      const key = `${bucketIndex}|${projectId}`
      let entry = map.get(key)
      if (!entry) {
        entry = {
          projectId,
          demand: 0,
          allocated: 0,
          requirementCount: 0,
          allocationCount: 0,
          sourceUpdateCount: 0,
          maxSourceUpdatedAt: null,
        }
        map.set(key, entry)
      }
      return entry
    }

    // 按项目聚合需求
    for (const req of requirements) {
      if (!req.startDate || !req.endDate) continue

      for (const [i, bucket] of buckets.entries()) {
        if (bucket.bucketStart > req.endDate || bucket.bucketEnd < req.startDate) continue

        const overlapStart = new Date(
          Math.max(new Date(bucket.bucketStart).getTime(), new Date(req.startDate).getTime()),
        )
        const overlapEnd = new Date(
          Math.min(new Date(bucket.bucketEnd).getTime(), new Date(req.endDate).getTime()),
        )
        const totalReqDays = this.dayDiff(req.startDate, req.endDate)
        const overlapDays = this.dayDiff(
          overlapStart.toISOString().slice(0, 10),
          overlapEnd.toISOString().slice(0, 10),
        )
        const ratio = totalReqDays > 0 ? overlapDays / totalReqDays : 1

        const entry = ensureEntry(i, req.projectId)
        entry.demand += req.hours * ratio
        entry.requirementCount += 1
        entry.sourceUpdateCount += 1
        if (req.updatedAt) {
          const t = new Date(req.updatedAt).getTime()
          const cur = entry.maxSourceUpdatedAt ? new Date(entry.maxSourceUpdatedAt).getTime() : 0
          if (t > cur) entry.maxSourceUpdatedAt = req.updatedAt
        }
      }
    }

    // 按项目聚合分配
    for (const alloc of allocations) {
      if (!alloc.startDate || !alloc.endDate) continue

      for (const [i, bucket] of buckets.entries()) {
        if (bucket.bucketStart > alloc.endDate || bucket.bucketEnd < alloc.startDate) continue

        const overlapStart = new Date(
          Math.max(new Date(bucket.bucketStart).getTime(), new Date(alloc.startDate).getTime()),
        )
        const overlapEnd = new Date(
          Math.min(new Date(bucket.bucketEnd).getTime(), new Date(alloc.endDate).getTime()),
        )
        const totalAllocDays = this.dayDiff(alloc.startDate, alloc.endDate)
        const overlapDays = this.dayDiff(
          overlapStart.toISOString().slice(0, 10),
          overlapEnd.toISOString().slice(0, 10),
        )
        const ratio = totalAllocDays > 0 ? overlapDays / totalAllocDays : 1

        const entry = ensureEntry(i, alloc.projectId)
        entry.allocated += alloc.hours * ratio
        entry.allocationCount += 1
        entry.sourceUpdateCount += 1
        if (alloc.updatedAt) {
          const t = new Date(alloc.updatedAt).getTime()
          const cur = entry.maxSourceUpdatedAt ? new Date(entry.maxSourceUpdatedAt).getTime() : 0
          if (t > cur) entry.maxSourceUpdatedAt = alloc.updatedAt
        }
      }
    }

    return map
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：缺口计算
  // ═══════════════════════════════════════════════════════════════════════════

  private computeGaps(
    roleBuckets: RoleBucketInternal[],
    skillBuckets: SkillBucketInternal[],
  ): ForecastGapEntry[] {
    const gaps: ForecastGapEntry[] = []

    // 角色缺口
    for (const rb of roleBuckets) {
      const [bucketIndexStr] = this.splitBucketKey(`${0}|${rb.role}`)
      const gapHours = rb.demand - rb.available

      if (gapHours > 0) {
        // shortage
        const sourceFreshnessDays = rb.maxSourceUpdatedAt
          ? Math.floor(
              (Date.now() - new Date(rb.maxSourceUpdatedAt).getTime()) / (1000 * 60 * 60 * 24),
            )
          : null

        const confidence = computeConfidenceBand({
          historicalDataPoints: rb.requirementCount + rb.allocationCount,
          sourceFreshnessDays,
          sourceCoverage: rb.requirementCount > 0 ? 0.6 : 0,
          visibleProjectCount: 1,
        })

        gaps.push({
          gapType: FORECAST_GAP_TYPES.SHORTAGE,
          description: `角色 ${rb.role} 在桶 ${bucketIndexStr} 预计短缺 ${Math.round(gapHours)} 小时`,
          gapHours: Math.round(gapHours * 100) / 100,
          direction: 'shortage',
          role: rb.role,
          bucketStart: undefined, // 角色聚合层不存储桶信息，由 toRoleBuckets 补全
          bucketEnd: undefined,
          confidence,
          warnings: [],
          evidenceRefs: this.buildEvidenceRefs(rb),
        })
      } else if (gapHours < rb.available * -0.3) {
        // significant surplus (> 30% idle)
        const surplus = rb.available - rb.demand - rb.allocated
        if (surplus > 0) {
          const sourceFreshnessDays = rb.maxSourceUpdatedAt
            ? Math.floor(
                (Date.now() - new Date(rb.maxSourceUpdatedAt).getTime()) / (1000 * 60 * 60 * 24),
              )
            : null

          const confidence = computeConfidenceBand({
            historicalDataPoints: rb.requirementCount + rb.allocationCount,
            sourceFreshnessDays,
            sourceCoverage: rb.requirementCount > 0 ? 0.6 : 0,
            visibleProjectCount: 1,
          })

          gaps.push({
            gapType: FORECAST_GAP_TYPES.SURPLUS,
            description: `角色 ${rb.role} 在桶 ${bucketIndexStr} 预计盈余 ${Math.round(surplus)} 小时`,
            gapHours: Math.round(surplus * 100) / 100,
            direction: 'surplus',
            role: rb.role,
            bucketStart: undefined,
            bucketEnd: undefined,
            confidence,
            warnings: [],
            evidenceRefs: this.buildEvidenceRefs(rb),
          })
        }
      }
    }

    // 技能缺口
    for (const sb of skillBuckets) {
      const gapHours = sb.demand - sb.available
      const [, bucketIndexStr] = this.splitBucketKey(`${0}|${sb.skillKey}`)

      const sourceFreshnessDays = sb.maxSourceUpdatedAt
        ? Math.floor(
            (Date.now() - new Date(sb.maxSourceUpdatedAt).getTime()) / (1000 * 60 * 60 * 24),
          )
        : null

      const confidence = computeConfidenceBand({
        historicalDataPoints: sb.requirementCount + sb.allocationCount,
        sourceFreshnessDays,
        sourceCoverage: sb.requirementCount > 0 ? 0.5 : 0,
        visibleProjectCount: 1,
      })

      if (gapHours > 0) {
        gaps.push({
          gapType: FORECAST_GAP_TYPES.SHORTAGE,
          description: `技能 ${sb.skillKey} 在桶 ${bucketIndexStr} 预计短缺 ${Math.round(gapHours)} 小时`,
          gapHours: Math.round(gapHours * 100) / 100,
          direction: 'shortage',
          skill: sb.skillKey,
          bucketStart: undefined,
          bucketEnd: undefined,
          confidence,
          warnings: [],
          evidenceRefs: this.buildEvidenceRefs(sb),
        })
      }
    }

    // 如果没有足够历史数据，添加 warning
    if (gaps.length === 0 && roleBuckets.length === 0 && skillBuckets.length === 0) {
      gaps.push({
        gapType: FORECAST_GAP_TYPES.INSUFFICIENT_HISTORY,
        description: '没有足够的历史数据来检测资源缺口',
        gapHours: 0,
        direction: 'shortage',
        confidence: FORECAST_CONFIDENCE_BANDS.UNKNOWN,
        warnings: [FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY],
        evidenceRefs: [],
      })
    }

    return gaps
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：项目驱动因素
  // ═══════════════════════════════════════════════════════════════════════════

  private computeProjectDrivers(projectBuckets: Map<BucketKey, ProjectBucketInternal>): Array<{
    projectId: number
    totalDemand: number
    totalAllocated: number
    requirementCount: number
    allocationCount: number
    sourceUpdateCount: number
    maxSourceUpdatedAt: string | null
    peakGap: number
    peakGapBucket?: string
  }> {
    // 按项目聚合所有桶的数据
    const projectMap = new Map<
      number,
      {
        projectId: number
        totalDemand: number
        totalAllocated: number
        requirementCount: number
        allocationCount: number
        sourceUpdateCount: number
        maxSourceUpdatedAt: string | null
        peakGap: number
        peakGapBucket?: string
        bucketGaps: Array<{ bucketStart: string; gap: number }>
      }
    >()

    for (const [, entry] of projectBuckets) {
      let aggr = projectMap.get(entry.projectId)
      if (!aggr) {
        aggr = {
          projectId: entry.projectId,
          totalDemand: 0,
          totalAllocated: 0,
          requirementCount: 0,
          allocationCount: 0,
          sourceUpdateCount: 0,
          maxSourceUpdatedAt: null,
          peakGap: 0,
          bucketGaps: [],
        }
        projectMap.set(entry.projectId, aggr)
      }

      aggr.totalDemand += entry.demand
      aggr.totalAllocated += entry.allocated
      aggr.requirementCount += entry.requirementCount
      aggr.allocationCount += entry.allocationCount
      aggr.sourceUpdateCount += entry.sourceUpdateCount

      const curMax = aggr.maxSourceUpdatedAt ? new Date(aggr.maxSourceUpdatedAt).getTime() : 0
      const entryMax = entry.maxSourceUpdatedAt ? new Date(entry.maxSourceUpdatedAt).getTime() : 0
      if (entryMax > curMax) {
        aggr.maxSourceUpdatedAt = entry.maxSourceUpdatedAt
      }
    }

    return [...projectMap.values()]
      .map((aggr) => ({
        projectId: aggr.projectId,
        totalDemand: aggr.totalDemand,
        totalAllocated: aggr.totalAllocated,
        requirementCount: aggr.requirementCount,
        allocationCount: aggr.allocationCount,
        sourceUpdateCount: aggr.sourceUpdateCount,
        maxSourceUpdatedAt: aggr.maxSourceUpdatedAt,
        peakGap: aggr.peakGap,
        peakGapBucket: aggr.peakGapBucket,
      }))
      .sort((a, b) => b.totalDemand - a.totalDemand)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：技能驱动因素
  // ═══════════════════════════════════════════════════════════════════════════

  private computeSkillDrivers(skillBuckets: SkillBucketInternal[]): Array<
    SkillBucketInternal & {
      totalDemand: number
      originalLabel?: string
      coveredHours: number
      gapHours: number
      projectCount: number
    }
  > {
    // 按技能聚合所有桶的数据
    const skillMap = new Map<
      string,
      {
        skillKey: string
        totalDemand: number
        totalAllocated: number
        totalAvailable: number
        requirementCount: number
        allocationCount: number
        resourceCount: number
        sourceUpdateCount: number
        maxSourceUpdatedAt: string | null
        projectIds: Set<number>
      }
    >()

    for (const entry of skillBuckets) {
      let aggr = skillMap.get(entry.skillKey)
      if (!aggr) {
        aggr = {
          skillKey: entry.skillKey,
          totalDemand: 0,
          totalAllocated: 0,
          totalAvailable: 0,
          requirementCount: 0,
          allocationCount: 0,
          resourceCount: entry.resourceCount,
          sourceUpdateCount: 0,
          maxSourceUpdatedAt: null,
          projectIds: new Set(),
        }
        skillMap.set(entry.skillKey, aggr)
      }

      aggr.totalDemand += entry.demand
      aggr.totalAllocated += entry.allocated
      aggr.totalAvailable += entry.available
      aggr.requirementCount += entry.requirementCount
      aggr.allocationCount += entry.allocationCount
      aggr.sourceUpdateCount += entry.sourceUpdateCount
      aggr.resourceCount = Math.max(aggr.resourceCount, entry.resourceCount)

      const curMax = aggr.maxSourceUpdatedAt ? new Date(aggr.maxSourceUpdatedAt).getTime() : 0
      const entryMax = entry.maxSourceUpdatedAt ? new Date(entry.maxSourceUpdatedAt).getTime() : 0
      if (entryMax > curMax) {
        aggr.maxSourceUpdatedAt = entry.maxSourceUpdatedAt
      }
    }

    return [...skillMap.values()]
      .map((aggr) => {
        const coveredHours = aggr.totalAllocated
        const gapHours = aggr.totalDemand - aggr.totalAvailable

        return {
          skillKey: aggr.skillKey,
          demand: 0,
          allocated: 0,
          available: 0,
          requirementCount: aggr.requirementCount,
          allocationCount: aggr.allocationCount,
          resourceCount: aggr.resourceCount,
          sourceUpdateCount: aggr.sourceUpdateCount,
          maxSourceUpdatedAt: aggr.maxSourceUpdatedAt,
          totalDemand: aggr.totalDemand,
          originalLabel: undefined,
          coveredHours,
          gapHours,
          projectCount: aggr.projectIds.size,
        }
      })
      .sort((a, b) => b.totalDemand - a.totalDemand)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：Freshness
  // ═══════════════════════════════════════════════════════════════════════════

  private buildFreshness(sources: {
    resources: ResourceFact[]
    requirements: RequirementFact[]
    allocations: AllocationFact[]
    projects: ProjectFact[]
    skills: SkillFact[]
    freshnessThresholdSeconds: number
  }): ForecastFreshness {
    const fresh = makeEmptyForecastFreshness()

    const maxUpdated = (items: Array<{ updatedAt: string | null }>): string | null => {
      const times = items
        .map((i) => i.updatedAt)
        .filter((v): v is string => Boolean(v))
        .map((v) => new Date(v).getTime())
        .filter((v) => Number.isFinite(v))
      return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
    }

    fresh.sources[FORECAST_SOURCE_KEYS.PROJECT_PLANS] = maxUpdated(sources.projects)
    fresh.sources[FORECAST_SOURCE_KEYS.RESOURCE_REGISTRY] = maxUpdated(sources.resources)
    fresh.sources[FORECAST_SOURCE_KEYS.RESOURCE_ALLOCATIONS] = maxUpdated(sources.allocations)
    fresh.sources[FORECAST_SOURCE_KEYS.TASK_RESOURCE_REQUIREMENTS] = maxUpdated(
      sources.requirements,
    )
    fresh.sources[FORECAST_SOURCE_KEYS.RESOURCE_SKILL_MATRIX] = maxUpdated(sources.skills)

    // Compute overall
    const timestamps = Object.values(fresh.sources).filter(Boolean) as string[]
    fresh.overallFreshness = timestamps.length > 0 ? timestamps.sort().reverse()[0] : null

    // Staleness
    const threshold = sources.freshnessThresholdSeconds
    const now = Date.now()
    fresh.staleSources = []

    for (const [key, value] of Object.entries(fresh.sources)) {
      if (!value) {
        fresh.staleSources.push(key as ForecastSourceKey)
        continue
      }
      const t = new Date(value).getTime()
      if (now - t > threshold * 1000) {
        fresh.staleSources.push(key as ForecastSourceKey)
      }
    }

    fresh.isStale = fresh.staleSources.length > 0

    const totalSources = Object.keys(fresh.sources).length
    const nonNullSources = Object.values(fresh.sources).filter(Boolean).length
    fresh.sourceCoverage = totalSources > 0 ? nonNullSources / totalSources : 0

    // 新鲜度哈希（使用已导入的 computeForecastFreshnessHash）
    fresh.freshnessHash = computeEvidenceHash(
      Object.entries(fresh.sources)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v ?? 'null'}`)
        .join('|'),
    )

    return fresh
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：转换内部类型 → 公开 DTO
  // ═══════════════════════════════════════════════════════════════════════════

  private toRoleBuckets(
    roleInternal: RoleBucketInternal[],
    buckets: TimeBucket[],
    freshnessThresholdSeconds: number,
    access: ForecastAccessContext,
  ): ForecastRoleBucket[] {
    return roleInternal.map((ri) => {
      const [bucketIndexStr] = this.splitBucketKey(`${0}|${ri.role}`)
      const bucketIndex = Number.parseInt(bucketIndexStr, 10)
      const bucket = buckets[bucketIndex]

      const sourceFreshnessDays = ri.maxSourceUpdatedAt
        ? Math.floor(
            (Date.now() - new Date(ri.maxSourceUpdatedAt).getTime()) / (1000 * 60 * 60 * 24),
          )
        : null

      const confidence = computeConfidenceBand({
        historicalDataPoints: ri.requirementCount + ri.allocationCount,
        sourceFreshnessDays,
        sourceCoverage: ri.requirementCount > 0 ? 0.6 : 0,
        visibleProjectCount: 1,
      })

      const remaining = ri.available - ri.allocated
      const gap = ri.demand - ri.available

      const warnings: ForecastWarningCode[] = []
      const maxUpdated = new Date(ri.maxSourceUpdatedAt ?? 0).getTime()
      if (ri.maxSourceUpdatedAt && Date.now() - maxUpdated > freshnessThresholdSeconds * 1000) {
        warnings.push(FORECAST_WARNING_CODES.STALE_SOURCE)
      }
      if (ri.sourceUpdateCount === 0) {
        warnings.push(FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY)
      }

      const redaction = this.shouldRedactRole(ri.role, access)
        ? FORECAST_REDACTION_STATES.REDACTED
        : undefined

      return {
        bucketStart: bucket?.bucketStart ?? '',
        bucketEnd: bucket?.bucketEnd ?? '',
        forecastDemand: Math.round(ri.demand * 100) / 100,
        actualAllocation: Math.round(ri.allocated * 100) / 100,
        available: Math.round(ri.available * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        gap: Math.round(gap * 100) / 100,
        confidence,
        method: FORECAST_METHODS.DETERMINISTIC_BUCKET,
        sourceFreshness: ri.maxSourceUpdatedAt,
        warnings: normalizeForecastWarnings(warnings),
        evidenceRefs: this.buildEvidenceRefs(ri),
        role: redaction ? 'REDACTED' : ri.role,
        roleRedaction: redaction,
      }
    })
  }

  private toSkillBuckets(
    skillInternal: SkillBucketInternal[],
    buckets: TimeBucket[],
    freshnessThresholdSeconds: number,
    access: ForecastAccessContext,
  ): ForecastSkillBucket[] {
    return skillInternal.map((si) => {
      const [, bucketIndexStr] = this.splitBucketKey(`${0}|${si.skillKey}`)
      const bucketIndex = Number.parseInt(bucketIndexStr, 10)
      const bucket = buckets[bucketIndex]

      const sourceFreshnessDays = si.maxSourceUpdatedAt
        ? Math.floor(
            (Date.now() - new Date(si.maxSourceUpdatedAt).getTime()) / (1000 * 60 * 60 * 24),
          )
        : null

      const confidence = computeConfidenceBand({
        historicalDataPoints: si.requirementCount + si.allocationCount,
        sourceFreshnessDays,
        sourceCoverage: si.requirementCount > 0 ? 0.5 : 0,
        visibleProjectCount: 1,
      })

      const remaining = si.available - si.allocated
      const gap = si.demand - si.available

      const warnings: ForecastWarningCode[] = []
      const maxUpdated = new Date(si.maxSourceUpdatedAt ?? 0).getTime()
      if (si.maxSourceUpdatedAt && Date.now() - maxUpdated > freshnessThresholdSeconds * 1000) {
        warnings.push(FORECAST_WARNING_CODES.STALE_SOURCE)
      }
      if (si.sourceUpdateCount === 0) {
        warnings.push(FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY)
      }

      const redaction = this.shouldRedactSkill(si.skillKey, access)
        ? FORECAST_REDACTION_STATES.REDACTED
        : undefined

      return {
        bucketStart: bucket?.bucketStart ?? '',
        bucketEnd: bucket?.bucketEnd ?? '',
        forecastDemand: Math.round(si.demand * 100) / 100,
        actualAllocation: Math.round(si.allocated * 100) / 100,
        available: Math.round(si.available * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        gap: Math.round(gap * 100) / 100,
        confidence,
        method: FORECAST_METHODS.DETERMINISTIC_BUCKET,
        sourceFreshness: si.maxSourceUpdatedAt,
        warnings: normalizeForecastWarnings(warnings),
        evidenceRefs: this.buildEvidenceRefs(si),
        skill: redaction ? 'REDACTED' : si.skillKey,
        originalLabel: redaction ? undefined : si.skillKey,
        skillRedaction: redaction,
      }
    })
  }

  private toProjectBuckets(
    projectInternal: Map<BucketKey, ProjectBucketInternal>,
    projects: ProjectFact[],
    buckets: TimeBucket[],
    freshnessThresholdSeconds: number,
    access: ForecastAccessContext,
  ): ForecastProjectBucket[] {
    const projectMap = new Map(projects.map((p) => [p.id, p]))
    const result: ForecastProjectBucket[] = []

    for (const [, entry] of projectInternal) {
      const [bucketIndexStr] = this.splitBucketKey(`${0}|${entry.projectId}`)
      const bucketIndex = Number.parseInt(bucketIndexStr, 10)
      const bucket = buckets[bucketIndex]
      const project = projectMap.get(entry.projectId)

      const sourceFreshnessDays = entry.maxSourceUpdatedAt
        ? Math.floor(
            (Date.now() - new Date(entry.maxSourceUpdatedAt).getTime()) / (1000 * 60 * 60 * 24),
          )
        : null

      const confidence = computeConfidenceBand({
        historicalDataPoints: entry.requirementCount + entry.allocationCount,
        sourceFreshnessDays,
        sourceCoverage: entry.requirementCount > 0 ? 0.5 : 0,
        visibleProjectCount: projects.length,
      })

      const remaining = 0 // 项目层不跟踪可用容量
      const gap = entry.demand - entry.allocated

      const warnings: ForecastWarningCode[] = []
      const maxUpdated = new Date(entry.maxSourceUpdatedAt ?? 0).getTime()
      if (entry.maxSourceUpdatedAt && Date.now() - maxUpdated > freshnessThresholdSeconds * 1000) {
        warnings.push(FORECAST_WARNING_CODES.STALE_SOURCE)
      }

      const redaction =
        !access.canViewAllResources || !project ? FORECAST_REDACTION_STATES.REDACTED : undefined

      result.push({
        bucketStart: bucket?.bucketStart ?? '',
        bucketEnd: bucket?.bucketEnd ?? '',
        forecastDemand: Math.round(entry.demand * 100) / 100,
        actualAllocation: Math.round(entry.allocated * 100) / 100,
        available: Math.round(entry.demand * 100) / 100, // 在项目层可用=需求
        remaining: Math.round(remaining * 100) / 100,
        gap: Math.round(gap * 100) / 100,
        confidence,
        method: FORECAST_METHODS.DETERMINISTIC_BUCKET,
        sourceFreshness: entry.maxSourceUpdatedAt,
        warnings: normalizeForecastWarnings(warnings),
        evidenceRefs: this.buildEvidenceRefs(entry),
        projectId: entry.projectId.toString(),
        projectName: redaction ? undefined : project?.name,
        projectRedaction: redaction,
      })
    }

    return result
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：构建 Warnings
  // ═══════════════════════════════════════════════════════════════════════════

  private buildWarnings(
    projects: ProjectFact[],
    resources: ResourceFact[],
    requirements: RequirementFact[],
    allocations: AllocationFact[],
    _skills: SkillFact[],
    freshness: ForecastFreshness,
    gaps: ForecastGapEntry[],
    resourceCoverage: boolean,
  ): ForecastWarningCode[] {
    const codes: ForecastWarningCode[] = []

    if (projects.length === 0) {
      codes.push(FORECAST_WARNING_CODES.NO_PROJECTS_VISIBLE)
    }

    if (requirements.length === 0 && allocations.length === 0) {
      codes.push(FORECAST_WARNING_CODES.INSUFFICIENT_HISTORY)
    }

    if (freshness.isStale) {
      codes.push(FORECAST_WARNING_CODES.STALE_SOURCE)
    }

    if (!resourceCoverage && resources.length > 0) {
      codes.push(FORECAST_WARNING_CODES.PARTIAL_VISIBILITY)
    }

    const hasLowConfidence = gaps.some(
      (g) =>
        g.confidence === FORECAST_CONFIDENCE_BANDS.LOW ||
        g.confidence === FORECAST_CONFIDENCE_BANDS.UNKNOWN,
    )
    if (hasLowConfidence) {
      codes.push(FORECAST_WARNING_CODES.LOW_CONFIDENCE)
    }

    return normalizeForecastWarnings(codes)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 内部：构建空摘要
  // ═══════════════════════════════════════════════════════════════════════════

  private buildEmptySummary(
    query: NormalizedForecastQuery,
    method: ForecastMethod,
  ): ForecastSummary {
    const freshness = makeEmptyForecastFreshness()

    const metrics: Record<string, number> = {}
    for (const key of Object.values(RESOURCE_DEMAND_FORECASTING_METRIC_KEYS)) {
      metrics[key] = 0
    }

    return {
      window: {
        startDate: query.startDate,
        endDate: query.endDate,
        granularity: query.granularity,
        bucketCount: 0,
      },
      metrics,
      freshness,
      overallConfidence: FORECAST_CONFIDENCE_BANDS.UNKNOWN,
      method,
      warnings: [FORECAST_WARNING_CODES.NO_PROJECTS_VISIBLE],
      projectCoverage: 0,
      resourceCoverage: 0,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── Helpers ────────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  private dayDiff(start: string, end: string): number {
    const s = new Date(start).getTime()
    const e = new Date(end).getTime()
    if (!Number.isFinite(s) || !Number.isFinite(e)) return 1
    return Math.max(1, Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1)
  }

  private bucketDayCount(
    _entry: { skillKey?: string; role?: string },
    buckets: TimeBucket[],
  ): number {
    // 按粒度估算桶天数
    if (buckets.length === 0) return 1
    const firstBucket = buckets[0]
    const start = new Date(firstBucket.bucketStart).getTime()
    const end = new Date(firstBucket.bucketEnd).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 1
    return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)))
  }

  private splitBucketKey(key: string): [string, string] {
    const idx = key.indexOf('|')
    if (idx === -1) return [key, '']
    return [key.slice(0, idx), key.slice(idx + 1)]
  }

  private buildEvidenceRefs(source: {
    requirementCount?: number
    allocationCount?: number
    sourceUpdateCount?: number
  }): ForecastEvidenceRef[] {
    const refs: ForecastEvidenceRef[] = []

    if ((source.requirementCount ?? 0) > 0) {
      refs.push({
        source: FORECAST_SOURCE_KEYS.TASK_RESOURCE_REQUIREMENTS,
        sourceHash: computeEvidenceHash(
          `req:${source.requirementCount}:${source.sourceUpdateCount ?? 0}`,
        ),
        sourceCoverage: source.requirementCount ?? 0,
      })
    }

    if ((source.allocationCount ?? 0) > 0) {
      refs.push({
        source: FORECAST_SOURCE_KEYS.RESOURCE_ALLOCATIONS,
        sourceHash: computeEvidenceHash(
          `alloc:${source.allocationCount}:${source.sourceUpdateCount ?? 0}`,
        ),
        sourceCoverage: source.allocationCount ?? 0,
      })
    }

    if (refs.length === 0) {
      refs.push({
        source: FORECAST_SOURCE_KEYS.PROJECT_PLANS,
        sourceHash: computeEvidenceHash('empty'),
        sourceCoverage: 0,
      })
    }

    return refs
  }

  private buildGapDescription(gap: {
    gapType: string
    role?: string
    skill?: string
    gapHours: number
    direction: string
  }): string {
    const detail = gap.role ?? gap.skill ?? '未知维度'
    const hours = Math.round(Math.abs(gap.gapHours))
    if (gap.direction === 'shortage') {
      return `${detail} 预计短缺 ${hours} 小时`
    }
    return `${detail} 预计盈余 ${hours} 小时`
  }

  private shouldRedactRole(_role: string, access: ForecastAccessContext): boolean {
    return !access.canViewAllResources
  }

  private shouldRedactSkill(skillKey: string, access: ForecastAccessContext): boolean {
    if (!access.canViewAllSkills && access.visibleSkillKeys !== null) {
      return !access.visibleSkillKeys.includes(skillKey)
    }
    return false
  }

  private determineGapRedaction(
    gap: { role?: string; skill?: string; projectId?: number },
    access: ForecastAccessContext,
    projectMap: Map<number, ProjectFact>,
  ): ForecastRedactionState | undefined {
    if (gap.projectId && !projectMap.has(gap.projectId)) {
      return FORECAST_REDACTION_STATES.REDACTED
    }
    if (!access.canViewAllResources && gap.role) {
      return FORECAST_REDACTION_STATES.REDACTED
    }
    if (!access.canViewAllSkills && gap.skill) {
      if (access.visibleSkillKeys !== null && !access.visibleSkillKeys.includes(gap.skill)) {
        return FORECAST_REDACTION_STATES.REDACTED
      }
    }
    return undefined
  }

  private filterSkillBuckets(
    buckets: ForecastSkillBucket[],
    query: NormalizedForecastQuery,
  ): ForecastSkillBucket[] {
    if (query.skills && query.skills.length > 0) {
      return buckets.filter((b) => query.skills!.includes(b.skill))
    }
    return buckets
  }

  private filterProjectBuckets(
    buckets: ForecastProjectBucket[],
    query: NormalizedForecastQuery,
  ): ForecastProjectBucket[] {
    if (query.projectIds && query.projectIds.length > 0) {
      return buckets.filter((b) => query.projectIds!.includes(Number(b.projectId)))
    }
    return buckets
  }

  private applyQueryFilters(
    curves: ForecastDemandCurve,
    query: NormalizedForecastQuery,
  ): ForecastDemandCurve {
    const topN = query.topN ?? DEFAULT_TOP_N
    const warnings = new Set(curves.warnings)

    // 按角色过滤
    if (query.roles && query.roles.length > 0) {
      curves.roleBuckets = curves.roleBuckets.filter((b) => query.roles!.includes(b.role))
    }

    // 按置信度过滤
    if (query.confidenceThreshold) {
      const thresholdOrder: Record<string, number> = {
        high: 3,
        medium: 2,
        low: 1,
        unknown: 0,
      }
      const minOrder = thresholdOrder[query.confidenceThreshold] ?? 0
      const filter = (b: ForecastRoleBucket | ForecastSkillBucket | ForecastProjectBucket) =>
        (thresholdOrder[b.confidence] ?? 0) >= minOrder

      curves.roleBuckets = curves.roleBuckets.filter(filter)
      curves.skillBuckets = curves.skillBuckets.filter(filter)
      curves.projectBuckets = curves.projectBuckets.filter(filter)
    }

    // TopN
    curves.roleBuckets = curves.roleBuckets.slice(0, topN)
    curves.skillBuckets = curves.skillBuckets.slice(0, topN)
    curves.projectBuckets = curves.projectBuckets.slice(0, topN)

    // 收集 warnings
    for (const bucket of [
      ...curves.roleBuckets,
      ...curves.skillBuckets,
      ...curves.projectBuckets,
    ]) {
      for (const w of bucket.warnings) {
        warnings.add(w)
      }
    }

    return {
      ...curves,
      warnings: normalizeForecastWarnings([...warnings]),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── 组织级查询辅助 ───────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  private async fetchAllOrgProjectIds(organizationId: number): Promise<number[]> {
    if (this.readers.readVisibleProjects) {
      const all = await this.readers.readVisibleProjects(organizationId)
      return all.filter((p) => Number(p.organizationId) === Number(organizationId)).map((p) => p.id)
    }

    const { default: ProjectModel } = await import('#models/project')
    const rows = await ProjectModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .select('id')
      .limit(2000)

    return rows.map((p) => Number(p.id))
  }

  private async fetchAllOrgResourceIds(
    organizationId: number,
    allProjectIds: number[],
  ): Promise<number[]> {
    if (allProjectIds.length === 0) return []

    if (this.readers.readResources) {
      const all = await this.readers.readResources(allProjectIds, organizationId)
      return all.map((r) => r.id)
    }

    const { default: ResourceModel } = await import('#models/resource')
    const rows = await ResourceModel.query()
      .whereIn('project_id', allProjectIds)
      .whereNull('deleted_at')
      .select('id')

    return rows.map((r) => Number(r.id))
  }

  private async getAllocationResourceIds(projectIds: number[]): Promise<number[]> {
    if (projectIds.length === 0) return []

    const { default: ResourceModel } = await import('#models/resource')
    const rows = await ResourceModel.query()
      .whereIn('project_id', projectIds)
      .whereNull('deleted_at')
      .select('id')

    return rows.map((r) => Number(r.id))
  }

  private async buildResourceProjectMap(projectIds: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>()
    if (projectIds.length === 0) return map

    const { default: ResourceModel } = await import('#models/resource')
    const rows = await ResourceModel.query()
      .whereIn('project_id', projectIds)
      .whereNull('deleted_at')
      .select('id', 'project_id')

    for (const r of rows) {
      map.set(Number(r.id), Number((r as { projectId: number }).projectId))
    }

    return map
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Source Signature（低敏审计）
  // ═══════════════════════════════════════════════════════════════════════════

  computeSourceSignature(
    resources: ResourceFact[],
    allocations: AllocationFact[],
    requirements: RequirementFact[],
    projects: ProjectFact[],
    skills: SkillFact[],
  ): string {
    const counts = [
      resources.length,
      allocations.length,
      requirements.length,
      projects.length,
      skills.length,
    ].join(':')
    const maxUpdated = [
      resources
        .map((r) => r.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '0',
      allocations
        .map((a) => a.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '0',
      requirements
        .map((r) => r.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '0',
      projects
        .map((p) => p.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '0',
      skills
        .map((s) => s.updatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '0',
    ].join(':')
    return computeEvidenceHash(`${counts}:${maxUpdated}`)
  }
}
