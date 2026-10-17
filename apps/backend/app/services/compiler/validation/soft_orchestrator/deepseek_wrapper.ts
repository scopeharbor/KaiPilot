/**
 * @aiproj/backend —— DeepSeek V4 Flash Soft Evaluator 调用包装。
 *
 * 通过现有 AIGateway/Adapter 调用 DeepSeek V4 Flash，提供：
 * - 5.1: 单维度/小维度组 prompt builder（小 JSON schema）
 * - 5.2: 复用 AIGateway，不新增模型接入层
 * - 5.3: 低温度、JSON 示例、max_tokens、attempt/dimension/stage ID、provider/model 记录
 * - 5.4: 响应 parse、zod validation、unknown field normalization、entity ID 校验、confidence 调整
 * - 5.5: 空内容、malformed JSON、truncated JSON、provider error、timeout → retry/soft_unavailable fallback
 */

import type { SoftDimensionScore } from '@aiproj/compiler-spec'

// ── Call Config ──

export interface SoftEvaluatorCallConfig {
  /** Stage ID。 */
  stageId: string
  /** Dimension ID（单维度调用）或首维 ID（小组调用）。 */
  dimensionId: string
  /** 评估的维度 ID 列表。 */
  dimensionIds: string[]
  /** Attempt ID（用于追踪）。 */
  attemptId: string
  /** provider/model 记录。 */
  provider: string
  model: string
  /** 温度。 */
  temperature: number
  /** 最大输出 token。 */
  maxTokens: number
  /** 最大重试次数。 */
  maxRetries: number
}

// ── Dimension Input ──

/**
 * 传递给 LLM 的评估输入（单维度）。
 */
export interface DimensionEvaluationInput {
  dimensionId: string
  dimensionName: string
  rubric: string
  pdmSlice: Record<string, unknown>
  deterministicSignals: Record<string, unknown>
}

// ── Response Types ──

/**
 * 期望的 LLM JSON 输出结构（单维度）。
 */
export interface LlmDimensionResponse {
  dimensionId: string
  score: number
  confidence: number
  rationale: string
  findings: {
    description: string
    severity?: 'info' | 'warning' | 'attention'
    affectedEntityIds?: string[]
    evidenceSnippet?: string
    suggestedReviewAction?: string
  }[]
}

// ── Error Classification ──

export type SoftCallErrorKind =
  | 'empty_content'
  | 'not_json'
  | 'truncated_json'
  | 'missing_fields'
  | 'invalid_score'
  | 'unknown_fields'
  | 'provider_error'
  | 'timeout'
  | 'retry_exhausted'

export interface SoftCallResult {
  success: boolean
  data?: LlmDimensionResponse
  errorKind?: SoftCallErrorKind
  errorMessage?: string
  tokensUsed: number
  latencyMs: number
  retryCount: number
}

// ── Prompt Builder ──

/**
 * 构建 Soft Evaluator 的单维度评估 prompt。
 * 每次只构造单维度 JSON schema，避免长 JSON 截断。
 */
