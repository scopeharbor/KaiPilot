import vine from '@vinejs/vine'

/**
 * 沟通管理计划校验器（v3-chart-gallery-data-foundation）。
 *
 * 仅做字段级格式校验；ownerId 组织成员校验、模板标识规范化等业务规则由
 * CommunicationPlanService 层判定。
 */

const idField = () => vine.number().withoutDecimals().positive()
const nameField = () => vine.string().trim().minLength(1).maxLength(255)
const text = (max: number) => vine.string().trim().minLength(1).maxLength(max)
const nullableText = (max: number) => vine.string().trim().maxLength(max).nullable().optional()

export const createCommunicationPlanValidator = vine.compile(
  vine.object({
    name: nameField(),
    ownerId: idField(),
    communicationType: vine
      .enum(['meeting', 'report', 'email', 'instant_message'] as const)
      .optional(),
    purpose: text(5000),
    frequency: vine
      .enum(['daily', 'weekly', 'biweekly', 'monthly', 'milestone_driven', 'ad_hoc'] as const)
      .optional(),
    channel: vine
      .enum([
        'in_person',
        'video_conference',
        'email',
        'wechat_work',
        'feishu',
        'pdf_export',
      ] as const)
      .optional(),
    audience: text(5000),
    deliverable: nullableText(255),
    reportTemplateKey: nullableText(64),
    isActive: vine.boolean().optional(),
  }),
)

export const updateCommunicationPlanValidator = vine.compile(
  vine.object({
    name: nameField().optional(),
    ownerId: idField().optional(),
    communicationType: vine
      .enum(['meeting', 'report', 'email', 'instant_message'] as const)
      .optional(),
    purpose: text(5000).optional(),
    frequency: vine
      .enum(['daily', 'weekly', 'biweekly', 'monthly', 'milestone_driven', 'ad_hoc'] as const)
      .optional(),
    channel: vine
      .enum([
        'in_person',
        'video_conference',
        'email',
        'wechat_work',
        'feishu',
        'pdf_export',
      ] as const)
      .optional(),
    audience: text(5000).optional(),
    deliverable: nullableText(255),
    reportTemplateKey: nullableText(64),
    isActive: vine.boolean().optional(),
  }),
)

export const listCommunicationPlansValidator = vine.compile(
  vine.object({
    communicationType: vine
      .enum(['meeting', 'report', 'email', 'instant_message'] as const)
      .optional(),
    frequency: vine
      .enum(['daily', 'weekly', 'biweekly', 'monthly', 'milestone_driven', 'ad_hoc'] as const)
      .optional(),
    channel: vine
      .enum([
        'in_person',
        'video_conference',
        'email',
        'wechat_work',
        'feishu',
        'pdf_export',
      ] as const)
      .optional(),
    // GET 查询串为字符串，'true' / 'false' 由控制器归一化为布尔。
    isActive: vine.enum(['true', 'false'] as const).optional(),
    search: vine.string().trim().maxLength(255).optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)
