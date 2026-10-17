/**
 * v3-ocr-provider-observability-cost-controls — OCR provider 观测与成本控制共享契约。
 *
 * 本模块提供：
 * - OCR provider attempt 状态、错误分类、警告代码、预算/限流决策枚举
 * - 低敏 DTO（attempt events, budget decisions, rate-limit decisions, cost summaries）
 * - 纯辅助函数（idempotency key, hashing, redaction, warning aggregation, cost estimation）
 * - Fixture builders（用于测试与联调）
 *
 * 红线：不存储 prompt/output/provider body/API key/Authorization header/full extracted text。
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const OCR_PROVIDER_ATTEMPT_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'budget_blocked',
  'rate_limited',
  'capability_mismatch',
  'skipped',
] as const
export type OcrProviderAttemptStatus = (typeof OCR_PROVIDER_ATTEMPT_STATUSES)[number]

export const OCR_PROVIDER_ERROR_CATEGORIES = [
  'none',
  'auth',
  'timeout',
  'rate_limit',
  'unavailable',
  'malformed_response',
  'capability_mismatch',
  'unknown',
] as const
export type OcrProviderErrorCategory = (typeof OCR_PROVIDER_ERROR_CATEGORIES)[number]

export const OCR_PROVIDER_WARNING_CODES = [
  'BUDGET_SOFT_LIMIT_EXCEEDED',
  'BUDGET_HARD_LIMIT_REACHED',
  'RATE_LIMIT_WAIT',
  'RATE_LIMIT_BLOCKED',
  'COST_UNKNOWN',
  'COST_FALLBACK_ESTIMATE',
  'USAGE_UNAVAILABLE',
  'PRICING_SNAPSHOT_MISSING',
  'PROVIDER_DEGRADATION',
  'PROVIDER_UNAVAILABLE',
  'PARTIAL_PAGE_FAILURE',
  'SOURCE_STALE',
  'RETENTION_POLICY_MISSING',
  'FEATURE_FLAG_DISABLED',
] as const
export type OcrProviderWarningCode = (typeof OCR_PROVIDER_WARNING_CODES)[number]

export const OCR_BUDGET_DECISION_STATUSES = [
  'allowed',
  'soft_warning',
  'hard_blocked',
  'unknown',
] as const
export type OcrBudgetDecisionStatus = (typeof OCR_BUDGET_DECISION_STATUSES)[number]

export const OCR_RATE_LIMIT_DECISION_STATUSES = ['allowed', 'wait', 'queued', 'blocked'] as const
export type OcrRateLimitDecisionStatus = (typeof OCR_RATE_LIMIT_DECISION_STATUSES)[number]

export const OCR_COST_STATUSES = [
  'estimated',
  'fallback_estimate',
  'cost_unknown',
  'unavailable',
  'zero',
] as const
export type OcrCostStatus = (typeof OCR_COST_STATUSES)[number]

export const OCR_BUDGET_SCOPES = ['organization', 'project', 'job', 'provider_model'] as const
export type OcrBudgetScope = (typeof OCR_BUDGET_SCOPES)[number]

export const OCR_BUDGET_SOFT_LIMIT_ACTIONS = ['warn', 'review_required', 'allow'] as const
export type OcrBudgetSoftLimitAction = (typeof OCR_BUDGET_SOFT_LIMIT_ACTIONS)[number]

// ---------------------------------------------------------------------------
// Core DTOs
// ---------------------------------------------------------------------------

/** 安全 provider 引用——不含 key/secret/baseUrl。 */
export interface OcrProviderSafeRef {
  provider: string
  model: string
  connectionId?: number | null
  modelId?: number | null
  capabilityMode?: string | null
}

/** 成本估计摘要。 */
export interface OcrCostEstimate {
  estimatedCost: number
  currency: string
  costStatus: OcrCostStatus
  pricingSnapshotId?: string | null
  /** 估计依据：实际 usage 维度 vs page/byte 估计 */
  estimationBasis?: string | null
}

