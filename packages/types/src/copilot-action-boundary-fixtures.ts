/**
 * @aiproj/types — V3 Copilot 动作边界 fixtures（八态，全部离线确定性，零网络零 provider）
 * v3-copilot-action-and-preview-boundary —— 任务 2.12。
 *
 * 八态：成功应用 / 修改后应用 / 拒绝 / stale 阻断 / 权限缺失 / dry-run 失败 / 部分失败 / 幂等重复。
 */
import type {
  CopilotActionAssumptionSlot,
  CopilotActionCard,
  CopilotActionConfirmationRequest,
  CopilotActionConfirmationResult,
  CopilotActionSourceSignature,
  CopilotBulkDecisionItemResult,
  CopilotBulkDecisionResult,
} from './copilot-action-boundary.js'
import { deriveCopilotActionIdempotencyKey } from './copilot-action-boundary.js'
import type {
  CopilotAssumptionEntry,
  CopilotRecommendedAction,
} from './copilot-shared-contracts.js'

// ── 基础素材 ──

export const COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES: readonly CopilotActionSourceSignature[] = [
  {
    sourceRef: 'project:42',
    contentHash: 'aaaabbbbccccdddd',
    capturedAt: '2026-08-16T10:00:00.000Z',
  },
  {
    sourceRef: 'task:1201',
    contentHash: '1111222233334444',
    capturedAt: '2026-08-16T10:00:01.000Z',
  },
]

export const COPILOT_ACTION_FIXTURE_STALE_SIGNATURES: readonly CopilotActionSourceSignature[] = [
  {
    sourceRef: 'project:42',
    contentHash: 'ffff0000eeee9999',
    capturedAt: '2026-08-16T10:05:00.000Z',
  },
  {
    sourceRef: 'task:1201',
    contentHash: '1111222233334444',
    capturedAt: '2026-08-16T10:00:01.000Z',
  },
]

export const COPILOT_ACTION_FIXTURE_ASSUMPTIONS: readonly CopilotAssumptionEntry[] = [
  {
    assumptionId: 'asm-1',
    statement: '假设每周 5 个工作日',
    source: 'derived',
    confidence: 95,
    usedDefault: false,
    needsConfirmation: true,
    editable: true,
  },
  {
    assumptionId: 'asm-2',
    statement: '技术栈默认 React，用户未明确，使用了默认值',
    source: 'default',
    confidence: 60,
    usedDefault: true,
    needsConfirmation: true,
    editable: true,
  },
]

export const COPILOT_ACTION_FIXTURE_SUPPLIED_SLOT: CopilotActionAssumptionSlot = {
  supplied: true,
  assumptions: COPILOT_ACTION_FIXTURE_ASSUMPTIONS,
  suppliedConfidenceBand: 'high',
}

export const COPILOT_ACTION_FIXTURE_UNSUPPLIED_SLOT: CopilotActionAssumptionSlot = {
  supplied: false,
  assumptions: [],
}

export const COPILOT_ACTION_FIXTURE_RECOMMENDED_ACTION: CopilotRecommendedAction = {
  actionId: 'act-fix-001',
  destination: 'draft_layer',
  actionType: 'preview',
  intentClass: 'mutation',
  label: '任务 1201 工期调整为 5 天',
  description: '基于项目 42 当前排期的确定性建议',
  sourceRefs: ['project:42', 'task:1201'],
  sourceHashes: ['aaaabbbbccccdddd', '1111222233334444'],
  requiredPermissions: ['ai:trigger', 'task:update'],
  requiresUserConfirmation: true,
  isStale: false,
  idempotencyKey: 'fixture-key-001',
  lowSensitivitySummary: '调整任务 1201 工期为 5 天',
}

// ── 动作卡片：1) 可确认（插槽已接入） 2) 依赖默认值但插槽未接入 3) stale ──

