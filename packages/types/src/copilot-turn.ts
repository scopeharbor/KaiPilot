/**
 * v3-copilot-live-submission-channel —— Copilot 回合契约。
 *
 * 定义回合请求与响应、上界常量、禁存约束、路由决策记录的显式转换、
 * 幂等键推导与 TPM 输入侧确定性估算。
 *
 * 本模块纯类型 + 确定性常量 + helpers，零运行时依赖，不含时钟与随机源。
 */

import type {
  ColleagueAppDestination,
  ColleagueUiPreferenceOptions,
} from './ai-colleague-app-map.js'
import type {
  CopilotScope,
  CopilotSessionAttribution,
  CopilotWarningCode,
  CopilotDegradedReason,
} from './copilot-shared-contracts.js'
import { computeCopilotIdempotencyKey } from './copilot-shared-contracts.js'
import type { MentionReference } from './copilot-input-completion.js'
import { DEFAULT_MAX_CANDIDATES } from './copilot-input-completion.js'
import { COPILLOT_SESSION_SUMMARY_MAX_LENGTH } from './copilot-session-persistence.js'
import type { CopilotRoutingDecisionRecord } from './copilot-intent-catalog.js'
import type {
  CopilotRouterAmbiguity,
  CopilotRouterDestination,
  CopilotClarificationItem,
  CopilotAssumptionEntrySimple,
  CopilotRoutingDecisionRecordSimple,
  CopilotRoutingStats,
} from './copilot-intent-router.js'
import type {
  CopilotAttachmentReference,
  CopilotAttachmentTurnSummary,
} from './copilot-attachment-contracts.js'
import {
  COPILOT_TURN_MAX_ATTACHMENT_REFS,
  validateAttachmentReferences,
} from './copilot-attachment-contracts.js'
import type { CopilotStructuredOutput } from './copilot-structured-output.js'
import type { CopilotWebSearchGateCode } from './copilot-web-search.js'
import type {
  CopilotPageContextDescriptorV1,
  CopilotPageContextDisclosureV1,
} from './copilot-page-context.js'

// ===========================================================================
// 上界常量（2.4）
// ===========================================================================

/** 回合文本上界。超界不报错，按有界摘要截断后持久化。 */
export const COPILOT_TURN_TEXT_MAX_LENGTH = 4000

/**
 * 单回合结构化提及引用数上界。
 *
 * 与补全候选上界（`DEFAULT_MAX_CANDIDATES`）同源：一次补全最多产出该数量候选，
 * 因此单回合引用数不应超过它，避免逐实体判权退化为无界查询（design 未决问题 2 的裁决）。
 */
export const COPILOT_TURN_MAX_MENTION_REFS = DEFAULT_MAX_CANDIDATES

/** 回合持久化摘要上界，与会话消息同一取值。 */
export const COPILOT_TURN_SUMMARY_MAX_LENGTH = COPILLOT_SESSION_SUMMARY_MAX_LENGTH

/** 回合模式：生产通道或本机演示降级。 */
export const COPILOT_TURN_MODES = ['live', 'demonstration'] as const
export type CopilotTurnMode = (typeof COPILOT_TURN_MODES)[number]

export type CopilotTurnResult =
  | {
      readonly kind: 'clarify'
      readonly items: readonly CopilotClarificationItem[]
    }
  | {
      readonly kind: 'route'
      readonly destinations: readonly CopilotRouterDestination[]
    }
  | {
      readonly kind: 'answer'
      readonly assistantMessageId: string
      readonly content: string
    }
  | {
      readonly kind: 'structured'
      readonly assistantMessageId: string
      readonly content: string
      readonly output: CopilotStructuredOutput
    }

// ===========================================================================
// 结构类型 — 回合请求（2.2）
// ===========================================================================

