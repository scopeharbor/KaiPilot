import vine from '@vinejs/vine'
import { BI_TEMPLATE_CATEGORY_VALUES } from '@aiproj/types'

/**
 * BI 报表模板库验证器（v3-bi-report-template-library §3.3）。
 */

// ─── 路由参数 ────────────────────────────────────────────────────────────────

/** organizationId 必须是正整数。 */
export const biTemplateParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
  }),
)

/** 模板详情/预览参数：organizationId + templateId。 */
export const biTemplateDetailParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    templateId: vine.string().trim().minLength(1),
  }),
)

/** 副本操作参数：organizationId + copyId。 */
export const biCopyParamsValidator = vine.compile(
  vine.object({
    organizationId: vine.number().positive(),
    copyId: vine.number().positive(),
  }),
)

// ─── 查询参数 ────────────────────────────────────────────────────────────────

/** 模板目录查询参数白名单。 */
export const biListTemplatesQueryValidator = vine.compile(
  vine.object({
    category: vine.enum(BI_TEMPLATE_CATEGORY_VALUES).optional(),
    page: vine.number().positive().optional(),
    perPage: vine.number().positive().max(100).optional(),
  }),
)

// ─── 请求体 ──────────────────────────────────────────────────────────────────

/** 另存为副本请求体。 */
export const biSaveCopyValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(2000).optional(),
  }),
)

/** 更新副本请求体。 */
export const biUpdateCopyValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255).optional(),
    description: vine.string().trim().maxLength(2000).optional(),
    defaultFilters: vine.object({}).allowUnknownProperties().optional(),
    chartOverrides: vine.object({}).allowUnknownProperties().optional(),
    concurrencyVersion: vine.number().positive(),
  }),
)

/** 实例化请求体。 */
export const biInstantiateValidator = vine.compile(
  vine.object({
    projectId: vine.number().positive().optional(),
    filters: vine.object({}).allowUnknownProperties().optional(),
  }),
)

/** 副本预览请求体（两步确认第1步）。 */
export const biCopyPreviewValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    description: vine.string().trim().maxLength(2000).optional(),
  }),
)

/** 副本确认请求体（两步确认第2步）。 */
export const biCopyConfirmValidator = vine.compile(
  vine.object({
    previewHandle: vine.string().trim().minLength(1),
    previewDigest: vine.string().trim().minLength(1),
  }),
)
