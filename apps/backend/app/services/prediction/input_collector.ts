/**
 * ProjectPredictionInputCollector —— 风险与进度预测输入收集器。
 *
 * 在受限窗口内收集任务、依赖、里程碑、关键路径摘要、资源、风险、
 * 变更影响、活动和 Dashboard 指标。
 *
 * v2-ai-risk-progress-prediction / design D2
 */
import { createHash } from 'node:crypto'
import Project from '#models/project'
import Task from '#models/task'
import Milestone from '#models/milestone'
import AuditLog from '#models/audit_log'
import db from '@adonisjs/lucid/services/db'
import type { PredictionDataWarning, PredictionWindow } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 输入/输出类型
// ---------------------------------------------------------------------------

export interface PredictionCollectorInput {
  organizationId: number
  projectId: number
  userId: number
  window: PredictionWindow
  hasRiskView: boolean
  hasResourceView: boolean
  hasChangeImpactView: boolean
}

export interface TaskCollectorData {
  totalTasks: number
  overdueTasks: number
  dueSoonTasks: number
  blockedTasks: number
  completedTasks: number
  inProgressTasks: number
  averageOverdueDays: number
  maxOverdueDays: number
  overdueDetails: Array<{ id: number; title: string; daysOverdue: number; isCritical: boolean }>
}

export interface CriticalPathCollectorData {
  totalCriticalTasks: number
  overdueCriticalTasks: number
  averageDelayDays: number
  delayedTasks: Array<{ id: number; title: string; delayDays: number }>
}

export interface MilestoneCollectorData {
  totalMilestones: number
  overdueMilestones: number
  upcomingMilestones: number
  overdueDetails: Array<{ id: number; title: string; daysOverdue: number }>
  upcomingDetails: Array<{ id: number; title: string; daysUntil: number }>
}

export interface ResourceCollectorData {
  totalResources: number
  overallLoadPercent: number
  overloadedResources: number
  overloadDetails: Array<{ role: string; overloadPercent: number }>
}

export interface RiskCollectorData {
  totalRisks: number
  criticalRisks: number
  highRisks: number
  overdueReviews: Array<{ riskId: number; title: string; daysOverdue: number }>
}

export interface ChangeImpactCollectorData {
  totalAnalyses: number
  openAnalyses: number
  highSeverityItems: number
}

export interface ActivityCollectorData {
  recentActivityCount: number
  recentCommentCount: number
}

