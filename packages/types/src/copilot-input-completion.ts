/**
 * v3-copilot-mentions-and-slash-commands —— Copilot 输入补全共享契约。
 *
 * 定义 @ 提及引用、/ 命令描述符、补全结果、候选排序键、三类可用性
 * （与路由器及芯片同一取值集合）、禁存原始输入约束、低敏 sanitizer。
 *
 * 本模块纯类型 + 确定性常量 + helpers，零运行时依赖。
 */

import type { ChipAvailabilityKind } from './copilot-context-chips.js'

// ===========================================================================
// 枚举 — 实体类型（提及引用）
// ===========================================================================

/**
 * 可提及的实体类型集合。与 search 模块的 SearchEntityType 对齐，
 * 但仅暴露 Copilot 补全场景所需的子集。
 */
export type MentionableEntityType =
  | 'project'
  | 'task'
  | 'milestone'
  | 'risk'
  | 'member'
  | 'document'
  | 'file'
  | 'report'
  | 'change_request'
  | 'comment'
  | 'ocr_document'
  | 'external_link'
  | 'wbs_node'

// ===========================================================================
// 枚举 — 命令来源类别
// ===========================================================================

/**
 * 命令来源：意图目录子意图或命令注册表命令。
 * 与 ChipSourceKind 同构但独立声明，避免语义耦合。
 */
export type CommandSourceKind = 'intent-catalog' | 'registered-command'

// ===========================================================================
// 枚举 — 可用性（与路由器及芯片同一取值集合）
// ===========================================================================

/**
 * 补全候选的可用性类别。
 * **MUST** 与 ChipAvailabilityKind 同一取值集合（spec REQ）。
 *
 * - available: 可用
 * - not-permitted: 无权限（缺席，不泄露存在）
 * - not-enabled: 能力未启用（可见不可用，给启用提示）
 * - authorization-gated: 需用户授权（可见不可用，给原因，点击不发外部请求）
 */
export type CompletionAvailabilityKind = ChipAvailabilityKind

// ===========================================================================
// 结构类型 — 提及引用
// ===========================================================================

/**
 * 提及引用：选中 @ 实体后保留的结构化引用。
 * 与可读文本双轨并行，端到端传递给后端。
 */
export interface MentionReference {
  /** 实体类型（如 'task', 'milestone', 'risk'）。 */
  readonly entityType: MentionableEntityType
  /** 实体 ID（数字型唯一标识）。 */
  readonly entityId: number
  /** 可读标签（如 "首页设计（T-1042）"），插入输入框的文本。 */
  readonly label: string
  /** 组织归属（组织 ID），用于组织隔离校验。 */
  readonly organizationId: number
  /** 所属项目 ID（可选，用于项目级过滤）。 */
  readonly projectId?: number
}

// ===========================================================================
// 结构类型 — 双轨表达
// ===========================================================================

/**
 * 可读文本 + 结构化引用的双轨表达。
 * 输入框中保留可读文本，提交时附带结构化引用。
 */
export interface MentionDualRail {
  /** 可读文本（插入输入框的部分）。 */
  readonly displayText: string
  /** 结构化实体引用。 */
  readonly reference: MentionReference
}

// ===========================================================================
// 结构类型 — 命令描述符
// ===========================================================================

/**
 * 命令描述符：/ 补全列表中的一条命令。
 */
export interface CommandDescriptor {
  /** 唯一标识符（与命令注册表 ID 或意图子意图 ID 对齐）。 */
  readonly id: string
  /** 中文标签。 */
  readonly label: string
  /** 来源类别。 */
  readonly sourceKind: CommandSourceKind
  /** 分组（如 'contextual', 'navigation', 'search'）。 */
  readonly group: string
  /** 中文一句说明。 */
  readonly description: string
  /** 所需权限列表。 */
  readonly requiredPermissions: readonly string[]
  /** 可用性类别。 */
  readonly availabilityKind: CompletionAvailabilityKind
  /** 不可用提示（当 availabilityKind 不是 'available' 时）。 */
  readonly hint?: string
  /** 命令填充文本（选中后插入输入框的内容）。 */
  readonly fillText: string
  /** 路由标识（选中后标记为路由层可识别的显式命令）。 */
  readonly routingKey: string
}

