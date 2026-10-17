import vine from '@vinejs/vine'

/**
 * V2 评论校验器（v2-collaboration-comments-mentions）。
 *
 * V1 基础 + V2 扩展：
 * - entityType 目标实体类型约束
 * - parentId 可空整数（回复）
 * - mentions 用户 ID 数组（@提及）
 * - status 状态筛选（open/resolved）
 */
const bodyFormat = () => vine.enum(['plain', 'markdown'] as const)
const commentStatus = () => vine.enum(['open', 'resolved'] as const)
const entityTypeEnum = () =>
  vine.enum(['project', 'task', 'milestone', 'risk', 'file', 'change_request'] as const)

/**
 * V2：创建评论 + 回复 + 提及。
 */
export const createCommentValidator = vine.compile(
  vine.object({
    body: vine.string().trim().minLength(1).maxLength(5000),
    bodyFormat: bodyFormat().optional(),
    parentId: vine.number().withoutDecimals().min(1).optional(),
    mentions: vine.array(vine.number().withoutDecimals().min(1)).maxLength(50).optional(),
  }),
)

/**
 * V2：统一实体评论列表查询。
 */
export const listEntityCommentsValidator = vine.compile(
  vine.object({
    entityType: entityTypeEnum(),
    entityId: vine.number().withoutDecimals().min(1),
    page: vine.number().withoutDecimals().min(1).optional(),
    perPage: vine.number().withoutDecimals().min(1).max(100).optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    status: commentStatus().optional(),
  }),
)

/**
 * V1 兼容：项目/任务评论列表查询。
 */
export const listCommentsValidator = vine.compile(
  vine.object({
    page: vine.number().withoutDecimals().min(1).optional(),
    perPage: vine.number().withoutDecimals().min(1).max(100).optional(),
    sort: vine.string().trim().maxLength(64).optional(),
    status: commentStatus().optional(),
  }),
)

/**
 * V2：更新评论。
 */
export const updateCommentValidator = vine.compile(
  vine.object({
    body: vine.string().trim().minLength(1).maxLength(5000).optional(),
    bodyFormat: bodyFormat().optional(),
  }),
)

/**
 * V2：校验提及候选查询参数
 */
export const mentionCandidatesValidator = vine.compile(
  vine.object({
    query: vine.string().trim().maxLength(100).optional(),
  }),
)
