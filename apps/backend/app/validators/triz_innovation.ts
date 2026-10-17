import vine from '@vinejs/vine'
import {
  INNOVATION_OPTION_ORIGINS,
  INNOVATION_SOURCE_TYPES,
  INNOVATION_SCHEME_STATUSES,
  INNOVATION_REVIEW_STATES,
  INNOVATION_SORT_FIELDS,
} from '@aiproj/types'

/**
 * v3-triz-innovation-workbench —— 创新工作台校验器。
 *
 * 仅校验请求体结构与类型；业务存在性、权限、来源可追溯由 Controller/Service 判定。
 */

const listValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    status: vine.enum(INNOVATION_SCHEME_STATUSES).optional(),
    includeDraft: vine.boolean().optional(),
  }),
)

const sourcesValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    includeDraft: vine.boolean().optional(),
  }),
)

const createSchemeValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    name: vine.string().trim().minLength(1).maxLength(200),
    note: vine.string().trim().maxLength(2000).optional().nullable(),
  }),
)

const updateSchemeValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    name: vine.string().trim().minLength(1).maxLength(200).optional(),
    note: vine.string().trim().maxLength(2000).optional().nullable(),
    reviewState: vine.enum(INNOVATION_REVIEW_STATES).optional(),
    sort: vine.enum(INNOVATION_SORT_FIELDS).optional(),
  }),
)

const addOptionValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    origin: vine.enum(INNOVATION_OPTION_ORIGINS),
    sourceRefs: vine
      .array(
        vine.object({
          sourceType: vine.enum(INNOVATION_SOURCE_TYPES),
          ref: vine.string().trim().minLength(1).maxLength(200),
          hash: vine.string().trim().maxLength(200).optional().nullable(),
          selectedPathId: vine.string().trim().maxLength(120).optional().nullable(),
        }),
      )
      .minLength(1),
    selectedPathId: vine.string().trim().maxLength(120).optional().nullable(),
    principleIds: vine.array(vine.string().trim().minLength(1).maxLength(60)).optional(),
    name: vine.string().trim().minLength(1).maxLength(200).optional(),
    description: vine.string().trim().maxLength(2000).optional().nullable(),
    applicability: vine.array(vine.string().trim().maxLength(300)).optional(),
    nonApplicability: vine.array(vine.string().trim().maxLength(300)).optional(),
  }),
)

const removeOptionValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    optionId: vine.string().trim().minLength(1).maxLength(120),
  }),
)

const handoffValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
    optionIds: vine.array(vine.string().trim().minLength(1).maxLength(120)).minLength(1).optional(),
    note: vine.string().trim().maxLength(2000).optional().nullable(),
  }),
)

const comparisonValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
  }),
)

const narrativeValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
  }),
)

const dashboardValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive(),
  }),
)

export {
  listValidator as innovationListValidator,
  sourcesValidator as innovationSourcesValidator,
  createSchemeValidator as innovationCreateSchemeValidator,
  updateSchemeValidator as innovationUpdateSchemeValidator,
  addOptionValidator as innovationAddOptionValidator,
  removeOptionValidator as innovationRemoveOptionValidator,
  handoffValidator as innovationHandoffValidator,
  comparisonValidator as innovationComparisonValidator,
  narrativeValidator as innovationNarrativeValidator,
  dashboardValidator as innovationDashboardValidator,
}