export const COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE: CopilotActionCard = {
  actionCardId: 'card-fix-001',
  recommendedAction: COPILOT_ACTION_FIXTURE_RECOMMENDED_ACTION,
  primaryActions: [
    {
      kind: 'apply_proposal',
      label: '应用此方案',
      state: 'idle',
      requiredPermission: 'task:update',
    },
    { kind: 'adjust', label: '调整', state: 'idle', requiredPermission: 'task:update' },
    { kind: 'discard', label: '放弃', state: 'idle' },
  ],
  secondaryActions: [
    { kind: 'view_details', label: '查看详情', state: 'idle' },
    { kind: 'add_as_task', label: '添加到任务', state: 'idle', requiredPermission: 'task:create' },
  ],
  assumptionSlot: COPILOT_ACTION_FIXTURE_SUPPLIED_SLOT,
  reliedOnSubstitutedDefaults: true,
}

export const COPILOT_ACTION_FIXTURE_CARD_UNSEEN_DEFAULT: CopilotActionCard = {
  actionCardId: 'card-fix-002',
  recommendedAction: { ...COPILOT_ACTION_FIXTURE_RECOMMENDED_ACTION, actionId: 'act-fix-002' },
  primaryActions: [{ kind: 'apply_proposal', label: '应用此方案', state: 'idle' }],
  secondaryActions: [],
  assumptionSlot: COPILOT_ACTION_FIXTURE_UNSUPPLIED_SLOT,
  reliedOnSubstitutedDefaults: true,
}

export const COPILOT_ACTION_FIXTURE_CARD_STALE: CopilotActionCard = {
  actionCardId: 'card-fix-003',
  recommendedAction: {
    ...COPILOT_ACTION_FIXTURE_RECOMMENDED_ACTION,
    actionId: 'act-fix-003',
    isStale: true,
    staleReason: 'source hash 失配',
  },
  primaryActions: [{ kind: 'apply_proposal', label: '应用此方案', state: 'idle' }],
  secondaryActions: [{ kind: 'view_details', label: '查看详情', state: 'idle' }],
  assumptionSlot: COPILOT_ACTION_FIXTURE_SUPPLIED_SLOT,
  reliedOnSubstitutedDefaults: false,
}

// ── 确认请求与结果 ──

export function copilotActionFixtureConfirmationRequest(overrides?: {
  decision?: CopilotActionConfirmationRequest['decision']
  signature?: readonly CopilotActionSourceSignature[]
  userModifiedValue?: unknown
  userNote?: string
}): CopilotActionConfirmationRequest {
  const signatures = overrides?.signature ?? COPILOT_ACTION_FIXTURE_SOURCE_SIGNATURES
  return {
    actionCardId: 'card-fix-001',
    decision: overrides?.decision ?? 'accept',
    targetEntityRefs: ['task:1201'],
    sourceSignatures: signatures,
    userModifiedValue: overrides?.userModifiedValue,
    userNote: overrides?.userNote,
    idempotencyKey: deriveCopilotActionIdempotencyKey({
      normalizedActionInput: 'apply-proposal:task:1201:duration=5',
      targetEntityRefs: ['task:1201'],
      sourceSignatures: signatures,
    }),
  }
}

// 八态结果
export const COPILOT_ACTION_FIXTURE_RESULT_ACCEPTED: CopilotActionConfirmationResult = {
  status: 'accepted',
  idempotencyKey: 'fixture-result-accepted',
  appliedChangeIds: [501],
  message: '已按原样应用该建议',
}

export const COPILOT_ACTION_FIXTURE_RESULT_MODIFIED: CopilotActionConfirmationResult = {
  status: 'modified',
  idempotencyKey: 'fixture-result-modified',
  appliedChangeIds: [502],
  message: '已按修改后的值应用（记录为“修改后应用”）',
}

export const COPILOT_ACTION_FIXTURE_RESULT_REJECTED: CopilotActionConfirmationResult = {
  status: 'rejected',
  idempotencyKey: 'fixture-result-rejected',
  message: '已放弃该建议',
}

export const COPILOT_ACTION_FIXTURE_RESULT_STALE_BLOCKED: CopilotActionConfirmationResult = {
  status: 'stale_blocked',
  idempotencyKey: 'fixture-result-stale',
  message: '建议来源已过期，请刷新后重新审查',
}

