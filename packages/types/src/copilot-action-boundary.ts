/**
 * @aiproj/types — V3 Copilot 动作与预览边界契约（前后端共享）
 * v3-copilot-action-and-preview-boundary —— Copilot 建议到正式项目数据的唯一受控通道。
 *
 * 依赖轻量约束：纯类型 + 确定性纯函数，只依赖同包 `copilot-shared-contracts.js`
 * （共享契约的动作 / 假设 / 置信度类型，消费不重定义）与 `triz-contradiction.js`
 * 的 `deterministicHash`（同为纯 TS 零依赖）。禁止依赖 AdonisJS、React、数据库客户端、
 * HTTP 客户端、外部网络、容器、provider 凭证或真实模型 SDK。
 *
 * 红线（本契约在类型层承载，配合后端/前端聚焦测试钉死）：
 * - 任何可导致持久化的 Copilot 动作必须经 preview → diff → dry-run → 人工确认 → apply，
 *   不存在绕过 draft layer 的直写路径
 * - 确认前必须重新校验 source 签名（内容 hash + 捕获时间戳）；失配阻断或标记 stale，
 *   禁止静默刷新后落库。缺捕获时间戳的签名契约校验拒绝
 * - 幂等键由归一化动作输入 + 目标实体引用 + source 签名派生（非客户端提供），
 *   两个语义不同的动作永不共享键
 * - 批量决策逐条校验权限与 stale，任意失败项不得整批静默通过；
 *   部分失败不得呈现为完全成功（fullyApplied 由逐条结局推导）
 * - 修改后应用记为 modified（userModifiedValue + userNote），与 accepted 区分
 * - dry-run 失败必须阻断 apply
 * - 动作卡片五类动作、最多三个主操作、其余折叠；按钮 idle → loading → success / failure，
 *   禁止无反馈态
 * - 可见措辞为审查导向中文，禁止自动执行措辞（按声明清单校验，非全串匹配）
 */

import { deterministicHash } from './triz-contradiction.js'
import type {
  CopilotAssumptionEntry,
  CopilotConfidenceBand,
  CopilotRecommendedAction,
} from './copilot-shared-contracts.js'

// ===========================================================================
// 2.2 五类动作枚举 + 主操作上限
// ===========================================================================

export const COPILOT_ACTION_KINDS = [
  'apply_proposal', // 应用此方案（主操作）
  'adjust', // 调整（进入编辑模式，修改后应用）
  'discard', // 放弃（忽略此建议）
  'view_details', // 查看详情（展开详细信息）
  'add_as_task', // 添加到任务（把建议添加为新任务）
] as const
export type CopilotActionKind = (typeof COPILOT_ACTION_KINDS)[number]

/** §4.4 按钮组规则：最多显示 3 个主要操作，更多操作折叠。 */
export const COPILOT_ACTION_CARD_MAX_PRIMARY = 3 as const

export function isCopilotActionKind(v: unknown): v is CopilotActionKind {
  return typeof v === 'string' && (COPILOT_ACTION_KINDS as readonly string[]).includes(v)
}

export function copilotActionKindLabel(kind: CopilotActionKind): string {
  switch (kind) {
    case 'apply_proposal':
      return '应用此方案'
    case 'adjust':
      return '调整'
    case 'discard':
      return '放弃'
    case 'view_details':
      return '查看详情'
    case 'add_as_task':
      return '添加到任务'
  }
}

// ===========================================================================
// 2.3 动作按钮状态机：idle → loading → success / failure，禁止无反馈态
// ===========================================================================

export const COPILOT_ACTION_BUTTON_STATES = ['idle', 'loading', 'success', 'failure'] as const
export type CopilotActionButtonState = (typeof COPILOT_ACTION_BUTTON_STATES)[number]

/** 合法迁移表：无「idle → success」直跳（禁止无反馈态）。 */
export const COPILOT_ACTION_BUTTON_TRANSITIONS: Record<
  CopilotActionButtonState,
  readonly CopilotActionButtonState[]