export interface CopilotTurnRequest {
  /** 会话 ID；null 表示新建会话。 */
  readonly sessionId: string | null
  readonly scope: CopilotScope
  readonly attribution: CopilotSessionAttribution
  /** 用户输入文本（超界由服务端按摘要上界截断后持久化）。 */
  readonly text: string
  /** 结构化提及引用。服务端不从文本二次解析实体（spec REQ）。 */
  readonly mentions: readonly MentionReference[]
  /** 附件引用（可选）。回合只携带引用，不接收 multipart（v3-copilot-attachment-and-ocr-input D1）。 */
  readonly attachments?: readonly CopilotAttachmentReference[]
  /** 显式斜杠命令（如 `/risk 新增`）。规则管线最高优先级的唯一入口。 */
  readonly slashCommand?: string
  /** 当前路由（用于上下文规则强度）。 */
  readonly currentRoute?: string
  /**
   * 版本化页面语境描述符（v3-copilot-authoritative-page-context）。
   *
   * 客户端只发送结构化可见状态（路由/项目/视图/筛选/排序/时间窗/选中实体/
   * 修订号），不发送 DOM 或整页 HTML。`currentRoute` 保持兼容：本字段缺席时
   * 行为与既有版本完全一致；在场时服务端以其为候选、重新授权解析。
   */
  readonly pageContext?: CopilotPageContextDescriptorV1
  /** 已完成澄清轮数（用于上界判定）。 */
  readonly clarificationRounds?: number
  /** 模型偏好（会话级，可选）。 */
  readonly modelPreference?: {
    readonly connectionId: number
    readonly modelId: number
    readonly reason?: string
  }
  /**
   * 本次回合是否允许使用外部网页搜索（按次同意）。
   *
   * 默认缺省 = 不同意。只有组织启用 + 配置 provider + 用户显式开启
   * （此处为 true）且 router 判断必要时，服务端才可能调用检索。
   */
  readonly webSearchConsent?: boolean
  /**
   * AI 同事应用地图（前端从界面目录实时生成、按权限过滤）：回答「XX 在哪里 / 怎么设置」
   * 以此为准。服务端只做形状清洗。
   */
  readonly appNavigation?: readonly ColleagueAppDestination[]
  /** 界面偏好可选值（浅/深色、密度、简繁体）。 */
  readonly uiPreferences?: ColleagueUiPreferenceOptions
  /**
   * AI 同事：是否允许问答模型把「要做事」的话交还操作执行器（缺省允许；
   * 执行器已判定「不是操作」后转来的问答传 false，避免来回推）。
   */
  readonly colleagueHandoff?: boolean
  /** AI 同事：当前页面的可见文字摘要（标题、按钮、表格行…；已截断），回答「这是什么」用。 */
  readonly pageVisibleText?: string
  /** AI 同事：当前页面截图的看图描述（用户点 📷 或 AI 看过页面后才有）。 */
  readonly pageVisualDescription?: string
}

// ===========================================================================
// 结构类型 — 回合响应（2.3）
// ===========================================================================

export interface CopilotTurnResponse {
  readonly sessionId: string
  readonly messageId: string
  readonly destinations: readonly CopilotRouterDestination[]
  readonly clarificationRequired: boolean
  readonly clarificationItems: readonly CopilotClarificationItem[]
  readonly assumptionEntries: readonly CopilotAssumptionEntrySimple[]
  readonly ambiguity: CopilotRouterAmbiguity | null
  readonly warnings: readonly CopilotWarningCode[]
  readonly degradedReason: CopilotDegradedReason | null
  /**
   * 被拒引用数。
   *
   * 只返回计数，不返回被拒实体的类型、ID、名称或原因明细——
   * 否则可用拒绝原因反推实体存在（spec REQ 非泄露）。
   */
  readonly rejectedReferenceCount: number
  readonly scope: CopilotScope
  /** 归一化意图摘要（有界低敏）。 */
  readonly intentSummary: string
  readonly stats: CopilotRoutingStats
  readonly mode: CopilotTurnMode
  /** 服务端权威终态；旧客户端可忽略。 */
  readonly result?: CopilotTurnResult
  /**
   * 附件处理摘要（可选）。
   * 仅在回合携带附件引用时返回；不含 OCR 原文（v3-copilot-attachment-and-ocr-input D4）。
   */
  readonly attachmentSummary?: CopilotAttachmentTurnSummary
  /**
   * 结构化产出块（可选）。
   *
   * 与文本结论并列的表格/清单/Mermaid 图三类结构化块。
   * 旧客户端忽略未知字段即可（向后兼容）。
   * 结构化块不含 prompt、模型输出全文、token 与 secret（spec REQ forbidden）。
   * 每行/每节点可追溯到 sourceRef（spec REQ traceability）。
   */
  readonly structuredOutput?: CopilotStructuredOutput
  /**
   * 模型降级信息（可选，仅在降级时返回）。
   *
   * 禁存约束：不含 prompt、模型输出、token 与 secret。
   */
  readonly modelFallback?: {
    /** 是否发生降级。 */
    readonly degraded: boolean
    /** 首选模型标识（可能不可用）。 */
    readonly preferredModelId?: number
    /** 实际使用的模型标识。 */
    readonly actualModelId: number
    /** 实际使用的模型名称。 */
    readonly actualModelName: string
    /** 降级原因（低敏）。 */
    readonly reason?: string
  }
  /**
   * 回合观测指标（可选，4.21）。
   *
   * 只给**数值**，供后续观察层（统一账本 / SLO 告警）消费，不含任何内容面：
   * 没有 prompt、没有模型输出、没有 token 明细、没有实体标识。
   * 旧客户端忽略未知字段即可（向后兼容）。
   */
  readonly turnMetrics?: CopilotTurnMetrics
  /**
   * 网页搜索门状态（可选，v3-copilot-optional-web-search-configuration）。
   *
   * 仅在「实际调用或降级」时返回 typed code + 可读文案；未配置工具、
   * 未涉及或 router 判断不需要时为 null。不含任何搜索词原文与 secret。
   */
  readonly webSearchStatus?: {
    readonly code: CopilotWebSearchGateCode
    readonly message: string
  } | null
  /**
   * 页面上下文披露（可选，v3-copilot-authoritative-page-context）。
   *
   * 服务端权威解析后的上下文透明信息：项目/页面/已应用与被忽略筛选/事实
   * 快照时间/上下文状态与固定隐私说明。旧客户端忽略未知字段即可。
   */
  readonly pageContextDisclosure?: CopilotPageContextDisclosureV1
}

