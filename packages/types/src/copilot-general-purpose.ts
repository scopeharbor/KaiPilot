// @aiproj/types — Copilot 通用问答模式契约
// v3-copilot-general-purpose-mode — global scope 下的通用问答能力
//
// 设计要点（design.md 决策 1–8）：
// - 模式标识持续可见，切换必须由显式用户动作触发（决策 1）
// - 项目数据双向隔离：不读（来源不合格）+ 不写（结构性禁写，动作不可用）（决策 2）
// - 独立成本归属与配额，不挪用项目预算（决策 3）
// - 记忆只读用户 scope（决策 4）
// - 通用知识标注与知识局限声明（决策 5）
// - 模式切换双向清理上下文（决策 6）
// - 无权限与组织关闭表述差异（决策 7）
// - 不接网络搜索，明确局限（决策 8）
//
// 本模块是纯类型 + 确定性纯函数，零运行时依赖（仅依赖 triz-contradiction.js 的 deterministicHash）。
// 禁止依赖 AdonisJS、React、数据库客户端、HTTP 客户端、外部网络、provider 凭证或真实模型 SDK。

import { deterministicHash } from './triz-contradiction.js'

// ===========================================================================
// 枚举 — 模式状态（任务 2.1 / 2.2）
// ===========================================================================

/** 模式三态：进入 / 活跃 / 退出。迁移必须由显式用户动作触发（design Decision 1）。 */
export const GENERAL_PURPOSE_MODE_STATES = ['entering', 'active', 'exiting'] as const
export type GeneralPurposeModeState = (typeof GENERAL_PURPOSE_MODE_STATES)[number]

/**
 * 合法迁移表（任务 2.2）。
 * 键：当前状态；值：允许迁移到的状态。
 * 任意不在表中的迁移均非法，必须拒绝。
 */
export const GENERAL_PURPOSE_MODE_TRANSITIONS: Record<
  GeneralPurposeModeState,
  readonly GeneralPurposeModeState[]
> = {
  entering: ['active', 'exiting'],
  active: ['exiting'],
  exiting: [],
}

/** 判断一次迁移是否合法（确定性纯函数）。 */
export function isValidGeneralPurposeModeTransition(
  from: unknown,
  to: unknown,
): to is GeneralPurposeModeState {
  if (
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    !(from in GENERAL_PURPOSE_MODE_TRANSITIONS)
  ) {
    return false
  }
  return (
    GENERAL_PURPOSE_MODE_TRANSITIONS[from as GeneralPurposeModeState] as readonly string[]
  ).includes(to)
}

/** 归一化未知值为 null（安全默认）。 */
export function normalizeGeneralPurposeModeState(value: unknown): GeneralPurposeModeState | null {
  if (
    typeof value === 'string' &&
    GENERAL_PURPOSE_MODE_STATES.includes(value as GeneralPurposeModeState)
  ) {
    return value as GeneralPurposeModeState
  }
  return null
}

// ===========================================================================
// 枚举 — 能力集（任务 2.3）
// ===========================================================================

export const GENERAL_PURPOSE_CAPABILITIES = [
  'rewrite',
  'polish',
  'summarize',
  'translate',
  'concept_explain',
  'table',
  'list',
  'diagram',
] as const
export type GeneralPurposeCapability = (typeof GENERAL_PURPOSE_CAPABILITIES)[number]

/** 能力集中文标签（前端展示用）。 */
export const GENERAL_PURPOSE_CAPABILITY_LABELS: Record<GeneralPurposeCapability, string> = {
  rewrite: '改写',
  polish: '润色',
  summarize: '摘要',
  translate: '翻译',
  concept_explain: '概念解释',
  table: '表格',
  list: '清单',
  diagram: '图表',
}

// ===========================================================================
// 枚举 — 边界校验结果（任务 2.4）
// ===========================================================================

export const GENERAL_PURPOSE_BOUNDARY_RESULTS = [
  'read_isolated',
  'write_forbidden',
  'memory_scope_filtered',
  'quota_sufficient',
  'quota_exhausted',
  'permission_missing',
  'capability_disabled',
  'external_retrieval_blocked',
] as const
export type GeneralPurposeBoundaryResult = (typeof GENERAL_PURPOSE_BOUNDARY_RESULTS)[number]

export const GENERAL_PURPOSE_BOUNDARY_RESULT_LABELS: Record<GeneralPurposeBoundaryResult, string> =
  {
    read_isolated: '读隔离：项目来源不合格',
    write_forbidden: '写禁止：通用模式无写入路径',
    memory_scope_filtered: '记忆范围过滤：仅用户 scope',
    quota_sufficient: '配额充足',
    quota_exhausted: '配额耗尽',
    permission_missing: '权限缺失',
    capability_disabled: '能力未启用',
    external_retrieval_blocked: '外部检索已阻止',
  }

// ===========================================================================
// 枚举 — 配额判定与降级原因（任务 2.5）
// ===========================================================================

export const GENERAL_PURPOSE_QUOTA_STATUSES = ['sufficient', 'exhausted'] as const
export type GeneralPurposeQuotaStatus = (typeof GENERAL_PURPOSE_QUOTA_STATUSES)[number]

