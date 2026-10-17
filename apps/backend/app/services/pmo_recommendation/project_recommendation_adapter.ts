/**
 * ProjectRecommendationAdapter —— 从项目级推荐摘要收集 PMO 候选输入。
 *
 * v3-pmo-ai-priority-recommendations §3.4: 消费已有的项目推荐记录作为 PMO 推荐的信号来源。
 */
import type { PmoSourceAdapter, PmoAdapterContext } from './adapter_types.js'
import type {
  PmoRecommendationCandidate,
  PmoSourceSignal,
  PmoRecommendationWarning,
} from '@aiproj/types'
import { computePmoCandidateDedupeKey, computePmoInputSignature } from '@aiproj/types'
import ProjectRecommendation from '#models/project_recommendation'

export default class ProjectRecommendationAdapter implements PmoSourceAdapter {
  readonly sourceType = 'project_recommendation' as const

  async collect(ctx: PmoAdapterContext): Promise<{
    candidates: PmoRecommendationCandidate[]
    signals: PmoSourceSignal[]
    warnings: PmoRecommendationWarning[]
    available: boolean
  }> {
    // 获取组织内活跃的项目级推荐
    const recs = await ProjectRecommendation.query()
      .where('organization_id', ctx.organizationId)
      .whereIn('status', ['new', 'reviewing', 'accepted'])
      .whereIn('severity', ['critical', 'high'])
      .orderBy('priority', 'desc')
      .limit(100)

    const candidates: PmoRecommendationCandidate[] = recs.map((rec) => {
      const signals = [`project_rec:${rec.sourceType}:${rec.severity}`]
      return {
        candidateType: 'project_recommendation' as const,
        projectId: rec.projectId,
        targetRef: rec.targetRef,
        title: rec.title,
        summary: rec.summary,
        suggestedAction: rec.recommendedAction ?? '查看项目推荐详情',
        actionType: rec.actionType,
        severity: rec.severity,
        priorityContext: {
          priorityScore: rec.priority,
          priorityLevel:
            rec.severity === 'critical' ? 'critical' : rec.severity === 'high' ? 'high' : 'medium',
          rank: null,
          weightVersion: null,
          topDimensionContributors: [rec.sourceType],
          scoringAvailable: ctx.priorityScoringAvailable,
        },
        sourceSignals: [],
        evidenceRefs: rec.evidenceRefs ?? [],
        dedupeKey: computePmoCandidateDedupeKey(
          'project_recommendation',
          rec.id,
          `prj-${rec.projectId}`,
        ),
        inputSignature: computePmoInputSignature({
          sourceType: 'project_recommendation',
          sourceId: `rec-${rec.id}`,
          projectId: rec.projectId,
          priorityScore: rec.priority,
          signals,
        }),
        candidateVersion: 'pmo-ai-priority-recommendations.v1',
        expiresAt: rec.expiresAt?.toISO?.() ?? null,
        warnings: [],
      }
    })

    const signal: PmoSourceSignal = {
      source: 'project_recommendation',
      summary: `从${recs.length}条活跃项目推荐中提取 PMO 候选`,
      severity: candidates.length > 0 ? 'high' : 'info',
      available: true,
      warnings: [],
      refreshedAt: new Date().toISOString(),
      stale: false,
    }

    return { candidates, signals: [signal], warnings: [], available: true }
  }
}