> = {
  idle: ['loading'],
  loading: ['success', 'failure'],
  success: [],
  failure: ['loading'],
}

export function isCopilotActionButtonState(v: unknown): v is CopilotActionButtonState {
  return typeof v === 'string' && (COPILOT_ACTION_BUTTON_STATES as readonly string[]).includes(v)
}

/** 迁移是否合法；任何未声明的迁移（含 idle→success 直跳）均为非法。 */
export function canCopilotActionButtonTransition(
  from: CopilotActionButtonState,
  to: CopilotActionButtonState,
): boolean {
  return COPILOT_ACTION_BUTTON_TRANSITIONS[from].includes(to)
}

// ===========================================================================
// 2.4 假设与可信度插槽契约（消费共享契约条目类型，不重定义）
// ===========================================================================

export interface CopilotActionAssumptionSlot {
  /** 归属能力（v3-copilot-clarification-and-assumptions）是否已接入并提供内容。false = 插槽未接入。 */
  readonly supplied: boolean
  /** 归属能力提供的内容，原样渲染不做转换。 */
  readonly assumptions: readonly CopilotAssumptionEntry[]
  /** 归属能力提供的整体可信度档位（可选；四档映射语义归归属能力）。 */
  readonly suppliedConfidenceBand?: CopilotConfidenceBand
}

export const COPILOT_ACTION_EMPTY_ASSUMPTION_SLOT: CopilotActionAssumptionSlot = {
  supplied: false,
  assumptions: [],
}

// ===========================================================================
// 2.5 「依赖替代默认值」标记 + 动作卡片（驱动「未见默认值不得确认」阻断）
// ===========================================================================

export interface CopilotActionCardControl {
  readonly kind: CopilotActionKind
  readonly label: string
  readonly state: CopilotActionButtonState
  readonly disabledReason?: string
  /** 执行本操作所需的权限（前端据此**不渲染**无权限动作，非禁用可见）。 */
  readonly requiredPermission?: string
}

export interface CopilotActionCard {
  readonly actionCardId: string
  readonly recommendedAction: CopilotRecommendedAction
  readonly primaryActions: readonly CopilotActionCardControl[]
  readonly secondaryActions: readonly CopilotActionCardControl[]
  readonly assumptionSlot: CopilotActionAssumptionSlot
  /** 建议是否依赖了替代默认值（用户从未看到的取值）。 */
  readonly reliedOnSubstitutedDefaults: boolean
}

/**
 * 卡片是否可确认：
 * - stale 动作恒不可确认（需刷新或重新审查）；
 * - 依赖替代默认值但假设插槽未接入 → 不可确认（用户不能确认自己没看到的取值）。
 */
export function isCopilotActionCardConfirmable(card: CopilotActionCard): boolean {
  return copilotActionCardConfirmBlockReason(card) === null
}

/** 返回中文阻断原因；null = 可确认。 */
export function copilotActionCardConfirmBlockReason(card: CopilotActionCard): string | null {
  if (card.recommendedAction.isStale) {
    return '建议来源已过期，请刷新后重新审查'
  }
  if (card.reliedOnSubstitutedDefaults && !card.assumptionSlot.supplied) {
    return '该建议依赖替代默认值，但假设清单未接入，请先查看假设后再确认'
  }
  return null
}

// ===========================================================================
// 2.6 source 签名：内容 hash + 捕获时间戳（缺时间戳契约拒绝）
// ===========================================================================

export interface CopilotActionSourceSignature {
  readonly sourceRef: string
  readonly contentHash: string
  /** ISO-8601 捕获时间戳。缺时间戳的签名无法区分「未变」与「从未捕获」，契约拒绝。 */
  readonly capturedAt: string
}