export const COPILOT_ACTION_FIXTURE_RESULT_PERMISSION_DENIED: CopilotActionConfirmationResult = {
  status: 'permission_denied',
  idempotencyKey: 'fixture-result-perm',
  message: '没有执行该操作的权限',
}

export const COPILOT_ACTION_FIXTURE_RESULT_DRY_RUN_FAILED: CopilotActionConfirmationResult = {
  status: 'dry_run_failed',
  idempotencyKey: 'fixture-result-dryrun',
  failedChangeIds: [503],
  message: '试运行校验失败，已阻断应用',
}

export const COPILOT_ACTION_FIXTURE_RESULT_PARTIAL_FAILURE: CopilotActionConfirmationResult = {
  status: 'partial_failure',
  idempotencyKey: 'fixture-result-partial',
  appliedChangeIds: [504],
  failedChangeIds: [505, 506],
  message: '部分应用成功：2 项成功，2 项失败',
}

export const COPILOT_ACTION_FIXTURE_RESULT_IDEMPOTENT_REPLAY: CopilotActionConfirmationResult = {
  status: 'idempotent_replay',
  idempotencyKey: 'fixture-result-replay',
  appliedChangeIds: [501],
  message: '该确认已处理过，返回既有结果，未重复写入',
}

export const COPILOT_ACTION_FIXTURE_RESULTS: readonly CopilotActionConfirmationResult[] = [
  COPILOT_ACTION_FIXTURE_RESULT_ACCEPTED,
  COPILOT_ACTION_FIXTURE_RESULT_MODIFIED,
  COPILOT_ACTION_FIXTURE_RESULT_REJECTED,
  COPILOT_ACTION_FIXTURE_RESULT_STALE_BLOCKED,
  COPILOT_ACTION_FIXTURE_RESULT_PERMISSION_DENIED,
  COPILOT_ACTION_FIXTURE_RESULT_DRY_RUN_FAILED,
  COPILOT_ACTION_FIXTURE_RESULT_PARTIAL_FAILURE,
  COPILOT_ACTION_FIXTURE_RESULT_IDEMPOTENT_REPLAY,
]

// ── 批量逐条结果 ──

export const COPILOT_ACTION_FIXTURE_BULK_OK: CopilotBulkDecisionItemResult[] = [
  {
    actionCardId: 'card-fix-001',
    permission: 'granted',
    stale: 'fresh',
    outcome: 'applied',
    message: '已应用',
  },
  {
    actionCardId: 'card-fix-004',
    permission: 'granted',
    stale: 'fresh',
    outcome: 'applied',
    message: '已应用',
  },
]

export const COPILOT_ACTION_FIXTURE_BULK_MIXED: CopilotBulkDecisionItemResult[] = [
  {
    actionCardId: 'card-fix-001',
    permission: 'granted',
    stale: 'fresh',
    outcome: 'applied',
    message: '已应用',
  },
  {
    actionCardId: 'card-fix-002',
    permission: 'granted',
    stale: 'stale',
    outcome: 'stale_blocked',
    message: '来源已过期，需重新审查',
  },
  {
    actionCardId: 'card-fix-003',
    permission: 'denied',
    stale: 'fresh',
    outcome: 'denied',
    message: '没有执行该操作的权限',
  },
]

export const COPILOT_ACTION_FIXTURE_BULK_RESULT_OK: CopilotBulkDecisionResult = {
  results: COPILOT_ACTION_FIXTURE_BULK_OK,
  fullyApplied: true,
}

export const COPILOT_ACTION_FIXTURE_BULK_RESULT_MIXED: CopilotBulkDecisionResult = {
  results: COPILOT_ACTION_FIXTURE_BULK_MIXED,
  fullyApplied: false,
}

// ── 索引 ──

export const COPILOT_ACTION_FIXTURE_CARDS: readonly CopilotActionCard[] = [
  COPILOT_ACTION_FIXTURE_CARD_CONFIRMABLE,
  COPILOT_ACTION_FIXTURE_CARD_UNSEEN_DEFAULT,
  COPILOT_ACTION_FIXTURE_CARD_STALE,
]
