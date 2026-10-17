/**
 * v3-copilot-web-search-tool §3 — 外部检索授权门。
 *
 * 设计纪律 D1：授权门短路点在"发出请求之前"。
 * 实现必须走完选域名、构造请求、落决策，然后在 HTTP 客户端调用处短路。
 *
 * 参照既有范式：
 * - Push 授权门（delivery_router.ts:76）：config flag + reason 短路
 * - OCR 授权门（ocr_privacy_downstream_guard.ts）：snapshot 判定
 *
 * 本 change 采用 Push 的简洁模式：
 * - 构造时注入 `authorizationEnabled` flag
 * - 未授权时返回 `authorization_gated` 拒绝原因
 * - 不发起任何外部请求
 */

import type {
  RetrievalAuthorizationState,
  RetrievalDecisionRecord,
  RetrievalRejectionReason,
} from '@aiproj/types'
import { RETRIEVAL_REJECTION_REASONS } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 授权门输入/输出
// ---------------------------------------------------------------------------

/** 授权门判定输入。 */
export interface AuthorizationGateInput {
  /** 组织 ID */
  organizationId: number
  /** 用户 ID */
  userId: number
  /** 回合 ID */
  turnId: string
}

/** 授权门判定结果。 */
export interface AuthorizationGateResult {
  /** 是否通过 */
  authorized: boolean
  /** 拒绝原因（仅 authorized=false 时有值） */
  rejectionReason: RetrievalRejectionReason | null
  /** 授权状态快照 */
  authorizationState: RetrievalAuthorizationState
}

// ---------------------------------------------------------------------------
// 授权门实现
// ---------------------------------------------------------------------------

/**
 * 外部检索授权门。
 *
 * 职责：
 * - 检查组织级外部检索授权状态
 * - 未授权时返回 `authorization_gated` 拒绝原因
 * - 不发起任何外部请求
 *
 * 接线位置：copilot_web_search/retrieval_service.ts
 */
export class RetrievalAuthorizationGate {
  /**
   * 判定是否允许外部检索。
   *
   * @param input 判定输入
   * @param authorizationState 组织级授权状态
   * @returns 判定结果
   */
  check(
    _input: AuthorizationGateInput,
    authorizationState: RetrievalAuthorizationState,
  ): AuthorizationGateResult {
    if (!authorizationState.authorized) {
      return {
        authorized: false,
        rejectionReason: 'authorization_gated',
        authorizationState,
      }
    }

    return {
      authorized: true,
      rejectionReason: null,
      authorizationState,
    }
  }

  /**
   * 构造授权门短路时的决策记录（低敏）。
   *
   * 在"发出请求之前"落账，确保授权前的每个环节都有测试覆盖。
   */
  makeGatedDecision(input: AuthorizationGateInput, queryCategory: string): RetrievalDecisionRecord {
    const rejectionReasonCounts: Record<RetrievalRejectionReason, number> = {} as any
    for (const r of RETRIEVAL_REJECTION_REASONS) {
      rejectionReasonCounts[r] = r === 'authorization_gated' ? 1 : 0
    }

    return {
      id: `ret_gated_${input.turnId}`,
      organizationId: input.organizationId,
      userId: input.userId,
      turnId: input.turnId,
      queryCategory: queryCategory as any,
      matchedDomains: [],
      rejectedDomainCount: 0,
      rejectionReasonCounts,
      elapsedMs: 0,
      resultCount: 0,
      isComplete: false,
      createdAt: new Date().toISOString(),
    }
  }
}
