/**
 * @aiproj/compiler-spec —— Compiler Observability & Cost Controls（v2-compiler-observability-cost-controls 1.1）。
 *
 * 定义 V2 Project Compiler 的结构化可观测事件、模型调用成本、预算策略与决策、
 * 以及摘要聚合的类型。供前后端共享，作为 observability/cost recorder、budget guard
 * 和 summary API 的类型基础。
 *
 * ⚠️ 本文件变更需同步更新 index.ts 导出。
 */

import { z } from 'zod'

// ══════════════════════════════════════════════════
// 1. Observability Event
// ══════════════════════════════════════════════════

export const observabilityEventTypeSchema = z.enum([
  'stage_started',
  'stage_completed',
  'stage_failed',
  'stage_skipped',
  'stage_needs_review',
  'phase_started',
  'phase_completed',
  'context_packet_generated',
  'artifact_stored',
  'validation_triggered',
  'validation_completed',
  'repair_attempted',
  'repair_completed',
  'repair_failed',
  'draft_handoff',
  'budget_decision',
  'resume_event',
  'replay_event',
])
export type ObservabilityEventType = z.infer<typeof observabilityEventTypeSchema>

export const errorCategorySchema = z.enum([
  'none',
  'llm_empty',
  'llm_malformed_json',
  'llm_truncated',
  'llm_provider_error',
  'llm_timeout',
  'llm_auth',
  'llm_rate_limited',
  'schema_validation_failed',
  'budget_exceeded',
  'internal_error',
  'resume_missing_artifact',
])
export type ErrorCategory = z.infer<typeof errorCategorySchema>

/**
 * ObservabilityEvent —— 结构化可观测事件。
 *
 * 用于 Compiler run、Phase、Stage、Context Packet、Artifact、Validation、
 * Repair 和 Draft handoff。禁止包含完整 prompt/用户输入/模型输出/API Key。
 */
