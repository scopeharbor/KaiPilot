import vine from '@vinejs/vine'

export const inviteMemberValidator = vine.create({
  email: vine.string().trim().email().maxLength(254),
  role: vine.enum(['admin', 'member', 'viewer'] as const).optional(),
})

export const updateRoleValidator = vine.create({
  role: vine.enum(['owner', 'admin', 'member', 'viewer'] as const),
})

export const transferOrgOwnerValidator = vine.create({
  memberId: vine.number().withoutDecimals().positive(),
})

export const createOrganizationAccountValidator = vine.create({
  fullName: vine.string().trim().minLength(1).maxLength(120),
  email: vine.string().trim().email().maxLength(254),
  password: vine
    .string()
    .minLength(8)
    .maxLength(32)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  role: vine.enum(['admin', 'member', 'viewer'] as const),
})