export interface PredictionCollectorOutput {
  taskData: TaskCollectorData | null
  criticalPathData: CriticalPathCollectorData | null
  milestoneData: MilestoneCollectorData | null
  resourceData: ResourceCollectorData | null
  riskData: RiskCollectorData | null
  changeImpactData: ChangeImpactCollectorData | null
  activityData: ActivityCollectorData | null
  warnings: PredictionDataWarning[]
  generatedAt: string
  sourceHash: string
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export default class ProjectPredictionInputCollector {
  async collect(input: PredictionCollectorInput): Promise<PredictionCollectorOutput> {
    const warnings: PredictionDataWarning[] = []
    const now = new Date()

    // 校验项目存在
    const project = await Project.query()
      .where('id', input.projectId)
      .where('organization_id', input.organizationId)
      .first()
    if (!project) {
      throw new Error('RESOURCE_NOT_FOUND')
    }

    // 并行收集各维度数据
    const [
      taskData,
      criticalPathData,
      milestoneData,
      resourceData,
      riskData,
      changeImpactData,
      activityData,
    ] = await Promise.all([
      this.collectTaskData(input, now),
      this.collectCriticalPathData(input, now),
      this.collectMilestoneData(input, now),
      input.hasResourceView ? this.collectResourceData(input) : Promise.resolve(null),
      input.hasRiskView ? this.collectRiskData(input) : Promise.resolve(null),
      input.hasChangeImpactView ? this.collectChangeImpactData(input) : Promise.resolve(null),
      this.collectActivityData(input),
    ])

    // 权限脱敏 warning
    if (!input.hasResourceView) {
      warnings.push({
        code: 'PERMISSION_FORBIDDEN',
        message: '无资源查看权限，资源维度预测不可用',
        blocking: true,
        signalType: 'resource_bottleneck',
      })
    }
    if (!input.hasRiskView) {
      warnings.push({
        code: 'PERMISSION_FORBIDDEN',
        message: '无风险查看权限，风险维度预测不可用',
        blocking: true,
        signalType: 'risk_escalation',
      })
    }
    if (!input.hasChangeImpactView) {
      warnings.push({
        code: 'PERMISSION_FORBIDDEN',
        message: '无变更影响查看权限，变更维度预测不可用',
        blocking: true,
        signalType: 'change_impact',
      })
    }

    // 数据缺失 warning
    if (!taskData || taskData.totalTasks === 0) {
      warnings.push({
        code: 'DATA_MISSING',
        message: '项目暂无任务数据，排期预测不可用',
        blocking: true,
        signalType: 'schedule_risk',
      })
    }

    // 计算 sourceHash
    const sourceHash = this.computeSourceHash({
      taskData,
      criticalPathData,
      milestoneData,
      resourceData,
      riskData,
      changeImpactData,
      activityData,
    })

    return {
      taskData,
      criticalPathData,
      milestoneData,
      resourceData,
      riskData,
      changeImpactData,
      activityData,
      warnings,
      generatedAt: now.toISOString(),
      sourceHash,
    }
  }

  private async collectTaskData(
    input: PredictionCollectorInput,
    now: Date,
  ): Promise<TaskCollectorData> {
    const nowStr = now.toISOString().split('T')[0]
    const qb = Task.query().where('project_id', input.projectId)

    const totalTasks = await qb
      .clone()
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const overdueTasks = await qb
      .clone()
      .whereNotNull('end_date')
      .where('end_date', '<', nowStr)
      .whereNotIn('status', ['completed', 'cancelled'])
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const windowEnd = new Date(now.getTime() + input.window * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]
    const dueSoonTasks = await qb
      .clone()
      .whereNotNull('end_date')
      .where('end_date', '>=', nowStr)
      .where('end_date', '<=', windowEnd)
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

    // 逾期详情
    const overdueDetails = await qb
      .clone()
      .whereNotNull('end_date')
      .where('end_date', '<', nowStr)
      .whereNotIn('status', ['completed', 'cancelled'])
      .select('id', 'name', 'end_date', 'is_critical_path')

    let maxOverdueDays = 0
    let totalOverdueDays = 0
    const details: Array<{ id: number; title: string; daysOverdue: number; isCritical: boolean }> =
      []

    for (const task of overdueDetails) {
      const endDateStr =
        typeof task.endDate === 'string' ? task.endDate : (task.endDate?.toISO?.() ?? '')
      const endDate = new Date(endDateStr)
      const daysOverdue = Number.isNaN(endDate.getTime())
        ? 0
        : Math.max(0, Math.floor((now.getTime() - endDate.getTime()) / (24 * 60 * 60 * 1000)))
      totalOverdueDays += daysOverdue
      if (daysOverdue > maxOverdueDays) maxOverdueDays = daysOverdue
      details.push({
        id: task.id,
        title: task.name,
        daysOverdue,
        isCritical: Boolean(task.isCriticalPath),
      })
    }

    return {
      totalTasks,
      overdueTasks,
      dueSoonTasks,
      blockedTasks,
      completedTasks,
      inProgressTasks,
      averageOverdueDays: overdueTasks > 0 ? Math.round(totalOverdueDays / overdueTasks) : 0,
      maxOverdueDays,
      overdueDetails: details.sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 10),
    }
  }

