import vine from '@vinejs/vine'

/**
 * 部门树校验器（v3-chart-gallery-data-foundation）。
 *
 * 仅做字段级格式校验；父部门同组织归属、循环挂载、code 唯一性与物化路径
 * path/depth 维护等业务规则由 DepartmentService 层判定。
 */

const idField = () => vine.number().withoutDecimals().positive()
const nameField = () => vine.string().trim().minLength(1).maxLength(128)
const codeField = () => vine.string().trim().minLength(1).maxLength(64)

export const createDepartmentValidator = vine.compile(
  vine.object({
    name: nameField(),
    code: codeField(),
    description: vine.string().trim().maxLength(2000).nullable().optional(),
    parentId: idField().nullable().optional(),
    leaderId: idField().nullable().optional(),
    sortOrder: vine.number().withoutDecimals().range([0, 100000]).optional(),
  }),
)

export const updateDepartmentValidator = vine.compile(
  vine.object({
    name: nameField().optional(),
    code: codeField().optional(),
    description: vine.string().trim().maxLength(2000).nullable().optional(),
    parentId: idField().nullable().optional(),
    leaderId: idField().nullable().optional(),
    sortOrder: vine.number().withoutDecimals().range([0, 100000]).optional(),
  }),
)
