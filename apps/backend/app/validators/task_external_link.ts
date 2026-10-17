import vine from '@vinejs/vine'
import { EXTERNAL_LINK_PROVIDERS, EXTERNAL_LINK_TYPES, EXTERNAL_LINK_STATUSES } from '@aiproj/types'

/**
 * v2-github-gitlab-light-links —— 外部链接创建校验器。
 *
 * 注：vine.string().url() 不直接支持 maxLength 链式调用，
 * 这里用 `maxLength` 对字符串长度做额外约束。
 */
export const createExternalLinkValidator = vine.compile(
  vine.object({
    provider: vine.enum(EXTERNAL_LINK_PROVIDERS),
    linkType: vine.enum(EXTERNAL_LINK_TYPES),
    repositoryOwner: vine.string().trim().minLength(1).maxLength(255),
    repositoryName: vine.string().trim().minLength(1).maxLength(255),
    externalNumber: vine.number().withoutDecimals().positive(),
    externalId: vine.string().trim().maxLength(255).optional().nullable(),
    externalTitle: vine.string().trim().maxLength(500).optional().nullable(),
    externalStatus: vine.enum(EXTERNAL_LINK_STATUSES),
    externalUrl: vine.string().trim().url(),
    note: vine.string().trim().maxLength(2000).optional().nullable(),
  }),
)

/**
 * v2-github-gitlab-light-links —— 外部链接更新校验器。
 */
export const updateExternalLinkValidator = vine.compile(
  vine.object({
    externalTitle: vine.string().trim().maxLength(500).optional().nullable(),
    externalStatus: vine.enum(EXTERNAL_LINK_STATUSES).optional(),
    note: vine.string().trim().maxLength(2000).optional().nullable(),
  }),
)