export const observabilityEventSchema = z.object({
  /** 组织 ID。 */
  organizationId: z.number().int().positive(),
  /** Compiler run ID。 */
  compilerRunId: z.number().int().positive(),
  /** 唯一事件标识。 */
  eventId: z.string().min(1),
  /** 事件类型。 */
  eventType: observabilityEventTypeSchema,
  /** Phase ID（可选）。 */
  phaseId: z.string().optional(),
  /** Stage ID（可选）。 */
  stageId: z.string().optional(),
  /** 事件状态。 */
  status: z.string().min(1),
  /** 事件发生时间。 */
  occurredAt: z.string().datetime().optional(),
  /** 开始时间。 */
  startedAt: z.string().datetime().optional(),
  /** 结束时间。 */
  endedAt: z.string().datetime().optional(),
  /** 耗时毫秒。 */
  durationMs: z.number().int().nonnegative().optional(),
  /** Attempt 编号。 */
  attemptNumber: z.number().int().nonnegative().optional(),
  /** 输入 artifact refs（只记录 ref，不含 payload）。 */
  inputRefs: z.array(z.string()).optional(),
  /** 输出 artifact refs（只记录 ref，不含 payload）。 */
  outputRefs: z.array(z.string()).optional(),
  /** 简短摘要。 */
  summary: z.string().optional(),
  /** 错误分类。 */
  errorCategory: errorCategorySchema.optional(),
  /** 错误消息摘要（不含调用栈细节）。 */
  errorMessage: z.string().optional(),
  /** 幂等键。 */
  idempotencyKey: z.string().optional(),
  /** 扩展属性（禁止保存敏感正文）。 */
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type ObservabilityEvent = z.infer<typeof observabilityEventSchema>

// ══════════════════════════════════════════════════
// 2. Model Cost Event
// ══════════════════════════════════════════════════

export const finishReasonSchema = z.enum([
  'stop',
  'length',
  'content_filter',
  'tool_calls',
  'error',
  'timeout',
  'cancelled',
])
export type FinishReason = z.infer<typeof finishReasonSchema>

/**
 * ModelCostEvent —— 每次经 AIGateway 发起的 LLM/hybrid Stage 调用的成本记录。
 *
 * 确定性 Stage 禁止产生非零 ModelCostEvent。
 * 禁止包含完整 prompt/完整用户输入/完整模型输出/API Key。
 */
export const modelCostEventSchema = z.object({
  /** 组织 ID。 */
  organizationId: z.number().int().positive(),
  /** Compiler run ID。 */
  compilerRunId: z.number().int().positive(),
  /** Provider 名称（如 deepseek、openai、mock）。 */
  provider: z.string().min(1),
  /** 模型名称（如 deepseek-chat、gpt-4o）。 */
  model: z.string().min(1),
  /** 模型模式。 */
  modelMode: z.enum(['thinking', 'non-thinking']).optional(),
  /** Stage ID。 */
  stageId: z.string().min(1),
  /** 实体 ID（可选）。 */
  entityId: z.string().optional(),
  /** Attempt 编号。 */
  attemptNumber: z.number().int().nonnegative().default(0),
  /** Prompt token 数。 */
  promptTokens: z.number().int().nonnegative().default(0),
  /** Completion token 数。 */
  completionTokens: z.number().int().nonnegative().default(0),
  /** Total token 数。 */
  totalTokens: z.number().int().nonnegative().default(0),
  /** 估算费用（非财务真账，仅用于预算守卫）。 */
  estimatedCost: z.number().nonnegative().default(0),
  /** 费用估算状态：unknown 不可解读为 0 成本。 */
  costEstimateStatus: z.enum(['priced', 'partial_unknown', 'legacy', 'unknown']).default('legacy'),
  /** 币种。 */
  currency: z.string().default('CNY'),
  /** 计费单元（如 1M tokens 的价格）。 */
  pricingUnit: z.string().optional(),
  /** 单价快照 ID。 */
  pricingSnapshotId: z.string().optional(),
  /** 目录供应商 ID（有 catalog 绑定时）。 */
  catalogProviderId: z.string().optional(),
  /** 目录模型 ID（有 catalog 绑定时）。 */
  catalogModelId: z.string().optional(),
  /** 细分 usage snapshot；禁止包含 prompt/output 正文。 */
  usageSnapshot: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      totalTokens: z.number().int().nonnegative().optional(),
      cacheReadTokens: z.number().int().nonnegative().optional(),
      cacheWriteTokens: z.number().int().nonnegative().optional(),
      inputAudioTokens: z.number().int().nonnegative().optional(),
      outputAudioTokens: z.number().int().nonnegative().optional(),
      reasoningTokens: z.number().int().nonnegative().optional(),
      contextOver200kTokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /** 调用时使用的上下文限制快照。 */
  contextLimitSnapshot: z
    .object({
      contextWindowTokens: z.number().int().positive().nullable().optional(),
      maxInputTokens: z.number().int().positive().nullable().optional(),
      maxOutputTokens: z.number().int().positive().nullable().optional(),
      source: z.enum(['catalog', 'manual']).nullable().optional(),
    })
    .optional(),
  /** 分项成本估算，不含敏感正文。 */
  costComponents: z
    .array(
      z.object({
        kind: z.enum([
          'input',
          'output',
          'cache_read',
          'cache_write',
          'input_audio',
          'output_audio',
          'reasoning',
          'context_over_200k',
        ]),
        tokens: z.number().int().nonnegative(),
        pricePerMillion: z.number().nullable(),
        cost: z.number().nonnegative().nullable(),
        state: z.enum(['priced', 'included', 'unknown']),
      }),
    )
    .optional(),
  /** 缓存读取 token。 */
  cacheReadTokens: z.number().int().nonnegative().optional(),
  /** 缓存写入 token。 */
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  /** 音频输入 token。 */
  inputAudioTokens: z.number().int().nonnegative().optional(),
  /** 音频输出 token。 */
  outputAudioTokens: z.number().int().nonnegative().optional(),
  /** 推理 token。 */
  reasoningTokens: z.number().int().nonnegative().optional(),
  /** 本次调用延迟（毫秒）。 */
  latencyMs: z.number().int().nonnegative().default(0),
  /** 上下文 artifact ref。 */
  contextPacketRef: z.string().optional(),
  /** 模型输出 artifact ref。 */
  modelOutputRef: z.string().optional(),
  /** 是否缓存命中。 */
  cacheHit: z.boolean().default(false),
  /** 缓存切分/裁剪标记。 */
  cacheCut: z.boolean().default(false),
  /** 结束原因。 */
  finishReason: finishReasonSchema.optional(),
  /** 错误分类（无错误时为 'none'）。 */
  errorCategory: errorCategorySchema.default('none'),
  /** 幂等键，防止重复记录。 */
  idempotencyKey: z.string().optional(),
  /** 是否真实模型调用（false 为 mock/fake）。 */
  isReal: z.boolean().default(false),
  /** 事件发生时间。 */
  occurredAt: z.string().datetime().optional(),
})

export type ModelCostEvent = z.infer<typeof modelCostEventSchema>

// ══════════════════════════════════════════════════
// 3. Budget Policy & Decision
// ══════════════════════════════════════════════════

export const budgetScopeSchema = z.enum([
  'organization',
  'user',
  'project',
  'compiler_run',
  'stage_type',
  'stage_id',
  'model_tier',
])
export type BudgetScope = z.infer<typeof budgetScopeSchema>

export const softLimitActionSchema = z.enum(['warn', 'require_review', 'continue'])
export type SoftLimitAction = z.infer<typeof softLimitActionSchema>

export const hardLimitActionSchema = z.enum(['block', 'block_stage', 'block_run'])
export type HardLimitAction = z.infer<typeof hardLimitActionSchema>

export const budgetDecisionStatusSchema = z.enum([
  'within_budget',
  'soft_exceeded',
  'hard_exceeded',
])
export type BudgetDecisionStatus = z.infer<typeof budgetDecisionStatusSchema>

/**
 * BudgetPolicy —— 预算策略。
 *
 * 支持按 organization/user/project/compiler run/stage type/stage id/model tier 配置。
 */
export const budgetPolicySchema = z.object({
  /** 策略名称。 */
  name: z.string().min(1),
  /** 策略作用域。 */
  scope: budgetScopeSchema,
  /** 作用域值。 */
  scopeValue: z.string().min(1),
  /** 是否启用。 */
  enabled: z.boolean().default(true),
  /** 软预算上限（估算成本）。 */
  softLimit: z.number().nonnegative().optional(),
  /** 硬预算上限（估算成本）。 */
  hardLimit: z.number().nonnegative().optional(),
  /** 软预算上限 token 数。 */
  softLimitTokens: z.number().int().nonnegative().optional(),
  /** 硬预算上限 token 数。 */
  hardLimitTokens: z.number().int().nonnegative().optional(),
  /** 币种。 */
  currency: z.string().default('CNY'),
  /** 策略窗口。 */
  window: z.string().optional(),
  /** 超出软预算后执行的操作。 */
  onSoftLimit: softLimitActionSchema.default('warn'),
  /** 超出硬预算后执行的操作。 */
  onHardLimit: hardLimitActionSchema.default('block'),
  /** 优先级（数字越大优先级越高）。 */
  priority: z.number().int().default(0),
  /** 应用范围。 */
  applicableStageTypes: z
    .array(z.enum(['llm', 'hybrid', 'deterministic', 'gate', 'meta']))
    .optional(),
  /** 应用 Stage ID 列表。 */
  applicableStageIds: z.array(z.string()).optional(),
  /** 应用模型层级。 */
  applicableModelTiers: z.array(z.string()).optional(),
})

export type BudgetPolicy = z.infer<typeof budgetPolicySchema>
export type BudgetPolicyInput = z.input<typeof budgetPolicySchema>

/**
 * BudgetDecision —— 预算守卫判定结果。
 */
export const budgetDecisionSchema = z.object({
  /** 组织 ID。 */
  organizationId: z.number().int().positive(),
  /** Compiler run ID。 */
  compilerRunId: z.number().int().positive(),
  /** 判定时间。 */
  decidedAt: z.string().datetime().optional(),
  /** 判定类型。 */
  decisionType: z.enum(['preflight', 'postflight']),
  /** 判定状态。 */
  status: budgetDecisionStatusSchema,
  /** 当前累计估算成本（调用前或调用后）。 */
  currentEstimatedCost: z.number().nonnegative().default(0),
  /** 当前调用估算成本。 */
  currentCallEstimatedCost: z.number().nonnegative().default(0),
  /** 软预算上限。 */
  softLimit: z.number().nonnegative().optional(),
  /** 硬预算上限。 */
  hardLimit: z.number().nonnegative().optional(),
  /** 累计 token。 */
  totalTokens: z.number().int().nonnegative().default(0),
  /** 是否允许继续调用。 */
  allowed: z.boolean(),
  /** 拒绝原因。 */
  reason: z.string().optional(),
  /** 建议的操作（warn/require_review/block）。 */
  suggestedAction: z.string().optional(),
  /** 关联 Stage ID。 */
  stageId: z.string().optional(),
  /** 关联的预算策略名称。 */
  appliedPolicyName: z.string().optional(),
  /** 事件幂等键。 */
  idempotencyKey: z.string().optional(),
})

export type BudgetDecision = z.infer<typeof budgetDecisionSchema>

// ══════════════════════════════════════════════════
// 4. Summary Types
// ══════════════════════════════════════════════════

/**
 * CostSummaryItem —— 单个维度成本汇总。
 */
export const costSummaryItemSchema = z.object({
  /** 汇总维度（total | by_stage | by_model | by_provider）。 */
  dimension: z.string(),
  /** 维度值。 */
  label: z.string(),
  /** 估算费用。 */
  estimatedCost: z.number().nonnegative().default(0),
  /** 币种。 */
  currency: z.string().default('CNY'),
  /** 模型调用次数。 */
  callCount: z.number().int().nonnegative().default(0),
  /** LLM 调用次数。 */
  llmCallCount: z.number().int().nonnegative().default(0),
  /** deterministic 调用次数。 */
  deterministicCallCount: z.number().int().nonnegative().default(0),
})

export type CostSummaryItem = z.infer<typeof costSummaryItemSchema>

/**
 * TokenSummaryItem —— token 汇总。
 */
export const tokenSummaryItemSchema = z.object({
  /** 汇总维度（total | by_stage | by_model）。 */
  dimension: z.string(),
  /** 维度值。 */
  label: z.string(),
  /** 输入 token。 */
  promptTokens: z.number().int().nonnegative().default(0),
  /** 输出 token。 */
  completionTokens: z.number().int().nonnegative().default(0),
  /** 总 token。 */
  totalTokens: z.number().int().nonnegative().default(0),
})

export type TokenSummaryItem = z.infer<typeof tokenSummaryItemSchema>

/**
 * LatencySummaryItem —— 延迟汇总。
 */
export const latencySummaryItemSchema = z.object({
  /** 汇总维度（total | by_stage | by_model）。 */
  dimension: z.string(),
  /** 维度值。 */
  label: z.string(),
  /** 总延迟（毫秒）。 */
  totalMs: z.number().int().nonnegative().default(0),
  /** 平均延迟（毫秒）。 */
  avgMs: z.number().nonnegative().default(0),
  /** 最大延迟（毫秒）。 */
  maxMs: z.number().int().nonnegative().default(0),
  /** 最小延迟（毫秒）。 */
  minMs: z.number().int().nonnegative().default(0),
})

export type LatencySummaryItem = z.infer<typeof latencySummaryItemSchema>

/**
 * RetrySummaryItem —— 重试汇总。
 */
export const retrySummaryItemSchema = z.object({
  /** 汇总维度（total | by_stage | by_model）。 */
  dimension: z.string(),
  /** 维度值。 */
  label: z.string(),
  /** 重试次数。 */
  retryCount: z.number().int().nonnegative().default(0),
  /** 首次成功次数。 */
  firstAttemptSuccessCount: z.number().int().nonnegative().default(0),
  /** 最终失败次数。 */
  finalFailureCount: z.number().int().nonnegative().default(0),
})

export type RetrySummaryItem = z.infer<typeof retrySummaryItemSchema>

/**
 * CacheCutSummary —— 缓存和裁剪汇总。
 */
export const cacheCutSummarySchema = z.object({
  /** 缓存命中次数。 */
  cacheHitCount: z.number().int().nonnegative().default(0),
  /** 缓存未命中次数。 */
  cacheMissCount: z.number().int().nonnegative().default(0),
  /** 裁剪次数。 */
  cutCount: z.number().int().nonnegative().default(0),
  /** 缓存节省估算 token。 */
  cacheSavedTokens: z.number().int().nonnegative().default(0),
  /** 裁剪估算节省 token。 */
  cutSavedTokens: z.number().int().nonnegative().default(0),
})

export type CacheCutSummary = z.infer<typeof cacheCutSummarySchema>

/**
 * ModelBreakdownItem —— 模型调用分布。
 */
export const modelBreakdownItemSchema = z.object({
  /** Provider 名称。 */
  provider: z.string(),
  /** 模型名称。 */
  model: z.string(),
  /** 调用次数。 */
  callCount: z.number().int().nonnegative().default(0),
  /** 估算费用。 */
  estimatedCost: z.number().nonnegative().default(0),
  /** 总 token。 */
  totalTokens: z.number().int().nonnegative().default(0),
  /** 平均延迟（毫秒）。 */
  avgLatencyMs: z.number().nonnegative().default(0),
})

export type ModelBreakdownItem = z.infer<typeof modelBreakdownItemSchema>

/**
 * ErrorBreakdownItem —— 错误分布。
 */
export const errorBreakdownItemSchema = z.object({
  /** 错误分类。 */
  errorCategory: errorCategorySchema,
  /** 发生次数。 */
  count: z.number().int().nonnegative().default(0),
  /** 最后发生时间。 */
  lastOccurredAt: z.string().datetime().optional(),
})

export type ErrorBreakdownItem = z.infer<typeof errorBreakdownItemSchema>

/**
 * ObservabilitySummary —— Compiler run/stage 级可观测摘要。
 *
 * 基于持久化 observability event、cost event、Ledger evidence 和 artifact refs 聚合。
 * 禁止依赖进程内计数。
 */
export const observabilitySummarySchema = z.object({
  /** Compiler run ID。 */
  compilerRunId: z.number().int().positive(),
  /** Stage ID（可选 — 省略则为 run 级摘要）。 */
  stageId: z.string().optional(),
  /** 预算状态。 */
  budgetStatus: budgetDecisionStatusSchema.optional(),
  /** 预算决策列表。 */
  budgetDecisions: z.array(budgetDecisionSchema).optional(),
  /** 预算告警。 */
  budgetWarnings: z.array(z.string()).optional(),
  /** 成本摘要。 */
  costSummary: z.array(costSummaryItemSchema).optional(),
  /** token 摘要。 */
  tokenSummary: z.array(tokenSummaryItemSchema).optional(),
  /** 延迟摘要。 */
  latencySummary: z.array(latencySummaryItemSchema).optional(),
  /** 重试摘要。 */
  retrySummary: z.array(retrySummaryItemSchema).optional(),
  /** 缓存和裁剪摘要。 */
  cacheCutSummary: cacheCutSummarySchema.optional(),
  /** 模型调用分布。 */
  modelBreakdown: z.array(modelBreakdownItemSchema).optional(),
  /** 错误分布。 */
  errorBreakdown: z.array(errorBreakdownItemSchema).optional(),
  /** 关联的 evidence refs（Ledger evidence 和 artifact refs）。 */
  evidenceRefs: z.array(z.string()).optional(),
  /** 聚合时间。 */
  aggregatedAt: z.string().datetime().optional(),
  /** 事件数量。 */
  totalEvents: z.number().int().nonnegative().default(0),
  /** LLM 调用总次数。 */
  totalLlmCalls: z.number().int().nonnegative().default(0),
  /** 运行总耗时（毫秒）。 */
  totalDurationMs: z.number().int().nonnegative().default(0),
})

export type ObservabilitySummary = z.infer<typeof observabilitySummarySchema>
