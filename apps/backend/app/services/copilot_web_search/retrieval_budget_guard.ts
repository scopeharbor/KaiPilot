/**
 * v3-copilot-web-search-tool §5 — 外部检索配额守卫。
 *
 * 设计纪律 D3：外部检索单独计量，不与模型调用共用额度。
 * 二者成本结构不同（检索按次、模型按 token），混在一起会让任一方的超支归因不清。
 *
 * 设计纪律 D4：超额是业务决策，必须明确拒绝并给出原因，不降级为少抓几个。
 *
 * 职责：
 * - 按组织级配额策略判定是否允许检索
 * - 超额时返回明确拒绝原因
 * - 不与模型调用共用额度
 */

import type {
  RetrievalQuotaPolicy,
  RetrievalQuotaResult,
  RetrievalRejectionReason,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 配额守卫输入/输出
// ---------------------------------------------------------------------------

/** 配额守卫判定输入。 */
export interface RetrievalBudgetCheckInput {
  /** 组织 ID */
  organizationId: number
  /** 当前窗口已用次数 */
  currentCount: number
  /** 窗口开始时间 */
  windowStart: Date
  /** 窗口结束时间 */
  windowEnd: Date
}

/** 配额守卫判定结果。 */
export interface RetrievalBudgetCheckResult {
  /** 是否允许 */
  allowed: boolean
  /** 拒绝原因（仅 allowed=false 时有值） */
  rejectionReason: RetrievalRejectionReason | null
  /** 配额判定详情 */
  quotaResult: RetrievalQuotaResult
}

// ---------------------------------------------------------------------------
// 配额守卫
// ---------------------------------------------------------------------------

/**
 * 外部检索配额守卫。
 *
 * 消费组织级配额策略，按窗口判定是否允许检索。
 * 超额时返回明确拒绝原因，不降级为少抓几个。
 */
export class RetrievalBudgetGuard {
  /**
   * 判定是否允许检索。
   *
   * @param input 判定输入
   * @param policy 组织级配额策略
   * @returns 判定结果
   */
  check(
    input: RetrievalBudgetCheckInput,
    policy: RetrievalQuotaPolicy,
  ): RetrievalBudgetCheckResult {
    const { currentCount } = input
    const { maxRetrievalsPerWindow } = policy

    if (currentCount >= maxRetrievalsPerWindow) {
      // 超额：明确拒绝
      const retryAfterSeconds = this.computeRetryAfterSeconds(input.windowEnd)
      return {
        allowed: false,
        rejectionReason: 'quota_exhausted',
        quotaResult: {
          allowed: false,
          currentCount,
          limit: maxRetrievalsPerWindow,
          retryAfterSeconds,
        },
      }
    }

    return {
      allowed: true,
      rejectionReason: null,
      quotaResult: {
        allowed: true,
        currentCount,
        limit: maxRetrievalsPerWindow,
        retryAfterSeconds: null,
      },
    }
  }

  /**
   * 计算重试建议秒数。
   */
  private computeRetryAfterSeconds(windowEnd: Date): number {
    const now = Date.now()
    const end = windowEnd.getTime()
    const diff = Math.max(0, Math.ceil((end - now) / 1000))
    return diff > 0 ? diff : 60 // 最少等 60 秒
  }
}
