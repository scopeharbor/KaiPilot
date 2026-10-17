// @aiproj/types — V3 Copilot 共享契约测试夹具（离线路由八态）
// v3-copilot-shared-contracts / §5 — 覆盖 success / clarification / degraded /
// stale-blocked / permission-missing / truncated / general-purpose / external-rejected。

import type {
  CopilotAssumptionEntry,
  CopilotAuditRefs,
  CopilotClarificationPrompt,
  CopilotContextPacket,
  CopilotCostSummary,
  CopilotRecommendedAction,
  CopilotResponse,
  CopilotRouteDecision,
  CopilotSession,
  CopilotSourceKind,
  CopilotSourceSummary,
} from './copilot-shared-contracts.js'
import {
  generateCopilotActionId,
  generateCopilotMessageId,
  generateCopilotRouteDecisionId,
} from './copilot-shared-contracts.js'

// ---------------------------------------------------------------------------
// fixture 状态标识
// ---------------------------------------------------------------------------

export type CopilotFixtureStateName =
  | 'success'
  | 'clarification'
  | 'degraded'
  | 'stale-blocked'
  | 'permission-missing'
  | 'truncated'
  | 'general-purpose'
  | 'external-rejected'

export interface CopilotFixtureState {
  readonly state: CopilotFixtureStateName
  readonly session: CopilotSession
  readonly contextPacket?: CopilotContextPacket
  readonly response: CopilotResponse
}

// ---------------------------------------------------------------------------
// 小构件
// ---------------------------------------------------------------------------

export function buildCopilotSourceSummary(params: {
  sourceKind: CopilotSourceKind
  sourceRef?: string
  sourceHash?: string
  lowSensitivitySummary?: string
  isStale?: boolean
}): CopilotSourceSummary {
  const sourceRef = params.sourceRef ?? `${params.sourceKind}/ref-001`
  return {
    sourceKind: params.sourceKind,
    sourceRef,
    sourceHash: params.sourceHash ?? `hash_${params.sourceKind}_001`,
    lowSensitivitySummary: params.lowSensitivitySummary ?? `${params.sourceKind} 的低敏摘要`,
    freshness: {
      lastUpdatedAt: '2026-08-16T00:00:00.000Z',
      isStale: params.isStale ?? false,
    },
    routeHints: [],
    warnings: [],
  }
}

export function buildCopilotRouteDecision(params: {
  destination: CopilotRouteDecision['destination']
  confidence?: CopilotRouteDecision['confidence']
  order?: number
  warnings?: CopilotRouteDecision['warnings']
}): CopilotRouteDecision {
  return {
    routeId: generateCopilotRouteDecisionId(),
    destination: params.destination,
    confidence: params.confidence ?? 'high',
    reason: '确定性路由命中',
    sourceRefs: ['ref-001'],
    sourceHashes: ['hash_ref_001'],
    warnings: params.warnings ?? [],
    order: params.order ?? 0,
  }
}

export function buildCopilotAction(params: {
  destination: CopilotRecommendedAction['destination']
  actionType?: CopilotRecommendedAction['actionType']
  intentClass?: CopilotRecommendedAction['intentClass']
  requiresUserConfirmation?: boolean
  isStale?: boolean
  sourceHashes?: readonly string[]
  navigationRef?: CopilotRecommendedAction['navigationRef']
}): CopilotRecommendedAction {
  return {
    actionId: generateCopilotActionId(),
    destination: params.destination,
    actionType: params.actionType ?? 'preview',
    intentClass: params.intentClass ?? 'mutation',
    label: '预览建议',
    description: '低敏描述',
    sourceRefs: ['ref-001'],
    sourceHashes: params.sourceHashes ?? ['hash_ref_001'],
    requiredPermissions: ['project:update'],
    requiresUserConfirmation: params.requiresUserConfirmation ?? true,
    isStale: params.isStale ?? false,
    idempotencyKey: 'fix_idem_001',
    lowSensitivitySummary: '待确认的低敏动作摘要',
    navigationRef: params.navigationRef,
  }
}