/** OCR provider attempt 低敏事件。 */
export interface OcrProviderAttemptEvent {
  id?: number | string
  organizationId: number
  projectId: number
  ocrJobId: number
  pageId?: number | null
  attemptNumber: number
  providerRef: OcrProviderSafeRef
  capabilityMode?: string | null
  status: OcrProviderAttemptStatus
  latencyMs?: number | null
  usage?: OcrProviderUsageSummary | null
  costEstimate?: OcrCostEstimate | null
  budgetDecisionRef?: string | null
  rateLimitDecisionRef?: string | null
  inputHash?: string | null
  outputRef?: string | null
  outputHash?: string | null
  errorCategory: OcrProviderErrorCategory
  warningCodes: OcrProviderWarningCode[]
  idempotencyKey: string
  occurredAt: string
}

/** OCR provider usage 低敏摘要（扩展自 OcrProviderUsage）。 */
export interface OcrProviderUsageSummary {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  audioTokens?: number | null
  reasoningTokens?: number | null
  contextTokens?: number | null
}

/** OCR 预算决策。 */
export interface OcrBudgetDecision {
  id?: number | string
  organizationId: number
  projectId: number
  ocrJobId?: number | null
  pageId?: number | null
  scope: OcrBudgetScope
  status: OcrBudgetDecisionStatus
  estimatedCost?: number | null
  currency?: string | null
  budgetLimit?: number | null
  budgetUsed?: number | null
  softLimitAction?: OcrBudgetSoftLimitAction | null
  warningCodes: OcrProviderWarningCode[]
  idempotencyKey: string
  metadata?: Record<string, unknown> | null
  createdAt?: string
}

/** OCR 限流决策。 */
export interface OcrRateLimitDecision {
  id?: number | string
  organizationId: number
  projectId: number
  ocrJobId?: number | null
  providerRef: OcrProviderSafeRef
  status: OcrRateLimitDecisionStatus
  rpmLimit?: number | null
  tpmLimit?: number | null
  rpmUsed?: number | null
  tpmUsed?: number | null
  estimatedTokens?: number | null
  waitMs?: number | null
  idempotencyKey: string
  createdAt?: string
}

/** 预算 preflight 输入。 */
export interface OcrBudgetPreflightInput {
  organizationId: number
  projectId: number
  ocrJobId: number
  pageId?: number | null
  provider: string
  model: string
  capabilityMode?: string | null
  estimatedTokens?: number | null
  estimatedCost?: number | null
  currency?: string | null
}

/** 预算 preflight 结果。 */
export interface OcrBudgetPreflightResult {
  allowed: boolean
  status: OcrBudgetDecisionStatus
  warningCodes: OcrProviderWarningCode[]
  decisionId?: string | null
}

/** 预算 postflight 输入。 */
export interface OcrBudgetPostflightInput {
  organizationId: number
  projectId: number
  ocrJobId: number
  pageId?: number | null
  provider: string
  model: string
  actualUsage?: OcrProviderUsageSummary | null
  actualCost?: number | null
  currency?: string | null
  idempotencyKey: string
}

/** 限流 preflight 输入。 */
export interface OcrRateLimitPreflightInput {
  organizationId: number
  projectId: number
  ocrJobId?: number | null
  provider: string
  model: string
  estimatedTokens?: number | null
  rpmLimit?: number | null
  tpmLimit?: number | null
}

/** 限流 preflight 结果。 */
export interface OcrRateLimitPreflightResult {
  allowed: boolean
  status: OcrRateLimitDecisionStatus
  waitMs?: number | null
  decisionId?: string | null
}