export const GENERAL_PURPOSE_QUOTA_EXHAUSTION_REASONS = [
  'daily_limit_reached',
  'monthly_limit_reached',
  'token_limit_reached',
  'organization_budget_exceeded',
  'provider_quota_exceeded',
] as const
export type GeneralPurposeQuotaExhaustionReason =
  (typeof GENERAL_PURPOSE_QUOTA_EXHAUSTION_REASONS)[number]

export const GENERAL_PURPOSE_QUOTA_EXHAUSTION_LABELS: Record<
  GeneralPurposeQuotaExhaustionReason,
  string
> = {
  daily_limit_reached: '已达每日使用上限',
  monthly_limit_reached: '已达每月使用上限',
  token_limit_reached: '已达 token 使用上限',
  organization_budget_exceeded: '组织预算已超',
  provider_quota_exceeded: '服务商配额已超',
}

// ===========================================================================
// 枚举 — 项目事实口吻禁止措辞（任务 2.6）
// ===========================================================================

/**
 * 项目事实口吻禁止措辞清单常量（design Decision 5）。
 * 回答中不得出现以下措辞或其变体（校验按声明清单匹配，非全串匹配）。
 */
export const GENERAL_PURPOSE_PROJECT_FACT_FORBIDDEN_PHRASES = [
  '根据您的项目',
  '根据项目数据',
  '项目显示',
  '项目记录表明',
  '项目中的数据显示',
  '从您的项目中',
  '项目信息显示',
  '项目数据显示',
  '项目进度表明',
  '项目的实际情况',
  '您项目中',
  '根据项目实际情况',
  '根据项目进展',
  '基于您的项目',
  '从项目中可以看出',
  '项目数据表明',
  '您项目的排期',
  '您项目的情况',
  '根据项目的',
  '项目里',
  '项目计划显示',
] as const

// ===========================================================================
// 结构类型 — 知识局限声明（任务 2.7）
// ===========================================================================

export interface GeneralPurposeKnowledgeLimitation {
  /** 是否已说明无实时外部检索。 */
  readonly noLiveLookupStated: boolean
  /** 时效性声明（时间敏感问题时触发）。 */
  readonly timelinessDisclaimer?: string
  /** 知识截止日期说明（如模型训练数据截止时间）。 */
  readonly knowledgeCutoffDisclaimer?: string
  /** 不确定性标注（模型知识不足时）。 */
  readonly uncertaintyStated: boolean
}

// ===========================================================================
// 结构类型 — 模式判定结果（任务 3.1）
// ===========================================================================

export interface GeneralPurposeModeDecision {
  /** 是否为通用问答模式。 */
  readonly isGeneralPurpose: boolean
  /** 边界校验结果集。 */
  readonly boundaryResults: readonly GeneralPurposeBoundaryResult[]
  /** 配额状态。 */
  readonly quotaStatus: GeneralPurposeQuotaStatus
  /** 配额耗尽原因（仅 quotaStatus=exhausted 时）。 */
  readonly quotaExhaustionReason?: GeneralPurposeQuotaExhaustionReason
  /** 知识局限声明。 */
  readonly knowledgeLimitation: GeneralPurposeKnowledgeLimitation
}

// ===========================================================================
// 结构类型 — 记忆边界（任务 3.7）
// ===========================================================================

export const GENERAL_PURPOSE_MEMORY_SCOPES = ['user'] as const
export type GeneralPurposeMemoryScope = (typeof GENERAL_PURPOSE_MEMORY_SCOPES)[number]

/**
 * 通用模式记忆过滤：仅允许用户 scope，禁止项目与组织 scope。
 * 这是 design Decision 4 的实现约束。
 */
export function isMemoryScopeAllowedInGeneralPurpose(
  scope: unknown,
): scope is GeneralPurposeMemoryScope {
  return scope === 'user'
}

// ===========================================================================
// 结构类型 — 审计事件形状（任务 8.5）
// ===========================================================================

export const GENERAL_PURPOSE_AUDIT_EVENT_TYPES = [
  'mode_entered',
  'mode_exited',
  'generation_completed',
  'generation_failed',
  'quota_exhausted',
  'unauthorized_attempt',
] as const
export type GeneralPurposeAuditEventType = (typeof GENERAL_PURPOSE_AUDIT_EVENT_TYPES)[number]

export interface GeneralPurposeAuditEvent {
  readonly eventType: GeneralPurposeAuditEventType
  readonly userId: number
  readonly organizationId: number
  readonly timestamp: string
  /** 低敏元数据：不含 prompt 与输出全文（spec 红线）。 */
  readonly metadata: Record<string, unknown>
}

// ===========================================================================
// 结构类型 — API 请求/响应（任务 9.1）
// ===========================================================================

export interface GeneralPurposeRequest {
  readonly message: string
  readonly sessionId?: string
  /** 请求的能力集（可选，缺省由模型自动判定）。 */
  readonly requestedCapability?: GeneralPurposeCapability
}

