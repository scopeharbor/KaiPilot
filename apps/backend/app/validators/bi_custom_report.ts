/**
 * bi_custom_report validator —— 自定义报表定义验证器。
 *
 * 覆盖 create/update/copy/default/archive/restore/list/preview 参数和 payload 大小上限。
 * v3-bi-custom-report-builder §3.2
 */
import vine from '@vinejs/vine'
import {
  BI_CUSTOM_REPORT_DATA_SOURCE_KEY_VALUES,
  BI_CUSTOM_REPORT_FIELD_KEY_VALUES,
  BI_CUSTOM_REPORT_FILTER_OPERATOR_VALUES,
  BI_CUSTOM_REPORT_VISUALIZATION_TYPE_VALUES,
  BI_CUSTOM_REPORT_SORT_DIRECTIONS,
  BI_CUSTOM_REPORT_SCOPES,
  BI_CUSTOM_REPORT_VISIBILITY,
  BI_CUSTOM_REPORT_LIMITS,
} from '@aiproj/types'

// ─── 公共 schema ───────────────────────────────────────────────────────────

const dataSourceRefSchema = vine.object({
  sourceKey: vine.enum(BI_CUSTOM_REPORT_DATA_SOURCE_KEY_VALUES),
  alias: vine.string().maxLength(50).optional(),
  label: vine.string().maxLength(50).optional(),
})

const filterSchema = vine.object({
  fieldKey: vine.enum(BI_CUSTOM_REPORT_FIELD_KEY_VALUES),
  operator: vine.enum(BI_CUSTOM_REPORT_FILTER_OPERATOR_VALUES),
  value: vine.any(),
  label: vine.string().maxLength(100).optional(),
})

const groupSchema = vine.object({
  fieldKey: vine.enum(BI_CUSTOM_REPORT_FIELD_KEY_VALUES),
  label: vine.string().maxLength(100).optional(),
})

const sortSchema = vine.object({
  fieldKey: vine.enum(BI_CUSTOM_REPORT_FIELD_KEY_VALUES),
  direction: vine.enum([
    BI_CUSTOM_REPORT_SORT_DIRECTIONS.ASC,
    BI_CUSTOM_REPORT_SORT_DIRECTIONS.DESC,
  ]),
  label: vine.string().maxLength(100).optional(),
})

const visualizationSchema = vine.object({
  type: vine.enum(BI_CUSTOM_REPORT_VISUALIZATION_TYPE_VALUES),
  title: vine.string().maxLength(200).optional(),
  xField: vine.enum(BI_CUSTOM_REPORT_FIELD_KEY_VALUES).optional(),
  yField: vine.enum(BI_CUSTOM_REPORT_FIELD_KEY_VALUES).optional(),
  seriesField: vine.enum(BI_CUSTOM_REPORT_FIELD_KEY_VALUES).optional(),
  colorPalette: vine.string().maxLength(50).optional(),
  height: vine.number().positive().max(2000).optional(),
  width: vine.number().positive().max(2000).optional(),
})

// ─── 创建 ──────────────────────────────────────────────────────────────────

export const createBiCustomReportValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_TITLE_LENGTH),
    description: vine
      .string()
      .trim()
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_DESCRIPTION_LENGTH)
      .optional(),
    scope: vine
      .enum([
        BI_CUSTOM_REPORT_SCOPES.ORGANIZATION,
        BI_CUSTOM_REPORT_SCOPES.PORTFOLIO,
        BI_CUSTOM_REPORT_SCOPES.PROJECT,
      ])
      .optional(),
    visibility: vine
      .enum([BI_CUSTOM_REPORT_VISIBILITY.PERSONAL, BI_CUSTOM_REPORT_VISIBILITY.SHARED])
      .optional(),
    projectId: vine.number().positive().optional(),
    portfolioId: vine.number().positive().optional(),
    dataSources: vine
      .array(dataSourceRefSchema)
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_DATA_SOURCES),
    fields: vine
      .array(vine.enum(BI_CUSTOM_REPORT_FIELD_KEY_VALUES))
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_FIELDS),
    filters: vine.array(filterSchema).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_FILTERS).optional(),
    groups: vine.array(groupSchema).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_GROUPS).optional(),
    sorts: vine.array(sortSchema).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_SORTS).optional(),
    visualizations: vine
      .array(visualizationSchema)
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_VISUALIZATIONS),
    layout: vine.record(vine.any()).optional(),
  }),
)

// ─── 更新 ──────────────────────────────────────────────────────────────────