export function isCopilotActionSourceSignature(sig: unknown): sig is CopilotActionSourceSignature {
  if (!sig || typeof sig !== 'object') return false
  const s = sig as Record<string, unknown>
  return (
    typeof s.sourceRef === 'string' &&
    s.sourceRef.length > 0 &&
    typeof s.contentHash === 'string' &&
    s.contentHash.length > 0 &&
    typeof s.capturedAt === 'string' &&
    s.capturedAt.length > 0
  )
}

export interface CopilotSourceSignatureValidation {
  readonly valid: boolean
  readonly errors: readonly string[]
}

/**
 * 契约校验：每条签名必须同时含内容 hash 与捕获时间戳。
 * 任一条缺失 capturedAt（或为空）→ valid=false。
 */
export function validateCopilotActionSourceSignatures(
  signatures: readonly CopilotActionSourceSignature[],
): CopilotSourceSignatureValidation {
  const errors: string[] = []
  signatures.forEach((sig, i) => {
    if (!sig || typeof sig.sourceRef !== 'string' || sig.sourceRef.length === 0) {
      errors.push(`签名[${i}] 缺少 sourceRef`)
    }
    if (!sig || typeof sig.contentHash !== 'string' || sig.contentHash.length === 0) {
      errors.push(`签名[${i}] 缺少内容 hash`)
    }
    if (!sig || typeof sig.capturedAt !== 'string' || sig.capturedAt.length === 0) {
      errors.push(`签名[${i}] 缺少捕获时间戳`)
    }
  })
  return { valid: errors.length === 0, errors }
}

/** 确认前重校验：当前签名与动作携带的签名「内容 hash 与捕获时间戳」一致才算 fresh。 */
export function isCopilotActionSourceSignatureFresh(
  current: CopilotActionSourceSignature,
  recorded: CopilotActionSourceSignature,
): boolean {
  return (
    current.sourceRef === recorded.sourceRef &&
    current.contentHash === recorded.contentHash &&
    current.capturedAt === recorded.capturedAt
  )
}

/** 审计低敏字段：source hash 前缀（不落全文）。 */
export function copilotActionSourceSignaturePrefix(
  sig: CopilotActionSourceSignature,
  prefixLength = 8,
): string {
  return sig.contentHash.slice(0, prefixLength)
}

// ===========================================================================
// 2.8 幂等键派生：归一化动作输入 + 目标实体引用 + source 签名
// ===========================================================================

export interface CopilotActionIdempotencyInput {
  readonly normalizedActionInput: string
  readonly targetEntityRefs: readonly string[]
  readonly sourceSignatures: readonly CopilotActionSourceSignature[]
}

/**
 * 确定性幂等键：稳定排序 target refs 与签名（hash@capturedAt）后拼接再散列。
 * 两个语义不同的动作（输入/目标/来源不同）永不共享键。
 */
export function deriveCopilotActionIdempotencyKey(input: CopilotActionIdempotencyInput): string {
  const targets = [...input.targetEntityRefs].sort().join('|')
  const sigs = [...input.sourceSignatures]
    .map((s) => `${s.contentHash}@${s.capturedAt}`)
    .sort()
    .join('|')
  return deterministicHash(`${input.normalizedActionInput}|${targets}|${sigs}`)
}

// ===========================================================================
// 决策请求与确认结果
// ===========================================================================

export const COPILOT_ACTION_DECISION_KINDS = ['accept', 'reject', 'modify', 'skip'] as const
export type CopilotActionDecisionKind = (typeof COPILOT_ACTION_DECISION_KINDS)[number]

export function isCopilotActionDecisionKind(v: unknown): v is CopilotActionDecisionKind {
  return typeof v === 'string' && (COPILOT_ACTION_DECISION_KINDS as readonly string[]).includes(v)
}

