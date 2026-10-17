import PmoAiPriorityRecommendation from '#models/pmo_ai_priority_recommendation'
import User from '#models/user'
import PmoAiPriorityRecommendationPolicy from '#policies/pmo_ai_priority_recommendation_policy'
import RbacService from '#services/rbac_service'
import { serializeInboxDedupeKey } from '@aiproj/types'
import type { InboxProblemKind, InboxSeverity, InboxSourceKind } from '@aiproj/types'
import type { PmoRecommendationSource } from '@aiproj/types'
import type { InboxSourceAdapter, InboxSourceEntry } from '../inbox_aggregator.js'

/**
 * `pmo_priority_recommendation` 来源适配器。
 *
 * 只读回源：把 PMO AI 优先级推荐里**尚待处理**的条目暴露成收件箱引用，
 * 不复制建议正文（收件箱按 spec 只存引用，正文留在来源侧读取）。
 *
 * 权限沿用来源自身模型（`PmoAiPriorityRecommendationPolicy.canView`），
 * 无权限时返回空数组而不是抛错——单个来源不得拖垮整个聚合。
 */

/** 仍需用户处理的状态；已接受/忽略/转换/过期的不再进收件箱。 */
const OPEN_STATUSES = ['new', 'reviewing'] as const

/**
 * PMO 来源类型 → 收件箱问题种类。
 * 没有语义对应的一律落 `other`，不强行归类。
 */
const PROBLEM_KIND_BY_SOURCE: Record<PmoRecommendationSource, InboxProblemKind> = {
  priority_scoring: 'process_gap',
  portfolio_dashboard: 'other',
  traffic_light: 'schedule_risk',
  investment_distribution: 'cost_overrun',
  freshness_stale: 'data_staleness',
  project_recommendation: 'other',
}

export class PmoPriorityRecommendationInboxAdapter implements InboxSourceAdapter {
  readonly sourceKind: InboxSourceKind = 'pmo_priority_recommendation'

  constructor(
    private readonly policy: PmoAiPriorityRecommendationPolicy = new PmoAiPriorityRecommendationPolicy(
      new RbacService(),
    ),
  ) {}

  /** 表存在即视为可用；权限在 `listForInbox` 内逐 actor 判定。 */
  async isAvailable(): Promise<boolean> {
    try {
      await PmoAiPriorityRecommendation.query().limit(1)
      return true
    } catch {
      return false
    }
  }

  async listForInbox(params: {
    organizationId: number
    projectId: number
    actorId: number
  }): Promise<InboxSourceEntry[]> {
    const actor = await User.find(params.actorId)
    if (!actor) return []
    if (!(await this.policy.canView(actor, params.organizationId))) return []

    // 刻意不用 scopeByOrgProject：该 helper 的参数与返回都是 any，会把整条链的类型
    // 推断打断（row 变成隐式 any）。它内部就是这两个 where，直接写等价且类型完整。
    const rows = await PmoAiPriorityRecommendation.query()
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .whereIn('status', [...OPEN_STATUSES])

    return rows.map((row) => {
      const problemKind = PROBLEM_KIND_BY_SOURCE[row.sourceType] ?? 'other'
      return {
        sourceId: String(row.id),
        projectId: row.projectId,
        problemKind,
        // PMO 与收件箱的严重度枚举取值完全一致（critical/high/medium/low/info），可直接透传。
        severity: row.severity as InboxSeverity,
        // 来源侧自带去重键，按收件箱契约再封一层「问题种类::来源键」。
        declaredDedupeKey: serializeInboxDedupeKey({
          problemKind,
          declaredKey: row.dedupeKey,
        }),
        // inputSignature 是来源侧的输入内容签名：输入变了签名就变，正是过期判定要的锚点。
        sourceHash: row.inputSignature,
        capturedAt: row.createdAt.toISO()!,
      }
    })
  }
}