  private async collectCriticalPathData(
    input: PredictionCollectorInput,
    now: Date,
  ): Promise<CriticalPathCollectorData> {
    const nowStr = now.toISOString().split('T')[0]
    const result = await db.rawQuery(
      `
      SELECT COUNT(DISTINCT t.id) as total,
             COUNT(DISTINCT CASE WHEN t.end_date < ? AND t.status NOT IN ('completed','cancelled') THEN t.id END) as overdue
      FROM tasks t
      INNER JOIN task_dependencies td ON (td.predecessor_id = t.id OR td.successor_id = t.id)
      WHERE t.project_id = ?
    `,
      [nowStr, input.projectId],
    )

    const row = result.rows?.[0] ?? result[0] ?? { total: 0, overdue: 0 }
    const totalCriticalTasks = Number(row.total ?? 0)
    const overdueCriticalTasks = Number(row.overdue ?? 0)

    // 延迟任务详情
    const delayedTasks: Array<{ id: number; title: string; delayDays: number }> = []
    if (overdueCriticalTasks > 0) {
      const delayed = await db.rawQuery(
        `
        SELECT DISTINCT t.id, t.name, t.end_date
        FROM tasks t
        INNER JOIN task_dependencies td ON (td.predecessor_id = t.id OR td.successor_id = t.id)
        WHERE t.project_id = ? AND t.end_date < ? AND t.status NOT IN ('completed','cancelled')
        ORDER BY t.end_date ASC
        LIMIT 10
      `,
        [input.projectId, nowStr],
      )

      const rows = delayed.rows ?? delayed
      for (const d of rows) {
        const endDate = new Date(d.end_date)
        const delayDays = Number.isNaN(endDate.getTime())
          ? 0
          : Math.max(0, Math.floor((now.getTime() - endDate.getTime()) / (24 * 60 * 60 * 1000)))
        delayedTasks.push({ id: d.id, title: d.name, delayDays })
      }
    }

    return {
      totalCriticalTasks,
      overdueCriticalTasks,
      averageDelayDays:
        overdueCriticalTasks > 0
          ? Math.round(delayedTasks.reduce((s, t) => s + t.delayDays, 0) / overdueCriticalTasks)
          : 0,
      delayedTasks,
    }
  }

