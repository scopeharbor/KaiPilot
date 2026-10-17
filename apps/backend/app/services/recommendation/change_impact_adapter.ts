/**
 * v2-ai-smart-recommendations — ChangeImpactAdapter。
 *
 * 从未确认/过期/高严重度变更影响分析中生成推荐候选。
 * 服从 hasChangeImpactView 权限：无权限时返回空候选 + 权限 warning。
 *
 * §3.4 — 变更影响 Adapter。
 */

import db from '@adonisjs/lucid/services/db'
import type { RecommendationCandidate, RecommendationSource } from '@aiproj/types'
import type {
  CollectorParams,
  CollectorWarning,
  RecommendationSourceAdapter,
} from './adapter_types.js'

export default class ChangeImpactAdapter implements RecommendationSourceAdapter {
  readonly source: RecommendationSource = 'change_impact'

  async collect(params: CollectorParams): Promise<{
    candidates: RecommendationCandidate[]
    warnings: CollectorWarning[]
  }> {
    const warnings: CollectorWarning[] = []

    // 权限守卫
    if (!params.hasChangeImpactView) {
      warnings.push({
        code: 'PERMISSION_FORBIDDEN',
        message: '无变更影响查看权限，变更影响推荐不可用',
        blocking: true,
        source: this.source,
      })
      return { candidates: [], warnings }
    }

    const candidates: RecommendationCandidate[] = []
    const projectId = params.projectId
    const now = new Date()

    // 1. 未确认的分析（status != 'completed' 和 'closed'）
    const unconfirmed = await db.rawQuery(
      `
      SELECT
        cia.id,
        cia.change_request_id,
        cia.status,
        cia.created_at,
        cr.title AS change_title,
        cia.summary
      FROM change_impact_analyses cia
      INNER JOIN change_requests cr ON cr.id = cia.change_request_id
      WHERE cia.project_id = ? AND cia.status NOT IN ('completed', 'closed')
      ORDER BY cia.created_at DESC
      LIMIT 15
    `,
      [projectId],
    )

    const unconfirmedRows = unconfirmed.rows ?? unconfirmed
    for (const row of unconfirmedRows) {
      const createdDate = new Date(row.created_at)
      const daysOpen = Math.floor((now.getTime() - createdDate.getTime()) / (24 * 60 * 60 * 1000))

      candidates.push({
        sourceType: this.source,
        sourceId: `change-impact-unconfirmed-${row.id}`,
        projectId,
        targetRef: {
          entityType: 'change_impact_analysis',
          entityId: row.id,
          displayName: row.change_title ?? `变更影响分析 #${row.id}`,
          url: `/projects/${projectId}/changes/${row.change_request_id}/impact/${row.id}`,
        },
        title: `变更影响分析待确认：${row.change_title ?? `#${row.id}`}`,
        summary: `分析已存在 ${daysOpen} 天，状态为 "${row.status}"，尚未确认`,
        recommendedAction: '审查变更影响分析结果，确认或调整影响范围',
        actionType: 'navigate',
        severity: daysOpen > 14 ? 'high' : 'medium',
        urgency: Math.min(8, 4 + Math.floor(daysOpen / 7)),
        confidence: 'high',
        impactScope: 'project',
        evidenceRefs: [
          {
            entityType: 'change_impact_analysis',
            entityId: row.id,
            summaryHash: '',
            displaySummary: `待确认，已 ${daysOpen} 天`,
            visibility: 'full',
          },
        ],
        dedupeKey: `change-impact-unconfirmed-${row.id}`,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { status: row.status, daysOpen },
      })
    }

    // 2. 高严重度影响（通过 change_impact_items）
    const highSeverity = await db.rawQuery(
      `
      SELECT
        cii.id,
        cii.severity,
        cii.dimension AS impact_type,
        cii.score,
        cia.id AS analysis_id,
        cr.title AS change_title,
        cii.evidence AS description
      FROM change_impact_items cii
      INNER JOIN change_impact_analyses cia ON cia.id = cii.analysis_id
      INNER JOIN change_requests cr ON cr.id = cia.change_request_id
      WHERE cia.project_id = ? AND cii.severity IN ('critical', 'high')
      ORDER BY cii.score DESC
      LIMIT 10
    `,
      [projectId],
    )

    const highSeverityRows = highSeverity.rows ?? highSeverity
    for (const row of highSeverityRows) {
      candidates.push({
        sourceType: this.source,
        sourceId: `change-impact-high-${row.id}`,
        projectId,
        targetRef: {
          entityType: 'change_impact_item',
          entityId: row.id,
          displayName: row.change_title ?? `影响项 #${row.id}`,
          url: `/projects/${projectId}/changes/${row.analysis_id}/items/${row.id}`,
        },
        title: `高严重度变更影响：${row.change_title ?? `#${row.analysis_id}`}`,
        summary:
          row.description ??
          `变更影响分析中识别到 ${row.severity} 严重度的 "${row.impact_type}" 影响`,
        recommendedAction: '审查高严重度影响详情，制定缓解措施',
        actionType: 'navigate',
        severity: row.severity === 'critical' ? 'critical' : 'high',
        urgency: row.severity === 'critical' ? 8 : 6,
        confidence: 'high',
        impactScope: 'project',
        evidenceRefs: [
          {
            entityType: 'change_impact_item',
            entityId: row.id,
            summaryHash: '',
            displaySummary: `${row.severity} ${row.impact_type}`,
            visibility: 'full',
          },
        ],
        dedupeKey: `change-impact-high-${row.id}`,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { impactSeverity: row.severity, impactType: row.impact_type },
      })
    }

    return { candidates, warnings }
  }
}
