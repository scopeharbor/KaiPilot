import vine from '@vinejs/vine'
import { REPORT_EXPORT_FORMATS, REPORT_TEMPLATES } from '@aiproj/types'

const reportTemplate = () => vine.enum([...REPORT_TEMPLATES] as const)
const exportFormat = () => vine.enum([...REPORT_EXPORT_FORMATS] as const)

/**
 * ReportFilters —— 生成入口的可选筛选条件。
 * 时间范围：`fromDate` 必须 <= `toDate`；两者均为 ISO 日期字符串。
 * 集合类字段限最多 200 项，避免超大 IN 语句。
 */
const filtersSchema = vine.object({
  fromDate: vine.string().trim().minLength(1).optional(),
  toDate: vine.string().trim().minLength(1).optional(),
  assigneeIds: vine.array(vine.number().withoutDecimals().positive()).maxLength(200).optional(),
  wbsNodeIds: vine.array(vine.number().withoutDecimals().positive()).maxLength(200).optional(),
  milestoneIds: vine.array(vine.number().withoutDecimals().positive()).maxLength(200).optional(),
})

const formatConfigSchema = vine.object({
  includeDetails: vine.boolean().optional(),
  includeWarnings: vine.boolean().optional(),
  locale: vine.enum(['zh-CN'] as const).optional(),
})

/**
 * POST /api/v1/projects/:projectId/reports
 * 触发一次预设模板报表生成。
 */
export const createReportValidator = vine.compile(
  vine.object({
    template: reportTemplate(),
    title: vine.string().trim().minLength(1).maxLength(255).optional(),
    filters: filtersSchema.optional(),
    formatConfig: formatConfigSchema.optional(),
  }),
)

/**
 * GET /api/v1/projects/:projectId/reports
 * 报表历史分页列表。
 */
export const listReportsValidator = vine.compile(
  vine.object({
    template: reportTemplate().optional(),
    generatedBy: vine.number().withoutDecimals().positive().optional(),
    fromDate: vine.string().trim().minLength(1).optional(),
    toDate: vine.string().trim().minLength(1).optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
  }),
)

/**
 * POST /api/v1/projects/:projectId/reports/:reportId/exports
 * 触发 Markdown 或 CSV 导出。
 */
export const exportReportValidator = vine.compile(
  vine.object({
    format: exportFormat(),
    formatConfig: formatConfigSchema.optional(),
  }),
)