/**
 * 回合观测指标（4.21）。
 *
 * 为什么只有这三个字段：
 * - `durationMs` 是**墙钟耗时**，观察层的第一指标（对齐 OTel `gen_ai.*` 的延迟面）；
 *   它天然每次不同，故**不属于**「同输入同输出」的判定面——路由与动作裁决不得读它。
 * - `ruleHitRate` 由既有 `stats` 确定性推导，不新增计算，也不新建表。
 * - `routedDestinationCount` 只给条数，不给 destination 名称：名称会随权限而变，
 *   计数不会（与 `rejectedReferenceCount` 同一条非泄露纪律）。
 */
export interface CopilotTurnMetrics {
  /** 回合墙钟耗时（毫秒，整数）。 */
  readonly durationMs: number
  /**
   * 规则命中率：`ruleHitCount / (ruleHitCount + fallbackCount)`。
   * 分母为 0 时返回 0（而不是 NaN——NaN 序列化成 null 会污染下游聚合）。
   * 保留三位小数，确定性可复现。
   */
  readonly ruleHitRate: number
  /** 本回合路由出的 destination 条数（只给计数）。 */
  readonly routedDestinationCount: number
}

/**
 * 由既有 `stats` 与耗时确定性推导回合观测指标（4.21）。
 *
 * 纪律：本函数**不读时钟**——`durationMs` 必须由调用方传入，
 * 这样单测可以给定值验证推导，而不必和墙钟赛跑。
 */
export function deriveTurnMetrics(input: {
  readonly stats: CopilotRoutingStats
  readonly durationMs: number
  readonly routedDestinationCount: number
}): CopilotTurnMetrics {
  const total = input.stats.ruleHitCount + input.stats.fallbackCount
  const rate = total <= 0 ? 0 : input.stats.ruleHitCount / total
  return {
    durationMs: Math.max(0, Math.round(input.durationMs)),
    ruleHitRate: Math.round(rate * 1000) / 1000,
    routedDestinationCount: Math.max(0, Math.round(input.routedDestinationCount)),
  }
}

// ===========================================================================
// 禁存约束（2.5 / 2.6）
// ===========================================================================

/**
 * 回合契约禁存的键名类别。命中即视为不合规。
 * 与统一账本的禁存键类别同源纪律：只留 ref/hash/count/status。
 */
export const COPILOT_TURN_FORBIDDEN_KEYS = [
  'prompt',
  'prompts',
  'completion',
  'completions',
  'rawInput',
  'raw_input',
  'modelOutput',
  'model_output',
  'apiKey',
  'api_key',
  'token',
  'tokens',
  'secret',
  'systemInstructions',
  'system_instructions',
] as const

/**
 * 有界低敏摘要：截断到上界并去除首尾空白。
 * 确定性：同输入同输出，不依赖时钟与随机源。
 */
