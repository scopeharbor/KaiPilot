/**
 * v2-ai-smart-recommendations — RiskAdapter。
 *
 * 从风险登记册、规则风险候选、复查逾期和高风险摘要中生成推荐候选。
 * 服从 hasRiskView 权限：无权限时返回空候选 + 权限 warning。
 *
 * §3.3 — 风险 Adapter。
 */

import db from '@adonisjs/lucid/services/db'
import type { RecommendationCandidate, RecommendationSource } from '@aiproj/types'
import type {
  CollectorParams,
  CollectorWarning,
  RecommendationSourceAdapter,
} from './adapter_types.js'

export default class RiskAdapter implements RecommendationSourceAdapter {
  readonly source: RecommendationSource = 'risk'

  async collect(params: CollectorParams): Promise<{
    candidates: RecommendationCandidate[]
    warnings: CollectorWarning[]
  }> {
    const warnings: CollectorWarning[] = []

    // 权限守卫
    if (!params.hasRiskView) {
      warnings.push({
        code: 'PERMISSION_FORBIDDEN',
        message: '无风险查看权限，风险推荐不可用',
        blocking: true,
        source: this.source,
      })
      return { candidates: [], warnings }
    }

    const candidates: RecommendationCandidate[] = []
    const projectId = params.projectId
    const now = new Date()
    const nowStr = now.toISOString().split('T')[0]

    // 1. 高风险等级风险
    const highRisks = await db.rawQuery(
      `
      SELECT id, title AS name, risk_level, score, owner_id, next_review_at
      FROM risks
      WHERE project_id = ? AND deleted_at IS NULL
        AND risk_level IN ('critical', 'high')
      ORDER BY score DESC
      LIMIT 20
    `,
      [projectId],
    )

    const highRiskRows = highRisks.rows ?? highRisks
    for (const row of highRiskRows) {
      candidates.push({
        sourceType: this.source,
        sourceId: `high-risk-${row.id}`,
        projectId,
        targetRef: {
          entityType: 'risk',
          entityId: row.id,
          displayName: row.name,
          url: `/projects/${projectId}/risks/${row.id}`,
        },
        title: `高风险：${row.name}`,
        summary: `风险等级 "${row.risk_level}"，评分 ${row.score}。建议尽快审查并制定应对措施`,
        recommendedAction: '审查风险详情，确认或更新应对计划',
        actionType: 'navigate',
        severity: row.risk_level === 'critical' ? 'critical' : 'high',
        urgency: row.risk_level === 'critical' ? 9 : 7,
        confidence: 'high',
        impactScope: 'project',
        evidenceRefs: [
          {
            entityType: 'risk',
            entityId: row.id,
            summaryHash: '',
            displaySummary: `${row.risk_level} 风险，评分 ${row.score}`,
            visibility: 'full',
          },
        ],
        dedupeKey: `high-risk-${row.id}`,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { riskLevel: row.risk_level, score: row.score },
      })
    }

    // 2. 复查逾期的风险
    const overdueReviews = await db.rawQuery(
      `
      SELECT id, title AS name, risk_level, next_review_at
      FROM risks
      WHERE project_id = ? AND deleted_at IS NULL
        AND next_review_at IS NOT NULL AND next_review_at < ?
      ORDER BY next_review_at ASC
      LIMIT 10
    `,
      [projectId, nowStr],
    )

    const overdueRows = overdueReviews.rows ?? overdueReviews
    for (const row of overdueRows) {
      const reviewDate = new Date(row.next_review_at)
      const daysOverdue = Math.max(
        0,
        Math.floor((now.getTime() - reviewDate.getTime()) / (24 * 60 * 60 * 1000)),
      )

      candidates.push({
        sourceType: this.source,
        sourceId: `risk-review-overdue-${row.id}`,
        projectId,
        targetRef: {
          entityType: 'risk',
          entityId: row.id,
          displayName: row.name,
          url: `/projects/${projectId}/risks/${row.id}`,
        },
        title: `风险复查逾期：${row.name}`,
        summary: `风险 "${row.name}" 复查已逾期 ${daysOverdue} 天（计划 ${row.next_review_at}）`,
        recommendedAction: '立即安排风险复查，更新状态与应对措施',
        actionType: 'navigate',
        severity: daysOverdue > 14 ? 'high' : 'medium',
        urgency: Math.min(10, 5 + Math.floor(daysOverdue / 7)),
        confidence: 'high',
        impactScope: 'risk',
        evidenceRefs: [
          {
            entityType: 'risk',
            entityId: row.id,
            summaryHash: '',
            displaySummary: `复查逾期 ${daysOverdue} 天`,
            visibility: 'full',
          },
        ],
        dedupeKey: `risk-review-overdue-${row.id}`,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { daysOverdue, riskLevel: row.risk_level },
      })
    }

    // 3. 规则引擎风险候选（未处理的 AI 识别风险）
    const signalCandidates = await db.rawQuery(
      `
      SELECT
        id,
        rule_id AS name,
        severity AS risk_level,
        confidence AS score,
        recommended_action AS summary
      FROM risk_signal_candidates
      WHERE project_id = ? AND status = 'pending'
      ORDER BY score DESC
      LIMIT 10
    `,
      [projectId],
    )

    const signalRows = signalCandidates.rows ?? signalCandidates
    for (const row of signalRows) {
      candidates.push({
        sourceType: this.source,
        sourceId: `risk-signal-${row.id}`,
        projectId,
        targetRef: {
          entityType: 'risk_signal_candidate',
          entityId: row.id,
          displayName: row.name,
          url: `/projects/${projectId}/risks/signals/${row.id}`,
        },
        title: `AI 识别风险：${row.name}`,
        summary: row.summary ?? `AI 规则引擎识别到未处理的风险信号（风险等级 ${row.risk_level}）`,
        recommendedAction: '审查 AI 风险候选，确认后录入风险登记册',
        actionType: 'create_draft',
        severity: row.risk_level === 'critical' || row.risk_level === 'high' ? 'high' : 'medium',
        urgency: 6,
        confidence: 'medium',
        impactScope: 'project',
        evidenceRefs: [
          {
            entityType: 'risk_signal_candidate',
            entityId: row.id,
            summaryHash: '',
            displaySummary: `AI 识别风险，评分 ${row.score}`,
            visibility: 'full',
          },
        ],
        dedupeKey: `risk-signal-${row.id}`,
        expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { riskLevel: row.risk_level, score: row.score },
      })
    }

    return { candidates, warnings }
  }
}
