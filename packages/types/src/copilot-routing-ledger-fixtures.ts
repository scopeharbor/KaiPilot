/**
 * v3-copilot-routing-decision-ledger —— 路由决策账本 fixtures（八态）。
 *
 * 覆盖：首位采纳、非首位采纳、改到未推荐、放弃、歧义选择、模型兜底、多轮澄清、确定性违规。
 * 命名纪律：ROUTING_LEDGER_FIXTURE_ 前缀。
 *
 * 依赖约束：纯常量 + 确定性构造器，零运行时/DB/网络依赖。
 */

import type {
  CopilotRoutingLedgerRecord,
  RoutingAccuracyMetrics,
  RoutingUnavailabilityDistribution,
} from './copilot-routing-ledger.js'
import {
  computeRoutingInputTupleHash,
  computeRoutingLedgerIdempotencyKey,
} from './copilot-routing-ledger.js'
import type { CopilotDestination, CopilotScope } from './copilot-shared-contracts.js'
import type { CopilotIntentClass } from './copilot-shared-contracts.js'

// ===========================================================================
// 常量
// ===========================================================================

export const ROUTING_LEDGER_FIXTURE_CATALOG_VERSION = '1.0.0'
export const ROUTING_LEDGER_FIXTURE_ORG_ID = 42
export const ROUTING_LEDGER_FIXTURE_USER_ID = 7

// ===========================================================================
// 辅助构造器
// ===========================================================================

function makeBaseRecord(
  overrides: Partial<CopilotRoutingLedgerRecord>,
): CopilotRoutingLedgerRecord {
  const now = new Date('2026-08-17T12:00:00Z')
  const intentSummary = '测试归一化意图摘要'
  const destinationOrder: readonly string[] = ['gantt_what_if', 'resource_forecasting']
  const confidences: readonly number[] = [85, 60]
  const catalogVersion = ROUTING_LEDGER_FIXTURE_CATALOG_VERSION

  const inputTupleHash = computeRoutingInputTupleHash({
    intentSummary,
    destinationOrder,
    confidences,
    catalogVersion,
    scope: 'project',
  })

  const idempotencyKey = computeRoutingLedgerIdempotencyKey({
    recordId: 'cpr_fixture_001',
    organizationId: ROUTING_LEDGER_FIXTURE_ORG_ID,
    catalogVersion,
  })

  const defaults: CopilotRoutingLedgerRecord = {
    dbId: 1,
    organizationId: ROUTING_LEDGER_FIXTURE_ORG_ID,
    recordId: 'cpr_fixture_001',
    catalogVersion,
    intentClass: 'query' as CopilotIntentClass,
    subIntentId: 'gantt_whatif_query',
    intentSummary,
    destinationOrder,
    confidences,
    clarificationRoundCount: 0,
    ambiguous: false,
    unavailabilityKinds: [],
    ruleHitCount: 1,
    fallbackCount: 0,
    scope: 'project' as CopilotScope,
    userDestination: null,
    redirectClass: 'accepted_top',
    attributionConfidence: 'direct',
    inputTupleHash,
    idempotencyKey,
    traceId: null,
    createdAt: now,
  }

  return { ...defaults, ...overrides }
}

// ===========================================================================
// 八态 Fixtures
// ===========================================================================

/**
 * 态 1：首位采纳（路由正确）
 * 用户采纳了路由推荐的第一个 destination。
 */
export const ROUTING_LEDGER_FIXTURE_ACCEPTED_TOP: CopilotRoutingLedgerRecord = makeBaseRecord({
  redirectClass: 'accepted_top',
  userDestination: 'gantt_what_if' as CopilotDestination,
  attributionConfidence: 'direct',
})

/**
 * 态 2：非首位采纳（排序错但候选对）
 * 用户采纳了路由推荐的第二个 destination。
 */
export const ROUTING_LEDGER_FIXTURE_ACCEPTED_NON_TOP: CopilotRoutingLedgerRecord = makeBaseRecord({
  recordId: 'cpr_fixture_002',
  redirectClass: 'accepted_non_top',
  userDestination: 'resource_forecasting' as CopilotDestination,
  attributionConfidence: 'direct',
})

