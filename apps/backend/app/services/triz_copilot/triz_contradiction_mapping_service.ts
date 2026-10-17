// v3-triz-contradiction-copilot W1 —— AI-as-ARIZ 矛盾语义映射服务（tasks 1.4）。
//
// 职责（design「架构（AI-as-ARIZ-Engine）」的「TrizContradictionMappingService —— AI-as-ARIZ 语义映射」
// 一行 + spec「AI-as-ARIZ 后台语义映射」第 1/2/3 条、「确定性回退与路径诚实披露」、「反幻觉与低敏审计边界」）：
// - **模型路径**经既有 `AIGateway`（`resolveAdapter` 解析 → `gateway.generate`，strategy='native'
//   带 JSON Schema），产出受**强 Schema** 约束的映射：contradictionType / 改善参数 / 恶化参数 /
//   候选原则（含排序）/ confidence / path / contextRefs；
// - **反幻觉关卡**：模型只允许输出**闭集编号**（1–39 参数、1–40 原则）与 `kind:id` 形态的实体引用；
//   参数名与原则名一律取自知识包而非模型文本；`contextRefs` 的每个引用必须通过 1.3 的
//   `isContextRefWhitelisted` 白名单校验，未通过即丢弃并**只记计数**（不记正文）；
// - **诚实披露**：真实模型未启用（`AIPROJ_TRIZ_ENABLE_REAL_AI` 门）、无 `ai:trigger`、预算阻断、
//   模型通道不可用、调用失败、调用超时、输出未过 Schema —— spec 的五类触发加两类细分共七类，
//   一律落到确定性规则路径并置 `path: 'rule'`，
//   响应携带触发原因；规则路径零 Token、零网络调用（`providerCalls = 0`）；
//   用量口径：未发出任何模型调用时 `totalTokens` 精确为 0，已发出调用时如实披露供应商回报值、
//   未回报时保持 null（未知不等于零消耗）——1.6 的触发矩阵与两侧 Schema 一致性单测逐条断言；
// - **人工确认关卡**：本服务**只产草案**（`persisted: false` / `requiresHumanConfirmation: true`），
//   模块内没有任何数据访问与写入端口；落库走 2.x 的「预览 → 人工确认 → 单事务」链路。
//
// 边界：不读写业务表、不做落库权限判定（2.2 的 Policy 承担）、不改既有 TRIZ 端点与数据语义（双轨 D23）。
// 常量默认值只允许收紧：单次分析模型 Token 预算 4000 与请求超时等上限见 `TRIZ_MAPPING_LIMITS`。

import { createHash } from 'node:crypto'
import { z } from 'zod'
import app from '@adonisjs/core/services/app'
import type { BudgetPreflightInput, BudgetPreflightResult } from '@aiproj/types'
import { ValidationException } from '#exceptions/api_exception'
import { AI_TRIGGER } from '#rbac'
import RbacService from '#services/rbac_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import {
  AiConnectionRequiredException,
  assertAiConnectionAvailable,
} from '#services/ai_m0/ai_connection_requirement'
import {
  TRIZ_KNOWLEDGE_PACK_VERSION,
  TRIZ_PARAMETERS,
  TRIZ_PM_CLASSIC_SCENARIOS,
  TRIZ_PM_CONTRAIDCTION_PAIRS,
  TRIZ_PRINCIPLES,
} from './knowledge/index.js'
import {
  searchParameterByNumber,
  searchPrincipleByNumber,
} from './triz_knowledge_search_service.js'
import {
  isContextRefWhitelisted,
  type TrizContextEntityKind,
  type TrizContextPack,
  type TrizContextPermissionChecker,
} from './triz_context_pack_service.js'

// ---------------------------------------------------------------------------
// 枚举、能力面与限额
// ---------------------------------------------------------------------------

/** 矛盾类型闭集（spec「AI-as-ARIZ 后台语义映射」第 1 条：管理 / 技术 / 物理三者之一）。 */
export const TRIZ_CONTRADICTION_TYPES = ['administrative', 'technical', 'physical'] as const
export type TrizContradictionType = (typeof TRIZ_CONTRADICTION_TYPES)[number]

/** 矛盾类型的中文标签（呈现层用语，参数与原则的中文名一律取自知识包）。 */
export const TRIZ_CONTRADICTION_TYPE_LABELS: Readonly<Record<TrizContradictionType, string>> = {
  administrative: '管理矛盾',
  technical: '技术矛盾',
  physical: '物理矛盾',
}

/** 结果路径闭集：模型推理（`ai`）/ 确定性规则（`rule`）。规则路径 MUST NOT 冒充模型推理。 */
export const TRIZ_MAPPING_PATHS = ['ai', 'rule'] as const
export type TrizMappingPath = (typeof TRIZ_MAPPING_PATHS)[number]

/** 能力面标识：既有预算守卫与账本按 capability 归属，本服务沿用该字段（不新建预算体系）。 */
export const TRIZ_MAPPING_CAPABILITY = 'triz_contradiction_mapping'

/** 观测面标识（落账用的 surface 字段）。 */
export const TRIZ_MAPPING_SURFACE = 'triz_copilot_mapping'

/** contextRefs 的规范形态：`<kind>:<id>`，与 1.3 白名单 ref 形态一致。 */
export const TRIZ_MAPPING_CONTEXT_REF_PATTERN =
  /^(task|risk|resource|milestone|change_request):\d+$/

/** 确定性回退的触发原因闭集（spec「确定性回退与路径诚实披露」第 1 条的五类触发 + 通道不可用 / 输出非法两类细分）。 */
export const TRIZ_MAPPING_FALLBACK_REASONS = [
  /** 真实模型未启用（AIPROJ_TRIZ_ENABLE_REAL_AI 门，默认状态） */
  'MODEL_DISABLED',
  /** 调用方无 ai:trigger 权限 */
  'NO_AI_TRIGGER',
  /** 组织预算耗尽 / 触发限流 / 单次分析 Token 预算阻断 */
  'BUDGET_EXHAUSTED',
  /** 模型通道不可用（未配置真实连接，或适配器解析失败 / 只解析到 mock 适配器） */
  'MODEL_UNAVAILABLE',
  /** 模型调用异常 */
  'MODEL_FAILED',
  /** 模型调用超时 */
  'MODEL_TIMEOUT',
  /** 模型输出未通过强 Schema（含非 JSON、字段缺失、编号越界） */
  'MODEL_OUTPUT_INVALID',
] as const
export type TrizMappingFallbackReason = (typeof TRIZ_MAPPING_FALLBACK_REASONS)[number]

/** 质量标记：不触发整体降级，但必须在草案上如实标注（供前端徽标与 2.x 观测计数）。 */
export const TRIZ_MAPPING_QUALITY_FLAGS = [
  /** 陈述信息不足，无法解析出参数对 */
  'INSUFFICIENT_INPUT',
  /** 多条映射并列最高分，参数对存在歧义 */
  'AMBIGUOUS_STATEMENT',
  /** 模型给出的参数编号不在知识包内（已置空） */
  'PARAMETER_NOT_IN_PACK',
  /** 命中编号不在知识包内的原则（已丢弃） */
  'PRINCIPLE_NOT_IN_PACK',
  /** 存在未通过上下文白名单的实体引用（已丢弃） */
  'CONTEXT_REFS_REJECTED',
  /** 陈述超过上限被截断 */
  'STATEMENT_TRUNCATED',
  /** 没有任何候选原则 */
  'NO_CANDIDATE_PRINCIPLE',
  /** 置信度低于可信下限（0.4），需人工判断 */
  'LOW_CONFIDENCE',
] as const
export type TrizMappingQualityFlag = (typeof TRIZ_MAPPING_QUALITY_FLAGS)[number]

