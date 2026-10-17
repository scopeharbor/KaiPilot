import vine from '@vinejs/vine'
import {
  CONTRADICTION_SEVERITIES,
  CONTRADICTION_STATUSES,
  CONTRADICTION_TYPES,
} from '@aiproj/types'

export const listContradictionsValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    type: vine.enum(CONTRADICTION_TYPES).optional(),
    status: vine.enum(CONTRADICTION_STATUSES).optional(),
    severity: vine.enum(CONTRADICTION_SEVERITIES).optional(),
    sort: vine.string().maxLength(80).optional(),
  }),
)

export const refreshContradictionsValidator = vine.compile(vine.object({}))

export const confirmContradictionValidator = vine.compile(vine.object({}))

export const dismissContradictionValidator = vine.compile(
  vine.object({
    reason: vine.string().trim().minLength(2).maxLength(500),
  }),
)

export const explainContradictionValidator = vine.compile(
  vine.object({
    focus: vine.string().trim().maxLength(200).optional(),
  }),
)