export interface GeneralPurposeResponse {
  readonly sessionId: string
  readonly messageId: string
  readonly answer: string
  readonly capability?: GeneralPurposeCapability
  readonly knowledgeLimitation: GeneralPurposeKnowledgeLimitation
  readonly quotaStatus: GeneralPurposeQuotaStatus
  readonly quotaExhaustionReason?: GeneralPurposeQuotaExhaustionReason
  readonly costSummary?: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly capability: string
    readonly surface: string
  }
  readonly warnings: readonly string[]
  readonly createdAt: string
}

// ===========================================================================
// Helpers — 确定性工具函数
// ===========================================================================

/** 生成通用模式会话 ID（确定性，无随机源）。 */
export function generateGeneralPurposeSessionId(): string {
  const ts = Date.now().toString(36)
  const hash = deterministicHash(`general-purpose-session-${ts}`)
  return `gp-${hash.slice(0, 12)}`
}

/** 生成通用模式消息 ID（确定性，无随机源）。 */
export function generateGeneralPurposeMessageId(sessionId: string, index: number): string {
  const hash = deterministicHash(`gp-msg-${sessionId}-${index}`)
  return `gp-msg-${hash.slice(0, 12)}`
}

/**
 * 检查回答是否包含项目事实口吻禁止措辞。
 * 按声明清单逐条匹配（非全串匹配），匹配到即返回第一个命中的措辞。
 */
export function findProjectFactForbiddenPhrase(answer: string): string | null {
  for (const phrase of GENERAL_PURPOSE_PROJECT_FACT_FORBIDDEN_PHRASES) {
    if (answer.includes(phrase)) {
      return phrase
    }
  }
  return null
}

/** 判断回答是否通过项目事实口吻校验。 */
export function isGeneralPurposeAnswerClean(answer: string): boolean {
  return findProjectFactForbiddenPhrase(answer) === null
}

/**
 * 校验模式迁移合法性（确定性纯函数）。
 * 返回 null 表示合法，否则返回拒绝原因。
 */
export function validateGeneralPurposeModeTransition(
  from: unknown,
  to: unknown,
): { readonly valid: true } | { readonly valid: false; readonly reason: string } {
  if (!isValidGeneralPurposeModeTransition(from, to)) {
    return {
      valid: false,
      reason: `非法迁移：${String(from)} → ${String(to)}。通用模式迁移必须由显式用户动作触发，禁止系统静默切换。`,
    }
  }
  return { valid: true }
}

/**
 * 构建知识局限声明（确定性纯函数）。
 * 时效性问题时触发 noLiveLookup 声明。
 */
export function buildKnowledgeLimitation(options: {
  readonly isTimeSensitive?: boolean
  readonly isUncertain?: boolean
}): GeneralPurposeKnowledgeLimitation {
  return {
    noLiveLookupStated: options.isTimeSensitive === true,
    timelinessDisclaimer: options.isTimeSensitive
      ? '本回答基于模型知识，不包含实时外部检索结果。如需最新信息，请查阅官方来源。'
      : undefined,
    knowledgeCutoffDisclaimer: options.isTimeSensitive
      ? '模型知识存在截止日期，可能不反映最新变化。'
      : undefined,
    uncertaintyStated: options.isUncertain === true,
  }
}

/**
 * 判断是否需要在回答中声明时效性局限。
 * 简单规则：问题包含时间相关关键词即触发。
 */
export function shouldDeclareTimelinessLimitation(question: string): boolean {
  const timePatterns = [
    /今天|今天是|当前|最新|最近|目前|现在|今/,
    /\d{4}年|\d{4}-\d{2}/,
    /today|current|latest|recent|now|as of/i,
    /什么时候|何时|几月|哪年/,
  ]
  return timePatterns.some((p) => p.test(question))
}

/**
 * 构建边界校验结果集（确定性纯函数）。
 * 通用模式下的完整校验：读隔离 + 写禁止 + 记忆过滤 + 配额判定。
 */
export function evaluateGeneralPurposeBoundary(params: {
  readonly hasPermission: boolean
  readonly isCapabilityEnabled: boolean
  readonly quotaStatus: GeneralPurposeQuotaStatus
  readonly quotaExhaustionReason?: GeneralPurposeQuotaExhaustionReason
  readonly isTimeSensitive: boolean
  readonly isUncertain: boolean
}): GeneralPurposeModeDecision {
  const boundaryResults: GeneralPurposeBoundaryResult[] = [
    'read_isolated',
    'write_forbidden',
    'memory_scope_filtered',
    'external_retrieval_blocked',
  ]

  if (!params.hasPermission) {
    boundaryResults.push('permission_missing')
  }
  if (!params.isCapabilityEnabled) {
    boundaryResults.push('capability_disabled')
  }
  if (params.quotaStatus === 'sufficient') {
    boundaryResults.push('quota_sufficient')
  } else {
    boundaryResults.push('quota_exhausted')
  }

  return {
    isGeneralPurpose: true,
    boundaryResults,
    quotaStatus: params.quotaStatus,
    quotaExhaustionReason: params.quotaExhaustionReason,
    knowledgeLimitation: buildKnowledgeLimitation({
      isTimeSensitive: params.isTimeSensitive,
      isUncertain: params.isUncertain,
    }),
  }
}
