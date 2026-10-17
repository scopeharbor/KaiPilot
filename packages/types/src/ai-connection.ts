/**
 * ai-gateway-abstraction —— AI 模型连接(前后端共享)类型。
 *
 * 协议抽象(2 种,非按厂商):openai_compatible / anthropic_compatible。
 * 每个 Provider 配置 = { protocol, baseUrl, apiKey, models[] } 的组合。
 * 厂商(OpenAI/DeepSeek/NVIDIA NIM/vLLM/Ollama/LM Studio/Anthropic/Bedrock/Vertex/... )
 * 只是「某协议 + 某 baseUrl」的端点实例,不另立 SDK。
 *
 * 类型定义纯静态,零运行时依赖(@aiproj/types 是零依赖 workspace 包)。
 */

import type {
  AiModelCatalogCost,
  AiModelCatalogLimit,
  AiModelCatalogSupportLevel,
  AiModelContextLimitSnapshot,
  AiModelTokenLimitSource,
} from './ai-model-catalog.js'

/** 协议:本产品只抽象两种(结论见 design D2「同协议直连,禁止跨协议路由」)。 */
export const AI_CONNECTION_PROTOCOLS = ['openai_compatible', 'anthropic_compatible'] as const
export type AiConnectionProtocol = (typeof AI_CONNECTION_PROTOCOLS)[number]

/**
 * 工具调用方式（AI 同事「自然语言操作」等需要模型挑选工具的场景）。
 *
 * - `prompt_json`：提示词列出可用操作，模型输出 JSON 文本，后端解析校验（任何模型都能用，兜底方案）；
 * - `openai_chat_tools`：OpenAI Chat Completions 原生 function calling
 *   （`tools[].function` → `message.tool_calls`）；
 * - `openai_responses_tools`：OpenAI Responses API 原生 function calling
 *   （扁平 `tools[]` → 输出 `function_call` 项）；
 * - `anthropic_tool_use`：Claude Messages API 原生 tool use（`tools[].input_schema` → `tool_use` 块）。
 *
 * 原生方式调用失败（端点不支持工具等）时自动回退 `prompt_json`，并如实告知。
 */
export const AI_TOOL_CALLING_MODES = [
  'prompt_json',
  'openai_chat_tools',
  'openai_responses_tools',
  'anthropic_tool_use',
] as const
export type AiToolCallingMode = (typeof AI_TOOL_CALLING_MODES)[number]

/** 界面显示名：中文 + 英文原名，便于辨别。 */
export const AI_TOOL_CALLING_MODE_LABELS: Readonly<Record<AiToolCallingMode, string>> = {
  prompt_json: '提示词 JSON（Prompt + JSON）',
  openai_chat_tools: 'Chat Completions 原生工具（Chat Tools）',
  openai_responses_tools: 'Responses API 原生工具（Responses Tools）',
  anthropic_tool_use: 'Claude 原生工具（Tool Use）',
}

/** 各方式适用的连接协议（协议不符时不可选：同协议直连，不做跨协议翻译）。 */
export const AI_TOOL_CALLING_MODE_PROTOCOLS: Readonly<
  Record<AiToolCallingMode, readonly AiConnectionProtocol[]>
> = {
  prompt_json: ['openai_compatible', 'anthropic_compatible'],
  openai_chat_tools: ['openai_compatible'],
  openai_responses_tools: ['openai_compatible'],
  anthropic_tool_use: ['anthropic_compatible'],
}

/**
 * 设置页「连接协议」下拉的选项：协议与工具调用方式合成一项（不另设单独的「工具调用方式」）。
 * 存储仍是 protocol + toolCallingMode 两列；`key` 为 `${protocol}:${toolCallingMode}`。
 */
export interface AiConnectionProtocolVariant {
  key: string
  protocol: AiConnectionProtocol
  toolCallingMode: AiToolCallingMode
  label: string
}

