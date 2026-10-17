/**
 * ProjectHealthInputCollector —— 项目健康诊断输入收集器。
 *
 * 只读收集项目正式数据，按白名单读取任务、依赖、里程碑、关键路径摘要、
 * 资源负载、风险摘要、变更影响、活动/评论计数和 Dashboard 指标。
 * 按维度权限脱敏：缺少 `risk:view`、资源或变更权限时返回 forbidden warning。
 *
 * v2-ai-project-health-diagnosis / D2
 */
import { createHash } from 'node:crypto'
import Project from '#models/project'
import Task from '#models/task'
import Milestone from '#models/milestone'
import AuditLog from '#models/audit_log'
import db from '@adonisjs/lucid/services/db'
import type { HealthDataWarning, HealthPermissionInfo } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 输入/输出类型
// ---------------------------------------------------------------------------

export interface HealthCollectorInput {
  organizationId: number
  projectId: number
  userId: number
  hasRiskView: boolean
  hasResourceView: boolean
  hasChangeImpactView: boolean
}

export interface TaskSummaryData {
  totalTasks: number
  overdueTasks: number
  dueSoonTasks: number
  blockedTasks: number
  completedTasks: number
  inProgressTasks: number
  notStartedTasks: number
  averageOverdueDays: number
  maxOverdueDays: number
}

export interface CriticalPathSummary {
  totalCriticalTasks: number
  overdueCriticalTasks: number
  totalCriticalPathDelay: number
}

export interface MilestoneSummaryData {
  totalMilestones: number
  completedMilestones: number
  overdueMilestones: number
  upcomingMilestones: number
}

export interface ResourceSummaryData {
  totalResources: number
  overallLoadPercent: number
  overloadedResources: number
}

export interface RiskSummaryData {
  totalRisks: number
  criticalRisks: number
  highRisks: number
  riskHealthScore: number | null
}

export interface ChangeImpactSummaryData {
  totalAnalyses: number
  openAnalyses: number
  highSeverityItems: number
}

export interface CollaborationSummaryData {
  recentActivityCount: number
  recentCommentCount: number
  activeMembers: number
}

export interface DataIntegritySummary {
  missingDimensions: HealthDataWarning[]
  hasDependencyCycles: boolean
  hasDataGaps: boolean
}

export interface HealthCollectorOutput {
  taskSummary: TaskSummaryData | null
  criticalPathSummary: CriticalPathSummary | null
  milestoneSummary: MilestoneSummaryData | null
  resourceSummary: ResourceSummaryData | null
  riskSummary: RiskSummaryData | null
  changeImpactSummary: ChangeImpactSummaryData | null
  collaborationSummary: CollaborationSummaryData | null
  dataIntegrity: DataIntegritySummary
  warnings: HealthDataWarning[]
  permissions: HealthPermissionInfo[]
  generatedAt: string
  sourceHash: string
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export default class ProjectHealthInputCollector {
  /**
   * 收集项目健康诊断输入。
   * 按维度权限脱敏，缺失数据返回 warning。
   */
  async collect(input: HealthCollectorInput): Promise<HealthCollectorOutput> {
    const warnings: HealthDataWarning[] = []
    const permissions: HealthPermissionInfo[] = []
    const now = new Date().toISOString()

    // 校验项目存在
    const project = await Project.query()
      .where('id', input.projectId)
      .where('organization_id', input.organizationId)
      .first()

    if (!project) {
      throw new Error(`Project ${input.projectId} not found in org ${input.organizationId}`)
    }

    // 并行收集各维度数据
    const [
      taskSummary,
      criticalPathSummary,
      milestoneSummary,
      resourceSummary,
      riskSummary,
      changeImpactSummary,
      collaborationSummary,
    ] = await Promise.all([
      this.collectTaskSummary(input),
      this.collectCriticalPathSummary(input),
      this.collectMilestoneSummary(input),
      input.hasResourceView ? this.collectResourceSummary(input) : Promise.resolve(null),
      input.hasRiskView ? this.collectRiskSummary(input) : Promise.resolve(null),
      input.hasChangeImpactView ? this.collectChangeImpactSummary(input) : Promise.resolve(null),
      this.collectCollaborationSummary(input),
    ])

    // 权限脱敏处理
    if (!input.hasResourceView) {
      warnings.push({
        dimension: 'resource',
        code: 'PERMISSION_FORBIDDEN',
        message: '无资源查看权限，资源健康维度不可用',
        blocking: true,
      })
      permissions.push({
        dimension: 'resource',
        access: 'forbidden',
        reason: '缺少 resource:view 权限',
      })
    }

    if (!input.hasRiskView) {
      warnings.push({
        dimension: 'risk',
        code: 'PERMISSION_FORBIDDEN',
        message: '无风险查看权限，风险健康维度不可用',
        blocking: true,
      })
      permissions.push({
        dimension: 'risk',
        access: 'forbidden',
        reason: '缺少 risk:view 权限',
      })
    }

    if (!input.hasChangeImpactView) {
      warnings.push({
        dimension: 'change_impact',
        code: 'PERMISSION_FORBIDDEN',
        message: '无变更影响查看权限，变更健康维度不可用',
        blocking: true,
      })
      permissions.push({
        dimension: 'change_impact',
        access: 'forbidden',
        reason: '缺少 change_impact:view 权限',
      })
    }

    // 数据完整性检查
    const dataIntegrity = this.checkDataIntegrity(taskSummary, warnings)

    // 计算 sourceHash
    const sourceHash = this.computeSourceHash({
      taskSummary,
      criticalPathSummary,
      milestoneSummary,
      resourceSummary,
      riskSummary,
      changeImpactSummary,
      collaborationSummary,
      dataIntegrity,
    })

    return {
      taskSummary,
      criticalPathSummary,
      milestoneSummary,
      resourceSummary,
      riskSummary,
      changeImpactSummary,
      collaborationSummary,
      dataIntegrity,
      warnings,
      permissions,
      generatedAt: now,
      sourceHash,
    }
  }

  private async collectTaskSummary(input: HealthCollectorInput): Promise<TaskSummaryData> {
    const now = new Date()
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const qb = Task.query().where('project_id', input.projectId)

    const totalTasks = await qb
      .clone()
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))
    const overdueTasks = await qb
      .clone()
      .whereNotNull('end_date')
      .where('end_date', '<', now.toISOString().split('T')[0])
      .whereNotIn('status', ['completed', 'cancelled'])
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const dueSoonTasks = await qb
      .clone()
      .whereNotNull('end_date')
      .where('end_date', '>=', now.toISOString().split('T')[0])
      .where('end_date', '<=', thirtyDaysLater.toISOString().split('T')[0])
      .whereNotIn('status', ['completed', 'cancelled'])
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const blockedTasks = await qb
      .clone()
      .where('status', 'blocked')
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const completedTasks = await qb
      .clone()
      .where('status', 'completed')
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const inProgressTasks = await qb
      .clone()
      .where('status', 'in_progress')
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const notStartedTasks = await qb
      .clone()
      .where('status', 'not_started')
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    // 平均逾期天数
    const overdueData = await qb
      .clone()
      .whereNotNull('end_date')
      .where('end_date', '<', now.toISOString().split('T')[0])
      .whereNotIn('status', ['completed', 'cancelled'])
      .select('end_date')

