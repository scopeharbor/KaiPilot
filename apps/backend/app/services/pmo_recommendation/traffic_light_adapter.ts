/**
 * TrafficLightAdapter —— 从 PMO 组合交通灯收集候选输入。
 *
 * v3-pmo-ai-priority-recommendations §3.4: 消费已归档的 pmo-portfolio-traffic-light 契约。
 * 不可用或禁止时返回 unavailable/forbidden warning。
 */
import type { PmoSourceAdapter, PmoAdapterContext } from './adapter_types.js'
import type {
  PmoRecommendationCandidate,
  PmoSourceSignal,
  PmoRecommendationWarning,
} from '@aiproj/types'
import { computePmoCandidateDedupeKey, computePmoInputSignature } from '@aiproj/types'
import Project from '#models/project'

export default class PmoTrafficLightAdapter implements PmoSourceAdapter {
  readonly sourceType = 'traffic_light' as const

  async collect(ctx: PmoAdapterContext): Promise<{
    candidates: PmoRecommendationCandidate[]
    signals: PmoSourceSignal[]
    warnings: PmoRecommendationWarning[]
    available: boolean
  }> {
    if (!ctx.trafficLightAvailable) {
      return {
        candidates: [],
        signals: [],
        warnings: [
          {
            code: 'TRAFFIC_LIGHT_UNAVAILABLE' as any,
            message: 'PMO 交通灯能力未启用或尚无数据',
            source: 'traffic_light',
            blocking: false,
          },
        ],
        available: false,
      }
    }

    // 查找有风险信号的项目（简化实现：按 status 筛选）
    const atRiskProjects = await Project.query()
      .where('organization_id', ctx.organizationId)
      .whereIn('status', ['at_risk', 'blocked', 'critical'])
      .select('id', 'name', 'status')
      .limit(50)

    const candidates: PmoRecommendationCandidate[] = atRiskProjects.map((project) => {
      const signals = [`traffic_light:${project.status}`]
      return {
        candidateType: 'traffic_light' as const,
        projectId: project.id,
        targetRef: {
          entityType: 'project',
          entityId: project.id,
          displayName: project.name ?? null,
          url: `/pmo/traffic-light/${project.id}`,
        },
        title: (project.name ?? `项目${project.id}`) + ' 交通灯预警',
        summary: `交通灯状态指示项目需要关注：${project.status}`,
        suggestedAction: '查看交通灯详情并标记复核',
        actionType: 'navigate',
        severity: project.status === 'critical' ? 'critical' : 'high',
        priorityContext: {
          priorityScore: null,
          priorityLevel: project.status === 'critical' ? 'critical' : 'high',
          rank: null,
          weightVersion: null,
          topDimensionContributors: ['traffic_light'],
          scoringAvailable: ctx.priorityScoringAvailable,
        },
        sourceSignals: [],
        evidenceRefs: [],
        dedupeKey: computePmoCandidateDedupeKey(
          'traffic_light',
          project.id,
          `tl:${project.status}`,
        ),
        inputSignature: computePmoInputSignature({
          sourceType: 'traffic_light',
          sourceId: `tl-proj-${project.id}`,
          projectId: project.id,
          priorityScore: null,
          signals,
        }),
        candidateVersion: 'pmo-ai-priority-recommendations.v1',
        expiresAt: null,
        warnings: [],
      }
    })

    const signal: PmoSourceSignal = {
      source: 'traffic_light',
      summary: `交通灯检测到${candidates.length}个需要关注的项目`,
      severity: candidates.length > 0 ? 'high' : 'info',
      available: true,
      warnings: [],
      refreshedAt: new Date().toISOString(),
      stale: false,
    }

    return { candidates, signals: [signal], warnings: [], available: true }
  }
}
