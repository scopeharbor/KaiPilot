import vine from '@vinejs/vine'

const slug = () =>
  vine
    .string()
    .trim()
    .minLength(2)
    .maxLength(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const createOrganizationValidator = vine.create({
  name: vine.string().trim().minLength(2).maxLength(255),
  description: vine.string().trim().maxLength(2000).nullable().optional(),
  slug: slug().optional(),
  ownerId: vine.number().withoutDecimals().positive(),
  settings: vine.any().optional(),
})

export const updateOrganizationValidator = vine.create({
  name: vine.string().trim().minLength(2).maxLength(255).optional(),
  description: vine.string().trim().maxLength(2000).nullable().optional(),
  slug: slug().optional(),
  settings: vine.any().optional(),
})
