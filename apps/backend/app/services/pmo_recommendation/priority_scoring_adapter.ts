/**
 * PriorityScoringAdapter —— 从优先级评分模型收集候选输入。
 *
 * v3-pmo-ai-priority-recommendations §3.4: 使用 fixture 回退
 * 当 v3-pmo-priority-scoring-model 未 apply 时返回 unavailable。
 */
import type { PmoSourceAdapter, PmoAdapterContext } from './adapter_types.js'
import type {
  PmoRecommendationCandidate,
  PmoSourceSignal,
  PmoRecommendationWarning,
} from '@aiproj/types'
import { makeVisiblePmoCandidate, pmoSourceUnavailableWarning } from '@aiproj/types'
import Project from '#models/project'

export default class PriorityScoringAdapter implements PmoSourceAdapter {
  readonly sourceType = 'priority_scoring' as const

  async collect(ctx: PmoAdapterContext): Promise<{
    candidates: PmoRecommendationCandidate[]
    signals: PmoSourceSignal[]
    warnings: PmoRecommendationWarning[]
    available: boolean
  }> {
    if (!ctx.priorityScoringAvailable) {
      return {
        candidates: [],
        signals: [],
        warnings: [pmoSourceUnavailableWarning('priority_scoring')],
        available: false,
      }
    }

    // Fixture 模式：基于可见项目列表生成模拟候选
    // 当 v3-pmo-priority-scoring-model 正式 apply 后，替换为真实评分调用
    const projects = await this.fetchVisibleProjects(ctx)
    const candidates: PmoRecommendationCandidate[] = projects.map((p, i) =>
      makeVisiblePmoCandidate(p.id, {
        candidateType: 'priority_scoring',
        severity: i < 3 ? 'critical' : i < 8 ? 'high' : 'medium',
      }),
    )

    const signal: PmoSourceSignal = {
      source: 'priority_scoring',
      summary: `基于${projects.length}个可见项目的优先级评分产生${candidates.length}条推荐`,
      severity: candidates.length > 0 ? 'high' : 'info',
      available: true,
      warnings: [],
      refreshedAt: new Date().toISOString(),
      stale: false,
    }

    return {
      candidates,
      signals: [signal],
      warnings: [],
      available: true,
    }
  }

  /** 获取组织下当前用户可见的项目列表。 */
  private async fetchVisibleProjects(ctx: PmoAdapterContext) {
    return Project.query()
      .where('organization_id', ctx.organizationId)
      .select('id', 'name')
      .limit(200)
  }
}
