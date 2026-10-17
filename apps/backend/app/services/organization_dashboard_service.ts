import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PROJECT_VIEW } from '#start/rbac/permissions'
import {
  ORGANIZATION_ATTENTION_REASONS,
  ORGANIZATION_DASHBOARD_METRIC_KEYS,
  ORGANIZATION_DASHBOARD_METRIC_VERSION,
  ORGANIZATION_DASHBOARD_MAX_SCAN_PROJECTS,
  ORGANIZATION_DASHBOARD_SECTIONS,
  ORGANIZATION_DASHBOARD_SOURCES,
  ORGANIZATION_DASHBOARD_STATUSES,
  ORGANIZATION_DASHBOARD_TARGET_KINDS,
  ORGANIZATION_REMINDER_CODES,
  buildEmptyOrganizationDashboard,
  computeOrganizationAttentionScore,
  degradedOrganizationPmoEntry,
  makeOrganizationDashboardFreshness,
  mergeOrganizationDashboardWarnings,
  normalizeOrganizationDashboardQuery,
  organizationCacheDegradedWarning,
  organizationDashboardFreshnessHash,
  organizationDashboardStableHash,
  organizationFinancialUnsupportedWarning,
  organizationSourcePartialWarning,
  organizationSourceStaleWarning,
  redactedOrganizationMemberOverview,
  redactedOrganizationMetric,
  redactedOrganizationResourceOverview,
  redactedOrganizationRiskReminders,
  toOrganizationDistribution,
  type NormalizedOrganizationDashboardQuery,
  type OrganizationActivityItem,
  type OrganizationAttentionItem,
  type OrganizationAttentionReason,
  type OrganizationDashboardIdentity,
  type OrganizationDashboardMetric,
  type OrganizationDashboardQuery,
  type OrganizationDashboardReadAudit,
  type OrganizationDashboardSourceFreshness,
  type OrganizationDashboardSummary,
  type OrganizationDashboardTarget,
  type OrganizationDashboardWarning,
  type OrganizationMemberOverview,
  type OrganizationPmoEntry,
  type OrganizationResourceOverview,
  type OrganizationRiskReminder,
} from '@aiproj/types'

/**
 * OrganizationDashboardService —— 组织级 Dashboard 只读聚合层（v3-organization-dashboard §3）。
 *
 * 约束（规范强制）：
 *   - **只读无副作用**：不调用 AIGateway、不启动 Compiler、不刷新预测/健康诊断/交通灯快照、
 *     不写业务事实、不发 Webhook/Web Push、不换 OAuth token、不做外部网络写入。
 *   - **组织隔离**：所有查询强制附加 `organization_id` 过滤，跨组织事实一律不可见、不可推断。
 *   - **维度脱敏**：风险/资源/成员/活动/PMO 权限不足时返回低敏 forbidden/unavailable 状态，
 *     不返回隐藏计数、实体名称、证据文本或未授权 drill-down target。
 *   - **有界查询**：limit/section/sort/filter 均已在 Validator 与共享归一化函数中被白名单约束。
 *   - **不重算 PMO 算法**：PMO 摘要来自 PMO 侧既有聚合，本服务只做低敏投影，避免口径漂移。
 */

// ─── 事实读取契约（默认走 Lucid，测试可注入 fixture）─────────────────────────────

export interface OrganizationDashboardProjectFact {
  id: number
  organizationId: number
  name: string
  status: string
  healthStatus: string
  progressPercent: number
  endDate: string | null
  updatedAt: string | null
  createdBy: number | null
}

export interface OrganizationOverdueTaskFact {
  projectId: number
  overdueCount: number
  updatedAt: string | null
}

export interface OrganizationRiskFact {
  openCount: number
  highCount: number
  updatedAt: string | null
}

export interface OrganizationMemberFact {
  totalMembers: number
  activeMembers: number
  roleCounts: Array<{ role: string; count: number }>
  updatedAt: string | null
}

export interface OrganizationResourceFact {
  allocatedProjectCount: number
  overloadedResourceCount: number
  totalAllocationPercent: number
  updatedAt: string | null
}

export interface OrganizationActivityFact {
  id: number
  action: string
  entityType: string | null
  severity: string
  projectId: number | null
  occurredAt: string
}

export interface OrganizationPmoFact {
  available: boolean
  totalProjects: number | null
  atRiskProjects: number | null
  overallProgressAvg: number | null
  lastUpdatedAt: string | null
}

export interface OrganizationDashboardReaders {
  readOrganization?: (organizationId: number) => Promise<OrganizationDashboardIdentity | null>
  readVisibleProjects?: (
    organizationId: number,
    user: User,
  ) => Promise<OrganizationDashboardProjectFact[]>
  readOverdueTasks?: (
    organizationId: number,
    projectIds: number[],
  ) => Promise<OrganizationOverdueTaskFact[]>
  readRiskSummary?: (
    organizationId: number,
    projectIds: number[],
  ) => Promise<OrganizationRiskFact | null>
  readMemberSummary?: (organizationId: number) => Promise<OrganizationMemberFact | null>
  readResourceSummary?: (
    organizationId: number,
    projectIds: number[],
  ) => Promise<OrganizationResourceFact | null>
  readActivity?: (
    organizationId: number,
    projectIds: number[],
    limit: number,
  ) => Promise<OrganizationActivityFact[]>
  readPmoSummary?: (organizationId: number, user: User) => Promise<OrganizationPmoFact | null>
}

