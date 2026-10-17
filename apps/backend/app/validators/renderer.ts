/**
 * renderer —— 确定性 UI Renderer 配置校验器（§2.6 P0）。
 *
 * VineJS 校验器用于：
 * - AI 候选视图确认（个人/共享）
 * - 渲染器配置保存前的权限校验
 */
import vine from '@vinejs/vine'
import { RENDERER_MAX_STRING_LENGTH, RENDERER_MAX_TITLE_LENGTH } from '@aiproj/compiler-spec'

/**
 * 确认 AI 候选视图为自定义视图的请求校验。
 */
export const confirmRendererCandidateValidator = vine.compile(
  vine.object({
    config: vine.any(), // schema 校验由 RendererConfigValidationService 执行
    name: vine.string().minLength(1).maxLength(RENDERER_MAX_TITLE_LENGTH),
    visibility: vine.enum(['personal', 'shared']),
    sourceArtifactRef: vine.string().maxLength(RENDERER_MAX_STRING_LENGTH).optional(),
    sourceRunId: vine.string().maxLength(RENDERER_MAX_STRING_LENGTH).optional(),
  }),
)

/**
 * 预览 AI 候选视图的请求校验（只读，不持久化）。
 */
export const previewRendererCandidateValidator = vine.compile(
  vine.object({
    config: vine.any(),
  }),
)
