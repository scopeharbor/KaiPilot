import vine from '@vinejs/vine'

/**
 * v2-triz-compiler-analysis-layer —— TRIZ Compiler Analysis 校验器。
 *
 * 所有校验器仅验证路径参数/请求体的结构与类型，
 * 业务存在性与权限由 Controller/Service 层判定。
 */

/**
 * 列表/查询校验：仅校验 runId 路径参数。
 */
export const trizAnalysisListValidator = vine.compile(
  vine.object({
    runId: vine.number().positive(),
  }),
)

/**
 * 详情校验：校验 runId + artifactId 路径参数。
 */
export const trizAnalysisDetailValidator = vine.compile(
  vine.object({
    runId: vine.number().positive(),
    artifactId: vine.string().trim().minLength(1).maxLength(255),
  }),
)

/**
 * Draft Handoff 校验：校验请求体。
 */
export const trizDraftHandoffValidator = vine.compile(
  vine.object({
    selectedPathId: vine.string().trim().minLength(1).maxLength(255),
    note: vine.string().trim().maxLength(2000).optional().nullable(),
  }),
)
