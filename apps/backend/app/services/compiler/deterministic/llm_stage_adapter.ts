/**
 * Compiler LLM Stage Adapter —— DeepSeek V4 Flash 适配约束（task 9）。
 *
 * 在 LLM stage 调用前后施加约束：
 * - prompt 必须包含 json 示例
 * - max_tokens 按 stage schema 设置
 * - 对空内容、malformed JSON、truncated JSON、unknown fields 进行分类
 * - 确保模型输出只生成 candidate patch，computed 字段由 deterministic engine 重算
 *
 * @aiproj/backend
 */

// ── LLM Stage Call Config ──

export interface LlmStageCallConfig {
  stageId: string
  jsonSchemaName: string
  entityIds: string[]
  /** stage 的 schema 示例（用于 prompt）。 */
  sampleJson: Record<string, unknown>
  /** max_tokens 上限，按 schema 上界设置。 */
  maxTokens: number
  /** 是否启用 thinking mode。 */
  thinkingMode: boolean
  /** 需要 deterministic 重算的字段列表。 */
  computedFields: string[]
  /** 最大重试次数。 */
  maxRetries: number
}

export interface LlmStageResult {
  /** 原始模型输出。 */
  rawContent: string
  /** 解析后的 JSON 数据。 */
  parsedData: Record<string, unknown> | null
  /** 规范化后的输出（只保留 schema 声明字段）。 */
  normalized: Record<string, unknown> | null
  /** 是否通过质量检查。 */
  passed: boolean
  /** 质量检测问题列表。 */
  issues: LlmOutputIssue[]
  /** 重试次数。 */
  attemptNumber: number
  /** 是否应重试。 */
  shouldRetry: boolean
}

export type LlmOutputIssueType =
  | 'empty_content'
  | 'malformed_json'
  | 'truncated_json'
  | 'schema_unknown_fields'
  | 'computed_field_in_output'
  | 'parse_failed'
  | 'candidate_only'

export interface LlmOutputIssue {
  type: LlmOutputIssueType
  field?: string
  message: string
  recovered?: boolean
}

// ── Stage Prompt Builder ──

/**
 * 构建 LLM stage 的 system prompt。
 * prompt 包含 JSON 示例和输出约束。
 */
export function buildStagePrompt(config: LlmStageCallConfig, stageDescription: string): string {
  const modeInstruction = config.thinkingMode
    ? '请先思考，再输出 JSON。'
    : '请直接输出 JSON，不要包含思考过程。'

  return [
    `## Stage: ${config.stageId}`,
    ``,
    stageDescription,
    ``,
    `## 输出要求`,
    `- 输出必须是合法 JSON（严格 JSON，不要包含 markdown 代码块标记）。`,
    `- 输出的 schema 必须严格遵循以下定义，不要包含未声明的字段。`,
    `- 实体 ID 白名单: ${config.entityIds.join(', ')}。`,
    `- 以下字段将由系统自动计算，请勿在输出中包含它们: ${config.computedFields.join(', ')}。`,
    `- 你的输出只是候选建议，最终计算结果由系统决定。`,
    ``,
    `## JSON Schema 示例`,
    JSON.stringify(config.sampleJson, null, 2),
    ``,
    modeInstruction,
    ``,
    `请输出 JSON:`,
  ].join('\n')
}

/**
 * 按 stage schema 设置合理的 max_tokens。
 */
export function estimateMaxTokens(
  entityCount: number,
  schemaComplexity: 'simple' | 'moderate' | 'complex',
): number {
  const baseTokens = 1024
  const perEntity =
    schemaComplexity === 'simple' ? 512 : schemaComplexity === 'moderate' ? 1024 : 2048
  return Math.min(baseTokens + entityCount * perEntity, 16384)
}

// ── Output Classification & Recovery ──

/**
 * 检查 LLM 输出质量，对空内容、malformed JSON、truncated JSON 进行分类。
 * 返回检测问题和恢复后的数据。
 */
