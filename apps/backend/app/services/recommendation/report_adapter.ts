/**
 * v2-ai-smart-recommendations — ReportAdapter。
 *
 * 从报表数据源、预设报表生成的建议行动中生成推荐候选。
 * 优先级较低，属于告知性推荐。
 *
 * §3.5 — 报表 Adapter。
 */

import db from '@adonisjs/lucid/services/db'
import type { RecommendationCandidate, RecommendationSource } from '@aiproj/types'
import type {
  CollectorParams,
  CollectorWarning,
  RecommendationSourceAdapter,
} from './adapter_types.js'

export default class ReportAdapter implements RecommendationSourceAdapter {
  readonly source: RecommendationSource = 'report'

  async collect(params: CollectorParams): Promise<{
    candidates: RecommendationCandidate[]
    warnings: CollectorWarning[]
  }> {
    const warnings: CollectorWarning[] = []
    const candidates: RecommendationCandidate[] = []
    const projectId = params.projectId
    const now = new Date()

    // 报告推荐不需要特权限定，但优先级较低

    // 1. 项目报表数据完整性建议
    try {
      const reportStatus = await db.rawQuery(
        `
        SELECT
          COUNT(DISTINCT t.id) AS task_count,
          COUNT(DISTINCT m.id) AS milestone_count,
          COUNT(DISTINCT r.id) AS resource_count,
          COUNT(DISTINCT rs.id) AS risk_count
        FROM (SELECT 1 AS dummy) AS dummy
        LEFT JOIN tasks t ON t.project_id = ? AND t.deleted_at IS NULL
        LEFT JOIN milestones m ON m.project_id = ?
        LEFT JOIN resources r ON r.project_id = ? AND r.deleted_at IS NULL
        LEFT JOIN risks rs ON rs.project_id = ? AND rs.deleted_at IS NULL
      `,
        [projectId, projectId, projectId, projectId],
      )

      const statusRow = reportStatus.rows?.[0] ?? reportStatus[0] ?? {}
      const taskCount = Number(statusRow.task_count ?? 0)
      const milestoneCount = Number(statusRow.milestone_count ?? 0)
      const resourceCount = Number(statusRow.resource_count ?? 0)
      const riskCount = Number(statusRow.risk_count ?? 0)

      // 缺少里程碑
      if (taskCount > 5 && milestoneCount === 0) {
        candidates.push({
          sourceType: this.source,
          sourceId: `report-no-milestones-${projectId}`,
          projectId,
          targetRef: {
            entityType: 'project',
            entityId: projectId,
            displayName: '里程碑设置',
            url: `/projects/${projectId}/milestones`,
          },
          title: '项目尚未设置里程碑',
          summary: `项目已有 ${taskCount} 个任务，但尚未设置里程碑。里程碑有助于跟踪关键节点进展`,
          recommendedAction: '为项目添加里程碑节点',
          actionType: 'navigate',
          severity: 'medium',
          urgency: 4,
          confidence: 'medium',
          impactScope: 'project',
          evidenceRefs: [
            {
              entityType: 'project',
              entityId: projectId,
              summaryHash: '',
              displaySummary: `${taskCount} 个任务，0 个里程碑`,
              visibility: 'summary_only',
            },
          ],
          dedupeKey: `report-no-milestones-${projectId}`,
          expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          metadata: { taskCount, milestoneCount },
        })
      }

      // 缺少风险登记
      if (taskCount > 10 && riskCount === 0) {
        candidates.push({
          sourceType: this.source,
          sourceId: `report-no-risks-${projectId}`,
          projectId,
          targetRef: {
            entityType: 'project',
            entityId: projectId,
            displayName: '风险登记册',
            url: `/projects/${projectId}/risks`,
          },
          title: '项目尚未登记风险',
          summary: `项目已有 ${taskCount} 个任务，但尚未登记风险。建议进行初步风险识别`,
          recommendedAction: '使用 AI 风险识别功能或手动添加风险项',
          actionType: 'create_draft',
          severity: 'low',
          urgency: 3,
          confidence: 'low',
          impactScope: 'project',
          evidenceRefs: [
            {
              entityType: 'project',
              entityId: projectId,
              summaryHash: '',
              displaySummary: `${taskCount} 个任务，0 个风险`,
              visibility: 'summary_only',
            },
          ],
          dedupeKey: `report-no-risks-${projectId}`,
          expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          metadata: { taskCount, riskCount },
        })
      }

      // 缺少资源
      if (taskCount > 5 && resourceCount === 0) {
        candidates.push({
          sourceType: this.source,
          sourceId: `report-no-resources-${projectId}`,
          projectId,
          targetRef: {
            entityType: 'project',
            entityId: projectId,
            displayName: '资源管理',
            url: `/projects/${projectId}/resources`,
          },
          title: '项目尚未分配资源',
          summary: `项目已有 ${taskCount} 个任务，但尚未登记资源。资源分配有助于负载均衡`,
          recommendedAction: '为项目添加成员和资源分配',
          actionType: 'navigate',
          severity: 'low',
          urgency: 2,
          confidence: 'low',
          impactScope: 'project',
          evidenceRefs: [
            {
              entityType: 'project',
              entityId: projectId,
              summaryHash: '',
              displaySummary: `${taskCount} 个任务，0 个资源`,
              visibility: 'summary_only',
            },
          ],
          dedupeKey: `report-no-resources-${projectId}`,
          expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          metadata: { taskCount, resourceCount },
        })
      }
    } catch {
      warnings.push({
        code: 'REPORT_QUERY_FAILED',
        message: '报表数据查询异常，部分推荐不可用',
        blocking: false,
        source: this.source,
      })
    }

    return { candidates, warnings }
  }
}
