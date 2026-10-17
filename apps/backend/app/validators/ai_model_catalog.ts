import vine from '@vinejs/vine'

export const catalogSearchValidator = vine.create({
  q: vine.string().trim().maxLength(160).optional(),
  providerId: vine.string().trim().maxLength(120).optional(),
  limit: vine.number().withoutDecimals().positive().max(100).optional(),
})

export const catalogMatchValidator = vine.create({
  baseUrl: vine.string().trim().maxLength(512).optional(),
  modelName: vine.string().trim().maxLength(240).optional(),
  limit: vine.number().withoutDecimals().positive().max(25).optional(),
})

export const catalogRefreshValidator = vine.create({
  force: vine.boolean().optional(),
})
