/**
 * v2-ai-smart-recommendations — DashboardAdapter。
 *
 * 从 Dashboard 指标 warning 和建议中生成推荐候选。
 * 优先级低于资源/风险 adapter——适合告知性、非紧急建议。
 *
 * §3.5 — Dashboard Adapter。
 */

import db from '@adonisjs/lucid/services/db'
import type { RecommendationCandidate, RecommendationSource } from '@aiproj/types'
import type {
  CollectorParams,
  CollectorWarning,
  RecommendationSourceAdapter,
} from './adapter_types.js'

/** Dashboard 指标 warning 的固定代码前缀 */
const DASHBOARD_WARNING_PREFIX = 'DASHBOARD_'

export default class DashboardAdapter implements RecommendationSourceAdapter {
  readonly source: RecommendationSource = 'dashboard'

  async collect(params: CollectorParams): Promise<{
    candidates: RecommendationCandidate[]
    warnings: CollectorWarning[]
  }> {
    const warnings: CollectorWarning[] = []
    const candidates: RecommendationCandidate[] = []
    const projectId = params.projectId
    const now = new Date()

    // Dashboard 推荐总是可用（不依赖特定权限），但优先级较低

    // 1. 高进度偏差（进度严重落后）
    try {
      const progressResult = await db.rawQuery(
        `
        SELECT id, name, status, start_date, end_date
        FROM tasks
        WHERE project_id = ? AND deleted_at IS NULL
          AND status NOT IN ('completed', 'cancelled')
          AND end_date IS NOT NULL AND end_date < CURRENT_DATE
        ORDER BY end_date ASC
        LIMIT 5
      `,
        [projectId],
      )

      const overdueRows = progressResult.rows ?? progressResult
      if (overdueRows.length >= 3) {
        candidates.push({
          sourceType: this.source,
          sourceId: `dashboard-overdue-bulk-${projectId}`,
          projectId,
          targetRef: {
            entityType: 'project',
            entityId: projectId,
            displayName: '项目进度',
            url: `/projects/${projectId}/dashboard`,
          },
          title: '项目逾期任务较多',
          summary: `当前有 ${overdueRows.length} 个逾期未完成任务，建议关注项目进度`,
          recommendedAction: '查看 Dashboard 进度概览，识别瓶颈任务',
          actionType: 'navigate',
          severity: overdueRows.length >= 10 ? 'high' : 'medium',
          urgency: 5,
          confidence: 'high',
          impactScope: 'project',
          evidenceRefs: [
            {
              entityType: 'project',
              entityId: projectId,
              summaryHash: '',
              displaySummary: `${overdueRows.length} 个逾期任务`,
              visibility: 'summary_only',
            },
          ],
          dedupeKey: `dashboard-overdue-bulk-${projectId}`,
          expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          metadata: { overdueCount: overdueRows.length },
        })
      }

      // 2. 任务完成率低
      const taskCounts = await db.rawQuery(
        `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
        FROM tasks
        WHERE project_id = ? AND deleted_at IS NULL
      `,
        [projectId],
      )

      const taskRow = taskCounts.rows?.[0] ?? taskCounts[0] ?? { total: 0, completed: 0 }
      const totalTasks = Number(taskRow.total ?? 0)
      const completedCount = Number(taskRow.completed ?? 0)

      if (totalTasks > 0) {
        const completionRate = completedCount / totalTasks

        if (completionRate < 0.1 && totalTasks >= 5) {
          candidates.push({
            sourceType: this.source,
            sourceId: `dashboard-low-completion-${projectId}`,
            projectId,
            targetRef: {
              entityType: 'project',
              entityId: projectId,
              displayName: '项目任务',
              url: `/projects/${projectId}/tasks`,
            },
            title: '项目任务完成率偏低',
            summary: `当前完成率 ${(completionRate * 100).toFixed(0)}%（${completedCount}/${totalTasks}），建议检查任务状态`,
            recommendedAction: '查看任务列表，推动关键任务进展',
            actionType: 'navigate',
            severity: completionRate < 0.05 ? 'high' : 'medium',
            urgency: 4,
            confidence: 'medium',
            impactScope: 'project',
            evidenceRefs: [
              {
                entityType: 'project',
                entityId: projectId,
                summaryHash: '',
                displaySummary: `完成率 ${(completionRate * 100).toFixed(0)}%`,
                visibility: 'summary_only',
              },
            ],
            dedupeKey: `dashboard-low-completion-${projectId}`,
            expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
            metadata: { completionRate: Math.round(completionRate * 100) },
          })
        }
      }

      // 3. 里程碑停滞（状态不是 achieved/missed 但已过期）
      const stalledMilestones = await db.rawQuery(
        `
        SELECT id, name, planned_date, status
        FROM milestones
        WHERE project_id = ? AND status NOT IN ('achieved', 'missed')
          AND planned_date IS NOT NULL AND planned_date < CURRENT_DATE
        ORDER BY planned_date ASC
        LIMIT 5
      `,
        [projectId],
      )

      const stalledRows = stalledMilestones.rows ?? stalledMilestones
      for (const row of stalledRows) {
        candidates.push({
          sourceType: this.source,
          sourceId: `dashboard-stalled-milestone-${row.id}`,
          projectId,
          targetRef: {
            entityType: 'milestone',
            entityId: row.id,
            displayName: row.name,
            url: `/projects/${projectId}/milestones/${row.id}`,
          },
          title: `里程碑停滞：${row.name}`,
          summary: `里程碑 "${row.name}" 计划日期已过但状态仍为 "${row.status}"`,
          recommendedAction: '审查里程碑进展，更新状态或调整计划',
          actionType: 'navigate',
          severity: 'low',
          urgency: 3,
          confidence: 'medium',
          impactScope: 'milestone',
          evidenceRefs: [
            {
              entityType: 'milestone',
              entityId: row.id,
              summaryHash: '',
              displaySummary: `停滞，状态 ${row.status}`,
              visibility: 'summary_only',
            },
          ],
          dedupeKey: `dashboard-stalled-milestone-${row.id}`,
          expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          metadata: { milestoneStatus: row.status },
        })
      }
    } catch {
      warnings.push({
        code: `${DASHBOARD_WARNING_PREFIX}QUERY_FAILED`,
        message: 'Dashboard 指标查询异常，部分推荐不可用',
        blocking: false,
        source: this.source,
      })
    }

    return { candidates, warnings }
  }
}