export const AI_CONNECTION_PROTOCOL_VARIANTS: readonly AiConnectionProtocolVariant[] = [
  {
    key: 'openai_compatible:prompt_json',
    protocol: 'openai_compatible',
    toolCallingMode: 'prompt_json',
    label: 'OpenAI 兼容 · 提示词 JSON（Prompt + JSON）',
  },
  {
    key: 'openai_compatible:openai_chat_tools',
    protocol: 'openai_compatible',
    toolCallingMode: 'openai_chat_tools',
    label: 'OpenAI 兼容 · Chat Completions 原生工具（Chat Tools）',
  },
  {
    key: 'openai_compatible:openai_responses_tools',
    protocol: 'openai_compatible',
    toolCallingMode: 'openai_responses_tools',
    label: 'OpenAI 兼容 · Responses API 原生工具（Responses Tools）',
  },
  {
    key: 'anthropic_compatible:prompt_json',
    protocol: 'anthropic_compatible',
    toolCallingMode: 'prompt_json',
    label: 'Anthropic 兼容 · 提示词 JSON（Prompt + JSON）',
  },
  {
    key: 'anthropic_compatible:anthropic_tool_use',
    protocol: 'anthropic_compatible',
    toolCallingMode: 'anthropic_tool_use',
    label: 'Anthropic 兼容 · Claude 原生工具（Tool Use）',
  },
]

/** 由连接的 protocol + toolCallingMode 找到下拉选项（不匹配时回到该协议的提示词 JSON）。 */
export function findProtocolVariant(
  protocol: AiConnectionProtocol,
  toolCallingMode: AiToolCallingMode | null | undefined,
): AiConnectionProtocolVariant {
  return (
    AI_CONNECTION_PROTOCOL_VARIANTS.find(
      (variant) =>
        variant.protocol === protocol &&
        variant.toolCallingMode === (toolCallingMode ?? 'prompt_json'),
    ) ??
    AI_CONNECTION_PROTOCOL_VARIANTS.find(
      (variant) => variant.protocol === protocol && variant.toolCallingMode === 'prompt_json',
    )!
  )
}

export function isToolCallingModeAllowed(
  mode: AiToolCallingMode,
  protocol: AiConnectionProtocol,
): boolean {
  return AI_TOOL_CALLING_MODE_PROTOCOLS[mode].includes(protocol)
}

/**
 * 端点能力(测连接探测回填,策略降级依据)。
 * 「同协议≠功能等同」:OpenAI-compat 端点(Ollama/LM Studio/部分自建)在 strict schema / tool 上能力不齐,
 * 这三项不齐时,Resolver/Judge 据此自动把策略从 native 降到 prompt/tool。
 */
export interface AiConnectionCapability {
  /** 是否支持 strict 结构化输出(OpenAI response_format=json_schema / Anthropic output_config.format)。 */
  supportsStrictSchema?: boolean
  /** 是否支持 tool/function calling。 */
  supportsToolCalling?: boolean
  /** 是否支持流式 tool calls(Ollama 历史缺失项之一)。 */
  supportsStreamingTool?: boolean
}

/** 连接可用性(自研路径:由 DB is_active + 端点可达性决定,无外部网关健康检查)。 */
export const AI_CONNECTION_AVAILABILITY = ['available', 'unavailable', 'fallback'] as const
export type AiConnectionAvailability = (typeof AI_CONNECTION_AVAILABILITY)[number]

/** 模型用途能力：UI 以复选框呈现，多模态模型可同时选择多项。 */
export const AI_MODEL_CAPABILITIES = [
  'chat',
  'project_draft',
  'ocr',
  'vision',
  'document_understanding',
  'audio_input',
  'speech_output',
  'video_input',
  'image_generation',
  'structured_output',
  'tool_calling',
  'embeddings',
  'rerank',
  'moderation',
  'realtime_voice',
] as const
export type AiModelCapability = (typeof AI_MODEL_CAPABILITIES)[number]

export const AI_DRAFT_MODEL_CAPABILITIES = ['project_draft', 'chat'] as const
export type AiDraftModelCapability = (typeof AI_DRAFT_MODEL_CAPABILITIES)[number]