export function checkLlmOutput(
  rawContent: string,
  config: LlmStageCallConfig,
): Omit<LlmStageResult, 'attemptNumber'> {
  const issues: LlmOutputIssue[] = []
  let parsedData: Record<string, unknown> | null = null
  let normalized: Record<string, unknown> | null = null

  // 1. 空内容检测
  if (!rawContent || rawContent.trim().length === 0) {
    issues.push({
      type: 'empty_content',
      message: `LLM stage ${config.stageId} 返回空内容。provider/model 需记录。`,
    })
    return {
      rawContent,
      parsedData: null,
      normalized: null,
      passed: false,
      issues,
      shouldRetry: true,
    }
  }

  const trimmed = rawContent.trim()

  // 2. 截断检测
  const openBraces = (trimmed.match(/\{/g) ?? []).length
  const closeBraces = (trimmed.match(/\}/g) ?? []).length
  const openBrackets = (trimmed.match(/\[/g) ?? []).length
  const closeBrackets = (trimmed.match(/\]/g) ?? []).length
  const isTruncated = openBraces > closeBraces || openBrackets > closeBrackets

  // 3. JSON 解析
  let parseSucceeded = false
  let jsonParsed: any = null

  try {
    jsonParsed = JSON.parse(trimmed)
    parseSucceeded = true
  } catch {
    // 尝试去掉 markdown 代码块标记
    const cleaned = trimmed.replace(/```(?:json)?\s*/g, '').trim()
    try {
      jsonParsed = JSON.parse(cleaned)
      parseSucceeded = true
      issues.push({
        type: 'malformed_json',
        message: 'JSON 包含 markdown 代码块标记，已自动清理',
        recovered: true,
      })
    } catch {
      // 解析失败
    }
  }

  if (!parseSucceeded) {
    issues.push({
      type: isTruncated ? 'truncated_json' : 'parse_failed',
      message: isTruncated
        ? `JSON 输出疑似被截断（括号未闭合: {${openBraces}/${closeBraces}, [${openBrackets}/${closeBrackets}]）`
        : 'LLM 输出不是合法 JSON',
    })
    return {
      rawContent,
      parsedData: null,
      normalized: null,
      passed: false,
      issues,
      shouldRetry: isTruncated,
    }
  }

  // 截断后 JSON 解析成功的情况
  if (isTruncated) {
    issues.push({
      type: 'truncated_json',
      message: 'JSON 输出疑似被截断，但解析成功（部分数据可能丢失）',
    })
  }

  parsedData =
    typeof jsonParsed === 'object' && !Array.isArray(jsonParsed)
      ? (jsonParsed as Record<string, unknown>)
      : { data: jsonParsed }

  // 4. Schema 未知字段检测
  const knownFields = extractKnownFields(config.sampleJson)
  const unknownFields = Object.keys(parsedData).filter((k) => !knownFields.has(k))
  if (unknownFields.length > 0) {
    issues.push({
      type: 'schema_unknown_fields',
      message: `输出包含 schema 未声明字段: ${unknownFields.join(', ')}。这些字段将被丢弃。`,
      recovered: true,
    })
  }

  // 5. Computed 字段检测（禁止 LLM 输出包含 computed 字段）
  const computedInOutput = config.computedFields.filter((f) => f in (parsedData ?? {}))
  if (computedInOutput.length > 0) {
    issues.push({
      type: 'computed_field_in_output',
      message: `LLM 输出包含 computed 字段: ${computedInOutput.join(', ')}。这些字段将被 deterministic engine 重算。`,
      recovered: true,
    })
  }

  // 6. 规范化：只保留 schema 允许的字段
  normalized = { ...parsedData }
  for (const key of unknownFields) {
    delete normalized[key]
  }
  for (const field of computedInOutput) {
    delete normalized[field]
  }

  // 始终标记为 candidate
  issues.push({
    type: 'candidate_only',
    message: '此输出仅为候选建议。computed 字段将由 deterministic engine 重算。',
  })

  return {
    rawContent,
    parsedData,
    normalized,
    passed: !isTruncated,
    issues,
    shouldRetry: isTruncated && config.maxRetries > 0,
  }
}

/**
 * 从 sample JSON 提取已知字段名。
 */
function extractKnownFields(obj: Record<string, unknown>, prefix = ''): Set<string> {
  const fields = new Set<string>()
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    fields.add(path)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const subFields = extractKnownFields(value as Record<string, unknown>, path)
      for (const f of subFields) fields.add(f)
    }
  }
  // Also add top-level keys without prefix
  for (const key of Object.keys(obj)) {
    fields.add(key)
  }
  return fields
}

/**
 * 判断 LLM stage 结果是否需要人工确认。
 */
export function needsHumanReview(result: LlmStageResult): boolean {
  const criticalIssues = result.issues.filter(
    (i) => i.type === 'truncated_json' || i.type === 'empty_content' || i.type === 'parse_failed',
  )
  return criticalIssues.length > 0 && !result.shouldRetry
}
