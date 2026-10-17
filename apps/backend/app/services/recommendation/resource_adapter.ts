/**
 * v2-ai-smart-recommendations — ResourceAdapter。
 *
 * 从资源分配/需求/冲突中生成推荐候选。
 * 服从 hasResourceView 权限：无权限时返回空候选 + 权限 warning。
 *
 * §3.2 — 资源 Adapter。
 */

import db from '@adonisjs/lucid/services/db'
import type { RecommendationCandidate, RecommendationSource } from '@aiproj/types'
import type {
  CollectorParams,
  CollectorWarning,
  RecommendationSourceAdapter,
} from './adapter_types.js'

export default class ResourceAdapter implements RecommendationSourceAdapter {
  readonly source: RecommendationSource = 'resource'

  async collect(params: CollectorParams): Promise<{
    candidates: RecommendationCandidate[]
    warnings: CollectorWarning[]
  }> {
    const warnings: CollectorWarning[] = []

    // 权限守卫
    if (!params.hasResourceView) {
      warnings.push({
        code: 'PERMISSION_FORBIDDEN',
        message: '无资源查看权限，资源推荐不可用',
        blocking: true,
        source: this.source,
      })
      return { candidates: [], warnings }
    }

    const candidates: RecommendationCandidate[] = []
    const projectId = params.projectId
    const now = new Date()

    // 1. 资源冲突（分配超过 100%）
    const conflicts = await db.rawQuery(
      `
      SELECT ra.id, r.name AS resource_name, r.role, ra.allocation_percent, t.name AS task_name
      FROM resource_allocations ra
      INNER JOIN resources r ON r.id = ra.resource_id
      LEFT JOIN tasks t ON t.id = ra.task_id
      WHERE r.project_id = ? AND r.deleted_at IS NULL AND ra.allocation_percent > 100
      ORDER BY ra.allocation_percent DESC
      LIMIT 20
    `,
      [projectId],
    )

    const conflictRows = conflicts.rows ?? conflicts
    for (const row of conflictRows) {
      const sourceId = `resource-conflict-${row.id}`
      candidates.push({
        sourceType: this.source,
        sourceId,
        projectId,
        targetRef: {
          entityType: 'resource_allocation',
          entityId: row.id,
          displayName: row.resource_name,
          url: `/projects/${projectId}/resources/${row.resource_id}`,
        },
        title: `资源超载：${row.resource_name}（${row.role}）`,
        summary: `${row.resource_name} 当前分配 ${row.allocation_percent}%，超出额定容量。涉及任务：${row.task_name ?? '未分配'}`,
        recommendedAction: '审查并调整资源分配，减少冲突任务的工作量或重新分配',
        actionType: 'navigate',
        severity: row.allocation_percent > 150 ? 'critical' : 'high',
        urgency: 8,
        confidence: 'high',
        impactScope: 'resource',
        evidenceRefs: [
          {
            entityType: 'resource_allocation',
            entityId: row.id,
            summaryHash: '',
            displaySummary: `${row.resource_name} 分配 ${row.allocation_percent}%`,
            visibility: 'full',
          },
        ],
        dedupeKey: `resource-conflict-${row.id}`,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { allocationPercent: row.allocation_percent, role: row.role },
      })
    }

    // 2. 资源需求缺口（有任务但无分配）
    const gaps = await db.rawQuery(
      `
      SELECT t.id AS task_id, t.name AS task_name, COUNT(trr.id) AS requirement_count
      FROM task_resource_requirements trr
      INNER JOIN tasks t ON t.id = trr.task_id
      LEFT JOIN resource_allocations ra ON ra.task_id = t.id
      WHERE t.project_id = ? AND t.deleted_at IS NULL AND ra.id IS NULL
      GROUP BY t.id
      ORDER BY requirement_count DESC
      LIMIT 10
    `,
      [projectId],
    )

    const gapRows = gaps.rows ?? gaps
    for (const row of gapRows) {
      candidates.push({
        sourceType: this.source,
        sourceId: `resource-gap-${row.task_id}`,
        projectId,
        targetRef: {
          entityType: 'task',
          entityId: row.task_id,
          displayName: row.task_name,
          url: `/projects/${projectId}/tasks/${row.task_id}`,
        },
        title: `资源需求缺口：${row.task_name}`,
        summary: `任务 "${row.task_name}" 有 ${row.requirement_count} 个资源需求但尚无分配记录`,
        recommendedAction: '为任务分配候选资源或调整需求优先级',
        actionType: 'create_draft',
        severity: 'medium',
        urgency: 6,
        confidence: 'medium',
        impactScope: 'task',
        evidenceRefs: [
          {
            entityType: 'task',
            entityId: row.task_id,
            summaryHash: '',
            displaySummary: `缺少 ${row.requirement_count} 个资源分配`,
            visibility: 'full',
          },
        ],
        dedupeKey: `resource-gap-${row.task_id}`,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { requirementCount: row.requirement_count },
      })
    }

    // 3. 资源匹配建议（未分配角色的资源）
    const unmatched = await db.rawQuery(
      `
      SELECT r.id, r.name, r.role, r.resource_type
      FROM resources r
      LEFT JOIN resource_allocations ra ON ra.resource_id = r.id
      WHERE r.project_id = ? AND r.deleted_at IS NULL AND ra.id IS NULL
      ORDER BY r.name ASC
      LIMIT 10
    `,
      [projectId],
    )

    const unmatchedRows = unmatched.rows ?? unmatched
    for (const row of unmatchedRows) {
      candidates.push({
        sourceType: this.source,
        sourceId: `resource-unmatched-${row.id}`,
        projectId,
        targetRef: {
          entityType: 'resource',
          entityId: row.id,
          displayName: row.name,
          url: `/projects/${projectId}/resources/${row.id}`,
        },
        title: `闲置资源：${row.name}（${row.role}）`,
        summary: `资源 "${row.name}"（${row.role}）暂无分配任务，可匹配至需求缺口`,
        recommendedAction: '查看任务资源需求，将闲置资源分配至合适任务',
        actionType: 'navigate',
        severity: 'low',
        urgency: 3,
        confidence: 'low',
        impactScope: 'resource',
        evidenceRefs: [
          {
            entityType: 'resource',
            entityId: row.id,
            summaryHash: '',
            displaySummary: `${row.name} 闲置中`,
            visibility: 'full',
          },
        ],
        dedupeKey: `resource-unmatched-${row.id}`,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { role: row.role, resourceType: row.resource_type },
      })
    }

    return { candidates, warnings }
  }
}