export interface CopilotActionConfirmationRequest {
  readonly actionCardId: string
  readonly decision: CopilotActionDecisionKind
  readonly targetEntityRefs: readonly string[]
  readonly sourceSignatures: readonly CopilotActionSourceSignature[]
  /** modify 决策时必填：用户修改后的值。 */
  readonly userModifiedValue?: unknown
  readonly userNote?: string
  /** 由 deriveCopilotActionIdempotencyKey 派生，服务端复核，不接受客户端自定义。 */
  readonly idempotencyKey: string
}

export const COPILOT_ACTION_CONFIRMATION_STATUSES = [
  'accepted', // 按原样接受
  'rejected', // 拒绝
  'modified', // 修改后应用（独立于 accepted）
  'skipped', // 跳过
  'stale_blocked', // source 签名失配阻断，需刷新或重新审查
  'permission_denied', // 权限不足（非泄露拒绝）
  'dry_run_failed', // dry-run 校验失败阻断 apply
  'partial_failure', // apply 部分失败（逐条结局呈现）
  'idempotent_replay', // 幂等重复确认：返回既有结果，不重复写入
] as const
export type CopilotActionConfirmationStatus = (typeof COPILOT_ACTION_CONFIRMATION_STATUSES)[number]

export interface CopilotActionConfirmationResult {
  readonly status: CopilotActionConfirmationStatus
  readonly idempotencyKey: string
  /** apply 成功的 change id（部分失败时仅含成功项）。 */
  readonly appliedChangeIds?: readonly number[]
  /** apply 失败的 change id（部分失败时）。 */
  readonly failedChangeIds?: readonly number[]
  /** 审查导向中文消息。 */
  readonly message: string
}

// ===========================================================================
// 2.10 批量决策逐条结果（每条含权限结果、stale 结果与最终结局）
// ===========================================================================

export const COPILOT_BULK_ITEM_RESULTS = [
  'applied',
  'rejected',
  'skipped',
  'modified',
  'denied', // 权限不足（非泄露）
  'stale_blocked', // source 签名失配
  'dry_run_failed',
  'failed',
] as const
export type CopilotBulkItemResultKind = (typeof COPILOT_BULK_ITEM_RESULTS)[number]

export interface CopilotBulkDecisionItemResult {
  readonly actionCardId: string
  readonly permission: 'granted' | 'denied'
  readonly stale: 'fresh' | 'stale'
  readonly outcome: CopilotBulkItemResultKind
  readonly message: string
}

export interface CopilotBulkDecisionResult {
  readonly results: readonly CopilotBulkDecisionItemResult[]
  /** 恒由逐条结局推导：任一非 applied 即 false，禁止部分失败呈现为完全成功。 */
  readonly fullyApplied: boolean
}

export function isCopilotBulkResultFullyApplied(result: CopilotBulkDecisionResult): boolean {
  return result.results.every((r) => r.outcome === 'applied')
}

// ===========================================================================
// 2.11 禁止措辞清单（自动执行类表述，按声明清单校验而非全串匹配）
// ===========================================================================

export const COPILOT_ACTION_FORBIDDEN_WORDING = [
  '自动应用',
  '自动执行',
  '自动写入',
  '自动确认',
  '自动落库',
  '自动提交',
  '自动导入',
  '自动分配',
  '自动导出',
  '自动优化',
  '自动规划',
  '自动解决',
  '自动重排',
  '自动平衡资源',
  '自动通知',
  '一键应用',
  '一键执行',
  '一键确认',
] as const

/** 返回命中的禁止词（空数组 = 措辞干净）。 */
export function findCopilotActionForbiddenWording(text: string): readonly string[] {
  return COPILOT_ACTION_FORBIDDEN_WORDING.filter((word) => text.includes(word))
}

export function isCopilotActionWordingClean(text: string): boolean {
  return findCopilotActionForbiddenWording(text).length === 0
}

// ===========================================================================
// dry-run 门禁（纯函数表达：dry-run canApply=false 时 apply 必须被阻断）
// ===========================================================================

export function assertCopilotDryRunGate(dryRunCanApply: boolean): boolean {
  return dryRunCanApply
}
