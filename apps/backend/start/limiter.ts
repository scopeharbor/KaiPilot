/**
 * 全局速率限制定义（SEC-10，design D6）。
 *
 * 认证端点（register / login / refresh）统一 100 次/分钟，按客户端 IP 计数。
 * 超限返回 429（统一错误体 code=TOO_MANY_REQUESTS）。
 */

import limiter from '@adonisjs/limiter/services/main'

/**
 * 认证端点节流中间件：100 次 / 分钟 / IP。
 */
export const authThrottle = limiter.define('auth', (ctx) => {
  return limiter
    .allowRequests(100)
    .every('1 minute')
    .usingKey(`auth_${ctx.request.ip()}`)
    .limitExceeded((error) => {
      error.setStatus(429).setMessage('请求过于频繁，请稍后再试')
    })
})
