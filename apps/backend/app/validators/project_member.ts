import vine from '@vinejs/vine'

export const addProjectMemberValidator = vine.create({
  userId: vine.number().withoutDecimals().positive(),
  projectRoleId: vine.number().withoutDecimals().positive(),
})

export const changeProjectMemberRoleValidator = vine.create({
  projectRoleId: vine.number().withoutDecimals().positive(),
})

export const transferProjectOwnerValidator = vine.create({
  userId: vine.number().withoutDecimals().positive(),
})

export const inviteProjectMemberValidator = vine.create({
  email: vine.string().trim().email().maxLength(254),
  projectRoleId: vine.number().withoutDecimals().positive(),
})
