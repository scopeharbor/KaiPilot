/**
 * report_v2/report_periodic —— AI 周期报表 Vine validators。
 *
 * 覆盖周期类型、日期范围、模板 ID、idempotencyKey、审核动作和显式草稿导出意图。
 */
import vine from '@vinejs/vine'

// ---------------------------------------------------------------------------
// 周期报表预览校验器
// ---------------------------------------------------------------------------

export const periodicPreviewValidator = vine.compile(
  vine.object({
    templateId: vine.string().in(['weekly-ai-summary', 'monthly-ai-summary']),
    title: vine.string().maxLength(255).optional(),
    fromDate: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
)

// ---------------------------------------------------------------------------
// 周期报表生成校验器
// ---------------------------------------------------------------------------

export const periodicGenerateValidator = vine.compile(
  vine.object({
    templateId: vine.string().in(['weekly-ai-summary', 'monthly-ai-summary']),
    title: vine.string().maxLength(255).optional(),
    fromDate: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    previewSnapshotHash: vine.string(),
    idempotencyKey: vine.string().maxLength(64).optional(),
  }),
)

// ---------------------------------------------------------------------------
// 周期报表审核操作校验器
// ---------------------------------------------------------------------------

export const periodicReviewValidator = vine.compile(
  vine.object({
    action: vine.string().in(['confirm', 'return', 'edit']),
    editedDraft: vine.any().optional(),
    returnReason: vine.string().maxLength(500).optional(),
  }),
)

// ---------------------------------------------------------------------------
// 周期报表导出校验器
// ---------------------------------------------------------------------------

export const periodicExportValidator = vine.compile(
  vine.object({
    format: vine.string().in(['markdown', 'csv', 'pdf', 'xlsx']),
    draftOverride: vine.boolean().optional(),
  }),
)