export interface TrizMappingLimits {
  /** 陈述最大字符数：超出即截断（低敏，不落原文） */
  maxStatementChars: number
  /** 上下文引用上限 */
  maxContextRefs: number
  /** 候选原则上限（呈现层只给 Top 3，映射层保留候选取全量上限） */
  maxCandidatePrinciples: number
  /** 进 prompt 的实体引用上限 */
  maxPromptEntityRefs: number
  /** 规则路径绑定的证据引用上限 */
  maxRuleContextRefs: number
  /** 单次模型调用的最大输出 Token */
  maxOutputTokens: number
  /** 单次模型调用的请求超时（毫秒） */
  requestTimeoutMs: number
  /** 单次分析模型侧 Token 预算上限（design D7 原默认 4000；2026-09-26 起默认 64000，调用方仍只能收紧） */
  runTokenBudget: number
}

export const TRIZ_MAPPING_LIMITS: Readonly<TrizMappingLimits> = {
  maxStatementChars: 1200,
  maxContextRefs: 20,
  maxCandidatePrinciples: 12,
  maxPromptEntityRefs: 40,
  maxRuleContextRefs: 5,
  // 2026-09-26 放开：思考模型的推理与正文共享输出额度，原 900 / 4000 常在给出结论前耗尽
  maxOutputTokens: 16_000,
  requestTimeoutMs: 600_000,
  runTokenBudget: 64_000,
}

/** 预算下限：即便调用方传入更小的上限，也不会把链路压到无法完成一次调用。 */
const MIN_RUN_TOKEN_BUDGET = 256
const MIN_REQUEST_TIMEOUT_MS = 1
const MIN_STATEMENT_CHARS = 16

/**
 * 解析生效限额：默认值只允许**收紧**，调用方传入更大的值一律忽略（与 1.3 同口径，design D7）。
 */
export function resolveTrizMappingLimits(
  overrides?: Partial<TrizMappingLimits>,
): TrizMappingLimits {
  const resolved: TrizMappingLimits = { ...TRIZ_MAPPING_LIMITS }
  if (!overrides) return resolved
  for (const key of Object.keys(TRIZ_MAPPING_LIMITS) as (keyof TrizMappingLimits)[]) {
    const value = overrides[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const tightened = Math.floor(value)
    if (tightened < 1) continue
    if (tightened < resolved[key]) resolved[key] = tightened
  }
  if (resolved.runTokenBudget < MIN_RUN_TOKEN_BUDGET) {
    resolved.runTokenBudget = MIN_RUN_TOKEN_BUDGET
  }
  if (resolved.requestTimeoutMs < MIN_REQUEST_TIMEOUT_MS) {
    resolved.requestTimeoutMs = MIN_REQUEST_TIMEOUT_MS
  }
  if (resolved.maxStatementChars < MIN_STATEMENT_CHARS) {
    resolved.maxStatementChars = MIN_STATEMENT_CHARS
  }
  return resolved
}

// ---------------------------------------------------------------------------
// 强 Schema（模型输出的唯一入口闸门）
// ---------------------------------------------------------------------------

/**
 * 模型输出 Schema：**强约束 + 拒绝多余字段**。
 *
 * 设计要点（反幻觉第一道栅栏）：模型只能引用闭集编号与规范实体引用，不允许输出自由文本，
 * 因此模型无法编造参数名、原则名或实体名称——名称全部由知识包与上下文包给出。
 */
export const trizMappingModelOutputSchema = z.strictObject({
  contradictionType: z.enum(TRIZ_CONTRADICTION_TYPES),
  improvingParameterNumber: z.number().int().min(1).max(39),
  worseningParameterNumber: z.number().int().min(1).max(39),
  candidatePrinciples: z.array(z.number().int().min(1).max(40)).min(1).max(12),
  confidence: z.number().min(0).max(1),
  contextRefs: z.array(z.string().regex(TRIZ_MAPPING_CONTEXT_REF_PATTERN)).max(20),
})

export type TrizMappingModelOutput = z.infer<typeof trizMappingModelOutputSchema>

export type TrizMappingParseResult =
  { ok: true; value: TrizMappingModelOutput } | { ok: false; issues: string[] }

/** 去掉模型可能包裹的 Markdown 代码围栏（策略 native 本应直出 JSON，此处只做防御性归一）。 */
function stripCodeFence(rawText: string): string {
  const trimmed = rawText.trim()
  if (!trimmed.startsWith('```')) return trimmed
  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*\s*/, '')
  const closingIndex = withoutOpening.lastIndexOf('```')
  return (closingIndex >= 0 ? withoutOpening.slice(0, closingIndex) : withoutOpening).trim()
}

/**
 * 解析并校验模型输出。失败只回传**问题位置 + 问题码**（不含模型正文，RL-12）。
 */
export function parseTrizMappingModelOutput(rawText: string): TrizMappingParseResult {
  const jsonText = stripCodeFence(typeof rawText === 'string' ? rawText : '')
  if (jsonText.length === 0) return { ok: false, issues: ['$:empty_output'] }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, issues: ['$:not_json'] }
  }

  const result = trizMappingModelOutputSchema.safeParse(parsed)
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues
        .slice(0, 20)
        .map((issue) => `${issue.path.join('.') || '$'}:${issue.code}`),
    }
  }
  return { ok: true, value: result.data }
}

/** 模型输出的 JSON Schema（随请求下发给支持强 Schema 的供应商）。 */
export function trizMappingModelJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(trizMappingModelOutputSchema) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 草案结构（强 Schema 的业务形态）
// ---------------------------------------------------------------------------

/** 参数引用：编号 + 中文名 + 现代语汇名 + PM 释义，全部取自知识包。 */
export interface TrizParameterRef {
  number: number
  nameZh: string
  displayName: string
  pmMeaning: string
}

/** 候选原则引用：含排序（rank 从 1 起）与知识包溯源字段（RL-10）。 */
export interface TrizCandidatePrincipleRef {
  rank: number
  number: number
  nameZh: string
  displayName: string
  definition: string
  source: string
}

/** 上下文引用的白名单校验结论：只记**计数**，不记被拒正文（RL-12）。 */
export interface TrizContextRefValidation {
  accepted: number
  rejected: number
}

