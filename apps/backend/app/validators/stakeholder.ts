import vine from '@vinejs/vine'

/**
 * 利害关系人登记表校验器（v3-chart-gallery-data-foundation）。
 *
 * 仅做字段级格式校验；内部用户归属组织、四象限/策略一致性推导等业务规则
 * 由 StakeholderService 层判定。
 */

const idField = () => vine.number().withoutDecimals().positive()
const nameField = () => vine.string().trim().minLength(1).maxLength(128)
const longText = (max: number) => vine.string().trim().maxLength(max)

export const createStakeholderValidator = vine.compile(
  vine.object({
    name: nameField(),
    userId: idField().nullable().optional(),
    organizationName: longText(255).nullable().optional(),
    roleTitle: longText(128).nullable().optional(),
    stakeholderType: vine.enum(['internal', 'external'] as const).optional(),
    powerLevel: vine.enum(['low', 'medium', 'high'] as const).optional(),
    interestLevel: vine.enum(['low', 'medium', 'high'] as const).optional(),
    attitude: vine.enum(['supportive', 'neutral', 'resistant', 'leading'] as const).optional(),
    expectations: longText(5000).nullable().optional(),
    managementStrategy: vine
      .enum(['manage_closely', 'keep_satisfied', 'keep_informed', 'monitor'] as const)
      .optional(),
    // 联系方式自由键值对象（email / phone / wechat 等），值须为字符串。
    contactInfo: vine.record(vine.string().trim().maxLength(500)).nullable().optional(),
  }),
)

export const updateStakeholderValidator = vine.compile(
  vine.object({
    name: nameField().optional(),
    userId: idField().nullable().optional(),
    organizationName: longText(255).nullable().optional(),
    roleTitle: longText(128).nullable().optional(),
    stakeholderType: vine.enum(['internal', 'external'] as const).optional(),
    powerLevel: vine.enum(['low', 'medium', 'high'] as const).optional(),
    interestLevel: vine.enum(['low', 'medium', 'high'] as const).optional(),
    attitude: vine.enum(['supportive', 'neutral', 'resistant', 'leading'] as const).optional(),
    expectations: longText(5000).nullable().optional(),
    managementStrategy: vine
      .enum(['manage_closely', 'keep_satisfied', 'keep_informed', 'monitor'] as const)
      .optional(),
    contactInfo: vine.record(vine.string().trim().maxLength(500)).nullable().optional(),
  }),
)

export const listStakeholdersValidator = vine.compile(
  vine.object({
    view: vine.enum(['quadrant'] as const).optional(),
    stakeholderType: vine.enum(['internal', 'external'] as const).optional(),
    managementStrategy: vine
      .enum(['manage_closely', 'keep_satisfied', 'keep_informed', 'monitor'] as const)
      .optional(),
    search: vine.string().trim().maxLength(255).optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)
