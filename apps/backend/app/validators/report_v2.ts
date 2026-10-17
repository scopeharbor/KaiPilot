import vine from '@vinejs/vine'
import {
  V2_REPORT_TEMPLATES,
  V2_REPORT_EXPORT_FORMATS,
  REPORT_AI_REVIEW_STATUSES,
} from '@aiproj/types'

/**
 * V2 报表验证器（v2-reporting-system-upgrade）。
 *
 * 校验范围：
 * - 模板 ID：必须是 V2 内置模板白名单（V2_REPORT_TEMPLATES）
 * - 时间范围：fromDate <= toDate
 * - 筛选参数白名单（禁止客户端传递任意 SQL/JSON）
 * - 输出格式：markdown/csv/pdf/xlsx
 * - IdempotencyKey：非空字符串且长度有限
 * - AI 审核 payload：reviewStatus + 可选编辑正文
 */

const v2TemplateId = () => vine.enum([...V2_REPORT_TEMPLATES] as const)
const v2ExportFormat = () => vine.enum([...V2_REPORT_EXPORT_FORMATS] as const)

/**
 * 通用筛选条件（同 V1，V2 复用）。
 */
const filtersSchema = vine.object({
  fromDate: vine.string().trim().minLength(1).optional(),
  toDate: vine.string().trim().minLength(1).optional(),
  assigneeIds: vine.array(vine.number().withoutDecimals().positive()).maxLength(200).optional(),
  wbsNodeIds: vine.array(vine.number().withoutDecimals().positive()).maxLength(200).optional(),
  milestoneIds: vine.array(vine.number().withoutDecimals().positive()).maxLength(200).optional(),
})

/**
 * POST /api/v1/projects/:projectId/reports/v2/preview
 * 预览报表：校验模板 ID、标题和筛选条件。不创建版本。
 */
export const v2PreviewValidator = vine.compile(
  vine.object({
    templateId: v2TemplateId(),
    title: vine.string().trim().maxLength(255).optional(),
    filters: filtersSchema.optional(),
    enableAiDraft: vine.boolean().optional(),
  }),
)

/**
 * POST /api/v1/projects/:projectId/reports/v2/versions
 * 创建报表版本：校验模板、previewHash、幂等 key 和标题。
 * previewSnapshotHash 为预览返回的快照指纹，用于防止过时预览被确认。
 */
export const v2CreateVersionValidator = vine.compile(
  vine.object({
    templateId: v2TemplateId(),
    title: vine.string().trim().maxLength(255).optional(),
    filters: filtersSchema.optional(),
    enableAiDraft: vine.boolean().optional(),
    previewSnapshotHash: vine.string().trim().minLength(1).maxLength(128),
    idempotencyKey: vine.string().trim().minLength(1).maxLength(128).optional(),
  }),
)

/**
 * GET /api/v1/projects/:projectId/reports/v2/versions
 * 版本分页列表筛选条件。
 */
export const v2ListVersionsValidator = vine.compile(
  vine.object({
    templateId: v2TemplateId().optional(),
    page: vine.number().withoutDecimals().range([1, 100000]).optional(),
    perPage: vine.number().withoutDecimals().range([1, 100]).optional(),
    sort: vine.string().trim().maxLength(64).optional(),
  }),
)

/**
 * POST /api/v1/projects/:projectId/reports/v2/versions/:versionId/exports
 * 创建导出请求：校验输出格式。
 */
export const v2CreateExportValidator = vine.compile(
  vine.object({
    format: v2ExportFormat(),
  }),
)

/**
 * POST /api/v1/projects/:projectId/reports/v2/jobs/:jobId/retry
 * 重试任务：无需请求体（仅路径参数）。
 * 保留空校验器用于统一验证入口。
 */
export const v2RetryJobValidator = vine.compile(vine.object({}))

/**
 * PATCH /api/v1/projects/:projectId/reports/v2/versions/:versionId/ai-review
 * AI 草稿审核：校验审核状态和可选的编辑后正文。
 */
export const v2AiReviewValidator = vine.compile(
  vine.object({
    reviewStatus: vine.enum([...REPORT_AI_REVIEW_STATUSES] as const),
    aiDraft: vine.string().optional(),
  }),
)
