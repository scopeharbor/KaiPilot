/**
 * DashboardAdapter —— 从 PMO 组合 Dashboard 收集候选输入。
 *
 * v3-pmo-ai-priority-recommendations §3.4: 消费已归档的 pmo-portfolio-dashboard 契约。
 */
import type { PmoSourceAdapter, PmoAdapterContext } from './adapter_types.js'
import type {
  PmoRecommendationCandidate,
  PmoSourceSignal,
  PmoRecommendationWarning,
} from '@aiproj/types'
import { computePmoCandidateDedupeKey, computePmoInputSignature } from '@aiproj/types'
import Project from '#models/project'

export default class PmoDashboardAdapter implements PmoSourceAdapter {
  readonly sourceType = 'portfolio_dashboard' as const

  async collect(ctx: PmoAdapterContext): Promise<{
    candidates: PmoRecommendationCandidate[]
    signals: PmoSourceSignal[]
    warnings: PmoRecommendationWarning[]
    available: boolean
  }> {
    const projects = await this.fetchProjectsWithMetrics(ctx)
    const candidates: PmoRecommendationCandidate[] = []
    const warnings: PmoRecommendationWarning[] = []

    for (const project of projects) {
      const contextHash = `dashboard:${project.id}:${project.status ?? 'unknown'}`
      const signals: string[] = [project.status ?? 'unknown']

      const candidate: PmoRecommendationCandidate = {
        candidateType: 'portfolio_dashboard',
        projectId: project.id,
        targetRef: {
          entityType: 'project',
          entityId: project.id,
          displayName: project.name ?? null,
          url: `/projects/${project.id}`,
        },
        title: (project.name ?? `项目${project.id}`) + ' Dashboard 提示关注',
        summary: `项目 Dashboard 指标摘要：状态=${project.status ?? '未知'}`,
        suggestedAction: '查看项目 Dashboard 获取完整指标',
        actionType: 'navigate',
        severity: 'medium',
        priorityContext: {
          priorityScore: null,
          priorityLevel: 'unavailable',
          rank: null,
          weightVersion: null,
          topDimensionContributors: [],
          scoringAvailable: ctx.priorityScoringAvailable,
        },
        sourceSignals: [],
        evidenceRefs: [],
        dedupeKey: computePmoCandidateDedupeKey('portfolio_dashboard', project.id, contextHash),
        inputSignature: computePmoInputSignature({
          sourceType: 'portfolio_dashboard',
          sourceId: `proj-${project.id}`,
          projectId: project.id,
          priorityScore: null,
          signals,
        }),
        candidateVersion: 'pmo-ai-priority-recommendations.v1',
        expiresAt: null,
        warnings: [],
      }
      candidates.push(candidate)
    }

    const signal: PmoSourceSignal = {
      source: 'portfolio_dashboard',
      summary: `Dashboard 指标覆盖${projects.length}个可见项目`,
      severity: 'medium',
      available: true,
      warnings,
      refreshedAt: new Date().toISOString(),
      stale: false,
    }

    return { candidates, signals: [signal], warnings, available: true }
  }

  /** 查询有状态/进度的可见项目。 */
  private async fetchProjectsWithMetrics(ctx: PmoAdapterContext) {
    return Project.query()
      .where('organization_id', ctx.organizationId)
      .select('id', 'name', 'status')
      .limit(100)
  }
}