// ===========================================================================
// 结构类型 — 补全结果
// ===========================================================================

/**
 * 补全结果：一次补全请求的返回。
 */
export interface CompletionResult {
  /** 补全类型。 */
  readonly kind: 'mention' | 'command'
  /** 候选列表（已排序、过滤、去重）。 */
  readonly candidates: readonly CompletionCandidate[]
  /** 实际返回的候选数。 */
  readonly count: number
  /** 是否有更多结果被截断。 */
  readonly truncated: boolean
}

/**
 * 补全候选：一条提及或命令候选。
 */
export type CompletionCandidate = CompletionMentionCandidate | CommandCandidate

/**
 * 提及候选：从 search_service.suggest() 派生。
 */
export interface CompletionMentionCandidate {
  /** 候选类型。 */
  readonly kind: 'mention'
  /** 实体类型。 */
  readonly entityType: MentionableEntityType
  /** 实体 ID。 */
  readonly entityId: number
  /** 可读标签。 */
  readonly label: string
  /** 摘要（可选）。 */
  readonly summary?: string
  /** 所属项目 ID。 */
  readonly projectId?: number
  /** 排序键。 */
  readonly sortKey: CompletionSortKey
}

/**
 * 命令候选：从双来源派生。
 */
export interface CommandCandidate {
  /** 候选类型。 */
  readonly kind: 'command'
  /** 命令描述符。 */
  readonly descriptor: CommandDescriptor
  /** 排序键。 */
  readonly sortKey: CompletionSortKey
}

// ===========================================================================
// 结构类型 — 排序键
// ===========================================================================

/**
 * 补全候选排序键：确定性排序依据。
 * 按 relevanceTier 降序 → impactSeverity 降序 → stableTieBreak 升序。
 */
export interface CompletionSortKey {
  /** 相关性档（critical > high > medium > low）。 */
  readonly relevanceTier: 'critical' | 'high' | 'medium' | 'low'
  /** 影响严重度（数值越高越重要）。 */
  readonly impactSeverity: number
  /** 稳定破平局键（字典序）。 */
  readonly stableTieBreak: string
}

// ===========================================================================
// 结构类型 — 输入状态
// ===========================================================================

/**
 * 输入补全状态：跟踪当前补全上下文。
 */
export interface InputCompletionState {
  /** 补全是否激活。 */
  readonly active: boolean
  /** 补全类型（mention 或 command）。 */
  readonly kind: 'mention' | 'command' | null
  /** 当前输入前缀（@ 或 / 之后的部分）。 */
  readonly prefix: string
  /** 选中的候选索引（-1 表示无选中）。 */
  readonly selectedIndex: number
  /** 当前候选列表。 */
  readonly candidates: readonly CompletionCandidate[]
  /** 触发位置在输入文本中的起始索引。 */
  readonly triggerOffset: number
}

// ===========================================================================
// 常量
// ===========================================================================

/** @ 提及触发字符。 */
export const MENTION_TRIGGER = '@' as const

/** / 斜杠命令触发字符。 */
export const COMMAND_TRIGGER = '/' as const

/** 默认最大候选数。 */
export const DEFAULT_MAX_CANDIDATES = 10

/** 输入去抖延迟（毫秒）。 */
export const DEBOUNCE_MS = 150

/** 候选列表最大宽度（字符数）。 */
export const MAX_CANDIDATE_LABEL_LENGTH = 60

// ===========================================================================
// 类型守卫
// ===========================================================================

