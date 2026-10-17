/**
 * v3-triz-ifr-visualization —— TRIZ IFR（最终理想解）可视化共享契约与确定性纯函数引擎。
 *
 * 所有 IFR 计算是确定性的、可解释的、版本化的。
 * AI 生成不得修改分数、公式版本、来源 refs、排序、warnings 或置信度。
 *
 * 注意：.js 扩展是后端 AdonisJS NodeNext 要求；前端通过 transpilePackages 自动匹配 .ts。
 */

// ─── Enums & Constants ──────────────────────────────────────────

/** IFR schema 版本（每次破坏性结构变更递增）。 */
export const IFR_SCHEMA_VERSION = 1 as const

/** 理想度公式版本（每次权重或公式变更递增）。 */
export const IFR_SCORE_VERSION = 1 as const

/** 审查状态。 */
export type IfrReviewStatus = 'draft' | 'saved' | 'superseded' | 'stale'

/** 有效审查状态白名单。 */
export const IFR_REVIEW_STATUSES: readonly IfrReviewStatus[] = [
  'draft',
  'saved',
  'superseded',
  'stale',
]

export function isIfrReviewStatus(v: unknown): v is IfrReviewStatus {
  return IFR_REVIEW_STATUSES.includes(v as IfrReviewStatus)
}

/** 来源类型。 */
export type IfrSourceKind =
  | 'project_state'
  | 'user_input'
  | 'contradiction'
  | 'analysis_artifact'
  | 'rationale'
  | 'workbench_scheme'
  | 'decision_log'

/** 有效来源类型白名单。 */
export const IFR_SOURCE_KINDS: readonly IfrSourceKind[] = [
  'project_state',
  'user_input',
  'contradiction',
  'analysis_artifact',
  'rationale',
  'workbench_scheme',
  'decision_log',
]

export function isIfrSourceKind(v: unknown): v is IfrSourceKind {
  return IFR_SOURCE_KINDS.includes(v as IfrSourceKind)
}

/** 阶段类型。 */
export type IfrStageKind = 'current' | 'intermediate' | 'target'

/** 有效阶段类型白名单。 */
export const IFR_STAGE_KINDS: readonly IfrStageKind[] = ['current', 'intermediate', 'target']

export function isIfrStageKind(v: unknown): v is IfrStageKind {
  return IFR_STAGE_KINDS.includes(v as IfrStageKind)
}

/** IFR warning 代码。 */
export type IfrWarningCode =
  | 'MISSING_COST_DATA'
  | 'MISSING_HARM_DATA'
  | 'MISSING_USEFUL_FUNCTION_DATA'
  | 'STALE_SOURCE'
  | 'SOURCE_UNAVAILABLE'
  | 'NO_CONTRADICTIONS'
  | 'NO_WORKBENCH_SCHEMES'
  | 'NO_DECISION_LOGS'
  | 'AI_DRAFT_FALLBACK'
  | 'AI_DRAFT_VALIDATION_FAILED'
  | 'INACCESSIBLE_SOURCE'
  | 'LARGE_STAGE_SET'
  | 'HANDOFF_STALE_BLOCKED'

/** AI 草稿状态。 */
export type IfrAiDraftState = 'draft' | 'validated' | 'fallback' | 'unsafe'

/** 有效 AI 草稿状态。 */
export const IFR_AI_DRAFT_STATES: readonly IfrAiDraftState[] = [
  'draft',
  'validated',
  'fallback',
  'unsafe',
]

export function isIfrAiDraftState(v: unknown): v is IfrAiDraftState {
  return IFR_AI_DRAFT_STATES.includes(v as IfrAiDraftState)
}

/** Handoff 目标。 */
export type IfrHandoffTarget = 'innovation_workbench' | 'decision_log' | 'rationale' | 'draft_layer'

/** 有效 handoff 目标。 */
export const IFR_HANDOFF_TARGETS: readonly IfrHandoffTarget[] = [
  'innovation_workbench',
  'decision_log',
  'rationale',
  'draft_layer',
]

export function isIfrHandoffTarget(v: unknown): v is IfrHandoffTarget {
  return IFR_HANDOFF_TARGETS.includes(v as IfrHandoffTarget)
}