/**
 * 态 3：改到未推荐 destination（最强错误信号）
 * 用户去了一个路由推荐列表中完全不存在的 destination。
 */
export const ROUTING_LEDGER_FIXTURE_WENT_TO_UNRECOMMENDED: CopilotRoutingLedgerRecord =
  makeBaseRecord({
    recordId: 'cpr_fixture_003',
    redirectClass: 'went_to_unrecommended',
    userDestination: 'compiler' as CopilotDestination,
    attributionConfidence: 'direct',
  })

/**
 * 态 4：放弃（用户未去任何地方）
 */
export const ROUTING_LEDGER_FIXTURE_ABANDONED: CopilotRoutingLedgerRecord = makeBaseRecord({
  recordId: 'cpr_fixture_004',
  redirectClass: 'abandoned',
  userDestination: null,
  attributionConfidence: 'ambiguous',
})

/**
 * 态 5：歧义候选中选择（不算路由错误）
 * 路由返回了歧义候选集，用户选择了其中一个。
 */
export const ROUTING_LEDGER_FIXTURE_AMBIGUOUS_CHOICE: CopilotRoutingLedgerRecord = makeBaseRecord({
  recordId: 'cpr_fixture_005',
  ambiguous: true,
  redirectClass: 'chose_from_ambiguous',
  userDestination: 'gantt_what_if' as CopilotDestination,
  attributionConfidence: 'direct',
})

/**
 * 态 6：模型兜底（规则未命中，模型参与分类）
 */
export const ROUTING_LEDGER_FIXTURE_MODEL_FALLBACK: CopilotRoutingLedgerRecord = makeBaseRecord({
  recordId: 'cpr_fixture_006',
  ruleHitCount: 0,
  fallbackCount: 1,
  intentClass: null,
  subIntentId: null,
  intentSummary: '模型兜底分类的归一化意图摘要',
  redirectClass: 'accepted_top',
  userDestination: 'general_qa' as CopilotDestination,
})

/**
 * 态 7：多轮澄清后成功路由
 */
export const ROUTING_LEDGER_FIXTURE_MULTI_ROUND_CLARIFICATION: CopilotRoutingLedgerRecord =
  makeBaseRecord({
    recordId: 'cpr_fixture_007',
    clarificationRoundCount: 3,
    redirectClass: 'accepted_top',
    userDestination: 'draft_layer' as CopilotDestination,
  })

/**
 * 态 8：确定性违规（同 hash 不同排序）
 * 用于测试 reproducibility violation 检测。
 */
export const ROUTING_LEDGER_FIXTURE_DETERMINISM_VIOLATION: {
  recordA: CopilotRoutingLedgerRecord
  recordB: CopilotRoutingLedgerRecord
} = {
  recordA: makeBaseRecord({
    recordId: 'cpr_fixture_008a',
    destinationOrder: ['gantt_what_if', 'resource_forecasting'],
    confidences: [85, 60],
  }),
  recordB: makeBaseRecord({
    recordId: 'cpr_fixture_008b',
    destinationOrder: ['resource_forecasting', 'gantt_what_if'],
    confidences: [60, 85],
  }),
}

// ===========================================================================
// Fixtures — 不可用类别分布
// ===========================================================================

export const ROUTING_LEDGER_FIXTURE_UNAVAILABILITY_DISTRIBUTION: RoutingUnavailabilityDistribution =
  {
    missingPermissionCount: 5,
    notEnabledCount: 3,
    authorizationGatedCount: 2,
    totalUnavailabilityEvents: 10,
  }

// ===========================================================================
// Fixtures — 准确率指标
// ===========================================================================

export const ROUTING_LEDGER_FIXTURE_ACCURACY_METRICS: RoutingAccuracyMetrics = {
  totalDecisions: 100,
  topOneHits: 60,
  topNHits: 75,
  abandonedCount: 10,
  ambiguousSelectionCount: 5,
  topOneHitRate: 0.6,
  topNHitRate: 0.75,
  wentToUnrecommendedCount: 15,
  acceptedNonTopCount: 15,
}