export interface TrizContradictionMappingDraft {
  /** 结果路径：模型推理（ai）或确定性规则（rule），前端以可见徽标区分 */
  path: TrizMappingPath
  contradictionType: TrizContradictionType
  contradictionTypeLabel: string
  /** 改善参数；信息不足时为 null（不编造） */
  improvingParameter: TrizParameterRef | null
  /** 恶化参数；信息不足时为 null（不编造） */
  worseningParameter: TrizParameterRef | null
  /** 候选原则（按推荐度排序，rank 从 1 起；未进 Top 3 的原则号也在此列） */
  candidatePrinciples: TrizCandidatePrincipleRef[]
  /** 0–1 置信度：规则路径上限 0.8，模型路径为模型自评（并受可用性下调） */
  confidence: number
  /** 已通过上下文白名单的项目实体引用 */
  contextRefs: string[]
  contextRefValidation: TrizContextRefValidation
  /** 命中的知识包映射标识（规则路径：PM-0x / CLASSIC-x；模型路径为空） */
  sourceMappingIds: string[]
  /** 命中映射的来源章节标注（知识包自带，RL-10） */
  sourceSections: string[]
  /** 人工确认关卡：本服务只产草案，落库必须经 2.x 的两阶段确认 */
  requiresHumanConfirmation: true
  /** 显式声明零落库：本服务无任何写入端口 */
  persisted: false
  /** 是否需要向 PM 澄清（信息不足时为真） */
  needsClarification: boolean
  /** 回退触发原因（仅在 path='rule' 时非空） */
  fallbackReasons: TrizMappingFallbackReason[]
  qualityFlags: TrizMappingQualityFlag[]
  /** 陈述摘要（SHA-256 前 32 位十六进制），原文不落库不落草案（RL-12） */
  statementDigest: string
  /** 归一化后的陈述长度（已按上限截断，截断事实见 statementTruncated） */
  statementLength: number
  statementTruncated: boolean
  knowledgePackVersion: string
}

/** 落库投影：2.1 表字段契约中的低敏子集（只有编号 / 枚举 / 摘要 / 引用，无任何全文）。 */
export interface TrizMappingLowSensitivityRecord {
  contradictionType: TrizContradictionType
  improvingParameterNumber: number | null
  worseningParameterNumber: number | null
  candidatePrincipleNumbers: number[]
  path: TrizMappingPath
  confidence: number
  contextRefs: string[]
  statementDigest: string
  statementLength: number
  knowledgePackVersion: string
  /** 人工改判位：本服务恒为 false（改判属 2.2 / 5.3 的独立链路） */
  humanOverride: false
}

export interface TrizMappingModelUsage {
  /** provider 调用次数：规则路径恒为 0（自动化测试据此断言） */
  providerCalls: number
  provider: string | null
  model: string | null
  /** 送模型前的确定性 Token 估算（输入 + 最大输出）；未走到模型路径时为 0 */
  estimatedTokens: number
  /**
   * 本次分析的模型 Token 用量：未发出任何调用时精确为 0（确定性回退零 Token 可直接断言）；
   * 已发出调用且供应商回报用量时如实披露，未回报时为 null（**不回填 0**，避免把未知伪报成零消耗）。
   */
  totalTokens: number | null
}

export interface TrizContradictionMappingResult {
  mapping: TrizContradictionMappingDraft
  modelUsage: TrizMappingModelUsage
  /** 供 2.1 落库使用的低敏投影；本服务不落库 */
  lowSensitivityRecord: TrizMappingLowSensitivityRecord
}

// ---------------------------------------------------------------------------
// 模型通道端口（默认经既有 AIGateway 实现；测试注入假实现，零真实调用）
// ---------------------------------------------------------------------------

export interface TrizMappingGenerationRequest {
  systemPrompt: string
  userPrompt: string
  jsonSchema: Record<string, unknown>
  maxOutputTokens: number
  requestTimeoutMs: number
  signal: AbortSignal
}

export interface TrizMappingGenerationResponse {
  rawText: string
  provider: string | null
  model: string | null
  totalTokens: number | null
  usingRealAdapter: boolean
}

/** 模型通道端口：把 `AIGateway.generate` 收敛成单方法，便于用 fixture 断言零真实调用。 */
export interface TrizMappingModelPort {
  generate(request: TrizMappingGenerationRequest): Promise<TrizMappingGenerationResponse>
}

/** 预算门端口：入参/出参与既有 `UnifiedBudgetGuard.preflight` 同形，可直接接线（2.3）。 */
export interface TrizMappingBudgetInput {
  organizationId: number
  projectId: number
  userId: number | null
  capability: string
  surface: string
  estimatedTokens: number
  estimatedCost: number
  idempotencyKey: string
  ledgerAttemptRef: string | null
}

export interface TrizMappingBudgetDecision {
  allowed: boolean
  outcome: string
  reasonCode: string | null
  reason: string | null
}

export interface TrizMappingBudgetGate {
  preflight(input: TrizMappingBudgetInput): Promise<TrizMappingBudgetDecision>
}

/**
 * 把既有 `UnifiedBudgetGuard` 接线成映射服务的预算门（结构兼容，无需新建预算体系）。
 * 决策记录由守卫自身持久化，本窄端口只取结论。
 */
export function createUnifiedBudgetGate(guard: {
  preflight(input: BudgetPreflightInput): Promise<BudgetPreflightResult>
}): TrizMappingBudgetGate {
  return {
    async preflight(input: TrizMappingBudgetInput): Promise<TrizMappingBudgetDecision> {
      const result = await guard.preflight({
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        capability: input.capability,
        surface: input.surface,
        estimatedCost: input.estimatedCost,
        estimatedTokens: input.estimatedTokens,
        idempotencyKey: input.idempotencyKey,
        ledgerAttemptRef: input.ledgerAttemptRef,
      })
      return {
        allowed: result.allowed,
        outcome: String(result.outcome),
        reasonCode: result.reasonCode ?? null,
        reason: result.reason ?? null,
      }
    },
  }
}

/**
 * 默认预算门：只做**单次分析 Token 预算**（design D7 的 4000 上限）的确定性检查。
 * 组织级预算由 2.3 通过 `createUnifiedBudgetGate` 接入（本函数不做默认放行之外的假设）。
 */
export function createRunTokenBudgetGate(budget: number): TrizMappingBudgetGate {
  return {
    async preflight(input: TrizMappingBudgetInput): Promise<TrizMappingBudgetDecision> {
      const estimated = Number.isFinite(input.estimatedTokens)
        ? Math.max(0, Math.ceil(input.estimatedTokens))
        : 0
      const allowed = estimated <= budget
      return {
        allowed,
        outcome: allowed ? 'allow' : 'block',
        reasonCode: allowed ? null : 'run_token_budget_exceeded',
        reason: allowed
          ? null
          : `单次分析模型 Token 预算 ${budget} 不足（本次估算 ${estimated}），已改用确定性规则路径`,
      }
    },
  }
}

/**
 * 默认模型通道：经既有 `resolveAdapter` 解析真实适配器，再经 `AIGateway.generate` 生成。
 * 只解析到 mock/fake 适配器时返回 null（RL-13：mock 结果不得充当真实模型路径）。
 */