export const COPILOT_FIXTURE_COST: CopilotCostSummary = {
  providerName: 'fixture-provider',
  requestModel: 'fixture-request-model',
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  reasoningTokens: 0,
  realAdapterFlag: false,
  fallbackFlag: false,
}

export function buildCopilotAuditRefs(overrides?: Partial<CopilotAuditRefs>): CopilotAuditRefs {
  return {
    sessionId: 'cps_fixture',
    routeIds: ['cpr_fixture'],
    actionIds: ['cpa_fixture'],
    sourceRefKinds: ['task'],
    sourceHashPrefixes: ['hash_ref'],
    warningCodes: [],
    fallbackState: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 八态 fixtures
// ---------------------------------------------------------------------------

/** 成功态：确定性路由命中 + 可选叙述 + preview 动作（destination 可持久化 → 确认必填）。 */
export function buildSuccessCopilotFixture(): CopilotFixtureState {
  const contextPacket: CopilotContextPacket = {
    contextHash: 'ctx_hash_success',
    scope: 'project',
    sources: [buildCopilotSourceSummary({ sourceKind: 'task', sourceRef: 'proj-1/task-42' })],
    eligibleKnowledgeTiers: ['L1', 'L2'],
    truncation: {
      truncated: false,
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      budgetBytes: 8192,
    },
    budget: {
      contextBytesUsed: 512,
      contextBytesLimit: 4096,
      evidenceBytesUsed: 256,
      evidenceBytesLimit: 2048,
    },
    warnings: [],
    sourceOrdering: ['task'],
  }
  const response: CopilotResponse = {
    sessionId: 'cps_fixture',
    messageId: generateCopilotMessageId(),
    intentClass: 'mutation',
    routeDecisions: [buildCopilotRouteDecision({ destination: 'draft_layer' })],
    recommendedActions: [
      buildCopilotAction({
        destination: 'draft_layer',
        actionType: 'preview',
        intentClass: 'mutation',
        requiresUserConfirmation: true,
      }),
    ],
    clarificationPrompts: [],
    narration: {
      text: '基于当前任务数据建议调整排期，可先预览再确认。',
      isFallback: false,
      validationStatus: 'valid',
      provider: 'fixture-provider',
      model: 'fixture-request-model',
      costSummary: COPILOT_FIXTURE_COST,
    },
    warnings: [],
    fallback: false,
    costSummary: COPILOT_FIXTURE_COST,
    reviewRequired: true,
    auditRefs: buildCopilotAuditRefs(),
    createdAt: '2026-08-16T00:00:00.000Z',
  }
  return {
    state: 'success',
    session: {
      sessionId: 'cps_fixture',
      scope: 'project',
      attribution: { organizationId: 'org-1', projectId: 'proj-1' },
      status: 'active',
      title: '排期调整建议',
      archived: false,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:00.000Z',
    },
    contextPacket,
    response,
  }
}

/** 澄清态：关键信息缺失 → 澄清提示，不产出变更动作。 */
export function buildClarificationCopilotFixture(): CopilotFixtureState {
  const contextPacket: CopilotContextPacket = {
    contextHash: 'ctx_hash_clarification',
    scope: 'project',
    sources: [],
    eligibleKnowledgeTiers: ['L1', 'L2'],
    truncation: {
      truncated: false,
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      budgetBytes: 8192,
    },
    budget: {
      contextBytesUsed: 64,
      contextBytesLimit: 4096,
      evidenceBytesUsed: 0,
      evidenceBytesLimit: 2048,
    },
    warnings: ['RETRIEVAL_ZERO_RESULTS'],
    sourceOrdering: [],
  }
  const clarificationPrompts: CopilotClarificationPrompt[] = [
    {
      promptId: 'cpp_fixture_clarify',
      question: '该排期调整的目标里程碑或截止约束是什么？',
      purpose: '缺少关键约束，无法确定性安全路由',
      quickOptions: ['按里程碑', '按截止日期'],
      relatedIntentClass: 'mutation',
      sourceRefs: [],
    },
  ]
  const response: CopilotResponse = {
    sessionId: 'cps_fixture',
    messageId: generateCopilotMessageId(),
    intentClass: 'query',
    routeDecisions: [
      buildCopilotRouteDecision({ destination: 'clarification_cards', confidence: 'medium' }),
    ],
    recommendedActions: [],
    clarificationPrompts,
    warnings: ['RETRIEVAL_ZERO_RESULTS'],
    fallback: false,
    reviewRequired: false,
    auditRefs: buildCopilotAuditRefs({
      routeIds: ['cpr_fixture_clarify'],
      actionIds: [],
      warningCodes: ['RETRIEVAL_ZERO_RESULTS'],
    }),
    createdAt: '2026-08-16T00:00:01.000Z',
  }
  return {
    state: 'clarification',
    session: {
      sessionId: 'cps_fixture',
      scope: 'project',
      attribution: { organizationId: 'org-1', projectId: 'proj-1' },
      status: 'active',
      title: '排期调整建议（待澄清）',
      archived: false,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:01.000Z',
    },
    contextPacket,
    response,
  }
}

/** 降级态：isFallback=true + 机器可读降级原因 + 确定性建议保留。 */
export function buildDegradedCopilotFixture(): CopilotFixtureState {
  const contextPacket: CopilotContextPacket = {
    contextHash: 'ctx_hash_degraded',
    scope: 'project',
    sources: [buildCopilotSourceSummary({ sourceKind: 'task', sourceRef: 'proj-1/task-7' })],
    eligibleKnowledgeTiers: ['L1', 'L2'],
    truncation: {
      truncated: false,
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      budgetBytes: 8192,
    },
    budget: {
      contextBytesUsed: 640,
      contextBytesLimit: 4096,
      evidenceBytesUsed: 256,
      evidenceBytesLimit: 2048,
    },
    warnings: ['AI_FALLBACK'],
    sourceOrdering: ['task'],
  }
  const response: CopilotResponse = {
    sessionId: 'cps_fixture',
    messageId: generateCopilotMessageId(),
    intentClass: 'analysis',
    routeDecisions: [
      buildCopilotRouteDecision({ destination: 'health_diagnosis', confidence: 'medium' }),
    ],
    recommendedActions: [
      buildCopilotAction({
        destination: 'health_diagnosis',
        actionType: 'navigation',
        intentClass: 'analysis',
        requiresUserConfirmation: false,
      }),
    ],
    clarificationPrompts: [],
    narration: {
      text: '模型服务暂不可用，已按确定性规则给出诊断导航。',
      isFallback: true,
      degradedReason: 'provider_error',
      validationStatus: 'not_validated',
    },
    warnings: ['AI_FALLBACK', 'PROVIDER_ERROR'],
    fallback: true,
    degradedReason: 'provider_error',
    costSummary: COPILOT_FIXTURE_COST,
    reviewRequired: false,
    auditRefs: buildCopilotAuditRefs({
      fallbackState: true,
      warningCodes: ['AI_FALLBACK', 'PROVIDER_ERROR'],
    }),
    createdAt: '2026-08-16T00:00:02.000Z',
  }
  return {
    state: 'degraded',
    session: {
      sessionId: 'cps_fixture',
      scope: 'project',
      attribution: { organizationId: 'org-1', projectId: 'proj-1' },
      status: 'completed_with_warnings',
      title: '健康诊断（降级）',
      archived: false,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:02.000Z',
    },
    contextPacket,
    response,
  }
}

/** stale 阻断态：source hash 失配 → 动作被标记 stale。 */
export function buildStaleBlockedCopilotFixture(): CopilotFixtureState {
  const contextPacket: CopilotContextPacket = {
    contextHash: 'ctx_hash_stale',
    scope: 'project',
    sources: [
      buildCopilotSourceSummary({
        sourceKind: 'risk',
        sourceRef: 'proj-1/risk-3',
        sourceHash: 'hash_NEW_risk_3',
      }),
    ],
    eligibleKnowledgeTiers: ['L1', 'L2'],
    truncation: {
      truncated: false,
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      budgetBytes: 8192,
    },
    budget: {
      contextBytesUsed: 700,
      contextBytesLimit: 4096,
      evidenceBytesUsed: 256,
      evidenceBytesLimit: 2048,
    },
    warnings: ['SOURCE_STALE'],
    sourceOrdering: ['risk'],
  }
  const response: CopilotResponse = {
    sessionId: 'cps_fixture',
    messageId: generateCopilotMessageId(),
    intentClass: 'mutation',
    routeDecisions: [
      buildCopilotRouteDecision({ destination: 'risk_suggestions', warnings: ['SOURCE_STALE'] }),
    ],
    recommendedActions: [
      buildCopilotAction({
        destination: 'risk_suggestions',
        actionType: 'preview',
        intentClass: 'mutation',
        requiresUserConfirmation: true,
        isStale: true,
        sourceHashes: ['hash_OLD_risk_3'],
      }),
    ],
    clarificationPrompts: [],
    narration: {
      text: '风险数据已变更，动作被标记为陈旧，需刷新后重新审查。',
      isFallback: false,
      validationStatus: 'valid',
      provider: 'fixture-provider',
      model: 'fixture-request-model',
    },
    warnings: ['SOURCE_STALE', 'STALE_ACTION_BLOCKED'],
    fallback: false,
    reviewRequired: true,
    auditRefs: buildCopilotAuditRefs({ warningCodes: ['SOURCE_STALE', 'STALE_ACTION_BLOCKED'] }),
    createdAt: '2026-08-16T00:00:03.000Z',
  }
  return {
    state: 'stale-blocked',
    session: {
      sessionId: 'cps_fixture',
      scope: 'project',
      attribution: { organizationId: 'org-1', projectId: 'proj-1' },
      status: 'active',
      title: '风险建议（数据已变更）',
      archived: false,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:03.000Z',
    },
    contextPacket,
    response,
  }
}

/** 权限缺失态：不可访问来源不暴露存在、名称、计数或 hash。 */
export function buildPermissionMissingCopilotFixture(): CopilotFixtureState {
  const contextPacket: CopilotContextPacket = {
    contextHash: 'ctx_hash_permission',
    scope: 'project',
    // 无 sources：不可访问来源连详情、名称、计数、hash 都不暴露
    sources: [],
    eligibleKnowledgeTiers: ['L1', 'L2'],
    truncation: {
      truncated: false,
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      budgetBytes: 8192,
    },
    budget: {
      contextBytesUsed: 32,
      contextBytesLimit: 4096,
      evidenceBytesUsed: 0,
      evidenceBytesLimit: 2048,
    },
    warnings: ['SOURCE_PERMISSION_DENIED'],
    sourceOrdering: [],
  }
  const response: CopilotResponse = {
    sessionId: 'cps_fixture',
    messageId: generateCopilotMessageId(),
    intentClass: 'query',
    routeDecisions: [
      buildCopilotRouteDecision({
        destination: 'health_diagnosis',
        confidence: 'fallback',
        warnings: ['PERMISSION_DENIED'],
      }),
    ],
    recommendedActions: [],
    clarificationPrompts: [],
    warnings: ['PERMISSION_DENIED'],
    fallback: true,
    degradedReason: 'permission_denied',
    reviewRequired: false,
    auditRefs: buildCopilotAuditRefs({ warningCodes: ['PERMISSION_DENIED'] }),
    createdAt: '2026-08-16T00:00:04.000Z',
  }
  return {
    state: 'permission-missing',
    session: {
      sessionId: 'cps_fixture',
      scope: 'project',
      attribution: { organizationId: 'org-1', projectId: 'proj-1' },
      status: 'completed_with_warnings',
      title: '健康诊断（权限受限）',
      archived: false,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:04.000Z',
    },
    contextPacket,
    response,
  }
}

/** 截断态：超预算保留路由输入、丢证据正文并给省略计数。 */
export function buildTruncatedCopilotFixture(): CopilotFixtureState {
  const contextPacket: CopilotContextPacket = {
    contextHash: 'ctx_hash_truncated',
    scope: 'project',
    sources: [buildCopilotSourceSummary({ sourceKind: 'task', sourceRef: 'proj-1/task-1' })],
    eligibleKnowledgeTiers: ['L1', 'L2'],
    truncation: {
      truncated: true,
      omittedSourceCount: 3,
      omittedEvidenceCount: 12000,
      budgetBytes: 4096,
      warning: buildTruncationWarningText(),
    },
    budget: {
      contextBytesUsed: 4096,
      contextBytesLimit: 4096,
      evidenceBytesUsed: 2048,
      evidenceBytesLimit: 2048,
    },
    warnings: ['CONTEXT_TRUNCATED'],
    sourceOrdering: ['task'],
  }
  const response: CopilotResponse = {
    sessionId: 'cps_fixture',
    messageId: generateCopilotMessageId(),
    intentClass: 'mutation',
    routeDecisions: [buildCopilotRouteDecision({ destination: 'ai_draft_generation' })],
    recommendedActions: [
      buildCopilotAction({
        destination: 'ai_draft_generation',
        actionType: 'preview',
        intentClass: 'mutation',
        requiresUserConfirmation: true,
      }),
    ],
    clarificationPrompts: [],
    narration: {
      text: '上下文超预算，已保留路由输入并丢弃溢出证据正文。',
      isFallback: false,
      validationStatus: 'not_validated',
    },
    warnings: ['CONTEXT_TRUNCATED'],
    fallback: false,
    reviewRequired: true,
    auditRefs: buildCopilotAuditRefs({ warningCodes: ['CONTEXT_TRUNCATED'] }),
    createdAt: '2026-08-16T00:00:05.000Z',
  }
  return {
    state: 'truncated',
    session: {
      sessionId: 'cps_fixture',
      scope: 'project',
      attribution: { organizationId: 'org-1', projectId: 'proj-1' },
      status: 'completed_with_warnings',
      title: '草案生成（上下文截断）',
      archived: false,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:05.000Z',
    },
    contextPacket,
    response,
  }
}

function buildTruncationWarningText(): string {
  return '上下文截断：共 4 个来源，仅纳入 1 个（预算 4096 字节）'
}

/** 通用问答态：global scope、无项目来源、禁写标记（无 preview/持久化动作）。 */
export function buildGeneralPurposeCopilotFixture(): CopilotFixtureState {
  const contextPacket: CopilotContextPacket = {
    contextHash: 'ctx_hash_general',
    scope: 'global',
    sources: [],
    eligibleKnowledgeTiers: ['L1', 'L4'],
    truncation: {
      truncated: false,
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      budgetBytes: 8192,
    },
    budget: {
      contextBytesUsed: 32,
      contextBytesLimit: 4096,
      evidenceBytesUsed: 0,
      evidenceBytesLimit: 2048,
    },
    warnings: [],
    sourceOrdering: [],
  }
  const response: CopilotResponse = {
    sessionId: 'cps_global',
    messageId: generateCopilotMessageId(),
    intentClass: 'query',
    routeDecisions: [
      buildCopilotRouteDecision({ destination: 'general_qa', confidence: 'medium' }),
    ],
    // 禁写标记：通用问答只产出导航/解释，不得产出可持久化动作
    recommendedActions: [
      buildCopilotAction({
        destination: 'general_qa',
        actionType: 'explanation',
        intentClass: 'query',
        requiresUserConfirmation: false,
      }),
    ],
    clarificationPrompts: [],
    narration: {
      text: '这是一个通用问答回答，不涉及任何项目数据。',
      isFallback: false,
      validationStatus: 'valid',
      provider: 'fixture-provider',
      model: 'fixture-request-model',
    },
    warnings: [],
    fallback: false,
    reviewRequired: false,
    auditRefs: buildCopilotAuditRefs({ sessionId: 'cps_global' }),
    createdAt: '2026-08-16T00:00:06.000Z',
  }
  return {
    state: 'general-purpose',
    session: {
      sessionId: 'cps_global',
      scope: 'global',
      attribution: {},
      status: 'completed',
      title: '通用问答',
      archived: false,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:06.000Z',
    },
    contextPacket,
    response,
  }
}

/** 外部内容被拒态：外部检索结果被安全策略拒绝并留告警码。 */
export function buildExternalRejectedCopilotFixture(): CopilotFixtureState {
  const contextPacket: CopilotContextPacket = {
    contextHash: 'ctx_hash_external',
    scope: 'global',
    sources: [],
    eligibleKnowledgeTiers: ['L1', 'L4'],
    truncation: {
      truncated: false,
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      budgetBytes: 8192,
    },
    budget: {
      contextBytesUsed: 64,
      contextBytesLimit: 4096,
      evidenceBytesUsed: 0,
      evidenceBytesLimit: 2048,
    },
    warnings: ['EXTERNAL_CONTENT_REJECTED'],
    sourceOrdering: [],
  }
  const response: CopilotResponse = {
    sessionId: 'cps_global',
    messageId: generateCopilotMessageId(),
    intentClass: 'query',
    routeDecisions: [
      buildCopilotRouteDecision({
        destination: 'help_and_terminology',
        confidence: 'fallback',
        warnings: ['EXTERNAL_CONTENT_REJECTED'],
      }),
    ],
    recommendedActions: [
      buildCopilotAction({
        destination: 'help_and_terminology',
        actionType: 'navigation',
        intentClass: 'query',
        requiresUserConfirmation: false,
        navigationRef: { path: '/help/terminology', label: '术语表' },
      }),
    ],
    clarificationPrompts: [],
    narration: {
      text: '外部检索内容被安全策略拒绝，已回退到本地术语帮助。',
      isFallback: true,
      degradedReason: 'external_content_rejected',
      validationStatus: 'not_validated',
    },
    warnings: ['EXTERNAL_CONTENT_REJECTED'],
    fallback: true,
    degradedReason: 'external_content_rejected',
    reviewRequired: false,
    auditRefs: buildCopilotAuditRefs({
      sessionId: 'cps_global',
      warningCodes: ['EXTERNAL_CONTENT_REJECTED'],
    }),
    createdAt: '2026-08-16T00:00:07.000Z',
  }
  return {
    state: 'external-rejected',
    session: {
      sessionId: 'cps_global',
      scope: 'global',
      attribution: {},
      status: 'completed_with_warnings',
      title: '术语查询（外部检索被拒）',
      archived: false,
      createdAt: '2026-08-16T00:00:00.000Z',
      updatedAt: '2026-08-16T00:00:07.000Z',
    },
    contextPacket,
    response,
  }
}

/** 假设条目 fixture（clarification change 可复用）。 */
export function buildCopilotAssumption(
  params?: Partial<CopilotAssumptionEntry>,
): CopilotAssumptionEntry {
  return {
    assumptionId: 'cpas_fixture_1',
    statement: '假设项目采用敏捷方法推进。',
    source: 'default',
    confidence: 72,
    usedDefault: true,
    needsConfirmation: true,
    editable: true,
    ...params,
  }
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

export const COPILOT_FIXTURE_STATES: readonly CopilotFixtureState[] = [
  buildSuccessCopilotFixture(),
  buildClarificationCopilotFixture(),
  buildDegradedCopilotFixture(),
  buildStaleBlockedCopilotFixture(),
  buildPermissionMissingCopilotFixture(),
  buildTruncatedCopilotFixture(),
  buildGeneralPurposeCopilotFixture(),
  buildExternalRejectedCopilotFixture(),
]

export const COPILOT_FIXTURE_STATE_NAMES: readonly CopilotFixtureStateName[] =
  COPILOT_FIXTURE_STATES.map((f) => f.state)