export function boundedTurnSummary(
  text: string,
  max: number = COPILOT_TURN_SUMMARY_MAX_LENGTH,
): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max)
}

/**
 * 低敏校验：序列化后检查禁存键名与敏感样本。
 * 任一命中即不合规（2.6 负例测试用）。
 */
export function containsForbiddenTurnPayload(
  payload: unknown,
  sensitiveSamples: readonly string[] = [],
): boolean {
  const serialized = JSON.stringify(payload ?? null)
  for (const key of COPILOT_TURN_FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key}":`)) return true
  }
  for (const sample of sensitiveSamples) {
    if (sample.length > 0 && serialized.includes(sample)) return true
  }
  return false
}

/**
 * 结构化产出块禁存校验。
 *
 * 复用 `containsForbiddenTurnPayload` 的序列化检查逻辑，
 * 但限定于结构化块的特定上下文：检查 prompt、模型输出全文、token 与 secret。
 * 结构化块的禁存纪律与回合响应一致（2.6 禁存键类别同源）。
 */
export function containsForbiddenStructuredOutput(
  structuredOutput: unknown,
  sensitiveSamples: readonly string[] = [],
): boolean {
  if (containsForbiddenTurnPayload(structuredOutput, sensitiveSamples)) return true

  // 结构化块的泄漏更常发生在**值**里而不是键名里：表格单元格、清单条目文本、
  // Mermaid 文本都是自由文本，往里写一句「token: sk-...」不会产生任何 JSON 键，
  // 只查键名的话这类泄漏全部漏检。这里补一层值级检测：禁存词后紧跟冒号的标签式写法。
  // 取舍是明确的——误伤一个合法单元格只是挡下一个块，漏检一次是把 secret 落库。
  const serialized = JSON.stringify(structuredOutput ?? null)
  return buildForbiddenKeyLabelPattern().test(serialized)
}

/**
 * 值级禁存标签模式：禁存词后紧跟半角或全角冒号的自由文本写法（大小写不敏感）。
 * 每次调用新建实例，避免正则实例被跨调用共享而带上状态。
 */
export function buildForbiddenKeyLabelPattern(): RegExp {
  return new RegExp('\\b(' + COPILOT_TURN_FORBIDDEN_KEYS.join('|') + ')\\s*[:：]', 'i')
}

// ===========================================================================
// 路由决策记录的显式转换（2.7 / 2.8）
// ===========================================================================

/**
 * 路由决策记录字段集合。
 *
 * `CopilotRoutingDecisionRecordSimple`（路由器产出）与
 * `CopilotRoutingDecisionRecord`（账本消费）字段列表一致，差别仅在
 * `unavailabilityKinds` 一侧用内联字面量联合、另一侧用具名类型。
 *
 * 因此转换是结构性的——但**必须显式列举字段而非类型断言**：
 * 断言会让任一侧增删字段静默漂移（design D1 的类型事实）。
 */
export const COPILOT_ROUTING_RECORD_FIELDS = [
  'recordId',
  'catalogVersion',
  'intentClass',
  'subIntentId',
  'intentSummary',
  'destinationOrder',
  'confidences',
  'clarificationRoundCount',
  'ambiguous',
  'unavailabilityKinds',
  'ruleHitCount',
  'fallbackCount',
  'userRerouted',
  'scope',
] as const

/** 显式逐字段转换。禁止 `as` 断言。 */
export function toRoutingDecisionRecord(
  simple: CopilotRoutingDecisionRecordSimple,
): CopilotRoutingDecisionRecord {
  return {
    recordId: simple.recordId,
    catalogVersion: simple.catalogVersion,
    intentClass: simple.intentClass,
    subIntentId: simple.subIntentId,
    intentSummary: simple.intentSummary,
    destinationOrder: simple.destinationOrder,
    confidences: simple.confidences,
    clarificationRoundCount: simple.clarificationRoundCount,
    ambiguous: simple.ambiguous,
    unavailabilityKinds: simple.unavailabilityKinds,
    ruleHitCount: simple.ruleHitCount,
    fallbackCount: simple.fallbackCount,
    userRerouted: simple.userRerouted,
    scope: simple.scope,
  }
}

// ===========================================================================
// 幂等键（4.14）
// ===========================================================================

