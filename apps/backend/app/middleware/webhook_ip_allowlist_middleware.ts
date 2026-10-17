/**
 * 入站 webhook 来源 IP 允许清单中间件（v2-5-webhook-ip-allowlist，design D2/D3/D4/D5）。
 *
 * 具名注册（start/kernel.ts 的 router.named），显式挂在入站接收路由
 * `POST /api/v1/webhooks/:provider` 前，运行于 JWT 认证之前的网络层纵深防御：
 * 命中允许清单 → 放行；未命中 → 403 WEBHOOK_IP_FORBIDDEN。
 *
 * 四态故障姿态（config/webhook_allowlist.ts）：
 * - 关闭（enabled=false）        → 直接放行（no-op，对现网零影响）。
 * - 开启且命中                   → 放行到下一个 handler。
 * - 开启且未命中                 → 403 WEBHOOK_IP_FORBIDDEN。
 * - 开启但清单为空（误配）       → fail-closed 全拒 + 一次 warn 日志。
 *
 * 来源 IP 只取自 ctx.request.ip()（trust-proxy 感知，走框架 proxy-addr + config/app.ts
 * 的 http.trustProxy）——**禁止**直接读取原始 X-Forwarded-For（可被伪造绕过清单）。
 * 依赖：反代/LB 场景下 config/app.ts 的 http.trustProxy 必须正确配置，request.ip() 才能
 * 拿到真实客户端 IP（本 change 不修改 trustProxy，属部署基线，见 design R1）。
 *
 * 隐私边界（spec「拒绝审计与隐私边界」）：拒绝日志只含 reason code 与来源 IP，
 * 禁止记录请求体、请求头敏感值或任何 provider secret。
 */
import type { HttpContext } from '@adonisjs/core/http'
import cfg from '#config/webhook_allowlist'
import { isIpAllowed } from '#services/security/ip_allowlist'

export default class WebhookIpAllowlistMiddleware {
  async handle(ctx: HttpContext, next: () => Promise<void>) {
    // ① 关闭 → no-op，不做任何比对
    if (!cfg.enabled) {
      return next()
    }

    // ② 开启但清单为空 → fail-closed（几乎必然是配置遗漏，尽早暴露）
    if (cfg.cidrs.length === 0) {
      ctx.logger.warn(
        { reason: 'WEBHOOK_IP_FORBIDDEN' },
        'webhook ip allowlist enabled but empty — failing closed',
      )
      return this.deny(ctx)
    }

    // ③ 命中允许清单 → 放行
    const ip = ctx.request.ip()
    if (isIpAllowed(ip, cfg.cidrs)) {
      return next()
    }

    // ④ 未命中 → 403（只记 reason 与 ip，不记 body/headers/secret）
    ctx.logger.warn({ ip, reason: 'WEBHOOK_IP_FORBIDDEN' }, 'webhook source ip denied')
    return this.deny(ctx)
  }

  private deny(ctx: HttpContext) {
    ctx.response.status(403).json({
      error: {
        code: 'WEBHOOK_IP_FORBIDDEN',
        message: 'Source IP is not in the webhook allowlist.',
        details: null,
      },
    })
  }
}
