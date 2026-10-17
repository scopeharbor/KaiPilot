import vine from '@vinejs/vine'
import { AI_MODEL_CAPABILITIES, AI_TOOL_CALLING_MODES } from '@aiproj/types'

/**
 * AI 连接校验(ai-gateway-abstraction)。
 * - protocol 只允许两种(OpenAI-compat / Anthropic-compat);
 * - baseUrl 可空(空 = 该协议默认官方端点);
 * - apiKey 在 update 时可省略(留空 = 不变,后端保留原密文)。
 */
const protocol = vine.enum(['openai_compatible', 'anthropic_compatible'])
const capability = vine.enum([...AI_MODEL_CAPABILITIES])
const tokenLimitSource = vine.enum(['catalog', 'manual'])
const toolCallingMode = vine.enum([...AI_TOOL_CALLING_MODES])
const modelInput = vine.object({
  id: vine.number().withoutDecimals().positive().optional(),
  modelName: vine.string().trim().minLength(1).maxLength(200),
  capabilities: vine.array(capability).minLength(1).distinct(),
  catalogProviderId: vine.string().trim().maxLength(120).nullable().optional(),
  catalogModelId: vine.string().trim().maxLength(240).nullable().optional(),
  pricingSnapshotId: vine.number().withoutDecimals().positive().nullable().optional(),
  catalogMetadata: vine.any().nullable().optional(),
  contextWindowTokens: vine.number().withoutDecimals().positive().nullable().optional(),
  maxInputTokens: vine.number().withoutDecimals().positive().nullable().optional(),
  maxOutputTokens: vine.number().withoutDecimals().positive().nullable().optional(),
  tokenLimitSource: tokenLimitSource.nullable().optional(),
  rpmLimit: vine.number().withoutDecimals().positive().nullable().optional(),
  tpmLimit: vine.number().withoutDecimals().positive().nullable().optional(),
  isActive: vine.boolean().optional(),
})

export const createConnectionValidator = vine.create({
  displayName: vine.string().trim().minLength(1).maxLength(120),
  protocol,
  baseUrl: vine.string().trim().maxLength(512).url().nullable().optional(),
  catalogProviderId: vine.string().trim().maxLength(120).nullable().optional(),
  catalogProviderName: vine.string().trim().maxLength(200).nullable().optional(),
  catalogProviderLogoUrl: vine.string().trim().maxLength(512).url().nullable().optional(),
  catalogProviderDocUrl: vine.string().trim().maxLength(512).url().nullable().optional(),
  catalogProviderEnvKeys: vine.array(vine.string().trim().maxLength(120)).maxLength(20).optional(),
  catalogSourcePayload: vine.any().nullable().optional(),
  apiKey: vine.string().trim().minLength(1).maxLength(4000).optional(),
  model: vine.string().trim().minLength(1).maxLength(200).optional(),
  models: vine.array(modelInput).minLength(1).maxLength(20).optional(),
  toolCallingMode: toolCallingMode.optional(),
  isActive: vine.boolean().optional(),
})

export const updateConnectionValidator = vine.create({
  displayName: vine.string().trim().minLength(1).maxLength(120).optional(),
  protocol: protocol.optional(),
  baseUrl: vine.string().trim().maxLength(512).url().nullable().optional(),
  catalogProviderId: vine.string().trim().maxLength(120).nullable().optional(),
  catalogProviderName: vine.string().trim().maxLength(200).nullable().optional(),
  catalogProviderLogoUrl: vine.string().trim().maxLength(512).url().nullable().optional(),
  catalogProviderDocUrl: vine.string().trim().maxLength(512).url().nullable().optional(),
  catalogProviderEnvKeys: vine.array(vine.string().trim().maxLength(120)).maxLength(20).optional(),
  catalogSourcePayload: vine.any().nullable().optional(),
  apiKey: vine.string().trim().minLength(1).maxLength(4000).optional(),
  model: vine.string().trim().minLength(1).maxLength(200).optional(),
  models: vine.array(modelInput).minLength(1).maxLength(20).optional(),
  toolCallingMode: toolCallingMode.optional(),
  isActive: vine.boolean().optional(),
})

/** 测连接：默认测全部启用模型；传 modelName 时只测该模型。 */
export const testConnectionValidator = vine.create({
  modelName: vine.string().trim().minLength(1).maxLength(200).optional(),
})

/**
 * 人工定价（2026-10-01）：第三方中转 / 私有模型在 models.dev 里没有可信挂牌价，
 * 只能由用户填写实际结算单价。单位一律「每 1M token」，币种可自选（USD / CNY）。
 */
const priceField = vine.number().min(0).max(1_000_000).nullable().optional()

export const modelPricingValidator = vine.create({
  currency: vine.string().trim().maxLength(8).optional(),
  cost: vine.object({
    input: priceField,
    output: priceField,
    cacheRead: priceField,
    cacheWrite: priceField,
    inputAudio: priceField,
    outputAudio: priceField,
    reasoning: priceField,
  }),
  note: vine.string().trim().maxLength(500).nullable().optional(),
})

/** 绑定目录定价：provider/model 必须精确指向 models.dev 条目。 */
export const catalogPricingValidator = vine.create({
  catalogProviderId: vine.string().trim().minLength(1).maxLength(120),
  catalogModelId: vine.string().trim().minLength(1).maxLength(240),
  approximate: vine.boolean().optional(),
  reason: vine.string().trim().maxLength(500).nullable().optional(),
})