export async function createAIGatewayMappingPort(args: {
  organizationId: number
  projectId: number
  userId: number
  estimatedTokens: number
  idempotencyKey: string
}): Promise<TrizMappingModelPort | null> {
  const resolved = await resolveAdapter({
    organizationId: args.organizationId,
    requiredCapabilities: ['structured_output'],
    estimatedTokens: args.estimatedTokens,
    recordContext: {
      organizationId: args.organizationId,
      projectId: args.projectId,
      userId: args.userId,
      capability: TRIZ_MAPPING_CAPABILITY,
      surface: TRIZ_MAPPING_SURFACE,
      idempotencyKey: args.idempotencyKey,
      source: 'user',
    },
  })
  // 组织没有任何可用 AI 连接：直接提示先在设置中添加，不出规则模板结果（个人版导出 3.3，
  // 用户 2026-10-14 决定）。联调 / 测试放行 Mock 时仍按「只解析到 mock」诚实降级。
  assertAiConnectionAvailable(resolved)
  if (!resolved.usingRealAdapter) return null

  return {
    async generate(request: TrizMappingGenerationRequest): Promise<TrizMappingGenerationResponse> {
      const result = await resolved.gateway.generate({
        sentence: request.userPrompt,
        promptSet: { systemPrompt: request.systemPrompt, userPrompt: request.userPrompt },
        strategy: 'native',
        jsonSchema: request.jsonSchema,
        maxOutputTokens: request.maxOutputTokens,
        requestTimeoutMs: request.requestTimeoutMs,
        signal: request.signal,
      })
      return {
        rawText: result.rawText,
        provider: resolved.provider,
        model: resolved.model,
        totalTokens: result.outputTokens,
        usingRealAdapter: result.usingRealAdapter,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 纯函数：反幻觉校验 / 引用投影 / 陈述归一
// ---------------------------------------------------------------------------

/** 陈述归一：折叠空白 + 按字符（码点）截断，超限即标记截断（低敏：草案只留摘要与长度）。 */
export function normalizeTrizStatement(
  statement: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  const collapsed = (typeof statement === 'string' ? statement : '').replace(/\s+/g, ' ').trim()
  const characters = Array.from(collapsed)
  if (characters.length <= maxChars) return { text: collapsed, truncated: false }
  return { text: characters.slice(0, maxChars).join(''), truncated: true }
}

/** 陈述摘要：SHA-256 前 32 位十六进制（用于观测与幂等，不可反推原文）。 */
export function digestTrizStatement(statement: string): string {
  return createHash('sha256').update(statement, 'utf8').digest('hex').slice(0, 32)
}

/** 由知识包编号构造参数引用；编号不在包内返回 null（不编造名称）。 */
export function toTrizParameterRef(number: number): TrizParameterRef | null {
  const entry = searchParameterByNumber(number)
  if (!entry) return null
  return {
    number: entry.number,
    nameZh: entry.nameZh,
    displayName: entry.displayName,
    pmMeaning: entry.pmMeaning,
  }
}

/** 由知识包编号构造原则引用；编号不在包内返回 null（不编造名称）。 */
export function toTrizCandidatePrincipleRef(
  number: number,
  rank: number,
): TrizCandidatePrincipleRef | null {
  const entry = searchPrincipleByNumber(number)
  if (!entry) return null
  return {
    rank,
    number: entry.number,
    nameZh: entry.nameZh,
    displayName: entry.displayName,
    definition: entry.definition,
    source: entry.source,
  }
}

/** 保留知识包内的编号（保序去重），并回报被丢弃的数量。 */
export function filterPrincipleNumbers(numbers: readonly number[]): {
  kept: number[]
  dropped: number
} {
  const kept: number[] = []
  let dropped = 0
  for (const number of numbers) {
    if (!searchPrincipleByNumber(number)) {
      dropped += 1
      continue
    }
    if (kept.includes(number)) continue
    kept.push(number)
  }
  return { kept, dropped }
}

/**
 * contextRefs 反幻觉关卡：逐个引用过 1.3 上下文白名单。
 * 未通过的引用被丢弃，只回报计数（不回报被拒引用本身，避免把编造内容带进观测面）。
 */
export function filterContextRefs(
  pack: TrizContextPack,
  refs: readonly string[],
): { accepted: string[]; rejected: number } {
  const accepted: string[] = []
  let rejected = 0
  for (const ref of refs) {
    if (!isContextRefWhitelisted(pack, ref)) {
      rejected += 1
      continue
    }
    if (accepted.includes(ref)) continue
    accepted.push(ref)
  }
  return { accepted, rejected }
}

/** 低敏落库投影：只保留编号 / 枚举 / 摘要 / 引用。 */
export function toLowSensitivityRecord(
  draft: TrizContradictionMappingDraft,
): TrizMappingLowSensitivityRecord {
  return {
    contradictionType: draft.contradictionType,
    improvingParameterNumber: draft.improvingParameter?.number ?? null,
    worseningParameterNumber: draft.worseningParameter?.number ?? null,
    candidatePrincipleNumbers: draft.candidatePrinciples.map((entry) => entry.number),
    path: draft.path,
    confidence: draft.confidence,
    contextRefs: [...draft.contextRefs],
    statementDigest: draft.statementDigest,
    statementLength: draft.statementLength,
    knowledgePackVersion: draft.knowledgePackVersion,
    humanOverride: false,
  }
}

// ---------------------------------------------------------------------------
// 确定性规则路径（零 Token / 零网络；1.6 在其上补齐触发矩阵与一致性断言）
// ---------------------------------------------------------------------------

/** 规则路径的匹配权重：标题 >> 场景 > 解法（标题承载矛盾本质）。 */
const RULE_TITLE_WEIGHT = 4
const RULE_SCENARIO_WEIGHT = 2
const RULE_SOLUTION_WEIGHT = 1
/** 命中阈值：至少一次标题命中，或场景内命中一个 3 元 + 一个 2 元词片。 */
const RULE_MIN_PAIR_SCORE = 4
/** 规则路径置信度上限：规则匹配 MUST NOT 冒充模型推理。 */
const RULE_CONFIDENCE_CEILING = 0.8

const TOKEN_MIN_LENGTH = 2
const MAX_STATEMENT_TOKENS = 120

/** 17 条映射（14 对 + 3 个经典推演）的检索文本：用于识别「泛化词」（区分度过低的词片）。 */
const RULE_MAPPING_TEXTS: readonly string[] = [
  ...TRIZ_PM_CONTRAIDCTION_PAIRS.map((pair) =>
    [pair.title, pair.scenario, pair.solutions.join(' ')].join(' ').toLowerCase(),
  ),
  ...TRIZ_PM_CLASSIC_SCENARIOS.map((scenario) =>
    [scenario.title, scenario.conflict, scenario.solutions.join(' ')].join(' ').toLowerCase(),
  ),
]

/** 泛化词阈值：出现在超过四分之一映射中的词片（如「项目」「交付」）没有区分度，不参与打分。 */
const RULE_GENERIC_TOKEN_DOC_THRESHOLD = Math.floor(RULE_MAPPING_TEXTS.length / 4) + 1

/**
 * 词片区分度判定：命中映射数达到泛化词阈值即视为无区分度。
 * 该阈值由知识包条数算出（非手写词表），知识包增删时自动跟随。
 */
export function isDiscriminatingTrizToken(token: string): boolean {
  let hits = 0
  for (const text of RULE_MAPPING_TEXTS) {
    if (!text.includes(token)) continue
    hits += 1
    if (hits >= RULE_GENERIC_TOKEN_DOC_THRESHOLD) return false
  }
  return true
}

/**
 * 陈述分词（确定性、无词典依赖）：拉丁/数字词整词 + 连续汉字段的 2 元与 3 元滑窗。
 * 同一输入两次调用结果完全一致；空输入返回空数组。
 */
export function tokenizeTrizStatement(statement: string): string[] {
  const normalized = (typeof statement === 'string' ? statement : '').toLowerCase()
  const tokens: string[] = []
  const seen = new Set<string>()

  const push = (token: string): void => {
    if (Array.from(token).length < TOKEN_MIN_LENGTH) return
    if (seen.has(token)) return
    if (tokens.length >= MAX_STATEMENT_TOKENS) return
    seen.add(token)
    tokens.push(token)
  }

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9_-]*/g)) push(match[0])

  for (const match of normalized.matchAll(/[\u4e00-\u9fff]+/g)) {
    const segment = match[0]
    for (let size = TOKEN_MIN_LENGTH; size <= 3; size += 1) {
      for (let index = 0; index + size <= segment.length; index += 1) {
        push(segment.slice(index, index + size))
      }
    }
  }

  return tokens
}

/** 词片权重：3 元及以上更具体，权重更高（2 元命中权重 1）。 */
function tokenWeight(token: string): number {
  return Array.from(token).length >= 3 ? 2 : 1
}

function hitsIn(text: string, tokens: readonly string[]): number {
  const haystack = text.toLowerCase()
  let hits = 0
  for (const token of tokens) {
    if (haystack.includes(token)) hits += tokenWeight(token)
  }
  return hits
}

interface TrizRuleMappingCandidate {
  kind: 'pm-pair' | 'classic-scenario'
  id: string
  score: number
  improvingNumbers: readonly number[]
  worseningNumbers: readonly number[]
  principleNumbers: readonly number[]
  source: string
}

/** 对 14 对 PM 矛盾映射与 3 个经典推演逐条打分（分数相同则先 pm-pair、再按 id 升序）。 */
function scoreRuleCandidates(tokens: readonly string[]): TrizRuleMappingCandidate[] {
  const candidates: TrizRuleMappingCandidate[] = [
    ...TRIZ_PM_CONTRAIDCTION_PAIRS.map((pair) => ({
      kind: 'pm-pair' as const,
      id: pair.id,
      score:
        RULE_TITLE_WEIGHT * hitsIn(pair.title, tokens) +
        RULE_SCENARIO_WEIGHT * hitsIn(pair.scenario, tokens) +
        RULE_SOLUTION_WEIGHT * hitsIn(pair.solutions.join(' '), tokens),
      improvingNumbers: pair.improvingParameterNumbers,
      worseningNumbers: pair.worseningParameterNumbers,
      principleNumbers: pair.principleNumbers,
      source: pair.source,
    })),
    ...TRIZ_PM_CLASSIC_SCENARIOS.map((scenario) => ({
      kind: 'classic-scenario' as const,
      id: scenario.id,
      score:
        RULE_TITLE_WEIGHT * hitsIn(scenario.title, tokens) +
        RULE_SCENARIO_WEIGHT * hitsIn(scenario.conflict, tokens) +
        RULE_SOLUTION_WEIGHT * hitsIn(scenario.solutions.join(' '), tokens),
      improvingNumbers: scenario.improvingParameterNumbers,
      worseningNumbers: scenario.worseningParameterNumbers,
      principleNumbers: scenario.principleNumbers,
      source: scenario.source,
    })),
  ]

  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.kind === 'classic-scenario') - Number(b.kind === 'classic-scenario') ||
      a.id.localeCompare(b.id),
  )
}

