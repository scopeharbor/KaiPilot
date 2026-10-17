import TwoFactorService from '#services/two_factor_service'
import User from '#models/user'
import {
  twoFactorAdminResetValidator,
  twoFactorCodeValidator,
  twoFactorDisableValidator,
  twoFactorSetupValidator,
} from '#validators/two_factor'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { AuthContext } from '#types/auth'

/**
 * 账号两步验证管理（本人自助，全部需要已认证会话）。
 *
 * 自助部分的作用域刻意限定为「当前会话用户自己」——没有任何按 userId 操作他人 2FA 的
 * 自助入口。唯一的他人入口是 `adminReset`，它单独过 `system:admin` 门并强制留痕。
 */
@inject()
export default class TwoFactorController {
  constructor(private twoFactor: TwoFactorService) {}

  private context({ request }: HttpContext): AuthContext {
    return {
      ip: request.ip(),
      userAgent: request.header('user-agent'),
      requestId: request.id() ?? null,
    }
  }

  /**
   * 任何可能带出密钥/恢复码明文的响应都禁止缓存。
   *
   * `no-store` 而不是 `no-cache`：后者只是要求重新校验，中间层仍可能落盘。
   * 同时压掉 `Pragma`/`Expires` 兼容老代理。
   */
  private noStore(ctx: HttpContext) {
    ctx.response.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    ctx.response.header('Pragma', 'no-cache')
    ctx.response.header('Expires', '0')
  }

  /**
   * GET /api/v1/account/two-factor
   *
   * 返回显式状态机取值（disabled / pending_setup / active / needs_reenrollment）。
   * 读取过程中若发现「已启用但密钥结构损坏」，Service 会就地修复成未绑定态。
   */
  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const status = await this.twoFactor.status(user, this.context(ctx))
    this.noStore(ctx)
    return ctx.response.ok({ data: status })
  }

  /**
   * POST /api/v1/account/two-factor/setup
   *
   * 首次绑定与「更换认证器」共用。账号已启用时必须同时给出：
   * 当前密码（local 账号）与当前认证器验证码/恢复码——OWASP 要求变更 MFA 因子本身
   * 也要重新验证身份。
   *
   * 返回体含明文密钥与 otpauth URI，是该密钥唯一一次出现：强制 `no-store`。
   */
  async setup(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const payload = await ctx.request.validateUsing(twoFactorSetupValidator)
    const enrollment = await this.twoFactor.startEnrollment(
      user,
      {
        label: payload.label ?? null,
        currentCode: payload.currentCode,
        password: payload.password,
      },
      this.context(ctx),
    )
    this.noStore(ctx)
    return ctx.response.created({ data: enrollment })
  }

  /**
   * POST /api/v1/account/two-factor/confirm
   *
   * 用认证器验证码确认，这一刻起 2FA 才真正生效（不是二维码一生成就启用）。
   */
  async confirm(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const payload = await ctx.request.validateUsing(twoFactorCodeValidator)
    const context = this.context(ctx)
    const recoveryCodes = await this.twoFactor.confirmEnrollment(user, payload.code, context)
    const status = await this.twoFactor.status(user, context)
    this.noStore(ctx)
    return ctx.response.ok({ data: { ...status, recoveryCodes } })
  }

  /**
   * POST /api/v1/account/two-factor/disable
   */
  async disable(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const payload = await ctx.request.validateUsing(twoFactorDisableValidator)
    const context = this.context(ctx)
    await this.twoFactor.disable(user, payload.code, context, { password: payload.password })
    const status = await this.twoFactor.status(user, context)
    this.noStore(ctx)
    return ctx.response.ok({ data: status })
  }

  /**
   * POST /api/v1/account/two-factor/recovery-codes
   */
  async regenerateRecoveryCodes(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const payload = await ctx.request.validateUsing(twoFactorCodeValidator)
    const context = this.context(ctx)
    const recoveryCodes = await this.twoFactor.regenerateRecoveryCodes(user, payload.code, context)
    const status = await this.twoFactor.status(user, context)
    this.noStore(ctx)
    return ctx.response.ok({ data: { ...status, recoveryCodes } })
  }

  /**
   * POST /api/v1/users/:id/two-factor/reset
   *
   * 管理员代为重置（**高风险动作**）：用户认证器与恢复码都丢失时的唯一兜底。
   * 本项目没有邮件基础设施，不存在「收到邮件即可关掉 2FA」的自助路径——那种设计会把
   * 第二因子降级成「谁能收邮箱谁就能进」。这里改为人工核身 + 强制留痕。
   *
   * 门：`system:admin`（平台管理员）。不接受组织级管理员，避免租户内提权。
   */
  async adminReset(ctx: HttpContext) {
    const actor = ctx.auth.getUserOrFail()
    if (!actor.isSuperAdmin && !ctx.rbac?.hasPermission('system:admin')) {
      throw new PermissionDeniedException('无权重置他人两步验证')
    }

    const payload = await ctx.request.validateUsing(twoFactorAdminResetValidator)
    const targetUserId = Number(ctx.params.id)
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      throw new ResourceNotFoundException('用户不存在')
    }

    const target = await User.find(targetUserId)
    if (!target) {
      throw new ResourceNotFoundException('用户不存在')
    }

    await this.twoFactor.adminReset(
      { actor, targetUserId: target.id, reason: payload.reason },
      this.context(ctx),
    )

    this.noStore(ctx)
    return ctx.response.ok({
      data: { userId: target.id, state: 'disabled', message: '该用户的两步验证已重置，需重新绑定' },
    })
  }
}
