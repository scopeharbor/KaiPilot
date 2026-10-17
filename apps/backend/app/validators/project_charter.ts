import vine from '@vinejs/vine'

/**
 * 项目章程校验器（v3-chart-gallery-data-foundation）。
 *
 * 仅做字段级格式校验；日期区间（end ≥ start）、状态机流转、审批治理等
 * 业务规则由 ProjectCharterService 层判定（design D1，业务规则在 Service）。
 */

const isoDate = () =>
  vine
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)

const stringList = () =>
  vine.array(vine.string().trim().minLength(1).maxLength(1000)).maxLength(100)

const text = (max: number) => vine.string().trim().minLength(1).maxLength(max)

export const createCharterValidator = vine.compile(
  vine.object({
    title: text(255),
    vision: text(5000),
    scope: text(10000),
    objectives: stringList(),
    successCriteria: stringList(),
    startDate: isoDate(),
    endDate: isoDate(),
    businessCase: vine.string().trim().maxLength(10000).nullable().optional(),
  }),
)

export const updateCharterValidator = vine.compile(
  vine.object({
    title: text(255).optional(),
    vision: text(5000).optional(),
    scope: text(10000).optional(),
    objectives: stringList().optional(),
    successCriteria: stringList().optional(),
    startDate: isoDate().optional(),
    endDate: isoDate().optional(),
    businessCase: vine.string().trim().maxLength(10000).nullable().optional(),
  }),
)

export const approveCharterValidator = vine.compile(
  vine.object({
    action: vine.enum(['approve', 'reject'] as const),
  }),
)