/** 规则路径的置信度：由命中分数与领先幅度决定（确定性、封顶 0.8）。 */
function rulePathConfidence(score: number, margin: number): number {
  const value = 0.4 + 0.04 * Math.min(score, 8) + 0.02 * Math.min(margin, 6)
  return Math.round(Math.min(RULE_CONFIDENCE_CEILING, value) * 100) / 100
}

/**
 * 规则路径的证据引用：按固定域序取本项目当前最强的事实信号（逾期任务 → 关键路径任务 →
 * 高风险 → 过载资源），全部来自 1.3 上下文包白名单，因此必然通过反幻觉关卡。
 */
function selectRuleContextRefs(pack: TrizContextPack, limit: number): string[] {
  const candidates: string[] = []

  const tasks = pack.domains.tasks
  if (tasks) {
    for (const item of tasks.items.filter((entry) => entry.overdue))
      candidates.push(`task:${item.id}`)
    for (const id of tasks.criticalPathTaskIds) candidates.push(`task:${id}`)
  }

  const risks = pack.domains.risks
  if (risks) {
    for (const item of risks.items.filter((entry) => entry.riskLevel !== 'low')) {
      candidates.push(`risk:${item.id}`)
    }
  }

  const resources = pack.domains.resources
  if (resources) {
    for (const item of resources.items.filter((entry) => entry.overallocated)) {
      candidates.push(`resource:${item.id}`)
    }
  }

  const selected: string[] = []
  for (const ref of candidates) {
    if (selected.length >= limit) break
    if (!isContextRefWhitelisted(pack, ref)) continue
    if (selected.includes(ref)) continue
    selected.push(ref)
  }
  return selected
}

export interface TrizRulePathInput {
  statement: string
  pack: TrizContextPack
  statementTruncated: boolean
  fallbackReasons: readonly TrizMappingFallbackReason[]
  limits: TrizMappingLimits
}

/**
 * 确定性规则路径：以关键词匹配 14 对 PM 矛盾映射（含 3 个经典推演），
 * 产出与模型路径**同 Schema** 的草案；无有效命中时给出诚实的「信息不足」草案（不编造参数）。
 */
export function buildTrizRulePathDraft(input: TrizRulePathInput): TrizContradictionMappingDraft {
  const { statement, pack, statementTruncated, fallbackReasons, limits } = input
  const tokens = tokenizeTrizStatement(statement).filter(isDiscriminatingTrizToken)
  const candidates = scoreRuleCandidates(tokens)
  const best = candidates[0] ?? null
  const second = candidates[1] ?? null

  const qualityFlags: TrizMappingQualityFlag[] = []
  if (statementTruncated) qualityFlags.push('STATEMENT_TRUNCATED')

  const base: TrizContradictionMappingDraft = {
    path: 'rule',
    contradictionType: 'administrative',
    contradictionTypeLabel: TRIZ_CONTRADICTION_TYPE_LABELS.administrative,
    improvingParameter: null,
    worseningParameter: null,
    candidatePrinciples: [],
    confidence: 0,
    contextRefs: [],
    contextRefValidation: { accepted: 0, rejected: 0 },
    sourceMappingIds: [],
    sourceSections: [],
    requiresHumanConfirmation: true,
    persisted: false,
    needsClarification: true,
    fallbackReasons: [...fallbackReasons],
    qualityFlags,
    statementDigest: digestTrizStatement(statement),
    statementLength: Array.from(statement).length,
    statementTruncated,
    knowledgePackVersion: TRIZ_KNOWLEDGE_PACK_VERSION,
  }

  if (!best || best.score < RULE_MIN_PAIR_SCORE) {
    qualityFlags.push('INSUFFICIENT_INPUT')
    return base
  }

  const margin = best.score - (second?.score ?? 0)
  if (margin === 0) qualityFlags.push('AMBIGUOUS_STATEMENT')

  const improving = toTrizParameterRef(best.improvingNumbers[0] ?? Number.NaN)
  const worsening = toTrizParameterRef(best.worseningNumbers[0] ?? Number.NaN)
  const { kept, dropped } = filterPrincipleNumbers(best.principleNumbers)
  if (dropped > 0) qualityFlags.push('PRINCIPLE_NOT_IN_PACK')

  const candidatePrinciples = kept
    .slice(0, limits.maxCandidatePrinciples)
    .map((number, index) => toTrizCandidatePrincipleRef(number, index + 1))
    .filter((entry): entry is TrizCandidatePrincipleRef => entry !== null)

  if (candidatePrinciples.length === 0) qualityFlags.push('NO_CANDIDATE_PRINCIPLE')

  const contextRefs = selectRuleContextRefs(pack, limits.maxRuleContextRefs)
  let confidence = rulePathConfidence(best.score, margin)
  if (!improving || !worsening || candidatePrinciples.length === 0) confidence = 0
  if (confidence > 0 && confidence < 0.4) qualityFlags.push('LOW_CONFIDENCE')

  return {
    ...base,
    // 14 对 PM 矛盾映射与 3 个经典推演均为参数对冲突（技术矛盾）；
    // 无参数对可解析时按管理矛盾（行政层面冲突）落档（base 默认值）。
    contradictionType: improving && worsening ? 'technical' : 'administrative',
    contradictionTypeLabel:
      TRIZ_CONTRADICTION_TYPE_LABELS[improving && worsening ? 'technical' : 'administrative'],
    improvingParameter: improving,
    worseningParameter: worsening,
    candidatePrinciples,
    confidence,
    contextRefs,
    contextRefValidation: { accepted: contextRefs.length, rejected: 0 },
    sourceMappingIds: [best.id],
    sourceSections: [best.source],
    needsClarification: !improving || !worsening || candidatePrinciples.length === 0,
  }
}

