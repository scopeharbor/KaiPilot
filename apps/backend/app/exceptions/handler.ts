import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'

/**
 * 框架错误码 → 统一错误体（code, status）的映射表。
 * 领域异常（见 api_exception.ts）自带 handle，不经此表。
 */
const FRAMEWORK_ERROR_MAP: Record<string, { code: string; status: number; message?: string }> = {
  E_VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 422, message: '请求参数校验失败' },
  E_UNAUTHORIZED_ACCESS: { code: 'AUTH_REQUIRED', status: 401, message: '未认证或令牌无效' },
  E_INVALID_CREDENTIALS: { code: 'INVALID_CREDENTIALS', status: 401, message: '邮箱或密码错误' },
  E_TOO_MANY_REQUESTS: {
    code: 'TOO_MANY_REQUESTS',
    status: 429,
    message: '请求过于频繁，请稍后再试',
  },
  // 未匹配任何路由（含个人版里不存在的企业 / 平台 API）：统一 404 错误体，
  // 固定文案，不回显请求路径与调试堆栈（v3-personal-edition-open-source-export 3.4）
  E_ROUTE_NOT_FOUND: { code: 'RESOURCE_NOT_FOUND', status: 404, message: '请求的接口不存在' },
}

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * 将框架内建错误（Vine 校验 / 认证 / 限流）归一化为
   * `{ error: { code, message, details? } }`；领域异常自带 handle，未命中则回落默认处理。
   */
  async handle(error: unknown, ctx: HttpContext) {
    const err = error as { code?: string; messages?: unknown; message?: string }
    const mapped = err?.code ? FRAMEWORK_ERROR_MAP[err.code] : undefined

    if (mapped) {
      const details = err.code === 'E_VALIDATION_ERROR' ? err.messages : undefined
      return ctx.response.status(mapped.status).send({
        error: {
          code: mapped.code,
          message: mapped.message ?? err.message ?? 'Error',
          ...(details !== undefined ? { details } : {}),
        },
      })
    }

    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