  private async collectMilestoneData(
    input: PredictionCollectorInput,
    now: Date,
  ): Promise<MilestoneCollectorData> {
    const nowStr = now.toISOString().split('T')[0]
    const qb = Milestone.query().where('project_id', input.projectId)

    const totalMilestones = await qb
      .clone()
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const overdueMilestones = await qb
      .clone()
      .whereNotNull('planned_date')
      .where('planned_date', '<', nowStr)
      .whereNotIn('status', ['achieved', 'missed'])
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    // 未来 window 天内到期的里程碑
    const windowEnd = new Date(now.getTime() + input.window * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]
    const upcomingMilestones = await qb
      .clone()
      .whereNotNull('planned_date')
      .where('planned_date', '>=', nowStr)
      .where('planned_date', '<=', windowEnd)
      .whereNotIn('status', ['achieved', 'missed'])
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    // 逾期详情
    const overdueRows = await qb
      .clone()
      .whereNotNull('planned_date')
      .where('planned_date', '<', nowStr)
      .whereNotIn('status', ['achieved', 'missed'])
      .select('id', 'name', 'planned_date')
      .orderBy('planned_date', 'asc')
      .limit(10)

    const overdueDetails = overdueRows.map((m) => ({
      id: m.id,
      title: m.name,
      daysOverdue: Math.max(
        0,
        Math.floor(
          (now.getTime() - new Date(String(m.plannedDate)).getTime()) / (24 * 60 * 60 * 1000),
        ),
      ),
    }))

    // 即将到期详情
    const upcomingRows = await qb
      .clone()
      .whereNotNull('planned_date')
      .where('planned_date', '>=', nowStr)
      .where('planned_date', '<=', windowEnd)
      .whereNotIn('status', ['achieved', 'missed'])
      .select('id', 'name', 'planned_date')
      .orderBy('planned_date', 'asc')
      .limit(10)

    const upcomingDetails = upcomingRows.map((m) => ({
      id: m.id,
      title: m.name,
      daysUntil: Math.max(
        0,
        Math.floor(
          (new Date(String(m.plannedDate)).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
        ),
      ),
    }))

    return {
      totalMilestones,
      overdueMilestones,
      upcomingMilestones,
      overdueDetails,
      upcomingDetails,
    }
  }

  private async collectResourceData(
    input: PredictionCollectorInput,
  ): Promise<ResourceCollectorData | null> {
    const result = await db.rawQuery(
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

    const row = result.rows?.[0] ?? result[0] ?? { total: 0, overloaded: 0, avg_load: 0 }
    const totalResources = Number(row.total ?? 0)

    // 过载详情
    const overloadDetails: Array<{ role: string; overloadPercent: number }> = []
    if (Number(row.overloaded ?? 0) > 0) {
      const overloads = await db.rawQuery(
        `
        SELECT r.role, MAX(ra.allocation_percent) as overload_percent
        FROM resources r
        INNER JOIN resource_allocations ra ON ra.resource_id = r.id
        WHERE r.project_id = ? AND ra.allocation_percent > 100
        GROUP BY r.role
        ORDER BY overload_percent DESC
        LIMIT 10
      `,
        [input.projectId],
      )
      const rows = overloads.rows ?? overloads
      for (const o of rows) {
        overloadDetails.push({
          role: o.role,
          overloadPercent: Math.round(Number(o.overload_percent ?? 0)),
        })
      }
    }

    return {
      totalResources,
      overallLoadPercent: Math.round(Number(row.avg_load ?? 0)),
      overloadedResources: Number(row.overloaded ?? 0),
      overloadDetails,
    }
  }

  private async collectRiskData(
    input: PredictionCollectorInput,
  ): Promise<RiskCollectorData | null> {
    const result = await db.rawQuery(
      `
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN risk_level = 'critical' THEN 1 END) as critical_count,
             COUNT(CASE WHEN risk_level = 'high' THEN 1 END) as high_count
      FROM risks
      WHERE project_id = ? AND deleted_at IS NULL
    `,
      [input.projectId],
    )

    const row = result.rows?.[0] ?? result[0] ?? { total: 0, critical_count: 0, high_count: 0 }

    // 逾期复查
    const now = new Date().toISOString().split('T')[0]
    const reviews = await db.rawQuery(
      `
      SELECT id, title, next_review_at
      FROM risks
      WHERE project_id = ? AND deleted_at IS NULL
        AND next_review_at IS NOT NULL
        AND next_review_at < ?
      ORDER BY next_review_at ASC
      LIMIT 10
    `,
      [input.projectId, now],
    )

    const reviewRows = reviews.rows ?? reviews
    const overdueReviews = reviewRows.map(
      (r: { id: number; title: string; next_review_at: string }) => ({
        riskId: r.id,
        title: r.title,
        daysOverdue: Math.max(
          0,
          Math.floor((Date.now() - new Date(r.next_review_at).getTime()) / (24 * 60 * 60 * 1000)),
        ),
      }),
    )

    return {
      totalRisks: Number(row.total ?? 0),
      criticalRisks: Number(row.critical_count ?? 0),
      highRisks: Number(row.high_count ?? 0),
      overdueReviews,
    }
  }

  private async collectChangeImpactData(
    input: PredictionCollectorInput,
  ): Promise<ChangeImpactCollectorData | null> {
    const result = await db.rawQuery(
      `
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN status NOT IN ('completed','closed') THEN 1 END) as open_analyses
      FROM change_impact_analyses
      WHERE project_id = ?
    `,
      [input.projectId],
    )

    const row = result.rows?.[0] ?? result[0] ?? { total: 0, open_analyses: 0 }
    return {
      totalAnalyses: Number(row.total ?? 0),
      openAnalyses: Number(row.open_analyses ?? 0),
      highSeverityItems: 0, // 简化版
    }
  }

  private async collectActivityData(
    input: PredictionCollectorInput,
  ): Promise<ActivityCollectorData> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const recentActivity = await AuditLog.query()
      .where('project_id', input.projectId)
      .where('created_at', '>=', thirtyDaysAgo)
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))

    const comments = await db.rawQuery(
      `
      SELECT COUNT(*) as total FROM comments
      WHERE project_id = ? AND created_at >= ?
    `,
      [input.projectId, thirtyDaysAgo],
    )

    const commentRow = comments.rows?.[0] ?? comments[0] ?? { total: 0 }
    return {
      recentActivityCount: recentActivity,
      recentCommentCount: Number(commentRow.total ?? 0),
    }
  }

  private computeSourceHash(data: Record<string, unknown>): string {
    const hash = createHash('sha256')
    const sorted = Object.keys(data)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = data[k]
        return acc
      }, {})
    hash.update(JSON.stringify(sorted))
    return hash.digest('hex').substring(0, 16)
  }
}