export function buildDimensionPrompt(
  input: DimensionEvaluationInput,
  _config: SoftEvaluatorCallConfig,
): { systemPrompt: string; userPrompt: string } {
  const jsonExample: LlmDimensionResponse = {
    dimensionId: input.dimensionId,
    score: 3,
    confidence: 0.8,
    rationale: '基于 xxx 分析，该维度评分中等，因为...',
    findings: [
      {
        description: '具体问题描述',
        severity: 'warning',
        affectedEntityIds: ['T1task_abc123', 'T2task_def456'],
        evidenceSnippet: '相关的证据摘要',
        suggestedReviewAction: '建议的操作',
      },
    ],
  }

  const systemPrompt = [
    `你是一个项目管理质量评估专家。请对以下维度进行评分。`,
    ``,
    `维度和评分标准：`,
    `ID: ${input.dimensionId}`,
    `名称: ${input.dimensionName}`,
    `评分标准 (1-5):`,
    input.rubric,
    ``,
    `评分规则：`,
    `- score: 1-5 整数，1=最差 5=最佳`,
    `- confidence: 0-1 浮点数，表示你对该评分的信心`,
    `- rationale: 评分理由，引用具体数据`,
    `- findings: 发现的问题列表，每个 finding 必须：`,
    `  * 有 description 描述具体问题`,
    `  * 引用 affectedEntityIds（必须是在输入中存在的实体 ID）`,
    `  * 如果无法引用具体实体 ID，将 unanchored 设为 true`,
    `  * 提供 evidenceSnippet 和 suggestedReviewAction`,
    ``,
    `重要：`,
    `- 你的评分是辅助性的，最终决策由硬规则和人工决定`,
    `- 不要编造不存在的实体 ID`,
    `- 无法引用实体时在 findings 中说明`,
  ].join('\n')

  const deterministicSection =
    Object.keys(input.deterministicSignals).length > 0
      ? `\n参考的统计数据（可用于辅助判断）：\n${JSON.stringify(input.deterministicSignals, null, 2)}\n`
      : ''

  const userPrompt = [
    `请评估维度 "${input.dimensionId} - ${input.dimensionName}"。`,
    deterministicSection,
    `PDM 相关数据片段：`,
    JSON.stringify(input.pdmSlice, null, 2),
    ``,
    `请输出以下 JSON 格式（不要包含 markdown 代码块标记）：`,
    JSON.stringify(jsonExample, null, 2),
  ].join('\n')

  return { systemPrompt, userPrompt }
}

// ── Response Parser ──

/**
 * 解析 LLM 响应，进行 zod validation、unknown field normalization、entity ID 校验、confidence 调整。
 */
export function parseDimensionResponse(
  rawText: string,
  dimensionId: string,
  knownEntityIds: string[],
): SoftCallResult {
  const baseResult: SoftCallResult = {
    success: false,
    tokensUsed: 0,
    latencyMs: 0,
    retryCount: 0,
  }

  // 5.5: 空内容检测
  if (!rawText || rawText.trim().length === 0) {
    return { ...baseResult, errorKind: 'empty_content', errorMessage: '模型返回空内容' }
  }

  // 提取 JSON（处理可能的 markdown 代码块包裹）
  let jsonStr = rawText.trim()
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  // 5.5: JSON parse——先尝试解析，失败时判断是否截断
  let parsed: any
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    // 截断检测：以不完整结构结尾
    const isTruncated =
      !jsonStr.trimEnd().endsWith('}') &&
      !jsonStr.trimEnd().endsWith(']') &&
      (jsonStr.includes('"score"') || jsonStr.includes('"'))

    if (isTruncated || jsonStr.trimEnd().match(/[,]\s*$/)) {
      return {
        ...baseResult,
        errorKind: 'truncated_json',
        errorMessage: 'JSON 被截断，无法完整解析',
      }
    }
    return { ...baseResult, errorKind: 'not_json', errorMessage: '响应不是合法 JSON' }
  }

  // 5.4: unknown field normalization（只保留已知字段）
  const knownFields = new Set(['dimensionId', 'score', 'confidence', 'rationale', 'findings'])
  const normalized: Record<string, unknown> = {}
  for (const key of Object.keys(parsed)) {
    if (knownFields.has(key)) {
      normalized[key] = parsed[key]
    }
  }
  // 如果所有字段都被剥离，视为空结果
  if (Object.keys(normalized).length === 0) {
    return { ...baseResult, errorKind: 'unknown_fields', errorMessage: '所有字段均为未知字段' }
  }

  // 类型校验
  if (normalized.dimensionId !== dimensionId) {
    return {
      ...baseResult,
      errorKind: 'missing_fields',
      errorMessage: `dimensionId 不匹配: 期望 ${dimensionId}, 得到 ${normalized.dimensionId}`,
    }
  }

  const score = typeof normalized.score === 'number' ? normalized.score : Number(normalized.score)
  if (Number.isNaN(score) || score < 1 || score > 5) {
    return {
      ...baseResult,
      errorKind: 'invalid_score',
      errorMessage: `score 不在 1-5 范围: ${normalized.score}`,
    }
  }

  let confidence =
    typeof normalized.confidence === 'number'
      ? normalized.confidence
      : Number(normalized.confidence)
  if (Number.isNaN(confidence)) confidence = 0.5
  // 调整 confidence 到 0-1 范围
  confidence = Math.max(0, Math.min(1, confidence))

  // 5.4: entity ID 校验和 confidence 调整
  const findings = Array.isArray(normalized.findings) ? normalized.findings : []
  const validatedFindings: LlmDimensionResponse['findings'] = []
  let hasUnanchoredFinding = false

  for (const f of findings) {
    if (!f.description) continue

    const entityIds = Array.isArray(f.affectedEntityIds) ? f.affectedEntityIds : []
    const validEntityIds = entityIds.filter((id: string) => knownEntityIds.includes(id))

    if (entityIds.length > 0 && validEntityIds.length === 0) {
      // 实体 ID 无效 → unanchored
      hasUnanchoredFinding = true
    }

    validatedFindings.push({
      description: f.description,
      severity: (['info', 'warning', 'attention'] as const).includes(f.severity)
        ? f.severity
        : 'info',
      affectedEntityIds: validEntityIds,
      evidenceSnippet: f.evidenceSnippet ?? '',
      suggestedReviewAction: f.suggestedReviewAction ?? '',
    })
  }

  // 全局 confidence 调整：如果有 unanchored finding，降低整体 confidence
  const adjustedConfidence = hasUnanchoredFinding ? confidence * 0.85 : confidence

  const data: LlmDimensionResponse = {
    dimensionId: normalized.dimensionId as string,
    score,
    confidence: adjustedConfidence,
    rationale: (normalized.rationale as string) ?? '',
    findings: validatedFindings,
  }

  return { ...baseResult, success: true, data }
}

