import vine from '@vinejs/vine'

/**
 * PWA Web Push 订阅 Validator（v2-5-pwa-web-push-notifications）。
 *
 * 覆盖：
 * - 订阅请求 payload shape
 * - endpoint URL 长度/格式
 * - base64url keys
 * - user-agent 长度
 * - 取消订阅请求语义
 */

// endpoint URL 最大长度（合理上限）
const ENDPOINT_MAX_LENGTH = 512
// keys base64url 最大长度
const KEY_MAX_LENGTH = 256
// user-agent 摘要最大长度
const USER_AGENT_MAX_LENGTH = 255

/**
 * 订阅请求 Validator。
 */
export const pushSubscribeValidator = vine.compile(
  vine.object({
    endpoint: vine
      .string()
      .trim()
      .minLength(10)
      .maxLength(ENDPOINT_MAX_LENGTH)
      .url({ protocols: ['https'] }),
    keys: vine.object({
      p256dh: vine.string().trim().minLength(1).maxLength(KEY_MAX_LENGTH),
      auth: vine.string().trim().minLength(1).maxLength(KEY_MAX_LENGTH),
    }),
    userAgent: vine.string().trim().maxLength(USER_AGENT_MAX_LENGTH).optional(),
  }),
)

/**
 * 取消订阅请求 Validator。
 */
export const pushUnsubscribeValidator = vine.compile(
  vine.object({
    endpoint: vine
      .string()
      .trim()
      .minLength(10)
      .maxLength(ENDPOINT_MAX_LENGTH)
      .url({ protocols: ['https'] }),
  }),
)

export { ENDPOINT_MAX_LENGTH, KEY_MAX_LENGTH, USER_AGENT_MAX_LENGTH }