export const AI_OCR_MODEL_CAPABILITIES = ['ocr', 'vision'] as const
export type AiOcrModelCapability = (typeof AI_OCR_MODEL_CAPABILITIES)[number]

/** 供应商连接下的可调用模型。RPM/TPM 为 null 表示不做本地限制。 */
export interface AiConnectionModelDto {
  id: string
  connectionId: string
  organizationId: string
  modelName: string
  capabilities: AiModelCapability[]
  catalogProviderId: string | null
  catalogModelId: string | null
  pricingSnapshotId: string | null
  catalogMetadata: {
    providerName?: string
    modelName?: string
    logoUrl?: string
    docsUrl?: string | null
    envKeys?: string[]
    protocol?: AiConnectionProtocol | null
    supportLevel?: AiModelCatalogSupportLevel
    baseUrl?: string | null
    baseUrlNeedsManualEdit?: boolean
    cost?: AiModelCatalogCost
    limit?: AiModelCatalogLimit
    knowledgeCutoff?: string | null
    releaseDate?: string | null
    lastUpdated?: string | null
    status?: string | null
    modalities?: { input: string[]; output: string[] }
    sourceHash?: string
  } | null
  contextWindowTokens: number | null
  maxInputTokens: number | null
  maxOutputTokens: number | null
  tokenLimitSource: AiModelTokenLimitSource | null
  rpmLimit: number | null
  tpmLimit: number | null
  isActive: boolean
  lastTestedAt: string | null
  createdAt: string
  updatedAt: string | null
}

/**
 * 返回前端的连接 DTO。
 * **红线**:API Key 永不回明文 —— 只有 `hasKey` + `keyHint`(末四位 masked)。
 */
export interface AiConnectionDto {
  id: string
  organizationId: string
  displayName: string
  protocol: AiConnectionProtocol
  baseUrl: string | null
  catalogProviderId: string | null
  catalogProviderName: string | null
  catalogProviderLogoUrl: string | null
  catalogProviderDocUrl: string | null
  catalogProviderEnvKeys: string[]
  catalogSyncedAt: string | null
  /** 兼容旧调用方：优先等于首个模型的 modelName。 */
  model: string
  models: AiConnectionModelDto[]
  /** 是否已设置 key(永不回明文)。 */
  hasKey: boolean
  /** 末四位 masked 提示,如 `...xab0`;未设 key 时为 null。 */
  keyHint: string | null
  capabilities: AiConnectionCapability | null
  /** 工具调用方式（缺省 `prompt_json`）。 */
  toolCallingMode: AiToolCallingMode
  isActive: boolean
  lastTestedAt: string | null
  createdAt: string
  updatedAt: string | null
}

/** 逐模型测试明细（一次连接测试可覆盖多个启用模型）。 */
export interface AiConnectionModelTestResult {
  modelId: string
  modelName: string
  ok: boolean
  latencyMs: number
  usage?: AiConnectionTestResult['usage']
  errorKind?: string
  errorMessage?: string
}

/** 测连接结果(对应 spec「测试成功并报告能力」)。 */
export interface AiConnectionTestResult {
  /** 本次测试的所有启用模型全部通过时为 true；任一失败即 false。 */
  ok: boolean
  latencyMs: number
  /** 失败时为首个失败模型名；全部通过时为首个测试模型名；无模型时为 null。 */
  model: string | null
  detectedCapabilities: AiConnectionCapability
  /** 各模型 token 消耗合计（能取到的部分）。 */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    inputAudioTokens?: number
    outputAudioTokens?: number
    reasoningTokens?: number
  }
  contextLimits?: AiModelContextLimitSnapshot
  pricingSnapshotId?: string | null
  /** 逐模型测试明细（多模型连接时长度 > 1；旧调用方可忽略）。 */
  results?: AiConnectionModelTestResult[]
  /** 失败时的错误分类(映射既有错误码体系)。 */
  errorKind?: string
  errorMessage?: string
}