/** 类型守卫：检查是否为有效的 MentionableEntityType。 */
export function isMentionableEntityType(value: unknown): value is MentionableEntityType {
  const VALID_TYPES: readonly string[] = [
    'project',
    'task',
    'milestone',
    'risk',
    'member',
    'document',
    'file',
    'report',
    'change_request',
    'comment',
    'ocr_document',
    'external_link',
  ]
  return typeof value === 'string' && VALID_TYPES.includes(value)
}

/** 类型守卫：检查是否为有效的 CommandSourceKind。 */
export function isCommandSourceKind(value: unknown): value is CommandSourceKind {
  return value === 'intent-catalog' || value === 'registered-command'
}

/** 类型守卫：检查是否为有效的 CompletionAvailabilityKind。 */
export function isCompletionAvailabilityKind(value: unknown): value is CompletionAvailabilityKind {
  return (
    value === 'available' ||
    value === 'not-permitted' ||
    value === 'not-enabled' ||
    value === 'authorization-gated'
  )
}

/** 类型守卫：检查是否为有效的 CompletionSortKey。 */
export function isValidCompletionSortKey(value: unknown): value is CompletionSortKey {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.relevanceTier === 'critical' ||
      v.relevanceTier === 'high' ||
      v.relevanceTier === 'medium' ||
      v.relevanceTier === 'low') &&
    typeof v.impactSeverity === 'number' &&
    typeof v.stableTieBreak === 'string'
  )
}

/** 类型守卫：检查是否为有效的 MentionReference。 */
export function isMentionReference(value: unknown): value is MentionReference {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isMentionableEntityType(v.entityType) &&
    typeof v.entityId === 'number' &&
    typeof v.label === 'string' &&
    typeof v.organizationId === 'number'
  )
}

/** 类型守卫：检查是否为有效的 CompletionMentionCandidate。 */
export function isMentionCandidate(value: unknown): value is CompletionMentionCandidate {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.kind === 'mention' &&
    isMentionableEntityType(v.entityType) &&
    typeof v.entityId === 'number' &&
    typeof v.label === 'string' &&
    isValidCompletionSortKey(v.sortKey)
  )
}

/** 类型守卫：检查是否为有效的 CommandCandidate。 */
export function isCommandCandidate(value: unknown): value is CommandCandidate {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.kind === 'command' &&
    typeof v.descriptor === 'object' &&
    v.descriptor !== null &&
    isValidCompletionSortKey(v.sortKey)
  )
}

// ===========================================================================
// 确定性 Helpers
// ===========================================================================

/**
 * 生成稳定的补全候选 ID。
 * mention: `mention:${entityType}:${entityId}`
 * command: `cmd:${id}`
 */
export function makeCompletionCandidateId(candidate: CompletionCandidate): string {
  if (candidate.kind === 'mention') {
    return `mention:${candidate.entityType}:${candidate.entityId}`
  }
  return `cmd:${candidate.descriptor.id}`
}

/**
 * 确定性排序键构造器。
 * 相关性档 → 影响严重度 → 稳定破平局键。
 */
export function makeCompletionSortKey(
  relevanceTier: CompletionSortKey['relevanceTier'],
  impactSeverity: number,
  stableTieBreak: string,
): CompletionSortKey {
  return { relevanceTier, impactSeverity, stableTieBreak }
}

/**
 * 相关性档排序权重。
 */
const TIER_WEIGHT: Record<CompletionSortKey['relevanceTier'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

/**
 * 确定性比较两个排序键。
 * 返回负数表示 a 排在 b 前面。
 */
export function compareSortKeys(a: CompletionSortKey, b: CompletionSortKey): number {
  const tierDiff = TIER_WEIGHT[a.relevanceTier] - TIER_WEIGHT[b.relevanceTier]
  if (tierDiff !== 0) return tierDiff

  const severityDiff = b.impactSeverity - a.impactSeverity
  if (severityDiff !== 0) return severityDiff

  return a.stableTieBreak.localeCompare(b.stableTieBreak)
}

/**
 * 确定性排序候选列表。
 */
export function sortCompletionCandidates<T extends CompletionCandidate>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => compareSortKeys(a.sortKey, b.sortKey))
}