/** 维度级权限。`false` 表示明确拒绝；`undefined` 表示调用方未做该维度判定（按允许处理）。 */
export interface OrganizationDashboardAccess {
  canViewMembers?: boolean
  canViewResources?: boolean
  canViewRisks?: boolean
  canViewActivity?: boolean
  canViewPmo?: boolean
}

/** 命中即返回 unsupported warning 的财务关键词（中英文别名）。 */
const FINANCIAL_KEYWORDS: Array<{
  field: 'budget' | 'cost' | 'roi' | 'financial_distribution'
  aliases: string[]
}> = [
  { field: 'budget', aliases: ['budget', '预算'] },
  { field: 'cost', aliases: ['cost', '成本', '花费'] },
  { field: 'roi', aliases: ['roi', '投资回报', '回报率'] },
  { field: 'financial_distribution', aliases: ['financial', '财务', '资金'] },
]

const DENIED = false

export default class OrganizationDashboardService {
  constructor(private readonly readers: OrganizationDashboardReaders = {}) {}

  /**
   * 组织 Dashboard 只读摘要。
   *
   * @param user 当前 actor
   * @param organizationId 目标组织（调用方须先完成组织成员/`org:view` 授权）
   * @param query 已白名单校验的查询参数
   * @param access 维度级权限判定结果
   */
  async getSummary(
    user: User,
    organizationId: number,
    query: OrganizationDashboardQuery = {},
    access: OrganizationDashboardAccess = {},
  ): Promise<OrganizationDashboardSummary> {
    const normalized = normalizeOrganizationDashboardQuery(query)
    const organization = await this.readOrganizationIdentity(organizationId)
    const wantsSection = (section: string) => normalized.sections.includes(section as never)

    const allProjects = await this.readVisibleProjects(organizationId, user)
    const scanned = allProjects.slice(0, ORGANIZATION_DASHBOARD_MAX_SCAN_PROJECTS)
    const truncated = allProjects.length > scanned.length
    const projects = this.applyProjectFilters(scanned, normalized)
    const projectIds = projects.map((project) => project.id)

    // 维度数据读取——权限不足或 section 未请求时不发起查询。
    const memberFact =
      access.canViewMembers === DENIED ||
      !wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.MEMBER_OVERVIEW)
        ? null
        : await this.readMemberSummary(organizationId)
    const resourceFact =
      access.canViewResources === DENIED ||
      !wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.RESOURCE_OVERVIEW)
        ? null
        : await this.readResourceSummary(organizationId, projectIds)
    const riskFact =
      access.canViewRisks === DENIED ||
      !wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.RISK_REMINDERS)
        ? null
        : await this.readRiskSummary(organizationId, projectIds)
    const activityFacts =
      access.canViewActivity === DENIED || !wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.ACTIVITY)
        ? []
        : await this.readActivity(organizationId, projectIds, normalized.activityLimit)
    const pmoEntry = await this.buildPmoEntry(
      user,
      organizationId,
      normalized,
      access,
      wantsSection,
    )

    const memberOverview = this.buildMemberOverview(access, memberFact)
    const resourceOverview = this.buildResourceOverview(access, resourceFact)

    // 空组织：返回合法空态，不伪造健康/风险/资源/活动/PMO 数值。
    if (projects.length === 0) {
      const empty = buildEmptyOrganizationDashboard({
        organization,
        actorId: Number(user.id),
        query: normalized,
        pmoEntry,
      })
      return {
        ...empty,
        memberOverview,
        resourceOverview,
        warnings: mergeOrganizationDashboardWarnings(
          empty.warnings,
          memberOverview.warnings,
          resourceOverview.warnings,
          this.detectUnsupportedFinancialWarnings(normalized),
        ),
      }
    }

    const overdueFacts = wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.ATTENTION_PROJECTS)
      ? await this.readOverdueTasks(organizationId, projectIds)
      : []
    const overdueByProject = new Map(
      overdueFacts.map((fact) => [fact.projectId, fact.overdueCount]),
    )

    const now = Date.now()
    const dueSoonThreshold = now + normalized.dueSoonDays * 24 * 60 * 60 * 1000
    const evaluated = projects.map((project) => ({
      project,
      reasons: this.resolveAttentionReasons(project, now, dueSoonThreshold),
    }))

    const attentionProjects = this.buildAttentionProjects(
      evaluated,
      overdueByProject,
      normalized,
      wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.ATTENTION_PROJECTS),
      access,
    )
    const overdueProjectCount = evaluated.filter((item) =>
      item.reasons.includes(ORGANIZATION_ATTENTION_REASONS.OVERDUE),
    ).length
    const dueSoonProjectCount = evaluated.filter((item) =>
      item.reasons.includes(ORGANIZATION_ATTENTION_REASONS.DUE_SOON),
    ).length
    const attentionCount = evaluated.filter((item) => item.reasons.length > 0).length

    const sourceFreshness = this.buildSourceFreshness(normalized, access, {
      projects,
      memberFact,
      resourceFact,
      riskFact,
      activityFacts,
      pmoEntry,
    })
    const staleSources = sourceFreshness.filter((item) => item.isStale)

    const kpis = this.buildKpis({
      projects,
      attentionCount,
      overdueProjectCount,
      dueSoonProjectCount,
      staleSourceCount: staleSources.length,
      activityCount: activityFacts.length,
      memberFact,
      resourceFact,
      riskFact,
      access,
      includeKpiSection: wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.KPI),
    })

    const statusDistribution = wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.STATUS_DISTRIBUTION)
      ? toOrganizationDistribution(this.countByStatus(projects))
      : []

    const riskReminders = this.buildRiskReminders(
      access,
      riskFact,
      overdueProjectCount,
      dueSoonProjectCount,
      wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.RISK_REMINDERS),
    )

    const recentActivity = this.toLowSensitiveActivity(activityFacts, projectIds, access)

    const warnings = mergeOrganizationDashboardWarnings(
      kpis.flatMap((metric) => metric.warnings ?? []),
      memberOverview.warnings,
      resourceOverview.warnings,
      riskReminders.flatMap((reminder) => reminder.warnings),
      pmoEntry.warnings,
      staleSources.map((item) => organizationSourceStaleWarning(item.source)),
      truncated ? [organizationSourcePartialWarning(ORGANIZATION_DASHBOARD_SOURCES.PROJECT)] : [],
      this.detectUnsupportedFinancialWarnings(normalized),
    )

    return {
      meta: {
        calculatedAt: new Date().toISOString(),
        metricVersion: ORGANIZATION_DASHBOARD_METRIC_VERSION,
        organizationId,
        actorId: Number(user.id),
        visibleProjectCount: projects.length,
        sections: normalized.sections,
        attentionLimit: normalized.attentionLimit,
        activityLimit: normalized.activityLimit,
        staleThresholdMinutes: normalized.freshnessWindowMinutes,
        inputSignatureHash: organizationDashboardStableHash(
          [
            organizationId,
            user.id,
            projects.length,
            normalized.sections.join('|'),
            normalized.attentionSort,
            normalized.attentionOrder,
            normalized.filterStatus ?? '',
            normalized.filterHealth ?? '',
          ].join(':'),
        ),
      },
      organization,
      kpis,
      statusDistribution,
      attentionProjects,
      memberOverview,
      resourceOverview,
      riskReminders,
      recentActivity,
      pmoEntry,
      sourceFreshness,
      warnings,
    }
  }

  /**
   * 可选低敏 read audit envelope（§3.7）。
   *
   * 只包含 actor、组织、查询形状、metric key、freshness 指纹与时间戳；
   * 不含证据文本、prompt、模型输出、Authorization header、token、API key 或跨组织数据。
   * 返回值由调用方决定是否落审计——本服务不写库，读路径保持无副作用。
   */
  buildReadAudit(summary: OrganizationDashboardSummary): OrganizationDashboardReadAudit {
    return {
      actorId: summary.meta.actorId,
      organizationId: summary.meta.organizationId,
      sections: summary.meta.sections,
      metricKeys: summary.kpis.map((metric) => metric.key),
      sourceFreshnessHashes: summary.sourceFreshness.map((item) => ({
        source: item.source,
        hash: organizationDashboardFreshnessHash(item),
      })),
      querySignatureHash: summary.meta.inputSignatureHash,
      occurredAt: summary.meta.calculatedAt,
    }
  }

  // ─── 组织身份 ────────────────────────────────────────────────────────────────

  private async readOrganizationIdentity(
    organizationId: number,
  ): Promise<OrganizationDashboardIdentity> {
    if (this.readers.readOrganization) {
      const identity = await this.readers.readOrganization(organizationId)
      if (identity) return identity
    } else {
      const { default: OrganizationModel } = await import('#models/organization')
      const organization = await OrganizationModel.find(organizationId)
      if (organization) {
        return {
          organizationId: Number(organization.id),
          name: organization.name,
          slug: organization.slug ?? null,
          planTier: (organization as { planTier?: string | null }).planTier ?? null,
          createdAt: organization.createdAt?.toISO() ?? null,
        }
      }
    }
    // 调用方已完成组织授权；到这里仍取不到实体时，返回最小 identity 而不是伪造字段。
    return {
      organizationId,
      name: '',
      slug: null,
      planTier: null,
      createdAt: null,
    }
  }

  // ─── 项目可见性（组织隔离 + 逐项目 RBAC）─────────────────────────────────────

  private async readVisibleProjects(
    organizationId: number,
    user: User,
  ): Promise<OrganizationDashboardProjectFact[]> {
    if (this.readers.readVisibleProjects) {
      const projects = await this.readers.readVisibleProjects(organizationId, user)
      // 双保险：即便注入的 reader 返回了跨组织数据，也在此过滤掉。
      return projects.filter((project) => Number(project.organizationId) === Number(organizationId))
    }

    const { default: ProjectModel } = await import('#models/project')
    const rbac = new RbacService()
    const rows = await ProjectModel.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .orderBy('updated_at', 'desc')
      .limit(ORGANIZATION_DASHBOARD_MAX_SCAN_PROJECTS)

    const visible: OrganizationDashboardProjectFact[] = []
    for (const project of rows) {
      const { allowed } = await rbac.check(user, PROJECT_VIEW, organizationId, Number(project.id))
      if (!allowed && Number(project.createdBy) !== Number(user.id)) continue
      visible.push({
        id: Number(project.id),
        organizationId: Number(project.organizationId),
        name: project.name,
        status: project.status,
        healthStatus: project.healthStatus,
        progressPercent: Number(project.progressPercent ?? 0),
        endDate: project.endDate?.toISO() ?? null,
        updatedAt: project.updatedAt?.toISO() ?? null,
        createdBy: project.createdBy ? Number(project.createdBy) : null,
      })
    }
    return visible
  }

  private applyProjectFilters(
    projects: OrganizationDashboardProjectFact[],
    query: NormalizedOrganizationDashboardQuery,
  ): OrganizationDashboardProjectFact[] {
    return projects.filter((project) => {
      if (query.filterStatus && project.status !== query.filterStatus) return false
      if (query.filterHealth && project.healthStatus !== query.filterHealth) return false
      if (query.search && !project.name.toLowerCase().includes(query.search.toLowerCase())) {
        return false
      }
      return true
    })
  }

  // ─── 维度事实读取（批量，避免 N+1）──────────────────────────────────────────

  private async readOverdueTasks(
    organizationId: number,
    projectIds: number[],
  ): Promise<OrganizationOverdueTaskFact[]> {
    if (this.readers.readOverdueTasks) {
      return this.readers.readOverdueTasks(organizationId, projectIds)
    }
    if (projectIds.length === 0) return []

    const { default: TaskModel } = await import('#models/task')
    const rows = await TaskModel.query()
      .whereIn('project_id', projectIds)
      .whereNull('deleted_at')
      .whereNotIn('status', ['done', 'cancelled'])
      .whereNotNull('end_date')
      .where('end_date', '<', new Date().toISOString().slice(0, 10))
      .select('project_id')
      .count('* as overdueCount')
      .max('updated_at as updatedAt')
      .groupBy('project_id')

    return rows.map((row: unknown) => {
      const extras = (row as { $extras: Record<string, unknown> }).$extras
      return {
        projectId: Number(extras.project_id ?? 0),
        overdueCount: Number(extras.overdueCount ?? 0),
        updatedAt: extras.updatedAt ? String(extras.updatedAt) : null,
      }
    })
  }

  private async readRiskSummary(
    organizationId: number,
    projectIds: number[],
  ): Promise<OrganizationRiskFact | null> {
    if (this.readers.readRiskSummary) {
      return this.readers.readRiskSummary(organizationId, projectIds)
    }
    if (projectIds.length === 0) {
      return { openCount: 0, highCount: 0, updatedAt: new Date().toISOString() }
    }

    const { default: RiskModel } = await import('#models/risk')
    const rows = await RiskModel.query()
      .where('organization_id', organizationId)
      .whereIn('project_id', projectIds)
      .whereNull('deleted_at')
      .whereNotIn('status', ['closed', 'resolved'])
      .select('risk_level')
      .count('* as levelCount')
      .max('updated_at as updatedAt')
      .groupBy('risk_level')

    let openCount = 0
    let highCount = 0
    let updatedAt: string | null = null
    for (const row of rows) {
      const extras = (row as unknown as { $extras: Record<string, unknown> }).$extras
      const count = Number(extras.levelCount ?? 0)
      const level = String(extras.risk_level ?? '')
      openCount += count
      if (level === 'high' || level === 'critical' || level === 'very_high') highCount += count
      const rowUpdatedAt = extras.updatedAt ? String(extras.updatedAt) : null
      if (rowUpdatedAt && (!updatedAt || rowUpdatedAt > updatedAt)) updatedAt = rowUpdatedAt
    }
    return { openCount, highCount, updatedAt }
  }

  private async readMemberSummary(organizationId: number): Promise<OrganizationMemberFact | null> {
    if (this.readers.readMemberSummary) {
      return this.readers.readMemberSummary(organizationId)
    }

    const { default: OrganizationMemberModel } = await import('#models/organization_member')
    const rows = await OrganizationMemberModel.query()
      .where('organization_id', organizationId)
      .select('role')
      .count('* as roleCount')
      .max('updated_at as updatedAt')
      .groupBy('role')

    const roleCounts: Array<{ role: string; count: number }> = []
    let totalMembers = 0
    let updatedAt: string | null = null
    for (const row of rows) {
      const extras = (row as unknown as { $extras: Record<string, unknown> }).$extras
      const count = Number(extras.roleCount ?? 0)
      roleCounts.push({ role: String(extras.role ?? 'member'), count })
      totalMembers += count
      const rowUpdatedAt = extras.updatedAt ? String(extras.updatedAt) : null
      if (rowUpdatedAt && (!updatedAt || rowUpdatedAt > updatedAt)) updatedAt = rowUpdatedAt
    }
    return { totalMembers, activeMembers: totalMembers, roleCounts, updatedAt }
  }

  private async readResourceSummary(
    organizationId: number,
    projectIds: number[],
  ): Promise<OrganizationResourceFact | null> {
    if (this.readers.readResourceSummary) {
      return this.readers.readResourceSummary(organizationId, projectIds)
    }
    if (projectIds.length === 0) {
      return {
        allocatedProjectCount: 0,
        overloadedResourceCount: 0,
        totalAllocationPercent: 0,
        updatedAt: new Date().toISOString(),
      }
    }

    const { default: ResourceModel } = await import('#models/resource')
    const resources = await ResourceModel.query()
      .whereIn('project_id', projectIds)
      .whereNull('deleted_at')
      .select('id', 'project_id')

    if (resources.length === 0) {
      return {
        allocatedProjectCount: 0,
        overloadedResourceCount: 0,
        totalAllocationPercent: 0,
        updatedAt: null,
      }
    }

    const resourceProject = new Map<number, number>()
    for (const resource of resources) {
      resourceProject.set(Number(resource.id), Number(resource.projectId))
    }

    const { default: ResourceAllocationModel } = await import('#models/resource_allocation')
    const rows = await ResourceAllocationModel.query()
      .whereIn('resource_id', [...resourceProject.keys()])
      .select('resource_id')
      .sum('allocation_percent as totalPercent')
      .max('updated_at as updatedAt')
      .groupBy('resource_id')

    const allocatedProjects = new Set<number>()
    let overloadedResourceCount = 0
    let totalAllocationPercent = 0
    let updatedAt: string | null = null
    for (const row of rows) {
      const extras = (row as unknown as { $extras: Record<string, unknown> }).$extras
      const resourceId = Number(extras.resource_id ?? 0)
      const percent = Number(extras.totalPercent ?? 0)
      totalAllocationPercent += percent
      if (percent > 100) overloadedResourceCount += 1
      const projectId = resourceProject.get(resourceId)
      if (projectId !== undefined && percent > 0) allocatedProjects.add(projectId)
      const rowUpdatedAt = extras.updatedAt ? String(extras.updatedAt) : null
      if (rowUpdatedAt && (!updatedAt || rowUpdatedAt > updatedAt)) updatedAt = rowUpdatedAt
    }

    return {
      allocatedProjectCount: allocatedProjects.size,
      overloadedResourceCount,
      totalAllocationPercent: Math.round(totalAllocationPercent * 100) / 100,
      updatedAt,
    }
  }

  private async readActivity(
    organizationId: number,
    projectIds: number[],
    limit: number,
  ): Promise<OrganizationActivityFact[]> {
    if (this.readers.readActivity) {
      return this.readers.readActivity(organizationId, projectIds, limit)
    }

    const { default: AuditLogModel } = await import('#models/audit_log')
    const query = AuditLogModel.query()
      .where('organization_id', organizationId)
      .orderBy('created_at', 'desc')
      .limit(limit)
    // 只读取组织内、当前 actor 可见项目的活动；组织级（无 project_id）事件同样只属于本组织。
    if (projectIds.length > 0) {
      query.where((builder) => {
        builder.whereIn('project_id', projectIds).orWhereNull('project_id')
      })
    } else {
      query.whereNull('project_id')
    }

    const rows = await query
    return rows.map((log) => ({
      id: Number(log.id),
      action: log.action,
      entityType: log.entityType ?? null,
      severity: log.severity,
      projectId: log.projectId ? Number(log.projectId) : null,
      occurredAt: log.createdAt.toISO() ?? new Date().toISOString(),
    }))
  }

  private async readPmoSummary(
    organizationId: number,
    user: User,
  ): Promise<OrganizationPmoFact | null> {
    if (this.readers.readPmoSummary) {
      return this.readers.readPmoSummary(organizationId, user)
    }

    // 复用 PMO 侧既有聚合，不重算组合指标口径。
    const { default: PortfolioDashboardService } =
      await import('#services/portfolio_dashboard_service')
    const portfolio = new PortfolioDashboardService()
    const summary = await portfolio.getSummary(
      organizationId,
      user,
      false,
      false,
      false,
      false,
      false,
    )
    const metric = (key: string) => summary.kpis.find((item) => item.key === key)?.value ?? null

    return {
      available: true,
      totalProjects: metric('total_projects'),
      atRiskProjects: metric('at_risk_projects'),
      overallProgressAvg: metric('overall_progress_avg'),
      lastUpdatedAt: summary.meta.calculatedAt,
    }
  }

  // ─── 组装：待关注项目 ────────────────────────────────────────────────────────

  private resolveAttentionReasons(
    project: OrganizationDashboardProjectFact,
    now: number,
    dueSoonThreshold: number,
  ): OrganizationAttentionReason[] {
    const reasons: OrganizationAttentionReason[] = []
    const closed = project.status === 'completed' || project.status === 'archived'

    if (project.healthStatus === 'critical') {
      reasons.push(ORGANIZATION_ATTENTION_REASONS.HEALTH_CRITICAL)
    } else if (project.healthStatus === 'at_risk') {
      reasons.push(ORGANIZATION_ATTENTION_REASONS.HEALTH_AT_RISK)
    }

    if (!closed && project.endDate) {
      const end = new Date(project.endDate).getTime()
      if (Number.isFinite(end)) {
        if (end < now) reasons.push(ORGANIZATION_ATTENTION_REASONS.OVERDUE)
        else if (end <= dueSoonThreshold) reasons.push(ORGANIZATION_ATTENTION_REASONS.DUE_SOON)
      }
    }

    if (project.status === 'on_hold') reasons.push(ORGANIZATION_ATTENTION_REASONS.ON_HOLD)
    if (!closed && project.progressPercent <= 0 && project.status === 'active') {
      reasons.push(ORGANIZATION_ATTENTION_REASONS.NO_PROGRESS)
    }
    return reasons
  }

  private buildAttentionProjects(
    evaluated: Array<{
      project: OrganizationDashboardProjectFact
      reasons: OrganizationAttentionReason[]
    }>,
    overdueByProject: Map<number, number>,
    query: NormalizedOrganizationDashboardQuery,
    include: boolean,
    access: OrganizationDashboardAccess,
  ): OrganizationAttentionItem[] {
    if (!include) return []

    const items = evaluated
      .filter((item) => item.reasons.length > 0)
      .map<OrganizationAttentionItem>(({ project, reasons }) => ({
        projectId: project.id,
        projectName: project.name,
        status: project.status,
        healthStatus: project.healthStatus,
        progressPercent: project.progressPercent,
        attentionScore: computeOrganizationAttentionScore(reasons),
        reasons,
        overdueTaskCount: overdueByProject.get(project.id) ?? 0,
        target: this.projectTarget(project.id),
        warnings: [],
      }))

    const direction = query.attentionOrder === 'asc' ? 1 : -1
    items.sort((a, b) => {
      let cmp = 0
      switch (query.attentionSort) {
        case 'name':
          cmp = a.projectName.localeCompare(b.projectName, 'zh-Hans-CN')
          break
        case 'progress':
          cmp = a.progressPercent - b.progressPercent
          break
        case 'health':
          cmp = a.healthStatus.localeCompare(b.healthStatus)
          break
        case 'overdue':
          cmp = (a.overdueTaskCount ?? 0) - (b.overdueTaskCount ?? 0)
          break
        case 'updated_at':
          cmp = a.projectId - b.projectId
          break
        default:
          cmp = a.attentionScore - b.attentionScore
      }
      // 同分时按项目 ID 稳定排序，保证同一输入产生同一输出。
      return cmp === 0 ? a.projectId - b.projectId : cmp * direction
    })

    void access
    return items.slice(0, query.attentionLimit)
  }

  // ─── 组装：KPI ───────────────────────────────────────────────────────────────

  private buildKpis(input: {
    projects: OrganizationDashboardProjectFact[]
    attentionCount: number
    overdueProjectCount: number
    dueSoonProjectCount: number
    staleSourceCount: number
    activityCount: number
    memberFact: OrganizationMemberFact | null
    resourceFact: OrganizationResourceFact | null
    riskFact: OrganizationRiskFact | null
    access: OrganizationDashboardAccess
    includeKpiSection: boolean
  }): OrganizationDashboardMetric[] {
    if (!input.includeKpiSection) return []

    const { projects } = input
    const countBy = (status: string) => projects.filter((item) => item.status === status).length
    const avgProgress =
      projects.length > 0
        ? Math.round(
            projects.reduce((sum, item) => sum + Number(item.progressPercent ?? 0), 0) /
              projects.length,
          )
        : 0

    const kpis: OrganizationDashboardMetric[] = [
      this.metric(ORGANIZATION_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS, projects.length, 'count'),
      this.metric(ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS, countBy('active'), 'count'),
      this.metric(ORGANIZATION_DASHBOARD_METRIC_KEYS.ON_HOLD_PROJECTS, countBy('on_hold'), 'count'),
      this.metric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.COMPLETED_PROJECTS,
        countBy('completed'),
        'count',
      ),
      this.metric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.ARCHIVED_PROJECTS,
        countBy('archived'),
        'count',
      ),
      this.metric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.ATTENTION_PROJECTS,
        input.attentionCount,
        'count',
        ORGANIZATION_DASHBOARD_SOURCES.COMPUTED,
      ),
      this.metric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERDUE_PROJECTS,
        input.overdueProjectCount,
        'count',
        ORGANIZATION_DASHBOARD_SOURCES.COMPUTED,
      ),
      this.metric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.DUE_SOON_PROJECTS,
        input.dueSoonProjectCount,
        'count',
        ORGANIZATION_DASHBOARD_SOURCES.COMPUTED,
      ),
      this.metric(ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG, avgProgress, 'percent'),
      this.metric(
        ORGANIZATION_DASHBOARD_METRIC_KEYS.STALE_SOURCE_COUNT,
        input.staleSourceCount,
        'count',
        ORGANIZATION_DASHBOARD_SOURCES.COMPUTED,
      ),
    ]

    // 成员维度
    if (input.access.canViewMembers === DENIED) {
      kpis.push(
        redactedOrganizationMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.MEMBER_TOTAL,
          ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP,
        ),
        redactedOrganizationMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_MEMBER_TOTAL,
          ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP,
        ),
      )
    } else if (input.memberFact) {
      kpis.push(
        this.metric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.MEMBER_TOTAL,
          input.memberFact.totalMembers,
          'count',
          ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP,
        ),
        this.metric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_MEMBER_TOTAL,
          input.memberFact.activeMembers,
          'count',
          ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP,
        ),
      )
    }

    // 资源维度
    if (input.access.canViewResources === DENIED) {
      kpis.push(
        redactedOrganizationMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.RESOURCE_ALLOCATED_PROJECTS,
          ORGANIZATION_DASHBOARD_SOURCES.RESOURCE_SUMMARY,
        ),
        redactedOrganizationMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.RESOURCE_OVERLOAD_COUNT,
          ORGANIZATION_DASHBOARD_SOURCES.RESOURCE_SUMMARY,
        ),
      )
    } else if (input.resourceFact) {
      kpis.push(
        this.metric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.RESOURCE_ALLOCATED_PROJECTS,
          input.resourceFact.allocatedProjectCount,
          'count',
          ORGANIZATION_DASHBOARD_SOURCES.RESOURCE_SUMMARY,
        ),
        this.metric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.RESOURCE_OVERLOAD_COUNT,
          input.resourceFact.overloadedResourceCount,
          'count',
          ORGANIZATION_DASHBOARD_SOURCES.RESOURCE_SUMMARY,
        ),
      )
    }

    // 风险维度
    if (input.access.canViewRisks === DENIED) {
      kpis.push(
        redactedOrganizationMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.OPEN_RISK_COUNT,
          ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        ),
        redactedOrganizationMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT,
          ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        ),
      )
    } else if (input.riskFact) {
      kpis.push(
        this.metric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.OPEN_RISK_COUNT,
          input.riskFact.openCount,
          'count',
          ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        ),
        this.metric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.HIGH_RISK_COUNT,
          input.riskFact.highCount,
          'count',
          ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        ),
      )
    }

    // 活动维度
    if (input.access.canViewActivity === DENIED) {
      kpis.push(
        redactedOrganizationMetric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.RECENT_ACTIVITY_COUNT,
          ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG,
        ),
      )
    } else {
      kpis.push(
        this.metric(
          ORGANIZATION_DASHBOARD_METRIC_KEYS.RECENT_ACTIVITY_COUNT,
          input.activityCount,
          'count',
          ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG,
        ),
      )
    }

    return kpis
  }

  private metric(
    key: OrganizationDashboardMetric['key'],
    value: number,
    unit: OrganizationDashboardMetric['unit'],
    source: OrganizationDashboardMetric['source'] = ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
  ): OrganizationDashboardMetric {
    return {
      key,
      value,
      unit,
      source,
      status:
        value === 0 ? ORGANIZATION_DASHBOARD_STATUSES.EMPTY : ORGANIZATION_DASHBOARD_STATUSES.OK,
    }
  }

  private countByStatus(
    projects: OrganizationDashboardProjectFact[],
  ): Array<{ key: string; label: string; count: number }> {
    const labels: Record<string, string> = {
      planning: '规划中',
      active: '进行中',
      on_hold: '暂停',
      completed: '已完成',
      archived: '已归档',
    }
    const counts = new Map<string, number>()
    for (const project of projects) {
      counts.set(project.status, (counts.get(project.status) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, label: labels[key] ?? key, count }))
  }

  // ─── 组装：成员 / 资源 / 风险 / 活动 / PMO ────────────────────────────────────

  private buildMemberOverview(
    access: OrganizationDashboardAccess,
    fact: OrganizationMemberFact | null,
  ): OrganizationMemberOverview {
    if (access.canViewMembers === DENIED) return redactedOrganizationMemberOverview()
    if (!fact) {
      return {
        available: false,
        forbidden: false,
        totalMembers: null,
        activeMembers: null,
        roleDistribution: [],
        target: null,
        warnings: [],
      }
    }
    return {
      available: true,
      forbidden: false,
      totalMembers: fact.totalMembers,
      activeMembers: fact.activeMembers,
      roleDistribution: toOrganizationDistribution(
        fact.roleCounts.map((item) => ({ key: item.role, label: item.role, count: item.count })),
      ),
      target: {
        kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.MEMBER,
        href: '/settings/organization',
        authorized: true,
      },
      warnings: [],
    }
  }

  private buildResourceOverview(
    access: OrganizationDashboardAccess,
    fact: OrganizationResourceFact | null,
  ): OrganizationResourceOverview {
    if (access.canViewResources === DENIED) return redactedOrganizationResourceOverview()
    if (!fact) {
      return {
        available: false,
        forbidden: false,
        allocatedProjectCount: null,
        overloadedResourceCount: null,
        totalAllocationPercent: null,
        target: null,
        warnings: [],
      }
    }
    return {
      available: true,
      forbidden: false,
      allocatedProjectCount: fact.allocatedProjectCount,
      overloadedResourceCount: fact.overloadedResourceCount,
      totalAllocationPercent: fact.totalAllocationPercent,
      target: {
        kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.RESOURCE,
        href: '/organization/resource-pool',
        authorized: true,
      },
      warnings: [],
    }
  }

  private buildRiskReminders(
    access: OrganizationDashboardAccess,
    riskFact: OrganizationRiskFact | null,
    overdueProjectCount: number,
    dueSoonProjectCount: number,
    include: boolean,
  ): OrganizationRiskReminder[] {
    if (!include) return []
    if (access.canViewRisks === DENIED) return redactedOrganizationRiskReminders()

    const reminders: OrganizationRiskReminder[] = []
    if (riskFact) {
      const riskTarget: OrganizationDashboardTarget = {
        kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.RISK,
        href: '/risks',
        authorized: true,
      }
      reminders.push({
        code: ORGANIZATION_REMINDER_CODES.HIGH_RISK,
        label: '高风险',
        count: riskFact.highCount,
        status:
          riskFact.highCount === 0
            ? ORGANIZATION_DASHBOARD_STATUSES.EMPTY
            : ORGANIZATION_DASHBOARD_STATUSES.OK,
        source: ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        target: riskTarget,
        warnings: [],
      })
      reminders.push({
        code: ORGANIZATION_REMINDER_CODES.OPEN_RISK,
        label: '未关闭风险',
        count: riskFact.openCount,
        status:
          riskFact.openCount === 0
            ? ORGANIZATION_DASHBOARD_STATUSES.EMPTY
            : ORGANIZATION_DASHBOARD_STATUSES.OK,
        source: ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        target: riskTarget,
        warnings: [],
      })
    }

    reminders.push({
      code: ORGANIZATION_REMINDER_CODES.OVERDUE_PROJECT,
      label: '已延期项目',
      count: overdueProjectCount,
      status:
        overdueProjectCount === 0
          ? ORGANIZATION_DASHBOARD_STATUSES.EMPTY
          : ORGANIZATION_DASHBOARD_STATUSES.OK,
      source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
      target: null,
      warnings: [],
    })
    reminders.push({
      code: ORGANIZATION_REMINDER_CODES.DUE_SOON_PROJECT,
      label: '临近截止项目',
      count: dueSoonProjectCount,
      status:
        dueSoonProjectCount === 0
          ? ORGANIZATION_DASHBOARD_STATUSES.EMPTY
          : ORGANIZATION_DASHBOARD_STATUSES.OK,
      source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
      target: null,
      warnings: [],
    })
    return reminders
  }

  /** 活动只保留低敏 envelope，并再次按可见项目过滤，防止跨项目/跨组织泄露。 */
  private toLowSensitiveActivity(
    facts: OrganizationActivityFact[],
    projectIds: number[],
    access: OrganizationDashboardAccess,
  ): OrganizationActivityItem[] {
    if (access.canViewActivity === DENIED) return []
    const visible = new Set(projectIds)
    return facts
      .filter((fact) => fact.projectId === null || visible.has(fact.projectId))
      .map((fact) => ({
        id: fact.id,
        action: fact.action,
        entityType: fact.entityType,
        severity: fact.severity,
        projectId: fact.projectId,
        occurredAt: fact.occurredAt,
        target: fact.projectId !== null ? this.projectTarget(fact.projectId) : null,
      }))
  }

  private async buildPmoEntry(
    user: User,
    organizationId: number,
    query: NormalizedOrganizationDashboardQuery,
    access: OrganizationDashboardAccess,
    wantsSection: (section: string) => boolean,
  ): Promise<OrganizationPmoEntry> {
    if (!wantsSection(ORGANIZATION_DASHBOARD_SECTIONS.PMO_ENTRY)) {
      return degradedOrganizationPmoEntry('unavailable')
    }
    if (access.canViewPmo === DENIED) return degradedOrganizationPmoEntry('forbidden')

    let fact: OrganizationPmoFact | null = null
    try {
      fact = await this.readPmoSummary(organizationId, user)
    } catch {
      // PMO 源不可用不应拖垮组织首页：降级为 unavailable，其余授权数据照常返回。
      fact = null
    }
    if (!fact || !fact.available) return degradedOrganizationPmoEntry('unavailable')

    return {
      available: true,
      forbidden: false,
      summary: {
        totalProjects: fact.totalProjects,
        atRiskProjects: fact.atRiskProjects,
        overallProgressAvg: fact.overallProgressAvg,
      },
      freshness: makeOrganizationDashboardFreshness({
        source: ORGANIZATION_DASHBOARD_SOURCES.PMO_PORTFOLIO,
        lastUpdatedAt: fact.lastUpdatedAt,
        staleThresholdMinutes: query.freshnessWindowMinutes,
      }),
      targets: [{ kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.PMO, href: '/pmo', authorized: true }],
      warnings: [],
    }
  }

  // ─── 组装：freshness ─────────────────────────────────────────────────────────

  private buildSourceFreshness(
    query: NormalizedOrganizationDashboardQuery,
    access: OrganizationDashboardAccess,
    input: {
      projects: OrganizationDashboardProjectFact[]
      memberFact: OrganizationMemberFact | null
      resourceFact: OrganizationResourceFact | null
      riskFact: OrganizationRiskFact | null
      activityFacts: OrganizationActivityFact[]
      pmoEntry: OrganizationPmoEntry
    },
  ): OrganizationDashboardSourceFreshness[] {
    const threshold = query.freshnessWindowMinutes
    const latest = (values: Array<string | null>): string | null => {
      const times = values
        .filter((value): value is string => Boolean(value))
        .map((value) => new Date(value).getTime())
        .filter((value) => Number.isFinite(value))
      return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
    }

    const freshness: OrganizationDashboardSourceFreshness[] = [
      makeOrganizationDashboardFreshness({
        source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
        lastUpdatedAt: latest(input.projects.map((project) => project.updatedAt)),
        staleThresholdMinutes: threshold,
      }),
      makeOrganizationDashboardFreshness({
        source: ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP,
        lastUpdatedAt: input.memberFact?.updatedAt ?? null,
        staleThresholdMinutes: threshold,
        forbidden: access.canViewMembers === DENIED,
        unavailable: access.canViewMembers !== DENIED && !input.memberFact,
      }),
      makeOrganizationDashboardFreshness({
        source: ORGANIZATION_DASHBOARD_SOURCES.RESOURCE_SUMMARY,
        lastUpdatedAt: input.resourceFact?.updatedAt ?? null,
        staleThresholdMinutes: threshold,
        forbidden: access.canViewResources === DENIED,
        unavailable: access.canViewResources !== DENIED && !input.resourceFact,
      }),
      makeOrganizationDashboardFreshness({
        source: ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
        lastUpdatedAt: input.riskFact?.updatedAt ?? null,
        staleThresholdMinutes: threshold,
        forbidden: access.canViewRisks === DENIED,
        unavailable: access.canViewRisks !== DENIED && !input.riskFact,
      }),
      makeOrganizationDashboardFreshness({
        source: ORGANIZATION_DASHBOARD_SOURCES.ACTIVITY_LOG,
        lastUpdatedAt: latest(input.activityFacts.map((fact) => fact.occurredAt)),
        staleThresholdMinutes: threshold,
        forbidden: access.canViewActivity === DENIED,
        unavailable: access.canViewActivity !== DENIED && input.activityFacts.length === 0,
      }),
    ]

    if (input.pmoEntry.freshness) freshness.push(input.pmoEntry.freshness)
    return freshness
  }

  // ─── 财务不支持检测 ──────────────────────────────────────────────────────────

  /** 查询命中预算/成本/ROI/财务关键词时返回 unsupported warning，而不是伪造财务数值。 */
  private detectUnsupportedFinancialWarnings(
    query: NormalizedOrganizationDashboardQuery,
  ): OrganizationDashboardWarning[] {
    if (!query.search) return []
    const needle = query.search.toLowerCase()
    const warnings: OrganizationDashboardWarning[] = []
    for (const entry of FINANCIAL_KEYWORDS) {
      if (entry.aliases.some((alias) => needle.includes(alias))) {
        warnings.push(organizationFinancialUnsupportedWarning(entry.field))
      }
    }
    return warnings
  }

  /** 可选缓存不可用时的降级 warning（本机 SQLite 默认不启用缓存）。 */
  cacheDegradedWarning(): OrganizationDashboardWarning {
    return organizationCacheDegradedWarning()
  }

  // ─── Target 构造 ─────────────────────────────────────────────────────────────

  /** 项目 drill-down target。仅对已通过可见性过滤的项目下发，真实详情端点仍二次授权。 */
  private projectTarget(projectId: number): OrganizationDashboardTarget {
    return {
      kind: ORGANIZATION_DASHBOARD_TARGET_KINDS.PROJECT,
      href: `/projects/${projectId}`,
      authorized: true,
    }
  }
}
