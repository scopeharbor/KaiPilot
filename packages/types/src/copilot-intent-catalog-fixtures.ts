/**
 * v3-copilot-intent-catalog-and-router —— 意图目录 fixtures（目录校验/路由器测试共用）。
 *
 * 全部离线确定性：无网络、无 provider、无时钟/随机源。
 */
import {
  type CopilotContextPacket,
  type CopilotDestination,
  type CopilotScope,
  type CopilotSourceKind,
} from './copilot-shared-contracts.js'
import {
  COPILOT_INTENT_CATALOG_VERSION,
  type CopilotDestinationAvailability,
  type CopilotCommandAvailabilityDeclaration,
  type CopilotEntityReference,
  type CopilotExtractedSlot,
  type CopilotRoutingDecisionRecord,
  type CopilotSubIntentEntry,
} from './copilot-intent-catalog.js'

/** 项目级 fixture 上下文包（上下文采集器落地前由 fixture 替代，design Non-Goals）。 */
export function copilotIntentFixtureContextPacket(
  scope: CopilotScope = 'project',
  sourceKinds: readonly CopilotSourceKind[] = ['task', 'project_facts'],
): CopilotContextPacket {
  return {
    contextHash: 'fixture-context-hash-0001',
    scope,
    sources: sourceKinds.map((sourceKind, index) => ({
      sourceKind,
      sourceRef: `fixture://source/${index}`,
      sourceHash: `fh${index}`,
      lowSensitivitySummary: `fixture 来源摘要 ${index}`,
      freshness: { lastUpdatedAt: '2026-08-01T00:00:00.000Z', isStale: false },
      routeHints: [],
      warnings: [],
    })),
    eligibleKnowledgeTiers: ['L1', 'L2', 'L4'],
    truncation: {
      truncated: false,
      omittedSourceCount: 0,
      omittedEvidenceCount: 0,
      budgetBytes: 4096,
    },
    budget: {
      contextBytesUsed: 128,
      contextBytesLimit: 4096,
      evidenceBytesUsed: 0,
      evidenceBytesLimit: 8192,
    },
    warnings: [],
    sourceOrdering: [...sourceKinds],
  }
}

export const COPILOT_INTENT_FIXTURE_ENTITY_REFS: readonly CopilotEntityReference[] = [
  { kind: 'task', text: '首页设计' },
  { kind: 'member', text: '小张' },
]

export const COPILOT_INTENT_FIXTURE_EXTRACTED_SLOTS: readonly CopilotExtractedSlot[] = [
  { slotId: 'target_task', value: '首页设计' },
  { slotId: 'report_period', value: '下周' },
]

/** 可用性输入 fixtures：general_qa 授权门未开 + ocr 未启用。 */
export const COPILOT_INTENT_FIXTURE_AVAILABILITY_GATED: readonly CopilotDestinationAvailability[] =
  [
    {
      destination: 'external_retrieval',
      kind: 'authorization-gated',
      hint: '需要用户授权后才能使用该能力',
    },
    { destination: 'ocr_document', kind: 'not-enabled', hint: '该能力未启用，可在设置中开启' },
  ]

/** 命令注册表声明 fixtures（6.11/6.12）：draft_layer 未启用、external_retrieval 授权门未开。 */
export const COPILOT_INTENT_FIXTURE_COMMAND_DECLARATIONS: readonly CopilotCommandAvailabilityDeclaration[] =
  [
    {
      destination: 'draft_layer',
      requiresPermission: ['project:update', 'ai:trigger'],
      whenResult: true,
      enabled: false,
      authorizationGated: false,
    },
    {
      destination: 'external_retrieval',
      requiresPermission: ['ai:trigger', 'external:read'],
      whenResult: true,
      enabled: true,
      authorizationGated: true,
    },
    {
      destination: 'weekly_monthly_report',
      requiresPermission: ['project:read', 'ai:trigger'],
      whenResult: true,
      enabled: true,
      authorizationGated: false,
    },
    {
      destination: 'advanced_search',
      requiresPermission: ['project:read', 'search:read'],
      whenResult: false,
      enabled: true,
      authorizationGated: false,
    },
  ]

/** 路由决策记录 fixture（7.x 测试用，低敏有界）。 */
export const COPILOT_INTENT_FIXTURE_ROUTING_RECORD: CopilotRoutingDecisionRecord = {
  recordId: 'cair_fixture_0001',
  catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
  intentClass: 'query',
  subIntentId: 'query.project_status',
  intentSummary: '项目现状：归一化意图摘要',
  destinationOrder: ['health_diagnosis', 'prediction'],
  confidences: [62, 62],
  clarificationRoundCount: 0,
  ambiguous: false,
  unavailabilityKinds: [],
  ruleHitCount: 1,
  fallbackCount: 0,
  userRerouted: false,
  scope: 'project',
}

/** 负例：把可持久化 destination 挂在只读分类上（2.12 负向断言用）。 */
export const COPILOT_INTENT_FIXTURE_INVALID_ENTRY_PERSISTENCE: CopilotSubIntentEntry = {
  subIntentId: 'query.invalid_persistence',
  intentClass: 'query',
  label: '非法：只读类挂可持久化 destination',
  examplePhrasings: ['非法样例'],
  requiredSlots: [],
  optionalSlots: [{ slotId: 'dummy', label: '占位', tier: 'optional' }],
  candidateDestinations: ['draft_layer'],
  requiredPermissions: ['project:update', 'ai:trigger'],
  ruleDeclarations: [{ ruleId: 'invalid.kw', strength: 'keyword_pattern', keywords: ['非法'] }],
  confidenceTier: 'keyword_pattern',
  catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
}

/** 负例：候选 destination 不在共享注册表（2.11 负向断言用）。 */
export const COPILOT_INTENT_FIXTURE_INVALID_ENTRY_UNKNOWN_DESTINATION: CopilotSubIntentEntry = {
  subIntentId: 'query.invalid_unknown_destination',
  intentClass: 'query',
  label: '非法：未知 destination',
  examplePhrasings: ['非法样例'],
  requiredSlots: [],
  optionalSlots: [{ slotId: 'dummy', label: '占位', tier: 'optional' }],
  candidateDestinations: ['not_a_destination' as CopilotDestination],
  requiredPermissions: ['project:read'],
  ruleDeclarations: [{ ruleId: 'invalid.kw', strength: 'keyword_pattern', keywords: ['非法'] }],
  confidenceTier: 'keyword_pattern',
  catalogVersion: COPILOT_INTENT_CATALOG_VERSION,
}