// ---------------------------------------------------------------------------
// Prompt 组装（低敏：只含陈述、聚合读数、实体引用与闭集编号表）
// ---------------------------------------------------------------------------

export interface TrizMappingPrompt {
  systemPrompt: string
  userPrompt: string
  jsonSchema: Record<string, unknown>
  /** 进 prompt 的实体引用（有界，全部来自上下文包） */
  entityRefs: string[]
}

const PROMPT_DOMAIN_KINDS: ReadonlyArray<
  [keyof TrizContextPack['domains'], TrizContextEntityKind]
> = [
  ['tasks', 'task'],
  ['risks', 'risk'],
  ['resources', 'resource'],
  ['milestones', 'milestone'],
  ['changeRequests', 'change_request'],
]

const SYSTEM_PROMPT = [
  '你是资深 TRIZ 项目管理顾问。请把项目管理者的大白话陈述映射为结构化 TRIZ 矛盾模型。',
  '输出规则：',
  '1. 只输出 JSON 对象，不要解释文字、不要 Markdown 代码块、不要多余字段；',
  '2. improvingParameterNumber / worseningParameterNumber 只能取给定的 39 个工程参数编号；',
  '3. candidatePrinciples 只能取给定的 40 个发明原则编号，并按推荐度从高到低排序；',
  '4. contextRefs 只能引用「可引用的项目实体」里出现过的引用，且只放与本矛盾真正相关的；',
  '5. contradictionType 只能是 administrative（管理矛盾）/ technical（技术矛盾）/ physical（物理矛盾）；',
  '6. confidence 是 0–1 的小数，表示你对本次映射的把握；不确定时给低分，不要编造。',
].join('\n')

function describePackReadings(pack: TrizContextPack): string[] {
  const lines: string[] = []
  const tasks = pack.domains.tasks
  if (tasks) {
    lines.push(
      `任务：共 ${tasks.readings.total} 项，关键路径 ${tasks.readings.criticalPathCount} 项，` +
        `逾期 ${tasks.readings.overdueCount} 项；进度偏差 SPI=${tasks.readings.schedule.spi}、` +
        `SV=${tasks.readings.schedule.sv}（${tasks.readings.schedule.scheduleStatus}）`,
    )
  }
  const risks = pack.domains.risks
  if (risks) {
    lines.push(
      `风险：共 ${risks.readings.total} 项，风险矩阵占用格 ${risks.readings.matrixCells.length} 个`,
    )
  }
  const resources = pack.domains.resources
  if (resources) {
    lines.push(
      `资源（团队聚合口径）：${resources.readings.resourceCount} 名，` +
        `团队平均负载 ${resources.readings.teamAverageUtilizationPercent}%，` +
        `过载 ${resources.readings.overloadedResourceCount} 名；` +
        `观测窗 ${resources.readings.windowFrom}~${resources.readings.windowTo}`,
    )
  }
  const milestones = pack.domains.milestones
  if (milestones) {
    const distribution = Object.entries(milestones.readings.byDisplayStatus)
      .map(([status, count]) => `${status}=${count}`)
      .join('、')
    lines.push(
      `里程碑：共 ${milestones.readings.total} 项${distribution ? `（${distribution}）` : ''}`,
    )
  }
  const changeRequests = pack.domains.changeRequests
  if (changeRequests) {
    lines.push(
      `变更请求：共 ${changeRequests.readings.total} 项，待审批 ${changeRequests.readings.pendingApprovalCount} 项`,
    )
  }
  return lines
}

/** 进 prompt 的实体引用清单：固定域序、按包内条目顺序、按上限截断（确定性）。 */
function collectPromptEntityRefs(
  pack: TrizContextPack,
  limit: number,
): Array<{ ref: string; label: string }> {
  const entries: Array<{ ref: string; label: string }> = []
  for (const [domain, kind] of PROMPT_DOMAIN_KINDS) {
    const packed = pack.domains[domain]
    if (!packed) continue
    for (const item of packed.items) {
      const ref = `${kind}:${item.id}`
      if (!isContextRefWhitelisted(pack, ref)) continue
      entries.push({ ref, label: item.label })
    }
  }
  return entries.slice(0, limit)
}

function closedSetList(entries: ReadonlyArray<{ number: number; displayName: string }>): string {
  return entries.map((entry) => `${entry.number}|${entry.displayName}`).join(' ')
}

/**
 * 组装模型请求：陈述（已截断）+ 项目聚合读数 + 可引用实体 + 参数/原则闭集编号表。
 * MUST NOT 放入个人维度度量（AGENTS.md §6 / design D9），只放团队聚合读数与实体标识。
 */
export function buildTrizMappingPrompt(args: {
  statement: string
  pack: TrizContextPack
  limits: TrizMappingLimits
}): TrizMappingPrompt {
  const entityRefs = collectPromptEntityRefs(args.pack, args.limits.maxPromptEntityRefs)

  const sections: string[] = [
    '【管理者陈述】（仅用于本次映射，系统不会落库原文）',
    args.statement,
    '',
    '【项目事实读数（团队聚合口径）】',
    ...describePackReadings(args.pack).map((line) => `- ${line}`),
    '',
    '【可引用的项目实体】',
    ...(entityRefs.length > 0
      ? entityRefs.map((entry) => `- ${entry.ref} ${entry.label}`)
      : ['- （本次上下文没有可用实体，contextRefs 请返回空数组）']),
    '',
    '【39 个工程参数】',
    closedSetList(TRIZ_PARAMETERS),
    '',
    '【40 个发明原则】',
    closedSetList(TRIZ_PRINCIPLES),
  ]

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: sections.join('\n'),
    jsonSchema: trizMappingModelJsonSchema(),
    entityRefs: entityRefs.map((entry) => entry.ref),
  }
}

/**
 * Token 估算（确定性、无 tokenizer 依赖）：汉字按 1 token / 字、其他字符按 3 字 / token 的上界估算。
 * 仅用于预算 preflight 与观测，不参与业务判定。
 */
export function estimateTrizMappingTokens(text: string): number {
  const characters = Array.from(typeof text === 'string' ? text : '')
  let cjk = 0
  let other = 0
  for (const character of characters) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(character)) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk + other / 3)
}

// ---------------------------------------------------------------------------
// 模型路径草案组装（反幻觉关卡第二道：白名单过滤 + 编号回填知识包）
// ---------------------------------------------------------------------------

export interface TrizAiPathDraftInput {
  statement: string
  statementTruncated: boolean
  pack: TrizContextPack
  output: TrizMappingModelOutput
  limits: TrizMappingLimits
}