// ── Retry / Fallback Logic ──

/**
 * 判断错误是否可重试。
 */
export function isRetryable(errorKind: SoftCallErrorKind): boolean {
  switch (errorKind) {
    case 'empty_content':
    case 'not_json':
    case 'truncated_json':
    case 'missing_fields':
    case 'invalid_score':
    case 'unknown_fields':
    case 'timeout':
      return true
    case 'provider_error':
    case 'retry_exhausted':
      return false
  }
}

/**
 * 创建 soft_unavailable 的降级维度结果。
 */
export function createUnavailableDimension(
  _dimensionId: string,
  reason: string,
  _attemptId: string,
  _config: SoftEvaluatorCallConfig,
  retryCount: number,
): SoftCallResult {
  return {
    success: false,
    errorKind: 'retry_exhausted',
    errorMessage: reason,
    tokensUsed: 0,
    latencyMs: 0,
    retryCount,
  }
}

// ── Response to DimensionScore ──

/**
 * 将 LLM 响应转换为 SoftDimensionScore。
 */
export function toDimensionScore(
  result: SoftCallResult,
  dimensionId: string,
  config: SoftEvaluatorCallConfig,
  tokensUsed: number,
  latencyMs: number,
): SoftDimensionScore {
  const data = result.data
  if (!result.success || !data) {
    return {
      dimensionId,
      score: 0,
      confidence: 0,
      rationale: result.errorMessage ?? '评估不可用',
      findings: [],
      status: 'unavailable',
      unavailableReason: result.errorMessage ?? 'unknown_error',
      attemptId: config.attemptId,
      provider: config.provider,
      model: config.model,
      tokensUsed,
      latencyMs,
      retryCount: result.retryCount,
    }
  }

  return {
    dimensionId: data.dimensionId,
    score: data.score,
    confidence: data.confidence,
    rationale: data.rationale,
    findings: data.findings.map((f) => ({
      findingId: `f-${config.attemptId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description: f.description,
      severity: f.severity ?? 'info',
      affectedEntityIds: f.affectedEntityIds ?? [],
      unanchored:
        (f.affectedEntityIds ?? []).length > 0
          ? (f.affectedEntityIds ?? []).some((id: string) => !config.dimensionIds.includes(id))
          : false,
      evidenceSnippet: f.evidenceSnippet ?? '',
      suggestedReviewAction: f.suggestedReviewAction ?? '',
      confidence: data.confidence,
    })),
    status: 'evaluated',
    attemptId: config.attemptId,
    provider: config.provider,
    model: config.model,
    tokensUsed,
    latencyMs,
    retryCount: result.retryCount,
  }
}
