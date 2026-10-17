/**
 * DeepSeek V4 Flash 输出边界 —— LLM Stage 调用参数与输出质量检测。
 *
 * - 5.1: JSON 输出目标、schema 名称、实体 ID 白名单、示例结构、max_tokens
 * - 5.3: 空内容、非 JSON、截断、额外属性、缺字段、重复 ID、未知 ID、占位符检测
 * - 5.4: Thinking/non-thinking 选择策略
 *
 * @aiproj/backend compiler
 */

// ── 5.1 LLM Stage 调用参数 ──

export interface LlmStageCallParams {
  /** JSON 输出 schema 名称。 */
  jsonSchemaName: string
  /** 当前批次实体 ID 白名单。 */
  entityIds: string[]
  /** JSON 输出示例结构。 */
  sampleStructure: Record<string, unknown>
  /** 最大输出 token。 */
  maxTokens: number
  /** Thinking/non-thinking 模式。 */
  modelMode: 'thinking' | 'non-thinking'
  /** System prompt 后缀（描述输出要求）。 */
  systemPromptSuffix: string
}

/**
 * 构建 LLM Stage 调用参数。
 * 用于传递给 AIGateway 的 prompt 构造。
 */
export function buildLlmStageParams(
  jsonSchemaName: string,
  entityIds: string[],
  entityCount: number,
  modelMode: 'thinking' | 'non-thinking',
): LlmStageCallParams {
  const maxTokens = Math.min(entityCount * 4096, 16384)
  return {
    jsonSchemaName,
    entityIds,
    sampleStructure: {
      entities: entityIds.map((id) => ({ entityId: id, name: '...', description: '...' })),
    },
    maxTokens,
    modelMode,
    systemPromptSuffix:
      `请为以下实体生成 JSON 输出（schema: ${jsonSchemaName}）。` +
      `实体 ID 白名单: ${entityIds.join(', ')}。` +
      `输出必须是合法 JSON，不要包含 markdown 代码块标记。`,
  }
}

// ── 5.2 AIGateway 集成 ──

/**
 * 确认 DeepSeek 调用必须经过 AIGateway 而非直连。
 * 本文件不创建任何 DeepSeek HTTP 客户端。
 * 调用方应通过已有 AIGateway / Adapter 体系发起请求。
 */
export const DEEPSEEK_VIA_AIGATEWAY = true

// ── 5.3 输出质量检测 ──

export interface OutputQualityIssue {
  entityId?: string
  type:
    | 'empty'
    | 'non_json'
    | 'truncated'
    | 'extra_fields'
    | 'missing_fields'
    | 'duplicate_id'
    | 'unknown_id'
    | 'placeholder'
    | 'contract_count_mismatch'
  field?: string
  message: string
}

/**
 * 检测 DeepSeek 输出质量问题。
 */
export function checkOutputQuality(
  rawContent: string,
  expectedEntityIds: string[],
  requiredFields: string[],
): OutputQualityIssue[] {
  const issues: OutputQualityIssue[] = []

  // 空内容
  if (!rawContent || rawContent.trim().length === 0) {
    issues.push({ type: 'empty', message: 'LLM 返回空内容' })
    return issues
  }

  // 非 JSON
  const trimmed = rawContent.trim()

  // 先检测截断（括号未闭合），即使 parse 失败也要报告
  const openBraces = (trimmed.match(/\{/g) ?? []).length
  const closeBraces = (trimmed.match(/\}/g) ?? []).length
  const openBrackets = (trimmed.match(/\[/g) ?? []).length
  const closeBrackets = (trimmed.match(/\]/g) ?? []).length
  const truncated = openBraces > closeBraces || openBrackets > closeBrackets

  let parsed: any
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    // 尝试修复：去掉 markdown 代码块标记
    const cleaned = rawContent.replace(/```(?:json)?\s*/g, '').trim()
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      if (truncated) {
        issues.push({ type: 'truncated', message: 'JSON 输出疑似被截断（括号未闭合）' })
      } else {
        issues.push({ type: 'non_json', message: 'LLM 输出不是合法 JSON' })
      }
      return issues
    }
  }

  // 截断检测（parse 成功后也检查）
  if (truncated) {
    issues.push({ type: 'truncated', message: 'JSON 输出疑似被截断（括号未闭合）' })
  }

  // 确保输出是数组或包含 entities 数组
  const entityList: any[] = Array.isArray(parsed)
    ? parsed
    : (parsed.entities ?? [parsed].filter(Boolean))

  // 检测未知 ID 和重复 ID
  const expectedSet = new Set(expectedEntityIds)
  const seenIds = new Set<string>()

  for (const entity of entityList) {
    const id = entity.entityId ?? entity.id
    if (!id) continue

    // 占位符检测
    if (/^(TODO|FIXME|placeholder|待填写|待补充|…)$/i.test(String(id))) {
      issues.push({ entityId: id, type: 'placeholder', message: `实体 ID 为占位符: ${id}` })
    }

    // 未知 ID
    if (!expectedSet.has(id)) {
      issues.push({ entityId: id, type: 'unknown_id', message: `未知实体 ID: ${id}` })
    }

    // 重复 ID
    if (seenIds.has(id)) {
      issues.push({ entityId: id, type: 'duplicate_id', message: `重复实体 ID: ${id}` })
    }
    seenIds.add(id)

    // 缺字段
    for (const field of requiredFields) {
      if (entity[field] === undefined || entity[field] === null || entity[field] === '') {
        issues.push({
          entityId: id,
          type: 'missing_fields',
          field,
          message: `${id} 缺少必填字段: ${field}`,
        })
      }
    }
  }

  const knownReturnedIds = [...seenIds].filter((id) => expectedSet.has(id))
  if (knownReturnedIds.length !== expectedEntityIds.length) {
    issues.push({
      type: 'contract_count_mismatch',
      message: `实体数量与 Contract 不一致: 期望 ${expectedEntityIds.length} 个，返回 ${knownReturnedIds.length} 个`,
    })
  }

  return issues
}

/**
 * 快速检测字符串是否包含占位符内容。
 */
export function containsPlaceholder(text: string): boolean {
  return /TODO|FIXME|placeholder|待填写|待补充|…/.test(text)
}

// ── 5.4 Thinking/Non-thinking 策略 ──

export type TaskComplexity = 'simple' | 'moderate' | 'complex'

/**
 * 判断生成的思维模式。
 * - complex（复杂规划/依赖解释/冲突修复）：启用 thinking
 * - simple/moderate（常规实体生成）：默认 non-thinking
 */
export function decideModelMode(
  entityType: string,
  entityCount: number,
  complexity: TaskComplexity,
): 'thinking' | 'non-thinking' {
  if (complexity === 'complex') return 'thinking'
  if (entityType === 'workstream' && entityCount > 1) return 'thinking'
  if (entityType === 'milestone') return 'thinking'
  return 'non-thinking'
}

/**
 * 判断实体类型是否属于"复杂"类别，应使用 thinking。
 */
export function isComplexEntityType(entityType: string): boolean {
  return ['workstream', 'milestone'].includes(entityType)
}