export const updateBiCustomReportValidator = vine.compile(
  vine.object({
    title: vine
      .string()
      .trim()
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_TITLE_LENGTH)
      .optional(),
    description: vine
      .string()
      .trim()
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_DESCRIPTION_LENGTH)
      .optional(),
    scope: vine
      .enum([
        BI_CUSTOM_REPORT_SCOPES.ORGANIZATION,
        BI_CUSTOM_REPORT_SCOPES.PORTFOLIO,
        BI_CUSTOM_REPORT_SCOPES.PROJECT,
      ])
      .optional(),
    visibility: vine
      .enum([BI_CUSTOM_REPORT_VISIBILITY.PERSONAL, BI_CUSTOM_REPORT_VISIBILITY.SHARED])
      .optional(),
    projectId: vine.number().positive().optional(),
    portfolioId: vine.number().positive().optional(),
    dataSources: vine
      .array(dataSourceRefSchema)
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_DATA_SOURCES)
      .optional(),
    fields: vine
      .array(vine.enum(BI_CUSTOM_REPORT_FIELD_KEY_VALUES))
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_FIELDS)
      .optional(),
    filters: vine.array(filterSchema).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_FILTERS).optional(),
    groups: vine.array(groupSchema).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_GROUPS).optional(),
    sorts: vine.array(sortSchema).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_SORTS).optional(),
    visualizations: vine
      .array(visualizationSchema)
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_VISUALIZATIONS)
      .optional(),
    layout: vine.record(vine.any()).optional(),
    expectedVersion: vine.number().positive(),
  }),
)

// ─── 复制 ──────────────────────────────────────────────────────────────────

export const copyBiCustomReportValidator = vine.compile(
  vine.object({
    title: vine.string().trim().maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_TITLE_LENGTH).optional(),
    scope: vine
      .enum([
        BI_CUSTOM_REPORT_SCOPES.ORGANIZATION,
        BI_CUSTOM_REPORT_SCOPES.PORTFOLIO,
        BI_CUSTOM_REPORT_SCOPES.PROJECT,
      ])
      .optional(),
    visibility: vine
      .enum([BI_CUSTOM_REPORT_VISIBILITY.PERSONAL, BI_CUSTOM_REPORT_VISIBILITY.SHARED])
      .optional(),
  }),
)

// ─── 设为默认 / 归档 / 恢复 ───────────────────────────────────────────────

export const setDefaultBiCustomReportValidator = vine.compile(
  vine.object({
    expectedVersion: vine.number().positive(),
  }),
)

export const archiveRestoreBiCustomReportValidator = vine.compile(
  vine.object({
    expectedVersion: vine.number().positive(),
  }),
)

// ─── 列表查询 ──────────────────────────────────────────────────────────────

export const listBiCustomReportValidator = vine.compile(
  vine.object({
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
    scope: vine
      .enum([
        BI_CUSTOM_REPORT_SCOPES.ORGANIZATION,
        BI_CUSTOM_REPORT_SCOPES.PORTFOLIO,
        BI_CUSTOM_REPORT_SCOPES.PROJECT,
      ])
      .optional(),
    visibility: vine
      .enum([BI_CUSTOM_REPORT_VISIBILITY.PERSONAL, BI_CUSTOM_REPORT_VISIBILITY.SHARED])
      .optional(),
    search: vine.string().maxLength(200).optional(),
    sort: vine.string().maxLength(50).optional(),
    includeArchived: vine.boolean().optional(),
    projectId: vine.number().positive().optional(),
    portfolioId: vine.number().positive().optional(),
  }),
)

// ─── 预览 ──────────────────────────────────────────────────────────────────

export const previewBiCustomReportValidator = vine.compile(
  vine.object({
    title: vine.string().trim().maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_TITLE_LENGTH).optional(),
    scope: vine
      .enum([
        BI_CUSTOM_REPORT_SCOPES.ORGANIZATION,
        BI_CUSTOM_REPORT_SCOPES.PORTFOLIO,
        BI_CUSTOM_REPORT_SCOPES.PROJECT,
      ])
      .optional(),
    dataSources: vine
      .array(dataSourceRefSchema)
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_DATA_SOURCES),
    fields: vine
      .array(vine.enum(BI_CUSTOM_REPORT_FIELD_KEY_VALUES))
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_FIELDS),
    filters: vine.array(filterSchema).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_FILTERS).optional(),
    groups: vine.array(groupSchema).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_GROUPS).optional(),
    sorts: vine.array(sortSchema).maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_SORTS).optional(),
    visualizations: vine
      .array(visualizationSchema)
      .minLength(1)
      .maxLength(BI_CUSTOM_REPORT_LIMITS.MAX_VISUALIZATIONS),
    layout: vine.record(vine.any()).optional(),
  }),
)

// ─── 路由参数 ──────────────────────────────────────────────────────────────

export const biCustomReportParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

export const biCustomReportDefinitionIdParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    definitionId: vine.string().trim().minLength(1).maxLength(36),
  }),
)
