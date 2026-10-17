/**
 * 没有可用 AI 连接时的统一处理（v3-personal-edition-open-source-export §D5、任务 3.3）。
 *
 * 组织没有任何可用连接、部署者也没有配置实例级默认 Key（`OPENAI_API_KEY`）时，解析器只能
 * 落到 Mock 适配器。Mock 输出是固定样例，不能冒充模型结果：AI 草案、AI 同事、矛盾求解
 * 三个入口一律提示「请先在设置中添加 AI 连接」并给出设置入口，不调用任何模型。
 *
 * - 错误码复用 sec06 的 `AI_SERVICE_ERROR`，用 `details.reason = AI_CONNECTION_REQUIRED`
 *   区分，前端据此显示设置入口；
 * - 联调时可设 `AI_ALLOW_MOCK=true` 放行 Mock；测试环境（NODE_ENV=test）缺省放行，
 *   测试里显式设为 false 即可验证提示路径。
 */
import env from '#start/env'
import ApiException from '#exceptions/api_exception'
import {
  AI_CONNECTION_REQUIRED_MESSAGE,
  AI_CONNECTION_REQUIRED_REASON,
  AI_CONNECTION_SETTINGS_PATH,
} from '@aiproj/types'

export class AiConnectionRequiredException extends ApiException {
  static status = 503
  static code = 'AI_SERVICE_ERROR'

  constructor() {
    super(AI_CONNECTION_REQUIRED_MESSAGE, {
      details: {
        reason: AI_CONNECTION_REQUIRED_REASON,
        settingsPath: AI_CONNECTION_SETTINGS_PATH,
      },
    })
  }
}

/** 是否允许用 Mock 适配器代替真实模型（联调与测试用）。 */
export function isMockAdapterAllowed(): boolean {
  // 直接读 process.env（与 AIPROJ_TRIZ_ENABLE_REAL_AI 同一做法），测试里可按用例切换
  const explicit = process.env.AI_ALLOW_MOCK
  if (explicit === 'true') return true
  if (explicit === 'false') return false
  return env.get('NODE_ENV') === 'test'
}

/** 解析结果只剩 Mock 且不允许 Mock 时，视为「没有可用 AI 连接」。 */
export function lacksAiConnection(resolved: { source: string }): boolean {
  return resolved.source === 'mock' && !isMockAdapterAllowed()
}

/** 没有可用 AI 连接时抛出统一的提示异常。 */
export function assertAiConnectionAvailable(resolved: { source: string }): void {
  if (lacksAiConnection(resolved)) throw new AiConnectionRequiredException()
}