/** 默认理想度权重（可配置，版本化）。 */
export const DEFAULT_IDEALITY_WEIGHTS = {
  usefulFunction: 0.5,
  cost: 0.25,
  harm: 0.25,
} as const

/** 理想度维度范围 [0, 1]。 */
export const IDEALITY_DIMENSION_MIN = 0 as const
export const IDEALITY_DIMENSION_MAX = 1 as const

// ─── DTOs ───────────────────────────────────────────────────────

/** 理想度指标输入。 */
export interface IdealityMeasureInput {
  /** 标准化有用功能度量 (0-1) */
  usefulFunction: number
  /** 标准化成本度量 (0-1, 较低更好) */
  cost: number
  /** 标准化危害度量 (0-1, 较低更好) */
  harm: number
}

/** 理想度维度计算结果。 */
export interface IdealityDimension {
  name: 'useful_function' | 'cost' | 'harm'
  raw: number
  normalized: number
  weight: number
  weightedScore: number
  hasData: boolean
}

/** 理想度评分输出。 */
export interface IdealityScoreOutput {
  formulaVersion: number
  dimensions: IdealityDimension[]
  aggregateScore: number
  confidence: number
  missingDataWarnings: IfrWarningCode[]
  sourceRefs: IfrSourceRef[]
  outputHash: string
}

/** IFR 趋势摘要。 */
export interface IfrTrendSummary {
  usefulFunctionTrend: 'improving' | 'stable' | 'declining' | 'unknown'
  costTrend: 'decreasing' | 'stable' | 'increasing' | 'unknown'
  harmTrend: 'decreasing' | 'stable' | 'increasing' | 'unknown'
  overallDirection: 'toward_ideal' | 'away_from_ideal' | 'stable' | 'needs_review'
  summaryText: string
  trendHash: string
}

/** IFR 来源 ref（低敏）。 */
export interface IfrSourceRef {
  kind: IfrSourceKind
  /** 低敏来源标识符（不含完整证据正文） */
  refId: string
  title: string
  hash: string
  stale: boolean
  staleReason: string | null
  /** 授权导航目标（未授权时用 null） */
  navigationRef: string | null
  kindVersion: string
}

/** IFR 演进路径阶段。 */
export interface IfrStage {
  stageId: string
  kind: IfrStageKind
  label: string
  description: string
  expectedUsefulFunctionChange: string
  expectedCostChange: string
  expectedHarmChange: string
  relatedPrincipleRefs: string[]
  relatedContradictionRefs: string[]
  warningCodes: IfrWarningCode[]
  reviewState: 'pending' | 'reviewed' | 'needs_revision'
  stageHash: string
  stale: boolean
}

/** IFR 预览（只读，无副作用）。 */
export interface IfrPreview {
  previewId: string
  organizationId: number
  projectId: number
  currentState: string
  idealState: string
  stages: IfrStage[]
  idealityScore: IdealityScoreOutput
  trendSummary: IfrTrendSummary
  sourceRefs: IfrSourceRef[]
  warningSummary: IfrWarningCode[]
  aiDraftState: IfrAiDraftState | null
  reviewStatus: 'preview'
  schemaVersion: number
  scoreVersion: number
  outputHash: string
}

/** IFR 保存的审查（持久化快照）。 */
export interface IfrSavedReview {
  ifrId: string
  organizationId: number
  projectId: number
  currentState: string
  idealState: string
  stages: IfrStage[]
  idealityScore: IdealityScoreOutput
  trendSummary: IfrTrendSummary
  sourceRefs: IfrSourceRef[]
  warningSummary: IfrWarningCode[]
  aiDraftState: IfrAiDraftState | null
  reviewStatus: IfrReviewStatus
  schemaVersion: number
  scoreVersion: number
  outputHash: string
  actorId: number
  createdAt: string
  updatedAt: string
}

/** AI IFR 草稿输出。 */
export interface IfrAiDraftOutput {
  idealStateDraft: string
  stageDescriptions: Record<string, string>
  gapSuggestions: string[]
  aiDraftState: IfrAiDraftState
  warnings: IfrWarningCode[]
  costSummary: {
    provider: string
    model: string
    estimatedTokens: number
    estimatedCost: number
    latencyMs: number
  } | null
  inputHash: string
  outputRef: string
  fallbackReason: string | null
}

