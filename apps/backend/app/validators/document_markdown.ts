import vine from '@vinejs/vine'
import {
  MARKDOWN_BUNDLE_MAX_ITEMS,
  MARKDOWN_IMPORT_MAX_BYTES,
  MARKDOWN_IMPORT_MAX_TITLE_LENGTH,
  MARKDOWN_IMPORT_MODES,
} from '@aiproj/types'

/**
 * 项目文档 Markdown 导入/导出验证器（v3-document-markdown-import-export §3.1）。
 * 只做参数结构/长度校验；字节与行数精确上限在服务层（Buffer.byteLength / 换行计数）强制。
 */

const importModeRule = vine.enum(MARKDOWN_IMPORT_MODES)

const originalFilenameRule = () =>
  vine.string().trim().maxLength(MARKDOWN_IMPORT_MAX_TITLE_LENGTH).nullable().optional()

const sourceDocumentHashRule = () =>
  vine.string().trim().minLength(1).maxLength(128).nullable().optional()

/** 导入预览：mode + 原始内容 + 可选来源文件名/父文件夹/目标文档/预期源哈希 */
export const markdownImportPreviewValidator = vine.compile(
  vine.object({
    mode: importModeRule,
    content: vine.string().maxLength(MARKDOWN_IMPORT_MAX_BYTES),
    originalFilename: originalFilenameRule(),
    parentId: vine.number().withoutDecimals().positive().nullable().optional(),
    targetDocumentId: vine.number().withoutDecimals().positive().nullable().optional(),
    expectedSourceDocumentHash: sourceDocumentHashRule(),
  }),
)

/** 导入确认：显式 confirmed=true + 与 preview 一致的 previewHash 才允许写入 */
export const markdownImportConfirmValidator = vine.compile(
  vine.object({
    mode: importModeRule,
    content: vine.string().maxLength(MARKDOWN_IMPORT_MAX_BYTES),
    originalFilename: originalFilenameRule(),
    parentId: vine.number().withoutDecimals().positive().nullable().optional(),
    targetDocumentId: vine.number().withoutDecimals().positive().nullable().optional(),
    confirmed: vine.boolean(),
    previewHash: vine.string().trim().minLength(1).maxLength(64),
    expectedSourceDocumentHash: sourceDocumentHashRule(),
  }),
)

/** 单文档导出路由参数：documentId */
export const markdownExportSingleParamsValidator = vine.compile(
  vine.object({
    documentId: vine.number().withoutDecimals().positive(),
  }),
)

/** 选中树导出：selectedIds 确定性去重 + 上限，includeChildren 可选 */
export const markdownExportTreeValidator = vine.compile(
  vine.object({
    selectedIds: vine
      .array(vine.number().withoutDecimals().positive())
      .minLength(1)
      .maxLength(MARKDOWN_BUNDLE_MAX_ITEMS),
    includeChildren: vine.boolean().optional(),
  }),
)