/** OCR provider observability 摘要（项目级只读）。 */
export interface OcrProviderObservabilitySummary {
  projectId: number
  totalAttempts: number
  totalPages: number
  succeededAttempts: number
  failedAttempts: number
  budgetBlockedAttempts: number
  rateLimitedAttempts: number
  totalLatencyMs: number
  totalInputTokens?: number | null
  totalOutputTokens?: number | null
  totalEstimatedCost?: number | null
  currency?: string | null
  costStatus: OcrCostStatus
  budgetStatus: OcrBudgetDecisionStatus
  rateLimitStatus: OcrRateLimitDecisionStatus
  errorCategories: Partial<Record<OcrProviderErrorCategory, number>>
  warningCodes: OcrProviderWarningCode[]
  providerRefs: OcrProviderSafeRef[]
  computedAt: string
}

/** OCR provider observability 事件列表筛选。 */
export interface OcrProviderObservabilityFilters {
  ocrJobId?: number | null
  provider?: string | null
  model?: string | null
  status?: OcrProviderAttemptStatus | null
  errorCategory?: OcrProviderErrorCategory | null
  timeWindowStart?: string | null
  timeWindowEnd?: string | null
  page?: number
  perPage?: number
}

/** OCR provider observability 事件列表项（比完整 event 更精简）。 */
export interface OcrProviderObservabilityEventItem {
  id: number | string
  ocrJobId: number
  pageId?: number | null
  attemptNumber: number
  provider: string
  model: string
  status: OcrProviderAttemptStatus
  latencyMs?: number | null
  estimatedCost?: number | null
  currency?: string | null
  costStatus: OcrCostStatus
  errorCategory: OcrProviderErrorCategory
  warningCodes: OcrProviderWarningCode[]
  occurredAt: string
}

