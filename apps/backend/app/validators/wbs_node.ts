import vine from '@vinejs/vine'

const id = () => vine.number().withoutDecimals().positive()

export const createWbsNodeValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    parentId: id().nullable().optional(),
    taskId: id().nullable().optional(),
  }),
)

export const updateWbsNodeValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255).optional(),
    collapsed: vine.boolean().optional(),
  }),
)

export const moveWbsNodeValidator = vine.compile(
  vine.object({
    parentId: id().nullable().optional(),
    displayOrder: vine.number().withoutDecimals().min(0).optional(),
  }),
)

export const listWbsTreeValidator = vine.compile(
  vine.object({
    include: vine.enum(['task'] as const).optional(),
  }),
)
