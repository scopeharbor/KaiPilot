/**
 * 没有可用 AI 连接时的统一提示契约（v3-personal-edition-open-source-export §D5、任务 3.3 / 4.6）。
 *
 * 组织没有任何可用连接、部署者也没有配置实例级默认 Key 时，AI 草案、AI 同事、矛盾求解
 * 一律提示「请先在设置中添加 AI 连接」并给出设置入口，不调用任何模型。
 *
 * - HTTP 接口：`{ error: { code: 'AI_SERVICE_ERROR', message, details: { reason, settingsPath } } }`，
 *   状态码 503；`reason` 为 `AI_CONNECTION_REQUIRED`；
 * - AI 同事流式回合：`turn-error` 的 `errorKind` 为 `ai-connection-required`。
 */
export const AI_CONNECTION_REQUIRED_REASON = 'AI_CONNECTION_REQUIRED' as const
export const AI_CONNECTION_REQUIRED_MESSAGE = '请先在设置中添加 AI 连接'
export const AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND = 'ai-connection-required' as const
/** 前端「AI 连接」设置页。 */
export const AI_CONNECTION_SETTINGS_PATH = '/next/settings/ai-connections'

/** 判断 API 错误体是否为「没有可用 AI 连接」。 */
export function isAiConnectionRequiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const details = (error as { details?: unknown }).details
  return (
    !!details &&
    typeof details === 'object' &&
    (details as { reason?: unknown }).reason === AI_CONNECTION_REQUIRED_REASON
  )
}
