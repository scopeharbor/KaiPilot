/**
 * v3-copilot-multi-model-selection —— 回合能力推导与模型选型契约。
 *
 * 纯类型 + 确定性纯函数，零运行时依赖，不含时钟与随机源。
 *
 * 职责（design D1 / D2）：
 * - 从回合意图与产出形态推导所需能力集合
 * - 模型偏好契约（会话级，受组织可用性限制）
 * - 选型确定性排序键（能力匹配度 → 声明优先级 → 创建时间 → ID 破平局）
 * - 禁存约束：偏好与选型记录只存标识与能力标签
 */

import type { AiModelCapability } from './ai-connection.js'

// ===========================================================================
// 回合所需能力推导（D1）
// ===========================================================================

/**
 * 回合能力推导输入。
 *
 * 从回合请求的意图与产出形态中提取，不由用户直接填写。
 */
export interface TurnCapabilityDerivationInput {
  /** 是否需要结构化输出（表格/清单/Mermaid 图）。 */
  readonly needsStructuredOutput?: boolean
  /** 是否需要工具路由（tool calling）。 */
  readonly needsToolCalling?: boolean
  /** 是否需要长上下文（更大 context window）。 */
  readonly needsLongContext?: boolean
  /** 上下文估算 token 数（用于判断是否需要长上下文）。 */
  readonly estimatedContextTokens?: number
}

/** 长上下文阈值：超过此值视为需要大 context window 模型。 */
export const LONG_CONTEXT_THRESHOLD_TOKENS = 32_000

/**
 * 从回合输入推导所需能力集合。
 *
 * 确定性纯函数：同输入同输出，不依赖时钟与随机源。
 *
 * 推导规则（D1）：
 * - 结构化产出 → 需要 structured_output
 * - 工具路由 → 需要 tool_calling
 * - 长上下文 → 需要 chat（大 context window 模型通常声明 chat 能力）
 *
 * 推导失败时保守选择能力更全的模型（spec REQ），不静默降级到最小能力。
 */
export function deriveTurnRequiredCapabilities(input: TurnCapabilityDerivationInput): {
  requiredCapabilities: AiModelCapability[]
  derivationConfidence: 'full' | 'partial' | 'none'
  derivationReason: string
} {
  const capabilities = new Set<AiModelCapability>()
  const reasons: string[] = []

  if (input.needsStructuredOutput) {
    capabilities.add('structured_output')
    reasons.push('结构化产出需要 strict schema 能力')
  }

  if (input.needsToolCalling) {
    capabilities.add('tool_calling')
    reasons.push('工具路由需要 tool calling 能力')
  }

  if (
    input.needsLongContext ||
    (input.estimatedContextTokens ?? 0) > LONG_CONTEXT_THRESHOLD_TOKENS
  ) {
    capabilities.add('chat')
    reasons.push('长上下文需要大 context window 模型')
  }

  const requiredCapabilities = Array.from(capabilities)

  if (requiredCapabilities.length === 0) {
    return {
      requiredCapabilities: [],
      derivationConfidence: 'none',
      derivationReason: '无法从回合输入推导所需能力，将选择能力更全的模型',
    }
  }

  if (requiredCapabilities.length < 3) {
    return {
      requiredCapabilities,
      derivationConfidence: 'partial',
      derivationReason: reasons.join('；'),
    }
  }

  return {
    requiredCapabilities,
    derivationConfidence: 'full',
    derivationReason: reasons.join('；'),
  }
}

// ===========================================================================
// 模型偏好契约（D5）
// ===========================================================================

/**
 * 模型偏好（会话级）。
 *
 * 禁存约束：只存标识与能力标签，不含 prompt、模型输出、token 与 secret。
 */
export interface CopilotModelPreference {
  /** 偏好模型的连接 ID。 */
  readonly connectionId: number
  /** 偏好模型的模型 ID。 */
  readonly modelId: number
  /** 偏好理由（低敏，不含 prompt 或输出）。 */
  readonly reason?: string
}

/**
 * 偏好禁存校验。
 *
 * 确定性纯函数：检查偏好记录是否包含敏感信息。
 */
export function containsForbiddenModelPreference(
  preference: unknown,
  sensitiveSamples: readonly string[] = [],
): boolean {
  const serialized = JSON.stringify(preference ?? null)
  const forbiddenKeys = [
    'prompt',
    'completion',
    'modelOutput',
    'model_output',
    'token',
    'tokens',
    'secret',
    'apiKey',
    'api_key',
  ]
  for (const key of forbiddenKeys) {
    const needle = '"' + key + '":'
    if (serialized.includes(needle)) return true
  }
  for (const sample of sensitiveSamples) {
    if (sample.length > 0 && serialized.includes(sample)) return true
  }
  return false
}

// ===========================================================================
// 选型确定性排序键（D2）
// ===========================================================================

/**
 * 模型选型候选。
 *
 * 用于确定性排序：能力匹配度 → 声明优先级 → 创建时间 → ID 破平局。
 */
