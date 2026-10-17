import vine from '@vinejs/vine'

/**
 * v2-ai-smart-recommendations — 推荐相关 VineJS validators.
 */

const sourceTypeEnum = vine.enum([
  'resource',
  'risk',
  'change_impact',
  'dashboard',
  'report',
  'health_diagnosis',
  'prediction',
  'weekly_report',
  'monthly_report',
  'manual',
])

const statusEnum = vine.enum([
  'new',
  'reviewing',
  'accepted',
  'dismissed',
  'snoozed',
  'converted',
  'expired',
])

const severityEnum = vine.enum(['critical', 'high', 'medium', 'low', 'info'])

export const listRecommendationsValidator = vine.compile(
  vine.object({
    status: statusEnum.optional(),
    sourceType: sourceTypeEnum.optional(),
    severity: severityEnum.optional(),
    stale: vine.boolean().optional(),
    q: vine.string().optional(),
    page: vine.number().withoutDecimals().optional(),
    perPage: vine.number().withoutDecimals().optional(),
    sort: vine.string().optional(),
  }),
)

export const refreshRecommendationsValidator = vine.compile(
  vine.object({
    sources: vine.array(sourceTypeEnum).optional(),
  }),
)

export const updateRecommendationStatusValidator = vine.compile(
  vine.object({
    status: statusEnum,
    reason: vine.string().maxLength(500).nullable().optional(),
  }),
)

export const generateAiExplanationValidator = vine.compile(
  vine.object({
    idempotencyKey: vine.string().maxLength(64).optional(),
  }),
)

export const approveAiExplanationValidator = vine.compile(
  vine.object({
    notes: vine.string().maxLength(500).nullable().optional(),
  }),
)

export const rejectAiExplanationValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(1).maxLength(500),
  }),
)

export const convertRecommendationValidator = vine.compile(
  vine.object({
    convertTo: vine.string().trim().minLength(1),
    params: vine.any().optional().nullable(),
  }),
)