/** OCR provider observability 事件列表响应。 */
export interface OcrProviderObservabilityEventList {
  data: OcrProviderObservabilityEventItem[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

// ---------------------------------------------------------------------------
// Pure Helpers — Idempotency
// ---------------------------------------------------------------------------

const OCR_PROVIDER_IDEMPOTENCY_VERSION = '1' as const

export function computeOcrProviderIdempotencyKey(input: {
  organizationId: number
  projectId: number
  ocrJobId: number
  pageId?: number | null
  attemptNumber: number
  scope?: string | null
}): string {
  const parts = [
    `v${OCR_PROVIDER_IDEMPOTENCY_VERSION}`,
    String(input.organizationId),
    String(input.projectId),
    String(input.ocrJobId),
    input.pageId != null ? String(input.pageId) : 'na',
    String(input.attemptNumber),
    input.scope ?? 'attempt',
  ]
  const raw = parts.join(':')
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

export function computeOcrBudgetIdempotencyKey(input: {
  organizationId: number
  projectId: number
  ocrJobId: number
  pageId?: number | null
  scope: OcrBudgetScope
}): string {
  return computeOcrProviderIdempotencyKey({
    organizationId: input.organizationId,
    projectId: input.projectId,
    ocrJobId: input.ocrJobId,
    pageId: input.pageId ?? null,
    attemptNumber: 0,
    scope: `budget:${input.scope}`,
  })
}

export function computeOcrRateLimitIdempotencyKey(input: {
  organizationId: number
  projectId: number
  ocrJobId?: number | null
  provider: string
  model: string
}): string {
  const raw = `v${OCR_PROVIDER_IDEMPOTENCY_VERSION}:rl:${input.organizationId}:${input.projectId}:${input.ocrJobId ?? 'na'}:${input.provider}:${input.model}`
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------
// Pure Helpers — Hashing
// ---------------------------------------------------------------------------

export function computeOcrInputHash(input: {
  imageDataUrl?: string | null
  promptHint?: string | null
  sourceFileName?: string | null
}): string {
  const raw = [input.imageDataUrl ?? '', input.promptHint ?? '', input.sourceFileName ?? ''].join(
    '::',
  )
  return createHash('sha256').update(raw).digest('hex').slice(0, 12)
}

export function computeOcrOutputHash(extractedText: string): string {
  return createHash('sha256').update(extractedText).digest('hex').slice(0, 12)
}

export function computeOcrObservabilitySummaryHash(
  summary: OcrProviderObservabilitySummary,
): string {
  const normalized = {
    projectId: summary.projectId,
    totalAttempts: summary.totalAttempts,
    totalPages: summary.totalPages,
    totalEstimatedCost: summary.totalEstimatedCost,
    computedAt: summary.computedAt,
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 12)
}

// ---------------------------------------------------------------------------
// Pure Helpers — Safe Provider Ref
// ---------------------------------------------------------------------------

export function buildOcrProviderSafeRef(input: {
  provider: string
  model: string
  connectionId?: number | null
  modelId?: number | null
  capabilityMode?: string | null
}): OcrProviderSafeRef {
  return {
    provider: input.provider,
    model: input.model,
    connectionId: input.connectionId ?? null,
    modelId: input.modelId ?? null,
    capabilityMode: input.capabilityMode ?? null,
  }
}

// ---------------------------------------------------------------------------
// Pure Helpers — Warning Aggregation
// ---------------------------------------------------------------------------

export function aggregateOcrWarnings(
  warnings: OcrProviderWarningCode[],
  additional?: OcrProviderWarningCode[] | null,
): OcrProviderWarningCode[] {
  const set = new Set(warnings)
  if (additional) {
    for (const w of additional) set.add(w)
  }
  return [...set].sort()
}

export function isOcrWarningBlocking(codes: OcrProviderWarningCode[]): boolean {
  return codes.some((c) =>
    ['BUDGET_HARD_LIMIT_REACHED', 'RATE_LIMIT_BLOCKED', 'PROVIDER_UNAVAILABLE'].includes(c),
  )
}

// ---------------------------------------------------------------------------
// Pure Helpers — Redaction
// ---------------------------------------------------------------------------

const OCR_PROVIDER_SENSITIVE_KEYS = [
  /api[-_]?key/i,
  /authorization/i,
  /token/i,
  /secret/i,
  /password/i,
  /prompt/i,
  /dataurl/i,
  /base64/i,
  /raw[-_]?body/i,
  /extracted[-_]?text/i,
  /source[-_]?bytes/i,
  /file[-_]?path/i,
]

export function redactOcrProviderObservabilityMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (OCR_PROVIDER_SENSITIVE_KEYS.some((p) => p.test(key))) continue
    safe[key] = value
  }
  return safe
}

export function redactOcrProviderError(errorMessage: string | null | undefined): string {
  if (!errorMessage) return 'unknown'
  // 截断到 200 字符，移除可能的 key/token/路径
  return errorMessage.slice(0, 200).replace(/(sk-[a-zA-Z0-9]{20,})/g, '[REDACTED]')
}

// ---------------------------------------------------------------------------
// Pure Helpers — Cost Estimation
// ---------------------------------------------------------------------------

export interface OcrPricingSnapshot {
  inputCostPer1k?: number | null
  outputCostPer1k?: number | null
  cacheReadCostPer1k?: number | null
  cacheWriteCostPer1k?: number | null
  currency?: string | null
}

export function estimateOcrCost(
  usage: OcrProviderUsageSummary | null | undefined,
  pricing: OcrPricingSnapshot | null | undefined,
  pricingSnapshotId?: string | null,
): OcrCostEstimate {
  const currency = pricing?.currency ?? 'USD'

  if (!usage || (!usage.inputTokens && !usage.outputTokens)) {
    // Check if it's explicit zero vs absent
    const hasExplicitZero = usage && usage.inputTokens === 0 && usage.outputTokens === 0
    return {
      estimatedCost: 0,
      currency,
      costStatus: hasExplicitZero ? 'zero' : 'unavailable',
      pricingSnapshotId: pricingSnapshotId ?? null,
      estimationBasis: hasExplicitZero ? 'usage_is_zero' : 'no_usage_data',
    }
  }

  if (!pricing || (pricing.inputCostPer1k == null && pricing.outputCostPer1k == null)) {
    return {
      estimatedCost: 0,
      currency,
      costStatus: 'cost_unknown',
      pricingSnapshotId: pricingSnapshotId ?? null,
      estimationBasis: 'no_pricing_data',
    }
  }

  let cost = 0
  const inputCostPer1k = pricing.inputCostPer1k ?? 0
  const outputCostPer1k = pricing.outputCostPer1k ?? 0

  if (usage.inputTokens) {
    cost += (usage.inputTokens / 1000) * inputCostPer1k
  }
  if (usage.outputTokens) {
    cost += (usage.outputTokens / 1000) * outputCostPer1k
  }
  if (usage.cacheReadTokens && pricing.cacheReadCostPer1k != null) {
    cost += (usage.cacheReadTokens / 1000) * pricing.cacheReadCostPer1k
  }
  if (usage.cacheWriteTokens && pricing.cacheWriteCostPer1k != null) {
    cost += (usage.cacheWriteTokens / 1000) * pricing.cacheWriteCostPer1k
  }

  const rounded = Math.round(cost * 1000000) / 1000000

  return {
    estimatedCost: rounded,
    currency,
    costStatus: rounded === 0 ? 'zero' : 'estimated',
    pricingSnapshotId: pricingSnapshotId ?? null,
    estimationBasis: 'token_usage',
  }
}

export function estimateOcrCostFallback(
  usage: OcrProviderUsageSummary | null | undefined,
  fallbackInputPrice: number,
  fallbackOutputPrice: number,
  currency?: string | null,
): OcrCostEstimate {
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const cost =
    (inputTokens / 1000) * fallbackInputPrice + (outputTokens / 1000) * fallbackOutputPrice
  const rounded = Math.round(cost * 1000000) / 1000000

  return {
    estimatedCost: rounded,
    currency: currency ?? 'USD',
    costStatus: 'fallback_estimate',
    pricingSnapshotId: null,
    estimationBasis: 'fallback_pricing',
  }
}

// ---------------------------------------------------------------------------
// Pure Helpers — Status Normalization
// ---------------------------------------------------------------------------

export function normalizeOcrErrorCategory(
  errorKind: string | null | undefined,
): OcrProviderErrorCategory {
  if (!errorKind) return 'none'
  const lower = errorKind.toLowerCase()
  if (lower.includes('auth')) return 'auth'
  if (lower.includes('timeout')) return 'timeout'
  if (lower.includes('rate')) return 'rate_limit'
  if (lower.includes('unavailable') || lower.includes('unreachable')) return 'unavailable'
  if (lower.includes('malformed') || lower.includes('parse')) return 'malformed_response'
  if (lower.includes('capability') || lower.includes('mismatch')) return 'capability_mismatch'
  return 'unknown'
}

export function isOcrProviderAttemptStatus(value: string): value is OcrProviderAttemptStatus {
  return OCR_PROVIDER_ATTEMPT_STATUSES.includes(value as OcrProviderAttemptStatus)
}

export function isOcrBudgetDecisionStatus(value: string): value is OcrBudgetDecisionStatus {
  return OCR_BUDGET_DECISION_STATUSES.includes(value as OcrBudgetDecisionStatus)
}

export function isOcrRateLimitDecisionStatus(value: string): value is OcrRateLimitDecisionStatus {
  return OCR_RATE_LIMIT_DECISION_STATUSES.includes(value as OcrRateLimitDecisionStatus)
}

export function isOcrCostStatus(value: string): value is OcrCostStatus {
  return OCR_COST_STATUSES.includes(value as OcrCostStatus)
}

export function isOcrProviderWarningCode(value: string): value is OcrProviderWarningCode {
  return OCR_PROVIDER_WARNING_CODES.includes(value as OcrProviderWarningCode)
}

// ---------------------------------------------------------------------------
// Pure Helpers — Budget Decision
// ---------------------------------------------------------------------------

export function resolveOcrBudgetDecisionStatus(
  estimatedCost: number,
  hardLimit: number | null | undefined,
  softLimit: number | null | undefined,
): OcrBudgetDecisionStatus {
  if (hardLimit != null && estimatedCost > hardLimit) return 'hard_blocked'
  if (softLimit != null && estimatedCost > softLimit) return 'soft_warning'
  return 'allowed'
}

// ---------------------------------------------------------------------------
// Pure Helpers — Rate Limit
// ---------------------------------------------------------------------------

export function checkOcrRateLimitCapacity(
  rpmUsed: number,
  rpmLimit: number | null | undefined,
  tpmUsed: number,
  tpmLimit: number | null | undefined,
  estimatedTokens?: number | null,
): { allowed: boolean; status: OcrRateLimitDecisionStatus } {
  if (rpmLimit != null && rpmUsed >= rpmLimit) return { allowed: false, status: 'blocked' }
  if (tpmLimit != null && tpmUsed + (estimatedTokens ?? 0) > tpmLimit)
    return { allowed: false, status: 'blocked' }
  return { allowed: true, status: 'allowed' }
}

// ---------------------------------------------------------------------------
// Pure Helpers — Summary Builder
// ---------------------------------------------------------------------------

export function buildOcrProviderObservabilitySummary(input: {
  projectId: number
  events: OcrProviderAttemptEvent[]
  computedAt?: string
}): OcrProviderObservabilitySummary {
  const { projectId, events } = input
  let totalLatencyMs = 0
  let totalInputTokens: number | null = null
  let totalOutputTokens: number | null = null
  let totalEstimatedCost: number | null = null
  let currency: string | null = null
  let budgetBlocked = 0
  let rateLimited = 0
  let succeeded = 0
  let failed = 0
  const errorCategories: Record<string, number> = {}
  const warningSet = new Set<OcrProviderWarningCode>()
  const providerRefs: OcrProviderSafeRef[] = []
  const seenProviders = new Set<string>()

  for (const e of events) {
    totalLatencyMs += e.latencyMs ?? 0

    if (e.usage?.inputTokens) {
      totalInputTokens = (totalInputTokens ?? 0) + e.usage.inputTokens
    }
    if (e.usage?.outputTokens) {
      totalOutputTokens = (totalOutputTokens ?? 0) + e.usage.outputTokens
    }

    if (e.costEstimate?.estimatedCost) {
      totalEstimatedCost = (totalEstimatedCost ?? 0) + e.costEstimate.estimatedCost
      currency = e.costEstimate.currency ?? currency
    }

    if (e.status === 'succeeded') succeeded++
    if (e.status === 'failed') failed++
    if (e.status === 'budget_blocked') budgetBlocked++
    if (e.status === 'rate_limited') rateLimited++

    if (e.errorCategory !== 'none') {
      errorCategories[e.errorCategory] = (errorCategories[e.errorCategory] ?? 0) + 1
    }

    for (const w of e.warningCodes) warningSet.add(w)

    const key = `${e.providerRef.provider}:${e.providerRef.model}`
    if (!seenProviders.has(key)) {
      seenProviders.add(key)
      providerRefs.push(e.providerRef)
    }
  }

  let costStatus: OcrCostStatus = 'unavailable'
  if (totalEstimatedCost != null && totalEstimatedCost > 0) costStatus = 'estimated'
  else if (totalInputTokens != null || totalOutputTokens != null) costStatus = 'cost_unknown'

  let budgetStatus: OcrBudgetDecisionStatus = 'allowed'
  if (budgetBlocked > 0) budgetStatus = 'hard_blocked'
  else if (warningSet.has('BUDGET_SOFT_LIMIT_EXCEEDED')) budgetStatus = 'soft_warning'

  let rateLimitStatus: OcrRateLimitDecisionStatus = 'allowed'
  if (rateLimited > 0) rateLimitStatus = 'blocked'
  else if (warningSet.has('RATE_LIMIT_WAIT')) rateLimitStatus = 'wait'

  return {
    projectId,
    totalAttempts: events.length,
    totalPages: events.filter((e) => e.pageId != null).length,
    succeededAttempts: succeeded,
    failedAttempts: failed,
    budgetBlockedAttempts: budgetBlocked,
    rateLimitedAttempts: rateLimited,
    totalLatencyMs,
    totalInputTokens,
    totalOutputTokens,
    totalEstimatedCost,
    currency,
    costStatus,
    budgetStatus,
    rateLimitStatus,
    errorCategories: errorCategories as Partial<Record<OcrProviderErrorCategory, number>>,
    warningCodes: [...warningSet].sort() as OcrProviderWarningCode[],
    providerRefs,
    computedAt: input.computedAt ?? new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Fixture Builders
// ---------------------------------------------------------------------------

export function ocrProviderAttemptFixture(
  overrides?: Partial<OcrProviderAttemptEvent>,
): OcrProviderAttemptEvent {
  return {
    organizationId: 1,
    projectId: 1,
    ocrJobId: 1,
    pageId: 1,
    attemptNumber: 1,
    providerRef: ocrProviderSafeRefFixture(),
    capabilityMode: 'ocr',
    status: 'succeeded',
    latencyMs: 250,
    usage: ocrProviderUsageSummaryFixture(),
    costEstimate: ocrCostEstimateFixture(),
    inputHash: 'abcdef123456',
    outputRef: 'candidate:1',
    outputHash: 'deadbeef1234',
    errorCategory: 'none',
    warningCodes: [],
    idempotencyKey: 'test-ik-001',
    occurredAt: new Date().toISOString(),
    ...overrides,
  }
}

export function ocrProviderSafeRefFixture(
  overrides?: Partial<OcrProviderSafeRef>,
): OcrProviderSafeRef {
  return {
    provider: 'openai-compatible',
    model: 'gpt-4o',
    connectionId: 1,
    modelId: 1,
    capabilityMode: 'vision',
    ...overrides,
  }
}

export function ocrProviderUsageSummaryFixture(
  overrides?: Partial<OcrProviderUsageSummary>,
): OcrProviderUsageSummary {
  return {
    inputTokens: 500,
    outputTokens: 200,
    totalTokens: 700,
    ...overrides,
  }
}

export function ocrCostEstimateFixture(overrides?: Partial<OcrCostEstimate>): OcrCostEstimate {
  return {
    estimatedCost: 0.005,
    currency: 'USD',
    costStatus: 'estimated',
    pricingSnapshotId: 'ps-001',
    estimationBasis: 'token_usage',
    ...overrides,
  }
}

export function ocrBudgetDecisionFixture(
  overrides?: Partial<OcrBudgetDecision>,
): OcrBudgetDecision {
  return {
    organizationId: 1,
    projectId: 1,
    ocrJobId: 1,
    pageId: 1,
    scope: 'job',
    status: 'allowed',
    estimatedCost: 0.005,
    currency: 'USD',
    budgetLimit: 1.0,
    budgetUsed: 0.25,
    warningCodes: [],
    idempotencyKey: 'bd-test-001',
    ...overrides,
  }
}

export function ocrRateLimitDecisionFixture(
  overrides?: Partial<OcrRateLimitDecision>,
): OcrRateLimitDecision {
  return {
    organizationId: 1,
    projectId: 1,
    ocrJobId: 1,
    providerRef: ocrProviderSafeRefFixture(),
    status: 'allowed',
    rpmLimit: 100,
    tpmLimit: 100000,
    rpmUsed: 5,
    tpmUsed: 3500,
    estimatedTokens: 700,
    idempotencyKey: 'rl-test-001',
    ...overrides,
  }
}

export function ocrBudgetPreflightResultFixture(
  overrides?: Partial<OcrBudgetPreflightResult>,
): OcrBudgetPreflightResult {
  return {
    allowed: true,
    status: 'allowed',
    warningCodes: [],
    ...overrides,
  }
}

export function ocrRateLimitPreflightResultFixture(
  overrides?: Partial<OcrRateLimitPreflightResult>,
): OcrRateLimitPreflightResult {
  return {
    allowed: true,
    status: 'allowed',
    ...overrides,
  }
}

export function ocrProviderObservabilitySummaryFixture(
  overrides?: Partial<OcrProviderObservabilitySummary>,
): OcrProviderObservabilitySummary {
  return {
    projectId: 1,
    totalAttempts: 5,
    totalPages: 5,
    succeededAttempts: 4,
    failedAttempts: 0,
    budgetBlockedAttempts: 0,
    rateLimitedAttempts: 0,
    totalLatencyMs: 1250,
    totalInputTokens: 2500,
    totalOutputTokens: 1000,
    totalEstimatedCost: 0.025,
    currency: 'USD',
    costStatus: 'estimated',
    budgetStatus: 'allowed',
    rateLimitStatus: 'allowed',
    errorCategories: { none: 5 },
    warningCodes: [],
    providerRefs: [ocrProviderSafeRefFixture()],
    computedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 聚合 fixture: 多事件场景
// ---------------------------------------------------------------------------

export function ocrProviderAttemptFixtures(): OcrProviderAttemptEvent[] {
  return [
    ocrProviderAttemptFixture({ pageId: 1, attemptNumber: 1 }),
    ocrProviderAttemptFixture({ pageId: 2, attemptNumber: 1, latencyMs: 300 }),
    ocrProviderAttemptFixture({ pageId: 3, attemptNumber: 1, latencyMs: 180 }),
    ocrProviderAttemptFixture({ pageId: 4, attemptNumber: 1, latencyMs: 420 }),
    ocrProviderAttemptFixture({ pageId: 5, attemptNumber: 1, latencyMs: 100 }),
  ]
}

export function ocrProviderAttemptFailureFixture(): OcrProviderAttemptEvent {
  return ocrProviderAttemptFixture({
    status: 'failed',
    errorCategory: 'timeout',
    warningCodes: ['PROVIDER_DEGRADATION'],
    usage: null,
    costEstimate: {
      estimatedCost: 0,
      currency: 'USD',
      costStatus: 'unavailable',
      estimationBasis: 'no_usage_data',
    },
    outputRef: null,
    outputHash: null,
  })
}

export function ocrProviderAttemptBudgetBlockedFixture(): OcrProviderAttemptEvent {
  return ocrProviderAttemptFixture({
    status: 'budget_blocked',
    errorCategory: 'none',
    warningCodes: ['BUDGET_HARD_LIMIT_REACHED'],
    usage: null,
    costEstimate: {
      estimatedCost: 0.005,
      currency: 'USD',
      costStatus: 'estimated',
      pricingSnapshotId: 'ps-001',
      estimationBasis: 'preflight_estimate',
    },
    latencyMs: null,
    budgetDecisionRef: 'bd:budget:job:abc123',
    outputRef: null,
    outputHash: null,
  })
}

export function ocrProviderAttemptRateLimitedFixture(): OcrProviderAttemptEvent {
  return ocrProviderAttemptFixture({
    status: 'rate_limited',
    errorCategory: 'none',
    warningCodes: ['RATE_LIMIT_BLOCKED'],
    usage: null,
    costEstimate: null,
    latencyMs: null,
    rateLimitDecisionRef: 'rl:blocked:def456',
    outputRef: null,
    outputHash: null,
  })
}

export function ocrProviderAttemptUnknownCostFixture(): OcrProviderAttemptEvent {
  return ocrProviderAttemptFixture({
    usage: { inputTokens: 300, outputTokens: 150, totalTokens: 450 },
    costEstimate: {
      estimatedCost: 0,
      currency: 'USD',
      costStatus: 'cost_unknown',
      pricingSnapshotId: null,
      estimationBasis: 'no_pricing_data',
    },
    warningCodes: ['COST_UNKNOWN'],
  })
}

export function ocrProviderAttemptNoUsageFixture(): OcrProviderAttemptEvent {
  return ocrProviderAttemptFixture({
    usage: null,
    costEstimate: {
      estimatedCost: 0,
      currency: 'USD',
      costStatus: 'unavailable',
      estimationBasis: 'no_usage_data',
    },
    warningCodes: ['USAGE_UNAVAILABLE'],
  })
}