/** IFR 新鲜度比较结果。 */
export interface IfrFreshnessResult {
  isFresh: boolean
  staleStageIds: string[]
  staleSourceKinds: IfrSourceKind[]
  staleReason: string | null
  currentSourceHash: string
  storedSourceHash: string
}

/** IFR handoff 输入。 */
export interface IfrHandoffInput {
  ifrId: string
  projectId: number
  organizationId: number
  target: IfrHandoffTarget
  stageRefs: string[]
  suggestionRefs: string[]
  principleRefs: string[]
  sourceRefs: IfrSourceRef[]
  sourceHash: string
  outputHash: string
  warningSummary: IfrWarningCode[]
  actorId: number
  idempotencyKey: string
  requiresUserConfirmation: boolean
}

/** IFR handoff 候选输出。 */
export interface IfrHandoffCandidate {
  input: IfrHandoffInput
  targetRef: string
  staleBlocked: boolean
  staleReason: string | null
  candidateHash: string
  createdAt: string
}

/** IFR API 预览响应。 */
export interface IfrPreviewResponse {
  data: IfrPreview
}

/** IFR API 列表响应。 */
export interface IfrListResponse {
  data: IfrSavedReview[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** IFR API 详情响应。 */
export interface IfrDetailResponse {
  data: IfrSavedReview
}

/** IFR AI 草稿响应。 */
export interface IfrAiDraftResponse {
  data: IfrAiDraftOutput
}

/** IFR 新鲜度响应。 */
export interface IfrFreshnessResponse {
  data: IfrFreshnessResult
}

/** IFR handoff 候选响应。 */
export interface IfrHandoffCandidateResponse {
  data: IfrHandoffCandidate
}

/** IFR 保存请求 body。 */
export interface IfrSaveRequest {
  confirmation: boolean
  idealState?: string
  stages?: { stageId: string; label?: string; description?: string }[]
}

/** IFR AI 草稿请求。 */
export interface IfrAiDraftRequest {
  focusAreas?: string[]
  stageId?: string
}

/** IFR handoff 请求。 */
export interface IfrHandoffRequest {
  target: IfrHandoffTarget
  stageRefs: string[]
  suggestionRefs: string[]
  principleRefs: string[]
  confirmation: boolean
}

// ─── Pure Functions ─────────────────────────────────────────────

/**
 * 标准化理想度输入：将所有输入钳制到 [0, 1]。
 */
export function normalizeIdealityInput(input: Partial<IdealityMeasureInput>): IdealityMeasureInput {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  return {
    usefulFunction: clamp(input.usefulFunction ?? 0),
    cost: clamp(input.cost ?? 0),
    harm: clamp(input.harm ?? 0),
  }
}

/**
 * 计算理想度评分。
 * 公式：Ideality = Σ(w_i × norm_i)，其中 w_useful=0.5, w_cost=0.25, w_harm=0.25
 * cost 和 harm 反序（较低更好 → 较高分数）。
 */
export function computeIdealityScore(
  input: IdealityMeasureInput,
  weights: typeof DEFAULT_IDEALITY_WEIGHTS = DEFAULT_IDEALITY_WEIGHTS,
  sourceRefs: IfrSourceRef[] = [],
): IdealityScoreOutput {
  const normalized = normalizeIdealityInput(input)

  const dimensions: IdealityDimension[] = [
    {
      name: 'useful_function',
      raw: input.usefulFunction,
      normalized: normalized.usefulFunction,
      weight: weights.usefulFunction,
      weightedScore: normalized.usefulFunction * weights.usefulFunction,
      hasData:
        input.usefulFunction !== undefined &&
        input.usefulFunction !== null &&
        !Number.isNaN(input.usefulFunction) &&
        input.usefulFunction > 0,
    },
    {
      name: 'cost',
      raw: input.cost,
      normalized: normalized.cost,
      weight: weights.cost,
      // 成本越低越好 → (1 - cost) × weight
      weightedScore: (1 - normalized.cost) * weights.cost,
      hasData:
        input.cost !== undefined &&
        input.cost !== null &&
        !Number.isNaN(input.cost) &&
        input.cost > 0,
    },
    {
      name: 'harm',
      raw: input.harm,
      normalized: normalized.harm,
      weight: weights.harm,
      // 危害越低越好 → (1 - harm) × weight
      weightedScore: (1 - normalized.harm) * weights.harm,
      hasData:
        input.harm !== undefined &&
        input.harm !== null &&
        !Number.isNaN(input.harm) &&
        input.harm > 0,
    },
  ]

  const aggregateScore = dimensions.reduce((sum, d) => sum + d.weightedScore, 0)

  const missingDataWarnings: IfrWarningCode[] = []
  if (!dimensions[0]?.hasData) missingDataWarnings.push('MISSING_USEFUL_FUNCTION_DATA')
  if (!dimensions[1]?.hasData) missingDataWarnings.push('MISSING_COST_DATA')
  if (!dimensions[2]?.hasData) missingDataWarnings.push('MISSING_HARM_DATA')

  const confidence = computeIdealityConfidence(missingDataWarnings, dimensions)

  const outputHash = computeIfrOutputHash({
    aggregateScore,
    dimensions,
    missingDataWarnings,
    sourceRefs,
  })

  return {
    formulaVersion: IFR_SCORE_VERSION,
    dimensions,
    aggregateScore,
    confidence,
    missingDataWarnings,
    sourceRefs,
    outputHash,
  }
}

/**
 * 计算理想度置信度。
 * 每个缺失数据维度将降低置信度 25%（最多降至 25% 基础值）。
 */
export function computeIdealityConfidence(
  missingDataWarnings: IfrWarningCode[],
  dimensions: IdealityDimension[],
): number {
  const baseConfidence = 0.95
  const missingPenalty = missingDataWarnings.length * 0.25
  const dimensionUncertainty =
    dimensions.filter((d) => d.normalized < 0.1 && d.hasData).length * 0.05
  return Math.max(0.2, Math.min(1.0, baseConfidence - missingPenalty - dimensionUncertainty))
}

/**
 * 计算 IFR 输出 hash（SHA-256 前 16 字符 hex）。
 */
export function computeIfrOutputHash(data: {
  aggregateScore: number
  dimensions: IdealityDimension[]
  missingDataWarnings: IfrWarningCode[]
  sourceRefs: IfrSourceRef[]
}): string {
  const payload = JSON.stringify({
    v: IFR_SCORE_VERSION,
    s: data.aggregateScore.toFixed(4),
    d: data.dimensions.map((d) => ({
      n: d.name,
      r: d.raw.toFixed(4),
      w: d.weight,
      ws: d.weightedScore.toFixed(4),
    })),
    w: data.missingDataWarnings.sort(),
    sr: data.sourceRefs.map((r) => `${r.kind}:${r.hash}`).sort(),
  })
  // 简化的确定性 hash（SHA-256 模拟，首期使用 djb2 变体 hash）
  return simpleHash(payload)
}

/**
 * 计算趋势摘要。
 */
export function computeIfrTrendSummary(
  currentScore: IdealityScoreOutput,
  previousScore: IdealityScoreOutput | null,
): IfrTrendSummary {
  if (!previousScore) {
    return {
      usefulFunctionTrend: 'unknown',
      costTrend: 'unknown',
      harmTrend: 'unknown',
      overallDirection: 'needs_review',
      summaryText: '尚无历史数据可比较趋势。请保存首个 IFR 审查以建立基线。',
      trendHash: simpleHash(JSON.stringify({ current: currentScore.outputHash, previous: null })),
    }
  }

  const ufDelta =
    (currentScore.dimensions[0]?.weightedScore ?? 0) -
    (previousScore.dimensions[0]?.weightedScore ?? 0)
  const costDelta =
    (currentScore.dimensions[1]?.weightedScore ?? 0) -
    (previousScore.dimensions[1]?.weightedScore ?? 0)
  const harmDelta =
    (currentScore.dimensions[2]?.weightedScore ?? 0) -
    (previousScore.dimensions[2]?.weightedScore ?? 0)

  const threshold = 0.01

  const classify = (delta: number, kind: 'uf' | 'cost' | 'harm'): string => {
    if (delta > threshold) {
      return kind === 'uf' ? 'improving' : kind === 'cost' ? 'decreasing' : 'decreasing'
    }
    if (delta < -threshold) {
      return kind === 'uf' ? 'declining' : kind === 'cost' ? 'increasing' : 'increasing'
    }
    return 'stable'
  }

  const usefulFunctionTrend = classify(ufDelta, 'uf') as IfrTrendSummary['usefulFunctionTrend']
  const costTrend = classify(costDelta, 'cost') as IfrTrendSummary['costTrend']
  const harmTrend = classify(harmDelta, 'harm') as IfrTrendSummary['harmTrend']

  let overallDirection: IfrTrendSummary['overallDirection']
  const scoreDelta = currentScore.aggregateScore - previousScore.aggregateScore

  if (scoreDelta > threshold) {
    overallDirection = 'toward_ideal'
  } else if (scoreDelta < -threshold) {
    overallDirection = 'away_from_ideal'
  } else {
    overallDirection = 'stable'
  }

  const trendHash = simpleHash(
    JSON.stringify({
      current: currentScore.outputHash,
      previous: previousScore.outputHash,
      ufDelta: ufDelta.toFixed(4),
      costDelta: costDelta.toFixed(4),
      harmDelta: harmDelta.toFixed(4),
    }),
  )

  return {
    usefulFunctionTrend,
    costTrend,
    harmTrend,
    overallDirection,
    summaryText: buildTrendSummaryText({
      usefulFunctionTrend,
      costTrend,
      harmTrend,
      overallDirection,
      scoreDelta,
    }),
    trendHash,
  }
}

/** 构建趋势摘要文本（中文）。 */
function buildTrendSummaryText(trends: {
  usefulFunctionTrend: string
  costTrend: string
  harmTrend: string
  overallDirection: string
  scoreDelta: number
}): string {
  const parts: string[] = []
  if (trends.usefulFunctionTrend === 'improving') parts.push('有用功能在增长')
  if (trends.usefulFunctionTrend === 'declining') parts.push('有用功能在下降')
  if (trends.costTrend === 'decreasing') parts.push('成本在降低')
  if (trends.costTrend === 'increasing') parts.push('成本在上升')
  if (trends.harmTrend === 'decreasing') parts.push('危害在减少')
  if (trends.harmTrend === 'increasing') parts.push('危害在增加')

  if (trends.overallDirection === 'toward_ideal') parts.push('整体趋向理想解')
  if (trends.overallDirection === 'away_from_ideal') parts.push('整体偏离理想解')
  if (trends.overallDirection === 'stable') parts.push('整体趋势稳定')

  return parts.length > 0 ? parts.join('；') + '。' : '趋势数据不足，无法提供有意义的分析。'
}

/**
 * 排序 IFR 阶段（当前 → 中间（按阶段数量排序） → 目标 IFR）。
 */
export function rankIfrStages(stages: IfrStage[]): IfrStage[] {
  const current = stages.filter((s) => s.kind === 'current')
  const intermediate = stages
    .filter((s) => s.kind === 'intermediate')
    .sort((a, b) => {
      // 按 relatedPrincipleRefs 数量降序（更多原则的中间阶段优先），然后按标签稳定排序
      const pa = a.relatedPrincipleRefs.length
      const pb = b.relatedPrincipleRefs.length
      if (pa !== pb) return pb - pa
      return a.label.localeCompare(b.label)
    })
  const target = stages.filter((s) => s.kind === 'target')

  return [...current, ...intermediate, ...target]
}

/**
 * 计算阶段 hash。
 */
export function computeIfrStageHash(
  stage: Pick<IfrStage, 'kind' | 'label' | 'description'>,
): string {
  return simpleHash(JSON.stringify({ k: stage.kind, l: stage.label, d: stage.description }))
}

/**
 * 计算来源 hash。
 */
export function computeIfrSourceHash(
  sources: Pick<IfrSourceRef, 'kind' | 'refId' | 'hash'>[],
): string {
  const payload = sources
    .map((s) => `${s.kind}:${s.refId}:${s.hash}`)
    .sort()
    .join('|')
  return simpleHash(payload)
}

/**
 * 判断 IFR 来源是否陈旧（当前 hash 与存储 hash 不匹配）。
 */
export function isIfrSourceStale(currentHash: string, storedHash: string): boolean {
  return currentHash !== storedHash
}

/**
 * 检测陈旧阶段。
 */
export function detectIfrStaleStages(
  stages: IfrStage[],
  currentSourceHashes: Map<string, string>,
  storedSourceHashes: Map<string, string>,
): string[] {
  const staleIds: string[] = []
  for (const stage of stages) {
    for (const ref of stage.relatedContradictionRefs) {
      const current = currentSourceHashes.get(ref)
      const stored = storedSourceHashes.get(ref)
      if (current && stored && current !== stored) {
        staleIds.push(stage.stageId)
        break
      }
    }
  }
  return staleIds
}

/**
 * 脱敏 helper：隐藏不可访问来源的字段。
 */
export function redactIfrSourceRef(ref: IfrSourceRef): IfrSourceRef {
  return {
    ...ref,
    title: '[已隐藏]',
    navigationRef: null,
    hash: '',
    stale: false,
    staleReason: null,
    kindVersion: '',
  }
}

/**
 * 聚合 warning 摘要。
 */
export function aggregateIfrWarnings(
  stages: IfrStage[],
  sourceRefs: IfrSourceRef[],
  score: IdealityScoreOutput,
): IfrWarningCode[] {
  const codes = new Set<IfrWarningCode>()

  // 来自分数的缺失数据 warnings
  for (const w of score.missingDataWarnings) {
    codes.add(w)
  }

  // 来自来源的陈旧标记
  if (sourceRefs.some((r) => r.stale)) {
    codes.add('STALE_SOURCE')
  }

  // 来源不可用
  if (sourceRefs.some((r) => r.kindVersion === '' && r.title === '[已隐藏]')) {
    codes.add('INACCESSIBLE_SOURCE')
  }

  // 阶段级的 warnings
  for (const stage of stages) {
    for (const w of stage.warningCodes) {
      codes.add(w)
    }
  }

  // 缺少矛盾
  if (!sourceRefs.some((r) => r.kind === 'contradiction')) {
    codes.add('NO_CONTRADICTIONS')
  }

  // 阶段过多
  if (stages.length > 10) {
    codes.add('LARGE_STAGE_SET')
  }

  return Array.from(codes).sort()
}

/**
 * 验证 handoff 输入。
 */
export function validateIfrHandoffInput(
  input: IfrHandoffInput,
  currentSourceHash: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!input.requiresUserConfirmation) {
    errors.push('handoff 必须包含显式用户确认')
  }

  if (!isIfrHandoffTarget(input.target)) {
    errors.push(`无效的 handoff 目标: ${input.target}`)
  }

  if (input.stageRefs.length === 0 && input.suggestionRefs.length === 0) {
    errors.push('必须至少包含一个阶段 ref 或建议 ref')
  }

  if (input.sourceHash !== currentSourceHash) {
    errors.push('来源 hash 已过期（stale），请在 handoff 前刷新 IFR')
  }

  if (!input.idempotencyKey) {
    errors.push('必须提供 idempotency key')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 生成 idempotency key（基于 IFR id + target + 阶段 refs）。
 */
export function computeIfrHandoffIdempotencyKey(
  ifrId: string,
  target: IfrHandoffTarget,
  stageRefs: string[],
): string {
  return simpleHash(JSON.stringify({ ifrId, target, stageRefs: [...stageRefs].sort() }))
}

/**
 * 脱敏 helper：构建低敏审计摘要（排除完整 prompt/model output/证据正文/token/secret）。
 */
export function buildIfrLowSensitivityAuditMeta(input: {
  actorId: number
  organizationId: number
  projectId: number
  ifrId: string
  stageRefs: string[]
  sourceKinds: IfrSourceKind[]
  sourceHashPrefix: string
  warningCount: number
  outputHash: string
  idempotencyKey: string
}): Record<string, unknown> {
  return {
    actor: input.actorId,
    org: input.organizationId,
    project: input.projectId,
    ifr: input.ifrId,
    stageRefs: input.stageRefs,
    sourceKinds: input.sourceKinds,
    sourceHashPrefix: input.sourceHashPrefix.slice(0, 8),
    warningCount: input.warningCount,
    outputHash: input.outputHash.slice(0, 8),
    idempotencyKey: input.idempotencyKey.slice(0, 8),
    ts: new Date().toISOString(),
  }
}

// ─── Internal Helpers ───────────────────────────────────────────

/**
 * 简化的确定性 hash 函数（djb2 变体，用于稳定输出 hash）。
 * 不适用于加密目的；仅用于缓存键和相等性比较。
 */
export function simpleHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33 + input.charCodeAt(i)) & 0xffffffff
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