/**
 * 回合幂等键：由输入元组确定性推导，复用共享 hash helper。
 *
 * 元组含归一化文本、会话 ID、斜杠命令、排序后的引用键与 actor——
 * 重放同一输入产出同一键，账本与消息各只落一条。
 */
export function deriveTurnIdempotencyKey(params: {
  readonly normalizedText: string
  readonly sessionId: string | null
  readonly slashCommand?: string
  readonly mentions: readonly MentionReference[]
  readonly actorId: number
}): string {
  const refKeys = params.mentions
    .map((m) => `${m.entityType}:${m.entityId}`)
    .slice()
    .sort()
  const payload = `${params.sessionId ?? ''}|${params.slashCommand ?? ''}|${params.normalizedText}`
  return computeCopilotIdempotencyKey(payload, refKeys, params.actorId)
}

// ===========================================================================
// TPM 输入侧确定性估算（8.1）
// ===========================================================================

/**
 * 每 token 的近似字节数。
 *
 * 简体中文在 UTF-8 下多为 3 字节/字，而主流 tokenizer 对中文约 1–1.5 字/token，
 * 故按 2 字节/token 取偏保守的上界估算。**不引入模型 tokenizer**（A3：不新增运行时依赖）。
 */
export const COPILOT_TURN_BYTES_PER_TOKEN = 2

/** 回合固定开销 token（系统侧模板与结构化包裹的稳定上界）。 */
export const COPILOT_TURN_OVERHEAD_TOKENS = 256

/**
 * 输入侧 token 估算。
 *
 * 确定性纯函数：同输入同值，不依赖时钟与随机源。偏差由既有 postflight
 * 的偏差记录承担，preflight 只需一个稳定上界（design D9）。
 */
export function estimateTurnTokens(params: {
  readonly normalizedText: string
  readonly contextBytes: number
}): number {
  const textBytes = utf8ByteLength(params.normalizedText)
  const contextBytes = Number.isFinite(params.contextBytes)
    ? Math.max(0, Math.trunc(params.contextBytes))
    : 0
  const total = textBytes + contextBytes
  return COPILOT_TURN_OVERHEAD_TOKENS + Math.ceil(total / COPILOT_TURN_BYTES_PER_TOKEN)
}

/** UTF-8 字节长度（不依赖 Buffer，前后端同源可用）。 */
export function utf8ByteLength(input: string): number {
  let bytes = 0
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code <= 0xffff) bytes += 3
    else bytes += 4
  }
  return bytes
}

// ===========================================================================
// 请求形状校验（2.4 上界执行）
// ===========================================================================

export interface CopilotTurnShapeViolation {
  readonly field: 'text' | 'mentions' | 'slashCommand' | 'attachments'
  readonly reason: 'empty' | 'too-long' | 'too-many' | 'invalid'
}

/**
 * 形状校验：文本非空且不超上界、引用数不超上界、附件引用数不超上界。
 * 返回违规列表（空数组 = 合规）。确定性纯函数。
 */
export function validateTurnRequestShape(
  request: Pick<CopilotTurnRequest, 'text' | 'mentions' | 'slashCommand' | 'attachments'>,
): readonly CopilotTurnShapeViolation[] {
  const violations: CopilotTurnShapeViolation[] = []
  const text = request.text.trim()
  if (text.length === 0) {
    violations.push({ field: 'text', reason: 'empty' })
  } else if (text.length > COPILOT_TURN_TEXT_MAX_LENGTH) {
    violations.push({ field: 'text', reason: 'too-long' })
  }
  if (request.mentions.length > COPILOT_TURN_MAX_MENTION_REFS) {
    violations.push({ field: 'mentions', reason: 'too-many' })
  }
  if (request.slashCommand !== undefined && request.slashCommand.trim().length === 0) {
    violations.push({ field: 'slashCommand', reason: 'empty' })
  }
  // 附件引用校验（v3-copilot-attachment-and-ocr-input）
  const attachments = request.attachments
  if (attachments !== undefined) {
    if (!Array.isArray(attachments)) {
      violations.push({ field: 'attachments', reason: 'invalid' })
    } else if (attachments.length > COPILOT_TURN_MAX_ATTACHMENT_REFS) {
      violations.push({ field: 'attachments', reason: 'too-many' })
    } else {
      // 逐条校验引用形状
      const { rejected } = validateAttachmentReferences(attachments)
      if (rejected.length > 0) {
        violations.push({ field: 'attachments', reason: 'invalid' })
      }
    }
  }
  return violations
}