/** 由已过强 Schema 的模型输出组装草案；此处的过滤是第二道防线（编号闭集 + 实体白名单）。 */
export function buildTrizAiPathDraft(input: TrizAiPathDraftInput): TrizContradictionMappingDraft {
  const { statement, statementTruncated, pack, output, limits } = input
  const qualityFlags: TrizMappingQualityFlag[] = []
  if (statementTruncated) qualityFlags.push('STATEMENT_TRUNCATED')

  const improving = toTrizParameterRef(output.improvingParameterNumber)
  const worsening = toTrizParameterRef(output.worseningParameterNumber)
  if (!improving || !worsening) qualityFlags.push('PARAMETER_NOT_IN_PACK')

  const { kept, dropped } = filterPrincipleNumbers(output.candidatePrinciples)
  if (dropped > 0) qualityFlags.push('PRINCIPLE_NOT_IN_PACK')

  const candidatePrinciples = kept
    .slice(0, limits.maxCandidatePrinciples)
    .map((number, index) => toTrizCandidatePrincipleRef(number, index + 1))
    .filter((entry): entry is TrizCandidatePrincipleRef => entry !== null)
  if (candidatePrinciples.length === 0) qualityFlags.push('NO_CANDIDATE_PRINCIPLE')

  const { accepted, rejected } = filterContextRefs(pack, output.contextRefs)
  if (rejected > 0) qualityFlags.push('CONTEXT_REFS_REJECTED')

  const needsClarification = !improving || !worsening || candidatePrinciples.length === 0
  let confidence = Math.min(1, Math.max(0, output.confidence))
  if (needsClarification) confidence = Math.min(confidence, 0.3)
  if (confidence > 0 && confidence < 0.4) qualityFlags.push('LOW_CONFIDENCE')

  // 同一参数既是改善又是恶化 ⇒ TRIZ 语义上的物理矛盾，类型以参数事实为准（不采信模型自述）。
  const contradictionType: TrizContradictionType =
    improving && worsening && improving.number === worsening.number
      ? 'physical'
      : output.contradictionType

  return {
    path: 'ai',
    contradictionType,
    contradictionTypeLabel: TRIZ_CONTRADICTION_TYPE_LABELS[contradictionType],
    improvingParameter: improving,
    worseningParameter: worsening,
    candidatePrinciples,
    confidence: Math.round(confidence * 100) / 100,
    contextRefs: accepted.slice(0, limits.maxContextRefs),
    contextRefValidation: { accepted: accepted.length, rejected },
    sourceMappingIds: [],
    sourceSections: [],
    requiresHumanConfirmation: true,
    persisted: false,
    needsClarification,
    fallbackReasons: [],
    qualityFlags,
    statementDigest: digestTrizStatement(statement),
    statementLength: Array.from(statement).length,
    statementTruncated,
    knowledgePackVersion: TRIZ_KNOWLEDGE_PACK_VERSION,
  }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

/** 发起人类型：直接取 1.3 权限端口契约的首参类型（等价于既有 `User`），本模块不引入数据访问层。 */
export type TrizMappingActor = Parameters<TrizContextPermissionChecker['check']>[0]

export interface TrizContradictionMappingRequest {
  organizationId: number
  projectId: number
  actor: TrizMappingActor
  /** 1.3 组装的上下文包：本服务不重新读业务数据，也 MUST NOT 跨组织使用 */
  contextPack: TrizContextPack
  /** PM 的大白话陈述（本服务内截断；草案只保留摘要与长度） */
  statement: string
  /** 幂等键（供既有预算守卫结算；缺省由陈述摘要派生） */
  idempotencyKey?: string
  /** 限额收紧（默认值只允许收紧） */
  limits?: Partial<TrizMappingLimits>
  /** 显式强制规则路径（离线/测试场景） */
  forceRulePath?: boolean
  /** 观测用请求标识（不落正文） */
  traceId?: string | null
}

export interface TrizContradictionMappingOptions {
  permissionChecker?: TrizContextPermissionChecker
  /** 模型通道：注入即以注入者为准；未注入时经 `resolveAdapter` 解析 */
  model?: TrizMappingModelPort | null
  budgetGate?: TrizMappingBudgetGate
  /** 真实模型开关；缺省见 `isTrizRealAiEnabled`（未设置时正式环境开启、测试环境关闭） */
  realAiEnabled?: boolean
}

/**
 * 真实模型总开关（沿用既有 env 门名 `AIPROJ_TRIZ_ENABLE_REAL_AI`）。
 *
 * 2026-10-12 用户反馈「进入矛盾求解后不是调用真实模型」：部署环境从未设置该变量，
 * 原先「未显式开启即关闭」让矛盾求解永远走规则模板。现在：显式 `true` / `false` 照旧；
 * 未设置时正式环境默认开启（仍要过 ai:trigger、预算门、真实适配器三道门，失败照常诚实降级），
 * 测试环境（NODE_ENV=test）保持关闭——mock 适配器不得冒充真实模型路径（RL-13）。
 */
export function isTrizRealAiEnabled(): boolean {
  const flag = process.env.AIPROJ_TRIZ_ENABLE_REAL_AI
  if (flag === 'true') return true
  if (flag === 'false') return false
  return process.env.NODE_ENV !== 'test'
}

interface TrizModelAttemptSuccess {
  kind: 'ok'
  /** 真实供应商调用次数（与 `port.generate` 的调用一一对应） */
  providerCalls: 1
  output: TrizMappingModelOutput
  provider: string | null
  model: string | null
  totalTokens: number | null
}

interface TrizModelAttemptFallback {
  kind: 'fallback'
  /** 0 = 未触达通道（未配置/未启用）；1 = 已发出调用但失败（失败/超时/输出非法） */
  providerCalls: 0 | 1
  reason: TrizMappingFallbackReason
  /** 已发出调用时供应商回报的用量（未知为 null / 缺省）：如实披露，不静默丢弃（1.6 加固） */
  provider?: string | null
  model?: string | null
  totalTokens?: number | null
}

type TrizModelAttempt = TrizModelAttemptSuccess | TrizModelAttemptFallback

export default class TrizContradictionMappingService {
  readonly #options: TrizContradictionMappingOptions

  constructor(options: TrizContradictionMappingOptions = {}) {
    this.#options = options
  }

  /**
   * 生成矛盾映射草案。调用顺序即红线顺序：陈述归一 → 上下文归属断言 → 模型路径三道门 →
   * 强 Schema → 反幻觉白名单 → 只产草案（任何一步不通过都落到确定性规则路径，绝不写库）。
   */
  async map(request: TrizContradictionMappingRequest): Promise<TrizContradictionMappingResult> {
    const limits = resolveTrizMappingLimits(request.limits)
    const normalized = normalizeTrizStatement(request.statement, limits.maxStatementChars)
    if (normalized.text.length === 0) {
      throw new ValidationException('矛盾陈述不能为空')
    }
    this.#assertPackBelongsToRequest(request)

    const fallbackReasons: TrizMappingFallbackReason[] = []
    const realAiEnabled = this.#options.realAiEnabled ?? isTrizRealAiEnabled()
    const modelUsage: TrizMappingModelUsage = {
      providerCalls: 0,
      provider: null,
      model: null,
      estimatedTokens: 0,
      // 未发出任何模型调用 ⇒ 用量精确为 0（确定性回退零 Token 可直接断言，1.6 加固）
      totalTokens: 0,
    }

    if (request.forceRulePath === true) fallbackReasons.push('MODEL_DISABLED')
    else if (!realAiEnabled) fallbackReasons.push('MODEL_DISABLED')
    else if (!(await this.#hasTriggerPermission(request))) fallbackReasons.push('NO_AI_TRIGGER')

    if (fallbackReasons.length === 0) {
      const prompt = buildTrizMappingPrompt({
        statement: normalized.text,
        pack: request.contextPack,
        limits,
      })
      const estimatedTokens =
        estimateTrizMappingTokens(prompt.systemPrompt) +
        estimateTrizMappingTokens(prompt.userPrompt) +
        limits.maxOutputTokens
      modelUsage.estimatedTokens = estimatedTokens

      const idempotencyKey =
        request.idempotencyKey ?? `triz-mapping-${digestTrizStatement(normalized.text)}`

      let budgetAllowed: boolean
      try {
        budgetAllowed = await this.#budgetAllows({
          request,
          limits,
          estimatedTokens,
          idempotencyKey,
        })
      } catch {
        // 预算门不可用 ⇒ fail-closed 按预算阻断处理并落到零 Token 规则路径（不把异常抛给调用方，1.6 加固）
        budgetAllowed = false
      }
      if (!budgetAllowed) {
        fallbackReasons.push('BUDGET_EXHAUSTED')
      } else {
        const attempt = await this.#runModelPath({
          request,
          prompt,
          limits,
          estimatedTokens,
          idempotencyKey,
        })
        if (attempt.kind === 'ok') {
          // 模型路径成立：provider 已被调用一次（计数与真实调用一一对应）
          modelUsage.providerCalls = attempt.providerCalls
          modelUsage.provider = attempt.provider
          modelUsage.model = attempt.model
          modelUsage.totalTokens = attempt.totalTokens
          const mapping = buildTrizAiPathDraft({
            statement: normalized.text,
            statementTruncated: normalized.truncated,
            pack: request.contextPack,
            output: attempt.output,
            limits,
          })
          return { mapping, modelUsage, lowSensitivityRecord: toLowSensitivityRecord(mapping) }
        }
        modelUsage.providerCalls = attempt.providerCalls
        if (attempt.providerCalls > 0) {
          // 已发出调用：供应商回报的用量如实披露，未回报时保持 null（未知不等于零消耗）
          modelUsage.provider = attempt.provider ?? null
          modelUsage.model = attempt.model ?? null
          modelUsage.totalTokens = attempt.totalTokens ?? null
        }
        fallbackReasons.push(attempt.reason)
      }
    }

    const mapping = buildTrizRulePathDraft({
      statement: normalized.text,
      pack: request.contextPack,
      statementTruncated: normalized.truncated,
      fallbackReasons,
      limits,
    })
    return { mapping, modelUsage, lowSensitivityRecord: toLowSensitivityRecord(mapping) }
  }

  // ── 前置断言与三道门 ──────────────────────────────────────────────

  /** 上下文包必须属于本次请求的组织与项目（跨组织/错配一律 fail-closed，RL-05）。 */
  #assertPackBelongsToRequest(request: TrizContradictionMappingRequest): void {
    const pack = request.contextPack
    if (pack.organizationId !== request.organizationId || pack.projectId !== request.projectId) {
      throw new ValidationException('上下文包与本次请求的组织 / 项目不一致')
    }
  }

  async #hasTriggerPermission(request: TrizContradictionMappingRequest): Promise<boolean> {
    const checker = this.#options.permissionChecker ?? (await app.container.make(RbacService))
    const result = await checker.check(
      request.actor,
      AI_TRIGGER,
      request.organizationId,
      request.projectId,
    )
    return result.allowed
  }

  async #budgetAllows(args: {
    request: TrizContradictionMappingRequest
    limits: TrizMappingLimits
    estimatedTokens: number
    idempotencyKey: string
  }): Promise<boolean> {
    const gate = this.#options.budgetGate ?? createRunTokenBudgetGate(args.limits.runTokenBudget)
    const decision = await gate.preflight({
      organizationId: args.request.organizationId,
      projectId: args.request.projectId,
      userId: Number.isFinite(Number(args.request.actor.id)) ? Number(args.request.actor.id) : null,
      capability: TRIZ_MAPPING_CAPABILITY,
      surface: TRIZ_MAPPING_SURFACE,
      estimatedTokens: args.estimatedTokens,
      estimatedCost: 0,
      idempotencyKey: args.idempotencyKey,
      ledgerAttemptRef: args.request.traceId ?? null,
    })
    return decision.allowed
  }

  /**
   * 模型路径：解析通道 → 调用（带超时）→ 强 Schema 校验。
   * 任何一步不成立都返回**回退原因**，由调用方落到规则路径（不抛错、不静默）。
   */
  async #runModelPath(args: {
    request: TrizContradictionMappingRequest
    prompt: TrizMappingPrompt
    limits: TrizMappingLimits
    estimatedTokens: number
    idempotencyKey: string
  }): Promise<TrizModelAttempt> {
    const port =
      this.#options.model === undefined
        ? await this.#resolveDefaultModelPort(args)
        : this.#options.model
    if (!port) return { kind: 'fallback', providerCalls: 0, reason: 'MODEL_UNAVAILABLE' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), args.limits.requestTimeoutMs)

    let response: TrizMappingGenerationResponse
    try {
      response = await port.generate({
        systemPrompt: args.prompt.systemPrompt,
        userPrompt: args.prompt.userPrompt,
        jsonSchema: args.prompt.jsonSchema,
        maxOutputTokens: args.limits.maxOutputTokens,
        requestTimeoutMs: args.limits.requestTimeoutMs,
        signal: controller.signal,
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      return {
        kind: 'fallback',
        providerCalls: 1,
        reason: name === 'AbortError' || name === 'TimeoutError' ? 'MODEL_TIMEOUT' : 'MODEL_FAILED',
      }
    } finally {
      clearTimeout(timer)
    }

    const parsed = parseTrizMappingModelOutput(response.rawText)
    if (!parsed.ok) {
      // 调用本身已发出：供应商回报的用量如实带出，不被回退分支吞掉（1.6 加固）
      return {
        kind: 'fallback',
        providerCalls: 1,
        reason: 'MODEL_OUTPUT_INVALID',
        provider: response.provider,
        model: response.model,
        totalTokens: response.totalTokens,
      }
    }

    return {
      kind: 'ok',
      providerCalls: 1,
      output: parsed.value,
      provider: response.provider,
      model: response.model,
      totalTokens: response.totalTokens,
    }
  }

  async #resolveDefaultModelPort(args: {
    request: TrizContradictionMappingRequest
    estimatedTokens: number
    idempotencyKey: string
  }): Promise<TrizMappingModelPort | null> {
    try {
      return await createAIGatewayMappingPort({
        organizationId: args.request.organizationId,
        projectId: args.request.projectId,
        userId: Number(args.request.actor.id) || 0,
        estimatedTokens: args.estimatedTokens,
        idempotencyKey: args.idempotencyKey,
      })
    } catch (error) {
      // 没有可用 AI 连接：交给调用方提示用户先添加连接
      if (error instanceof AiConnectionRequiredException) throw error
      // 其余适配器解析失败（不可用）⇒ 诚实降级，不把异常抛给调用方。
      return null
    }
  }
}