// ===========================================================================
// 低敏 Sanitizer
// ===========================================================================

/**
 * 补全查询低敏摘要：只保留实体标识与类型，禁存原始输入全文。
 */
export interface CompletionQuerySummary {
  /** 补全类型。 */
  readonly kind: 'mention' | 'command'
  /** 前缀长度（不存前缀内容）。 */
  readonly prefixLength: number
  /** 返回候选数。 */
  readonly candidateCount: number
  /** 触发偏移量。 */
  readonly triggerOffset: number
}

/**
 * 补全选择低敏记录：只保留实体标识与类型。
 */
export interface CompletionSelectionRecord {
  /** 补全类型。 */
  readonly kind: 'mention' | 'command'
  /** 选中的候选 ID（实体类型:实体 ID 或命令 ID）。 */
  readonly candidateId: string
  /** 位次（从 0 开始）。 */
  readonly ordinal: number
  /** 可用性类别。 */
  readonly availabilityKind: CompletionAvailabilityKind
}

/**
 * Sanitize 补全查询：确保原始输入全文不进入任何契约字段。
 */
export function sanitizeCompletionQuery(
  kind: 'mention' | 'command',
  prefix: string,
  candidateCount: number,
  triggerOffset: number,
): CompletionQuerySummary {
  return {
    kind,
    prefixLength: prefix.length,
    candidateCount,
    triggerOffset,
  }
}

/**
 * Sanitize 补全选择：确保原始输入全文不被记录。
 */
export function sanitizeCompletionSelection(
  kind: 'mention' | 'command',
  candidate: CompletionCandidate,
  ordinal: number,
): CompletionSelectionRecord {
  return {
    kind,
    candidateId: makeCompletionCandidateId(candidate),
    ordinal,
    availabilityKind:
      candidate.kind === 'command' ? candidate.descriptor.availabilityKind : 'available',
  }
}

// ===========================================================================
// 路由层识别：显式命令格式
// ===========================================================================

/**
 * 路由层识别的显式斜杠命令前缀格式。
 * 选中命令后填充到输入框的内容须以此格式开头，
 * 使路由规则管线的「显式斜杠命令」最高优先级可达。
 */
export const ROUTING_EXPLICIT_COMMAND_PREFIX = '/' as const

/**
 * 构造路由层可识别的显式命令文本。
 * 格式：`/${routingKey}` + 可选附加参数。
 */
export function formatRoutingExplicitCommand(routingKey: string, suffix?: string): string {
  const base = `${ROUTING_EXPLICIT_COMMAND_PREFIX}${routingKey}`
  return suffix ? `${base} ${suffix}` : base
}

/**
 * 检查输入文本是否以显式命令格式开头。
 */
export function isExplicitCommandFormat(text: string): boolean {
  return text.startsWith(ROUTING_EXPLICIT_COMMAND_PREFIX) && text.length > 1
}

// ===========================================================================
// 孤儿引用清理（v3-copilot-live-submission-channel）
// ===========================================================================

/**
 * 清除孤儿引用：移除标签已不出现在文本中的结构化引用。
 *
 * 提到共享契约的原因：前端提交前清理与服务端复核前清理**必须同语义**，
 * 否则前端认为已清、服务端仍按孤儿计入被拒计数（或反之）。原实现只存在于
 * 后端 `copilot_action/mention_reference_validator.ts`，前端无从复用。
 *
 * 确定性纯函数：同输入同输出，保持原有相对顺序，不依赖时钟与随机源。
 */
export function pruneOrphanMentionRefs(
  text: string,
  refs: readonly MentionReference[],
): readonly MentionReference[] {
  return refs.filter((ref) => ref.label.length > 0 && text.includes(ref.label))
}