    let maxOverdueDays = 0
    let totalOverdueDays = 0

    for (const task of overdueData) {
      if (task.endDate) {
        const endDateStr =
          typeof task.endDate === 'string'
            ? task.endDate
            : (task.endDate.toISO?.() ?? String(task.endDate))
        const endDate = new Date(endDateStr)
        const diffDays = Number.isNaN(endDate.getTime())
          ? 0
          : Math.max(0, Math.floor((now.getTime() - endDate.getTime()) / (24 * 60 * 60 * 1000)))
        totalOverdueDays += diffDays
        if (diffDays > maxOverdueDays) maxOverdueDays = diffDays
      }
    }

    const averageOverdueDays = overdueTasks > 0 ? Math.round(totalOverdueDays / overdueTasks) : 0

    return {
      totalTasks,
      overdueTasks,
      dueSoonTasks,
      blockedTasks,
      completedTasks,
      inProgressTasks,
      notStartedTasks,
      averageOverdueDays,
      maxOverdueDays,
    }
  }

  private async collectCriticalPathSummary(
    input: HealthCollectorInput,
  ): Promise<CriticalPathSummary> {
    // 关键路径任务通常通过标记或依赖链识别
    // V2 首版简化：检查关键路径上的任务状态
    const now = new Date()

    // 找到有依赖关系的任务作为关键路径近似
    const criticalPathTasks = await db.rawQuery(
      `
      SELECT COUNT(DISTINCT t.id) as total,
             COUNT(DISTINCT CASE WHEN t.end_date < ? AND t.status NOT IN ('completed','cancelled') THEN t.id END) as overdue
      FROM tasks t
      INNER JOIN task_dependencies td ON (td.predecessor_id = t.id OR td.successor_id = t.id)
      WHERE t.project_id = ?
    `,
      [now.toISOString().split('T')[0], input.projectId],
    )

    const row = criticalPathTasks.rows?.[0] ?? criticalPathTasks[0] ?? { total: 0, overdue: 0 }
    const totalCriticalTasks = Number(row.total ?? 0)
    const overdueCriticalTasks = Number(row.overdue ?? 0)

    return {
      totalCriticalTasks,
      overdueCriticalTasks,
      totalCriticalPathDelay: overdueCriticalTasks > 0 ? overdueCriticalTasks * 1 : 0,
    }
  }

  private async collectMilestoneSummary(
    input: HealthCollectorInput,
  ): Promise<MilestoneSummaryData> {
    const now = new Date()
    const qb = Milestone.query().where('project_id', input.projectId)

    const totalMilestones = await qb
      .clone()
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const completedMilestones = await qb
      .clone()
      .where('status', 'completed')
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const overdueMilestones = await qb
      .clone()
      .whereNotNull('planned_date')
      .where('planned_date', '<', now.toISOString().split('T')[0])
      .whereNot('status', 'completed')
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const upcomingMilestones = await qb
      .clone()
      .whereNotNull('planned_date')
      .where('planned_date', '>=', now.toISOString().split('T')[0])
      .whereNot('status', 'completed')
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    return { totalMilestones, completedMilestones, overdueMilestones, upcomingMilestones }
  }

  private async collectResourceSummary(
    input: HealthCollectorInput,
  ): Promise<ResourceSummaryData | null> {
    // 简化版资源摘要：统计资源数量和估算负载
    const resources = await db.rawQuery(
      `
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN ra.allocation_percent > 100 THEN 1 END) as overloaded,
             COALESCE(AVG(ra.allocation_percent), 0) as avg_load
      FROM resources r
      LEFT JOIN resource_allocations ra ON ra.resource_id = r.id
      WHERE r.project_id = ?
    `,
      [input.projectId],
    )

    const row = resources.rows?.[0] ?? resources[0] ?? { total: 0, overloaded: 0, avg_load: 0 }

    return {
      totalResources: Number(row.total ?? 0),
      overallLoadPercent: Math.round(Number(row.avg_load ?? 0)),
      overloadedResources: Number(row.overloaded ?? 0),
    }
  }

  private async collectRiskSummary(input: HealthCollectorInput): Promise<RiskSummaryData | null> {
    const qb = db.rawQuery(
      `
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN risk_level = 'critical' THEN 1 END) as critical_count,
             COUNT(CASE WHEN risk_level = 'high' THEN 1 END) as high_count
      FROM risks
      WHERE project_id = ? AND deleted_at IS NULL
    `,
      [input.projectId],
    )

    const result = await qb
    const row = result.rows?.[0] ?? result[0] ?? { total: 0, critical_count: 0, high_count: 0 }

    const totalRisks = Number(row.total ?? 0)

    return {
      totalRisks,
      criticalRisks: Number(row.critical_count ?? 0),
      highRisks: Number(row.high_count ?? 0),
      riskHealthScore:
        totalRisks > 0
          ? Math.max(
              0,
              100 - (Number(row.critical_count ?? 0) * 20 + Number(row.high_count ?? 0) * 10),
            )
          : null,
    }
  }

  private async collectChangeImpactSummary(
    input: HealthCollectorInput,
  ): Promise<ChangeImpactSummaryData | null> {
    const qb = db.rawQuery(
      `
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN status NOT IN ('completed','closed') THEN 1 END) as open_analyses
      FROM change_impact_analyses
      WHERE project_id = ?
    `,
      [input.projectId],
    )

    const result = await qb
    const row = result.rows?.[0] ?? result[0] ?? { total: 0, open_analyses: 0 }

    return {
      totalAnalyses: Number(row.total ?? 0),
      openAnalyses: Number(row.open_analyses ?? 0),
      highSeverityItems: 0, // 简化版
    }
  }

  private async collectCollaborationSummary(
    input: HealthCollectorInput,
  ): Promise<CollaborationSummaryData> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const recentActivity = await AuditLog.query()
      .where('project_id', input.projectId)
      .where('created_at', '>=', thirtyDaysAgo)
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const recentComments = await db.rawQuery(
      `
      SELECT COUNT(*) as total
      FROM comments
      WHERE project_id = ? AND created_at >= ?
    `,
      [input.projectId, thirtyDaysAgo],
    )

    const commentRow = recentComments.rows?.[0] ?? recentComments[0] ?? { total: 0 }

    return {
      recentActivityCount: recentActivity,
      recentCommentCount: Number(commentRow.total ?? 0),
      activeMembers: 0, // 简化版
    }
  }

  private checkDataIntegrity(
    taskSummary: TaskSummaryData | null,
    _warnings: HealthDataWarning[],
  ): DataIntegritySummary {
    const missingDimensions: HealthDataWarning[] = []

    if (!taskSummary || taskSummary.totalTasks === 0) {
      missingDimensions.push({
        dimension: 'progress',
        code: 'DATA_MISSING',
        message: '项目暂无任务数据，进度健康分析不可用',
        blocking: true,
      })
    }

    return {
      missingDimensions,
      hasDependencyCycles: false,
      hasDataGaps: missingDimensions.length > 0,
    }
  }

  private computeSourceHash(data: Record<string, any>): string {
    const hash = createHash('sha256')
    hash.update(JSON.stringify(data))
    return hash.digest('hex').substring(0, 16)
  }
}