export interface ModelSelectionCandidate {
  /** 连接 ID。 */
  readonly connectionId: number
  /** 模型 ID。 */
  readonly modelId: number
  /** 模型名称。 */
  readonly modelName: string
  /** 模型声明的能力集合。 */
  readonly capabilities: readonly AiModelCapability[]
  /** 声明优先级（数字越小优先级越高）。 */
  readonly declaredPriority: number
  /** 创建时间（ISO 8601）。 */
  readonly createdAt: string
  /** 是否激活。 */
  readonly isActive: boolean
}

/**
 * 选型排序键。
 *
 * 确定性：同输入同排序，不依赖成本或延迟（二者可变，破坏可复现性）。
 *
 * 排序规则（D2）：
 * 1. 能力匹配度（匹配所需能力数 / 所需能力总数，越高越好）
 * 2. 声明优先级（数字越小越好）
 * 3. 创建时间（越早越好）
 * 4. ID 破平局（越小越好）
 */
export function computeSelectionSortKey(
  candidate: ModelSelectionCandidate,
  requiredCapabilities: readonly AiModelCapability[],
): {
  capabilityMatchRatio: number
  declaredPriority: number
  createdAt: string
  modelId: number
} {
  const modelCaps = new Set(candidate.capabilities)
  const matchCount = requiredCapabilities.filter((cap) => modelCaps.has(cap)).length
  const capabilityMatchRatio =
    requiredCapabilities.length > 0 ? matchCount / requiredCapabilities.length : 1

  return {
    capabilityMatchRatio: -capabilityMatchRatio,
    declaredPriority: candidate.declaredPriority,
    createdAt: candidate.createdAt,
    modelId: candidate.modelId,
  }
}

/**
 * 确定性排序比较器。
 *
 * 确定性纯函数：同输入同排序，不依赖成本或延迟。
 */
export function compareModelSelectionCandidates(
  a: ModelSelectionCandidate,
  b: ModelSelectionCandidate,
  requiredCapabilities: readonly AiModelCapability[],
): number {
  const keyA = computeSelectionSortKey(a, requiredCapabilities)
  const keyB = computeSelectionSortKey(b, requiredCapabilities)

  if (keyA.capabilityMatchRatio !== keyB.capabilityMatchRatio) {
    return keyA.capabilityMatchRatio - keyB.capabilityMatchRatio
  }
  if (keyA.declaredPriority !== keyB.declaredPriority) {
    return keyA.declaredPriority - keyB.declaredPriority
  }
  if (keyA.createdAt !== keyB.createdAt) {
    return keyA.createdAt < keyB.createdAt ? -1 : 1
  }
  return keyA.modelId - keyB.modelId
}

// ===========================================================================
// 降级可见性（D4）
// ===========================================================================

/**
 * 降级信息（响应标注）。
 *
 * 禁存约束：不含 prompt、模型输出、token 与 secret。
 */
export interface CopilotModelFallbackInfo {
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

// ===========================================================================
// 选型结果（账本可区分性）
// ===========================================================================

/**
 * 选型结果（写入账本）。
 *
 * 禁存约束：只存标识与能力标签，不含 prompt、模型输出、token 与 secret。
 */
export interface CopilotModelSelectionResult {
  /** 请求的模型标识（选型结果）。 */
  readonly requestModelId: number
  /** 请求的模型名称。 */
  readonly requestModelName: string
  /** 响应的模型标识（provider 实际返回）。 */
  readonly responseModelId: number | null
  /** 响应的模型名称（provider 实际返回）。 */
  readonly responseModelName: string | null
  /** 是否发生降级。 */
  readonly degraded: boolean
  /** 降级原因。 */
  readonly degradedReason?: string
  /** 推导出的能力需求。 */
  readonly requiredCapabilities: readonly AiModelCapability[]
  /** 推导置信度。 */
  readonly derivationConfidence: 'full' | 'partial' | 'none'
}

/**
 * 选型结果禁存校验。
 *
 * 确定性纯函数：检查选型记录是否包含敏感信息。
 */
export function containsForbiddenModelSelectionResult(
  result: unknown,
  sensitiveSamples: readonly string[] = [],
): boolean {
  const serialized = JSON.stringify(result ?? null)
  const forbiddenKeys = [
    'prompt',
    'completion',
    'modelOutput',
    'model_output',
    'token',
    'tokens',
    'secret',
    'apiKey',
    'api_key',
  ]
  for (const key of forbiddenKeys) {
    const needle = '"' + key + '":'
    if (serialized.includes(needle)) return true
  }
  for (const sample of sensitiveSamples) {
    if (sample.length > 0 && serialized.includes(sample)) return true
  }
  return false
}

// ===========================================================================
// 扩展回合请求（向后兼容）
// ===========================================================================

/**
 * 扩展回合请求字段（可选，向后兼容）。
 *
 * 新增到 CopilotTurnRequest 的可选字段。
 */
export interface CopilotTurnModelFields {
  /** 模型偏好（会话级，可选）。 */
  readonly modelPreference?: CopilotModelPreference
}

/**
 * 扩展回合响应字段（可选，向后兼容）。
 *
 * 新增到 CopilotTurnResponse 的可选字段。
 */
export interface CopilotTurnModelResponseFields {
  /** 模型降级信息（可选，仅在降级时返回）。 */
  readonly modelFallback?: CopilotModelFallbackInfo
  /** 选型结果（可选）。 */
  readonly modelSelection?: CopilotModelSelectionResult
}
