/**
 * v3-copilot-routing-decision-ledger（任务 4.1–4.3）—— 路由决策记录器。
 *
 * 核心职责：
 * - 消费路由层产出的 CopilotRoutingDecisionRecord 形状
 * - 兑现「被用户改道」字段：五类改道分类
 * - 声明式归因规则（观察窗口 + 间接导航处理）
 * - 记账可降级：不得改变路由结果、不得阻断回合
 * - 幂等落库（幂等键防重复写入）
 * - 禁止隐式改道推断
 *
 * 失败姿态：记账失败时捕获异常，不向上抛出，不改变路由结果。
 */

import type { CopilotRoutingDecisionRecord, CopilotDestination } from '@aiproj/types'
import {
  buildRoutingLedgerRecord,
  type CopilotRoutingLedgerRecord,
  type RoutingAttributionConfidence,
} from '@aiproj/types'
import CopilotRoutingDecisionModel from '../../models/copilot_routing_decision.js'

// ---------------------------------------------------------------------------
// 输入类型
// ---------------------------------------------------------------------------

export interface RecordRoutingDecisionInput {
  /** 组织 ID（组织隔离必填）。 */
  readonly organizationId: number
  /** 路由层产出的低敏路由决策记录。 */
  readonly routingRecord: CopilotRoutingDecisionRecord
  /** 用户最终到达的 destination（null = 放弃/尚未归因）。 */
  readonly userDestination: CopilotDestination | null
  /** 因无权限被过滤的 destination 数量。 */
  readonly missingPermissionCount: number
  /** trace 引用（未落地时为 null 占位）。 */
  readonly traceId?: string | null
}

// ---------------------------------------------------------------------------
// 归因规则
// ---------------------------------------------------------------------------

/**
 * 归因观察窗口（毫秒）。
 * 用户在路由决策后多长时间内的导航行为可归因到该决策。
 * 超过此窗口的导航标记为 ambiguous 而非直接归因。
 */
export const ROUTING_ATTRIBUTION_WINDOW_MS = 5 * 60 * 1000 // 5 分钟

/**
 * 判定归因置信度。
 *
 * @param userDestination - 用户最终到达的 destination
 * @param routingDecisions - 路由推荐的有序 destination 列表
 * @param timeSinceDecisionMs - 距路由决策的时间差（毫秒）
 * @returns 归因置信度
 */
export function attributeRedirect(
  userDestination: CopilotDestination | null,
  routingDecisions: readonly string[],
  timeSinceDecisionMs: number,
): RoutingAttributionConfidence {
  if (userDestination === null) {
    return 'ambiguous'
  }

  // 超过观察窗口：归因不确定
  if (timeSinceDecisionMs > ROUTING_ATTRIBUTION_WINDOW_MS) {
    return 'ambiguous'
  }

  // 直接选择了推荐的 destination
  if (routingDecisions.includes(userDestination)) {
    return 'direct'
  }

  // 选择了非推荐的 destination（间接或错误）
  return 'indirect'
}

// ---------------------------------------------------------------------------
// 记录器
// ---------------------------------------------------------------------------

/**
 * 记录路由决策到账本。
 *
 * **失败姿态**：记账失败时捕获异常，不向上抛出，不改变路由结果。
 * 路由是确定性的，必须保持如此，无论观测是否成功。
 */
export async function recordRoutingDecision(
  input: RecordRoutingDecisionInput,
): Promise<{ success: boolean; ledgerRecord?: CopilotRoutingLedgerRecord }> {
  try {
    const { organizationId, routingRecord, userDestination, missingPermissionCount } = input

    // 构建账本记录
    const ledgerRecord = buildRoutingLedgerRecord({
      routingRecord,
      organizationId,
      userDestination,
      missingPermissionCount,
      traceId: input.traceId ?? null,
    })

    // 幂等检查：如果幂等键已存在，跳过写入
    const existing = await CopilotRoutingDecisionModel.query()
      .where('idempotency_key', ledgerRecord.idempotencyKey)
      .first()

    if (existing) {
      return { success: true, ledgerRecord }
    }

    // 写入数据库
    await CopilotRoutingDecisionModel.create({
      organizationId,
      recordId: ledgerRecord.recordId,
      catalogVersion: ledgerRecord.catalogVersion,
      intentClass: ledgerRecord.intentClass,
      subIntentId: ledgerRecord.subIntentId,
      intentSummary: ledgerRecord.intentSummary,
      destinationOrder: [...ledgerRecord.destinationOrder],
      confidences: [...ledgerRecord.confidences],
      clarificationRoundCount: ledgerRecord.clarificationRoundCount,
      ambiguous: ledgerRecord.ambiguous,
      unavailabilityKinds: [...ledgerRecord.unavailabilityKinds],
      ruleHitCount: ledgerRecord.ruleHitCount,
      fallbackCount: ledgerRecord.fallbackCount,
      scope: ledgerRecord.scope,
      userDestination: ledgerRecord.userDestination,
      redirectClass: ledgerRecord.redirectClass,
      attributionConfidence: ledgerRecord.attributionConfidence,
      inputTupleHash: ledgerRecord.inputTupleHash,
      idempotencyKey: ledgerRecord.idempotencyKey,
      traceId: ledgerRecord.traceId,
    })

    return { success: true, ledgerRecord }
  } catch {
    // 记账失败：捕获异常，不向上抛出
    // 路由结果不受影响，记账降级
    return { success: false }
  }
}
