import vine from '@vinejs/vine'

/**
 * Copilot 网页搜索工具设置校验（v3-copilot-optional-web-search-configuration）。
 *
 * 全部字段可选（update 语义 = 未提供不变；留空清空）。
 * requirePerTurnConsent 由服务端锁定为 true，不接受客户端提交。
 */

const domainPattern = vine
  .string()
  .trim()
  .minLength(3)
  .maxLength(253)
  .regex(/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i)

/** 更新设置载荷（部分更新）。 */
export const updateCopilotWebSearchSettingsValidator = vine.create({
  enabled: vine.boolean().optional(),
  providerConnectionId: vine.number().withoutDecimals().positive().nullable().optional(),
  allowedDomains: vine.array(domainPattern).maxLength(200).optional(),
  deniedDomains: vine.array(domainPattern).maxLength(200).optional(),
  dailyQueryLimit: vine.number().withoutDecimals().min(1).max(10_000).optional(),
  maxResultsPerQuery: vine.number().withoutDecimals().min(1).max(10).optional(),
  timeoutMs: vine.number().withoutDecimals().min(1_000).max(120_000).optional(),
  cacheTtlMinutes: vine.number().withoutDecimals().min(1).max(1_440).optional(),
  retainDecisionDays: vine.number().withoutDecimals().min(1).max(365).optional(),
  allowForAiCreate: vine.boolean().optional(),
  allowForGeneralCopilot: vine.boolean().optional(),
  providerKind: vine.enum(['free', 'tavily', 'brave', 'bocha', 'searxng']).optional(),
  providerBaseUrl: vine
    .string()
    .trim()
    .maxLength(500)
    .regex(/^https?:\/\/[^\s]+$/i)
    .nullable()
    .optional(),
  /** 只写：新密钥；空串 = 清除。 */
  providerApiKey: vine.string().trim().maxLength(500).nullable().optional(),
})
