import { isoDay } from '#services/project_health_service'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import AuditLog from '#models/audit_log'
import Project from '#models/project'
import ProjectContradiction from '#models/project_contradiction'
import ProjectHealthDiagnosis from '#models/project_health_diagnosis'
import ProjectMember from '#models/project_member'
import ProjectRecommendation from '#models/project_recommendation'
import RiskWorkbenchService from '#services/risk_workbench_service'
import InnovationDashboardAdapter from '#services/triz_innovation/innovation_dashboard_adapter'
import db from '@adonisjs/lucid/services/db'
import type {
  ContradictionDashboardSummary,
  DashboardMeta,
  DashboardMetric,
  DashboardWarning,
  DashboardHealthSummary,
  DashboardRecommendationSummary,
  InnovationDashboardSummaryResponse,
} from '@aiproj/types'
import {
  DASHBOARD_METRIC_KEYS,
  DASHBOARD_METRIC_VERSION_V1,
  DASHBOARD_SOURCES,
  DASHBOARD_STATUSES,
  DASHBOARD_WARNING_CODES,
  SOON_DUE_WINDOW_DAYS,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'
import type User from '#models/user'

export interface DashboardStats {
  healthStatus: string
  progressPercent: number
  taskStatusDistribution: Record<string, number>
  memberCount: number
  milestoneStatusDistribution: Record<string, number>
  startDate: string | null
  endDate: string | null
  remainingDays: number | null
  // V2 风险摘要
  totalRisks?: number
  highRiskCount?: number
  criticalRiskCount?: number
  riskHealthScore?: number | null
}

export interface RecentActivityItem {
  id: number
  action: string
  event: string | null
  severity: string
  userId: number | null
  entityType: string | null
  entityId: number | null
  createdAt: Date
}

export interface ProjectDashboardResult {
  stats: DashboardStats
  recentActivity: RecentActivityItem[]
  metrics: DashboardMetric[]
  meta: DashboardMeta
  warnings: DashboardWarning[]
  /** v2-ai-project-health-diagnosis：最新已确认健康诊断摘要（无诊断时不可用） */
  healthDiagnosis: DashboardHealthSummary
  /** v2-triz-contradiction-model-foundation：只读、权限脱敏矛盾摘要 */
  contradictionSummary: ContradictionDashboardSummary
  /** v2-ai-smart-recommendations：待处理推荐摘要 */
  recommendationSummary: DashboardRecommendationSummary
  /** v3-triz-innovation-workbench：只读、权限脱敏创新工作台摘要 */
  trizInnovationWorkbenchSummary: InnovationDashboardSummaryResponse['data']
}

/**
 * 读取期派生项目健康度（polish-v1-ui-and-assignment / D5）。
 * `projects.health_status` 列默认 'unknown' 且无写入方，直显即 UNKNOWN；
 * V1 简化档不写库，按进度/逾期/受阻即时派生 green/yellow/red/unknown。
 */
function deriveHealthStatus(
  taskTotal: number,
  overdueCount: number,
  blockedCount: number,
): 'green' | 'yellow' | 'red' | 'unknown' {
  if (taskTotal === 0) return 'unknown'
  const overdueRatio = overdueCount / taskTotal
  const blockedRatio = blockedCount / taskTotal
  if (overdueRatio >= 0.25 || blockedRatio >= 0.25) return 'red'
  if (overdueCount > 0 || blockedCount > 0) return 'yellow'
  return 'green'
}

/** Dashboard 聚合服务：单一权威出口，所有指标带组织+项目过滤。 */
@inject()
export default class ProjectDashboardService {
  constructor(
    private riskWorkbench: RiskWorkbenchService,
    private innovationDashboard: InnovationDashboardAdapter,
  ) {}

  async get(
    organizationId: number,
    projectId: number,
    userOrId: User | number,
    hasRiskView = false,
    hasResourceView = false,
    hasChangeImpactView = false,
    hasContradictionView = false,
    hasRecommendationView = false,
  ): Promise<ProjectDashboardResult> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) {
      throw new ResourceNotFoundException('项目不存在')
    }

    const user = typeof userOrId === 'number' ? null : userOrId
    const [
      stats,
      recentActivity,
      metrics,
      riskSummary,
      latestDiagnosis,
      contradictionSummary,
      recommendationSummary,
      trizInnovationWorkbenchSummary,
    ] = await Promise.all([
      this.computeStats(projectId, project),
      this.recentActivity(organizationId, projectId, 20),
      this.computeMetrics(projectId, organizationId, project),
      hasRiskView
        ? this.riskWorkbench.getSummary(organizationId, projectId).catch(() => null)
        : Promise.resolve(null),
      // v2-ai-project-health-diagnosis：读取最新已确认健康诊断（只读，不触发任何 AI 调用）
      this.fetchLatestConfirmedDiagnosis(organizationId, projectId),
      this.fetchContradictionSummary(organizationId, projectId, hasContradictionView),
      this.fetchRecommendationSummary(organizationId, projectId, hasRecommendationView),
      user && this.innovationDashboard
        ? this.innovationDashboard.getSummary(user, organizationId, projectId)
        : Promise.resolve({ summary: null, hasViewPermission: false }),
    ])

    // 风险摘要注入（仅对有权限用户）
    if (hasRiskView && riskSummary) {
      stats.totalRisks = riskSummary.totalRisks
      stats.highRiskCount = riskSummary.highRiskCount
      stats.criticalRiskCount = riskSummary.criticalRiskCount
      stats.riskHealthScore = riskSummary.healthScore
    }

    // 读取期派生健康度：复用已算出的分布/逾期数，不再额外查询。
    const taskTotal = Object.values(stats.taskStatusDistribution).reduce((s, v) => s + v, 0)
    const overdueCount = Number(
      metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.OVERDUE_TASK_COUNT)?.value ?? 0,
    )
    const derivedHealth = deriveHealthStatus(
      taskTotal,
      overdueCount,
      stats.taskStatusDistribution.blocked ?? 0,
    )
    stats.healthStatus = derivedHealth
    const healthMetric = metrics.find((m) => m.key === DASHBOARD_METRIC_KEYS.HEALTH_STATUS)
    if (healthMetric) healthMetric.value = derivedHealth

    // Compute warnings after metrics (reconciliation needs task/milestone data)
    const allWarnings = await this.computeWarnings(projectId, organizationId, project, stats)

    // 构建健康诊断摘要（v2-ai-project-health-diagnosis §6.1）
    // 权限脱敏：无风险/资源/变更权限时隐藏对应维度证据和建议（§6.3）
    const forbiddenDimensions: string[] = []
    if (!hasRiskView) forbiddenDimensions.push('risk')
    if (!hasResourceView) forbiddenDimensions.push('resource')
    if (!hasChangeImpactView) forbiddenDimensions.push('change_impact')

    const healthDiagnosis: DashboardHealthSummary = latestDiagnosis
      ? {
          diagnosisId: latestDiagnosis.id,
          overallScore: latestDiagnosis.summary?.overallScore ?? null,
          overallLabel: latestDiagnosis.summary?.overallLabel ?? null,
          dimensionScores: (latestDiagnosis.summary?.dimensionScores ?? [])
            .filter((ds) => !forbiddenDimensions.includes(ds.dimension))
            .map((ds) => ({
              dimension: ds.dimension,
              score: ds.score,
              severity: ds.severity,
            })),
          status: latestDiagnosis.status,
          stale: latestDiagnosis.stale,
          staleReason: latestDiagnosis.staleReason,
          confirmedAt: latestDiagnosis.confirmedAt?.toISO() ?? null,
          confirmedBy: latestDiagnosis.confirmedBy,
          confirmedNotes: latestDiagnosis.confirmedNotes,
          warnings: (latestDiagnosis.warnings ?? []).filter(
            (w) => !forbiddenDimensions.includes(w.dimension),
          ),
          available: true,
        }
      : {
          diagnosisId: null,
          overallScore: null,
          overallLabel: null,
          dimensionScores: [],
          status: null,
          stale: false,
          staleReason: null,
          confirmedAt: null,
          confirmedBy: null,
          confirmedNotes: null,
          warnings: [
            {
              dimension: 'progress',
              code: 'HEALTH_DIAGNOSIS_UNAVAILABLE',
              message: '暂无已确认的健康诊断概览（不含 AI 隐式调用）',
              blocking: false,
            },
          ],
          available: false,
        }

    return {
      stats,
      recentActivity,
      metrics,
      meta: {
        calculatedAt: new Date().toISOString(),
        metricVersion: DASHBOARD_METRIC_VERSION_V1,
        projectId,
        organizationId,
      },
      warnings: allWarnings,
      healthDiagnosis,
      contradictionSummary,
      recommendationSummary,
      trizInnovationWorkbenchSummary,
    }
  }

  private async computeStats(projectId: number, project: Project): Promise<DashboardStats> {
    const { taskStatusDistribution, milestoneStatusDistribution, memberCount } =
      await this.fetchAggregates(projectId)

    const now = new Date()
    let remainingDays: number | null = null
    const endIso = project.endDate?.toISODate()
    if (endIso) {
      const end = new Date(endIso)
      remainingDays = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    }

    return {
      healthStatus: project.healthStatus,
      progressPercent: Number(project.progressPercent),
      taskStatusDistribution,
      memberCount,
      milestoneStatusDistribution,
      startDate: project.startDate?.toISODate() ?? null,
      endDate: project.endDate?.toISODate() ?? null,
      remainingDays,
    }
  }

  private async fetchAggregates(projectId: number) {
    const [taskRows, milestoneRows, memberCountResult] = await Promise.all([
      db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .select('status')
        .count('* as count')
        .groupBy('status'),
      db
        .from('milestones')
        .where('project_id', projectId)
        .select('status')
        .count('* as count')
        .groupBy('status'),
      ProjectMember.query()
        .where('project_id', projectId)
        .where('is_active', true)
        .count('*', 'total'),
    ])

    const taskStatusDistribution: Record<string, number> = {
      not_started: 0,
      in_progress: 0,
      completed: 0,
      blocked: 0,
      on_hold: 0,
      cancelled: 0,
    }
    for (const row of taskRows) {
      taskStatusDistribution[row.status] = Number(row.count)
    }

    const milestoneStatusDistribution: Record<string, number> = {
      not_started: 0,
      planned: 0,
      at_risk: 0,
      achieved: 0,
      missed: 0,
    }
    for (const row of milestoneRows) {
      milestoneStatusDistribution[row.status] = Number(row.count)
    }

    return {
      taskStatusDistribution,
      milestoneStatusDistribution,
      memberCount: Number(memberCountResult[0]?.$extras?.total ?? 0),
    }
  }

  /** 集中生成规范化指标集合。 */
  private async computeMetrics(
    projectId: number,
    organizationId: number,
    project: Project,
  ): Promise<DashboardMetric[]> {
    const { taskStatusDistribution, milestoneStatusDistribution, memberCount } =
      await this.fetchAggregates(projectId)

    const now = new Date()

    // Remaining days
    const endIso = project.endDate?.toISODate()
    let remainingDays: number | null = null
    if (endIso) {
      const end = new Date(endIso)
      remainingDays = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    }

    // Overdue & soon-due tasks
    const { overdueCount, soonDueCount } = await this.fetchOverdueAndSoonDue(projectId, now)

    // Task total
    const taskTotal = Object.values(taskStatusDistribution).reduce((s, v) => s + v, 0)
    // Milestone total
    const milestoneTotal = Object.values(milestoneStatusDistribution).reduce((s, v) => s + v, 0)

    // Recent activity count (just for the summary metric)
    const activityCount = await AuditLog.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .count('*', 'total')
      .then((r) => Number(r[0]?.$extras?.total ?? 0))

    const metrics: DashboardMetric[] = [
      {
        key: DASHBOARD_METRIC_KEYS.PROGRESS_PERCENT,
        value: Number(project.progressPercent),
        unit: 'percent',
        source: DASHBOARD_SOURCES.PROJECT_FIELD,
        status: DASHBOARD_STATUSES.OK,
      },
      {
        key: DASHBOARD_METRIC_KEYS.HEALTH_STATUS,
        value: project.healthStatus,
        unit: 'status',
        source: DASHBOARD_SOURCES.PROJECT_FIELD,
        status: DASHBOARD_STATUSES.OK,
      },
      {
        key: DASHBOARD_METRIC_KEYS.TASK_STATUS_DISTRIBUTION,
        value: taskTotal,
        unit: 'distribution',
        source: DASHBOARD_SOURCES.TASK_AGGREGATION,
        status: taskTotal === 0 ? DASHBOARD_STATUSES.EMPTY : DASHBOARD_STATUSES.OK,
        breakdown: taskStatusDistribution,
      },
      {
        key: DASHBOARD_METRIC_KEYS.TASK_TOTAL,
        value: taskTotal,
        unit: 'count',
        source: DASHBOARD_SOURCES.TASK_AGGREGATION,
        status: taskTotal === 0 ? DASHBOARD_STATUSES.EMPTY : DASHBOARD_STATUSES.OK,
      },
      {
        key: DASHBOARD_METRIC_KEYS.OVERDUE_TASK_COUNT,
        value: overdueCount,
        unit: 'count',
        source: DASHBOARD_SOURCES.TASK_AGGREGATION,
        status: overdueCount === 0 ? DASHBOARD_STATUSES.OK : DASHBOARD_STATUSES.OK,
      },
      {
        key: DASHBOARD_METRIC_KEYS.SOON_DUE_TASK_COUNT,
        value: soonDueCount,
        unit: 'count',
        source: DASHBOARD_SOURCES.TASK_AGGREGATION,
        status: soonDueCount === 0 ? DASHBOARD_STATUSES.OK : DASHBOARD_STATUSES.OK,
      },
      {
        key: DASHBOARD_METRIC_KEYS.MEMBER_COUNT,
        value: memberCount,
        unit: 'count',
        source: DASHBOARD_SOURCES.MEMBER_AGGREGATION,
        status: memberCount === 0 ? DASHBOARD_STATUSES.EMPTY : DASHBOARD_STATUSES.OK,
      },
      {
        key: DASHBOARD_METRIC_KEYS.MILESTONE_STATUS_DISTRIBUTION,
        value: milestoneTotal,
        unit: 'distribution',
        source: DASHBOARD_SOURCES.MILESTONE_AGGREGATION,
        status: milestoneTotal === 0 ? DASHBOARD_STATUSES.EMPTY : DASHBOARD_STATUSES.OK,
        breakdown: milestoneStatusDistribution,
      },
      {
        key: DASHBOARD_METRIC_KEYS.MILESTONE_TOTAL,
        value: milestoneTotal,
        unit: 'count',
        source: DASHBOARD_SOURCES.MILESTONE_AGGREGATION,
        status: milestoneTotal === 0 ? DASHBOARD_STATUSES.EMPTY : DASHBOARD_STATUSES.OK,
      },
      {
        key: DASHBOARD_METRIC_KEYS.REMAINING_DAYS,
        value: remainingDays,
        unit: 'days',
        source: DASHBOARD_SOURCES.PROJECT_FIELD,
        status: remainingDays === null ? DASHBOARD_STATUSES.UNAVAILABLE : DASHBOARD_STATUSES.OK,
      },
      {
        key: DASHBOARD_METRIC_KEYS.RECENT_ACTIVITY_SUMMARY,
        value: activityCount,
        unit: 'summary',
        source: DASHBOARD_SOURCES.AUDIT_LOG_AGGREGATION,
        status: activityCount === 0 ? DASHBOARD_STATUSES.EMPTY : DASHBOARD_STATUSES.OK,
      },
    ]

    return metrics
  }

  /** 逾期任务数与即将到期任务数（排除 completed / cancelled）。 */
  private async fetchOverdueAndSoonDue(
    projectId: number,
    now: Date,
  ): Promise<{ overdueCount: number; soonDueCount: number }> {
    const todayStr = now.toISOString().slice(0, 10)
    const soonDueEnd = new Date(now.getTime() + SOON_DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    const rows = await db
      .from('tasks')
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .whereNotIn('status', ['completed', 'cancelled'])
      .whereNotNull('end_date')
      .select('end_date')

    let overdueCount = 0
    let soonDueCount = 0
    for (const row of rows) {
      const dueDate = isoDay(row.end_date) ?? ''
      if (dueDate < todayStr) {
        overdueCount++
      } else if (dueDate >= todayStr && dueDate <= soonDueEnd) {
        soonDueCount++
      }
    }
    return { overdueCount, soonDueCount }
  }

  /**
   * 获取最新已确认健康诊断（只读，不触发任何 AI 调用）。
   * v2-ai-project-health-diagnosis §6.1 / §6.2：禁止隐式生成或触发 AIGateway。
   */
  private async fetchLatestConfirmedDiagnosis(
    organizationId: number,
    projectId: number,
  ): Promise<ProjectHealthDiagnosis | null> {
    try {
      const diagnosis = await ProjectHealthDiagnosis.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .where('status', 'confirmed')
        .orderBy('generated_at', 'desc')
        .first()
      return diagnosis ?? null
    } catch {
      // 诊断表不可用（如迁移未运行）时静默降级，不影响 Dashboard 主流程
      return null
    }
  }

  /**
   * 读取 TRIZ 矛盾 Dashboard 摘要。
   * 只读已存快照，不触发 refresh、规则派生或 AIGateway。
   */
  private async fetchContradictionSummary(
    organizationId: number,
    projectId: number,
    hasContradictionView: boolean,
  ): Promise<ContradictionDashboardSummary> {
    if (!hasContradictionView) {
      return {
        unresolvedCount: 0,
        staleCount: 0,
        topContradictions: [],
        warnings: ['CONTRADICTION_PERMISSION_REDACTED'],
      }
    }

    try {
      const rows = await ProjectContradiction.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereIn('status', ['draft', 'confirmed'])
        .orderByRaw(
          `CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC`,
        )
        .orderBy('created_at', 'desc')
        .limit(5)

      const staleRows = await ProjectContradiction.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereIn('status', ['draft', 'confirmed'])
        .where('stale', true)
        .count('*', 'total')

      return {
        unresolvedCount: rows.length,
        staleCount: Number(staleRows[0]?.$extras?.total ?? 0),
        topContradictions: rows.map((row: ProjectContradiction) => ({
          id: row.id,
          type: row.type,
          title: row.title,
          severity: row.severity,
          improvingParameterKey: row.improvingParameterKey,
          worseningParameterKey: row.worseningParameterKey,
          parameterKey: row.parameterKey,
        })),
        warnings: [],
      }
    } catch {
      return {
        unresolvedCount: 0,
        staleCount: 0,
        topContradictions: [],
        warnings: ['CONTRADICTION_DATA_UNAVAILABLE'],
      }
    }
  }

  /**
   * v2-ai-smart-recommendations：读取推荐 Dashboard 摘要。
   * 只读 `project_recommendations` 聚合，不触发 refresh 或 AI 解释。
   */
  private async fetchRecommendationSummary(
    organizationId: number,
    projectId: number,
    hasRecommendationView: boolean,
  ): Promise<DashboardRecommendationSummary> {
    if (!hasRecommendationView) {
      return {
        pendingCount: 0,
        criticalCount: 0,
        maxSeverity: null,
        topRecommendations: [],
        updatedAt: null,
        available: false,
        warnings: [
          {
            code: 'RECOMMENDATION_PERMISSION_REDACTED',
            message: '没有查看推荐权限',
            blocking: false,
          },
        ],
      }
    }

    try {
      const rows = await ProjectRecommendation.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .select('id', 'title', 'severity', 'priority', 'status', 'created_at')

      const pending = rows.filter((r) => r.status === 'new' || r.status === 'reviewing')
      const critical = rows.filter((r) => r.severity === 'critical')

      const top = rows
        .filter((r) => !r.stale && (r.status === 'new' || r.status === 'reviewing'))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 3)
        .map((r) => ({
          id: r.id,
          title: r.title,
          severity: r.severity,
          priority: r.priority,
          status: r.status,
        }))

      return {
        pendingCount: pending.length,
        criticalCount: critical.length,
        maxSeverity:
          critical.length > 0
            ? 'critical'
            : rows.some((r) => r.severity === 'high')
              ? 'high'
              : null,
        topRecommendations: top,
        updatedAt:
          rows.length > 0
            ? rows
                .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0]
                .createdAt.toISO()!
            : null,
        available: rows.length > 0,
        warnings: [],
      }
    } catch {
      return {
        pendingCount: 0,
        criticalCount: 0,
        maxSeverity: null,
        topRecommendations: [],
        updatedAt: null,
        available: false,
        warnings: [
          { code: 'RECOMMENDATION_DATA_UNAVAILABLE', message: '推荐摘要不可用', blocking: false },
        ],
      }
    }
  }

  /** 对账与数据质量 warnings。 */
  private async computeWarnings(
    _projectId: number,
    _organizationId: number,
    project: Project,
    stats: DashboardStats,
  ): Promise<DashboardWarning[]> {
    const warnings: DashboardWarning[] = []

    // Date missing
    if (!project.endDate) {
      warnings.push({
        code: DASHBOARD_WARNING_CODES.PROJECT_DATE_MISSING,
        message: '项目缺少结束日期，剩余天数无法计算',
        metricKey: DASHBOARD_METRIC_KEYS.REMAINING_DAYS,
      })
    }

    // Task empty
    const taskTotal = Object.values(stats.taskStatusDistribution).reduce((s, v) => s + v, 0)
    if (taskTotal === 0) {
      warnings.push({
        code: DASHBOARD_WARNING_CODES.TASK_METRIC_EMPTY,
        message: '项目尚无任务数据，任务指标均为空',
        metricKey: DASHBOARD_METRIC_KEYS.TASK_TOTAL,
      })
    }

    // Milestone empty
    const milestoneTotal = Object.values(stats.milestoneStatusDistribution).reduce(
      (s, v) => s + v,
      0,
    )
    if (milestoneTotal === 0) {
      warnings.push({
        code: DASHBOARD_WARNING_CODES.MILESTONE_METRIC_EMPTY,
        message: '项目尚无里程碑数据，里程碑指标均为空',
        metricKey: DASHBOARD_METRIC_KEYS.MILESTONE_TOTAL,
      })
    }

    // Reconciliation: task total == sum of distribution
    const distributionSum = Object.values(stats.taskStatusDistribution).reduce((s, v) => s + v, 0)
    if (taskTotal !== distributionSum) {
      warnings.push({
        code: DASHBOARD_WARNING_CODES.METRIC_RECONCILIATION_MISMATCH,
        message: `任务总数 (${taskTotal}) 与分布之和 (${distributionSum}) 不一致`,
        metricKey: DASHBOARD_METRIC_KEYS.TASK_TOTAL,
      })
    }

    const milestoneDistributionSum = Object.values(stats.milestoneStatusDistribution).reduce(
      (s, v) => s + v,
      0,
    )
    if (milestoneTotal !== milestoneDistributionSum) {
      warnings.push({
        code: DASHBOARD_WARNING_CODES.METRIC_RECONCILIATION_MISMATCH,
        message: `里程碑总数 (${milestoneTotal}) 与分布之和 (${milestoneDistributionSum}) 不一致`,
        metricKey: DASHBOARD_METRIC_KEYS.MILESTONE_TOTAL,
      })
    }

    return warnings
  }

  async recentActivity(
    organizationId: number,
    projectId: number,
    limit = 20,
  ): Promise<RecentActivityItem[]> {
    const logs = await AuditLog.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')
      .limit(limit)

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      event: typeof log.metadata?.event === 'string' ? log.metadata.event : null,
      severity: log.severity,
      userId: log.userId ? Number(log.userId) : null,
      entityType: log.entityType,
      entityId: log.entityId ? Number(log.entityId) : null,
      createdAt: log.createdAt.toJSDate(),
    }))
  }
}
