import crypto from 'node:crypto'
import User from '#models/user'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import AuditService, { AuditEvent } from '#services/audit_service'
import LoginThrottleService from '#services/login_throttle_service'
import OrganizationService from '#services/organization_service'
import RbacService from '#services/rbac_service'
import TokenService from '#services/token_service'
import TwoFactorService from '#services/two_factor_service'
import {
  AccountInactiveException,
  AccountLockedException,
  InvalidCredentialsException,
  TwoFactorChallengeInvalidException,
  TwoFactorRequiredException,
} from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { AuthContext, JwtRefreshToken } from '#types/auth'
import type { GoogleUserInfo } from '#services/integrations/google_oauth_service'
import type { TwoFactorChallengeTicket } from '#services/two_factor_service'

export interface AuthResult {
  user: User
  accessToken: string
  refreshToken: string
  permissions: string[]
  /**
   * 当前生效组织的套餐层级（'free' | 'team' | 'enterprise'；无组织为 null）。
   * 与 JWT claims 的 planTier 一致，供服务层/控制器直接消费。
   */
  planTier: string | null
}

/**
 * 密码校验的结果：要么直接拿到会话，要么拿到一张待兑换的第二因子挑战票据。
 *
 * 用带判别字段的联合而非「返回 AuthResult 且某些字段为空」——后者会让调用方
 * 有机会在 2FA 未完成时误用一个半成品会话对象。
 */
export type LoginAttemptResult =
  | { twoFactorRequired: false; session: AuthResult }
  | { twoFactorRequired: true; challenge: TwoFactorChallengeTicket }

/**
 * 第二因子登录完成后的结果。
 *
 * `recoveryCodes` 只有在这次登录**顺便完成了首次绑定**（enrollment-at-login）时非空，
 * 且服务端此后无从还原——调用方必须在同一次响应里交给用户。
 */
export interface TwoFactorLoginResult extends AuthResult {
  recoveryCodes: string[] | null
  /**
   * 本次是用恢复码而非认证器完成的登录。
   *
   * 说明认证器多半已不可用，UI 据此引导用户尽快重新绑定——否则恢复码会被一张张用光，
   * 最后落到只能走管理员重置。
   */
  usedRecoveryCode: boolean
}

/**
 * 认证服务：封装注册、登录、刷新、登出、角色版本传播等业务逻辑。
 * 集成登录失败锁定（SEC-03）与认证类审计埋点（D12）。
 */
@inject()
export default class AuthService {
  constructor(
    private tokenService: TokenService,
    private loginThrottle: LoginThrottleService,
    private audit: AuditService,
    private rbacService: RbacService,
    private organizationService: OrganizationService,
    private twoFactor: TwoFactorService,
  ) {}

  /**
   * 用户注册（local 认证）。
   */
  async register(input: {
    fullName: string | null
    email: string
    password: string
    organizationName?: string
  }): Promise<AuthResult> {
    const { user, organization } = await db.transaction(async (trx) => {
      const createdUser = await User.create(
        {
          fullName: input.fullName,
          email: input.email,
          password: input.password,
          authProvider: 'local',
          isActive: true,
          isSuperAdmin: false,
          roleVersion: 0,
        },
        { client: trx },
      )
      const organizationName =
        input.organizationName?.trim() ||
        (input.fullName?.trim() ? `${input.fullName.trim()}的组织` : '我的组织')
      const slug = await this.organizationService.generateUniqueSlug(
        organizationName,
        undefined,
        trx,
      )
      const createdOrganization = await Organization.create(
        {
          ownerId: createdUser.id,
          name: organizationName,
          slug,
          description: null,
          planTier: 'free',
        },
        { client: trx },
      )
      await OrganizationMember.create(
        {
          organizationId: createdOrganization.id,
          userId: createdUser.id,
          role: 'owner',
        },
        { client: trx },
      )
      return { user: createdUser, organization: createdOrganization }
    })

    await this.audit.log({
      event: AuditEvent.USER_CREATED,
      userId: user.id,
      organizationId: organization.id,
      entityType: 'user',
      entityId: user.id,
    })
    await this.audit.log({
      event: AuditEvent.ORG_CREATED,
      userId: user.id,
      organizationId: organization.id,
      entityType: 'organization',
      entityId: organization.id,
    })

    return this.issueTokens(user, organization.id)
  }

  /**
   * 用户登录（**直接拿会话**的便捷路径）。
   *
   * 内部/测试调用用它；HTTP 端点用 `attemptLogin`。账号启用了两步验证时，
   * 这里没有能承载「中间态」的返回值，故抛 `TwoFactorRequiredException`——
   * 绝不静默跳过第二因子。
   */
  async login(
    input: { email: string; password: string },
    ctx: AuthContext = {},
  ): Promise<AuthResult> {
    const outcome = await this.attemptLogin(input, ctx)
    if (outcome.twoFactorRequired) {
      throw new TwoFactorRequiredException('该账号已启用两步验证，请通过登录接口提交验证码')
    }
    return outcome.session
  }

  /**
   * 密码登录第一步：校验凭证与账号状态，再决定是直接建会话还是要第二因子。
   *
   * 凭证错误统一抛 InvalidCredentials，不区分邮箱是否存在；
   * 连续失败 5 次锁定 30 分钟（SEC-03），锁定期即使凭证正确也拒绝。
   *
   * 关于「密码对但要 2FA」时清空失败计数：密码本身已证明是本人，继续累计会让
   * 正常用户在认证器上多输错几次就被锁 30 分钟。第二因子有自己的尝试上限
   * （`TwoFactorService.MAX_CHALLENGE_ATTEMPTS`），暴力破解仍被挡住。
   */
  async attemptLogin(
    input: { email: string; password: string },
    ctx: AuthContext = {},
  ): Promise<LoginAttemptResult> {
    const ip = ctx.ip ?? 'unknown'

    if (await this.loginThrottle.isLocked(input.email, ip)) {
      await this.audit.log({
        event: AuditEvent.LOGIN_FAILED,
        severity: 'warning',
        requestId: ctx.requestId ?? null,
        metadata: { email: input.email, ip, reason: 'account_locked' },
      })
      throw new AccountLockedException('登录失败次数过多，账户已临时锁定，请 30 分钟后再试')
    }

    const user = await User.findBy('email', input.email)
    const passwordVerified = user ? await hash.verify(user.password, input.password) : false

    if (!user || !passwordVerified) {
      await this.loginThrottle.recordFailure(input.email, ip)
      await this.audit.log({
        event: AuditEvent.LOGIN_FAILED,
        severity: 'warning',
        userId: user?.id ?? null,
        requestId: ctx.requestId ?? null,
        metadata: { email: input.email, ip, reason: 'invalid_credentials' },
      })
      throw new InvalidCredentialsException('邮箱或密码错误')
    }

    if (!user.isActive) {
      await this.audit.log({
        event: AuditEvent.LOGIN_FAILED,
        severity: 'warning',
        userId: user.id,
        requestId: ctx.requestId ?? null,
        metadata: { email: input.email, ip, reason: 'account_inactive' },
      })
      throw new AccountInactiveException('账户已被禁用')
    }

    await this.loginThrottle.clear(input.email, ip)

    const secondFactor = await this.resolveSecondFactorStep(user, ctx)
    if (secondFactor) return secondFactor

    const result = await this.issueTokens(user)

    await this.audit.log({
      event: AuditEvent.LOGIN_SUCCESS,
      userId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: { ip, userAgent: ctx.userAgent ?? null },
    })

    return { twoFactorRequired: false, session: result }
  }

  /**
   * 密码登录第二步：兑换挑战票据 + 第二因子，换取正式会话。
   *
   * 与 `login` / `loginWithGoogle` / `loginWithSaml` / `loginWithOidc` 走**同一条**
   * `issueTokens` 路径，claims 与刷新语义完全一致，下游 API 无需 2FA 专属分支。
   */
  async completeTwoFactorLogin(
    input: { challengeToken: string; code: string },
    ctx: AuthContext = {},
  ): Promise<TwoFactorLoginResult> {
    const { user, recoveryCodes, usedRecoveryCode } = await this.twoFactor.verifyLoginChallenge(
      input.challengeToken,
      input.code,
      ctx,
    )
    const session = await this.issueSessionForChallengeHolder(
      user,
      ctx,
      usedRecoveryCode ? 'two_factor_recovery_code' : 'two_factor',
    )
    return { ...session, recoveryCodes, usedRecoveryCode: usedRecoveryCode ?? false }
  }

  /**
   * 用户在登录期绑定界面选择「暂时跳过」（仅 `optional` 策略下可用）。
   *
   * 跳过的是**绑定**，不是第二因子校验——已绑定账号的 `verify` 挑战永远不可跳过，
   * 这个边界由 `TwoFactorService.skipEnrollmentChallenge` 强制。
   */
  async skipTwoFactorEnrollment(
    input: { challengeToken: string },
    ctx: AuthContext = {},
  ): Promise<AuthResult> {
    if (this.twoFactor.loginEnrollmentMode() !== 'optional') {
      throw new TwoFactorChallengeInvalidException('本站点要求完成两步验证绑定后才能登录')
    }
    const user = await this.twoFactor.skipEnrollmentChallenge(input.challengeToken, ctx)
    return this.issueSessionForChallengeHolder(user, ctx, 'two_factor_skipped')
  }

  /**
   * 持有效挑战票据者换会话的共同收尾：账号状态门 → 重读 DB → 签发 → 审计。
   *
   * 重读 DB 的原因：挑战下发到兑换之间 roleVersion 可能已被改（如管理员调整角色）。
   */
  private async issueSessionForChallengeHolder(
    user: User,
    ctx: AuthContext,
    provider: string,
  ): Promise<AuthResult> {
    if (!user.isActive) {
      await this.audit.log({
        event: AuditEvent.LOGIN_FAILED,
        severity: 'warning',
        userId: user.id,
        requestId: ctx.requestId ?? null,
        metadata: { reason: 'account_inactive', provider },
      })
      throw new AccountInactiveException('账户已被禁用')
    }

    await user.refresh()
    const result = await this.issueTokens(user)

    await this.audit.log({
      event: AuditEvent.LOGIN_SUCCESS,
      userId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: { provider, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    })

    return result
  }

  /**
   * Google OAuth 登录（v3-docker-google-oauth-runtime-wiring design C 登录决策顺序）。
   *
   * 语义分层（spec「Authentication source does not grant enterprise authority」）：
   *   Google = 身份来源；组织成员资格/角色、平台管理员、付费权益一律来自
   *   邀请/成员关系、RBAC 与 plan policy——Google provider 永不直接授予。
   *
   * 顺序：
   *   1. 以 (auth_provider=google, provider_subject) 查身份，未命中再按 verified email 查
   *      user（users 表有全局唯一索引支撑；防邮箱变更重复建号，DGO-07）。
   *   2. 既有用户 = 邀请/成员关系已在 `invite()` 时物化为 organization_members 行
   *      （本数据模型邀请要求被邀人已注册）——登录保持角色不变，绝不追加组织 owner
   *      或平台管理员身份（DGO-05）。
   *   3. 仅当身份/邮箱均无匹配（全新身份）才创建个人免费组织并自任 owner（DGO-06）；
   *      该组织与他人完全隔离，不授予企业权限。
   */
  async loginWithGoogle(profile: GoogleUserInfo, ctx: AuthContext = {}): Promise<AuthResult> {
    const outcome = await this.attemptGoogleLogin(profile, ctx)
    if (outcome.twoFactorRequired) {
      throw new TwoFactorRequiredException('该账号已启用两步验证，请通过登录接口提交验证码')
    }
    return outcome.session
  }

  /**
   * Google 登录（**2FA 感知**路径，供 OAuth 回调使用）。
   *
   * 为什么 Google 登录也要过本站两步验证：本站 2FA 的威胁模型是「账号凭证被窃」，
   * 而 Google 身份与本地账号按 verified email 归一（见下方决策顺序第 1 条）——
   * 若只在密码路径设卡，攻击者拿到同邮箱的 Google 访问即可整条绕开，2FA 形同虚设。
   *
   * 反过来，SAML/OIDC 企业 SSO **刻意不过**本站 2FA：那条路径上 MFA 策略归 IdP 所有，
   * 企业已在 IdP 侧统一管控（与业界惯例一致），本站再加一道属于越权。
   */
  async attemptGoogleLogin(
    profile: GoogleUserInfo,
    ctx: AuthContext = {},
  ): Promise<LoginAttemptResult> {
    if (!profile.email || profile.email_verified === false) {
      throw new InvalidCredentialsException('Google 账号邮箱未验证，无法登录')
    }
    const email = profile.email.toLowerCase()

    let user =
      (await User.query()
        .where('auth_provider', 'google')
        .where('provider_id', profile.sub)
        .first()) ?? (await User.findBy('email', email))

    if (!user) {
      const created = await this.createGoogleUserWithPersonalOrg(profile, email)
      user = created.user
      await this.audit.log({
        event: AuditEvent.USER_CREATED,
        userId: user.id,
        organizationId: created.organization.id,
        entityType: 'user',
        entityId: user.id,
        metadata: { source: 'google_oauth' },
      })
      await this.audit.log({
        event: AuditEvent.ORG_CREATED,
        userId: user.id,
        organizationId: created.organization.id,
        entityType: 'organization',
        entityId: created.organization.id,
        metadata: { source: 'google_oauth' },
      })
    } else {
      // 既有用户路径：保持成员/角色不变。邮箱变更时先防冲突再同步；
      // Google 用户 sub 变更沿用既有「恢复/收养」语义（users 唯一索引保证不碰撞）。
      const shouldSyncEmail = user.email !== email
      const shouldAdoptSubject =
        user.authProvider === 'google' && String(user.providerId ?? '') !== profile.sub
      if (shouldSyncEmail || shouldAdoptSubject) {
        if (shouldSyncEmail) {
          const taken = await User.query().where('email', email).whereNot('id', user.id).first()
          if (taken) {
            throw new InvalidCredentialsException('Google 账号邮箱与既有账号冲突，无法登录')
          }
        }
        user.email = email
        if (shouldAdoptSubject) user.providerId = profile.sub
        await user.save()
      }
    }

    if (!user.isActive) {
      await this.audit.log({
        event: AuditEvent.LOGIN_FAILED,
        severity: 'warning',
        userId: user.id,
        requestId: ctx.requestId ?? null,
        metadata: { email: profile.email, reason: 'account_inactive', provider: 'google' },
      })
      throw new AccountInactiveException('账户已被禁用')
    }

    const secondFactor = await this.resolveSecondFactorStep(user, ctx)
    if (secondFactor) return secondFactor

    const result = await this.issueTokens(user)
    await this.audit.log({
      event: AuditEvent.LOGIN_SUCCESS,
      userId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: { provider: 'google', ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
    })
    return { twoFactorRequired: false, session: result }
  }

  /**
   * 第一因子通过后，判断是否还要中断一步。
   *
   * 两种中断（Auth0 Universal Login 的既定形态）：
   * 1. 已绑定认证器 → `verify` 挑战，输一次性口令；
   * 2. 未绑定且开启了登录期绑定 → `enroll` 挑战，登录界面直接给二维码，
   *    扫码后输码完成绑定并登录。
   *
   * 返回 `null` 表示无需第二因子，调用方直接签发会话。
   */
  private async resolveSecondFactorStep(
    user: User,
    ctx: AuthContext,
  ): Promise<{ twoFactorRequired: true; challenge: TwoFactorChallengeTicket } | null> {
    // 部署机 `node ace admin:create-super` 建立的平台管理账号免两步验证（无 HTTP 修改入口）。
    if (user.twoFactorExempt) return null

    if (await this.twoFactor.isEnabled(user.id)) {
      return {
        twoFactorRequired: true,
        challenge: await this.twoFactor.createLoginChallenge(user, ctx),
      }
    }

    if (this.twoFactor.loginEnrollmentMode() === 'off') return null

    const { ticket } = await this.twoFactor.createEnrollmentChallenge(user, ctx)
    return { twoFactorRequired: true, challenge: ticket }
  }

  /**
   * 个人自助注册（design C.5 / DGO-06）：为**全新** Google 身份创建用户 + 个人 free 组织，
   * 本人自任 owner。与本地注册一致的组织隔离语义——该组织只属于本人，
   * 不产生任何企业权限（planTier=free、isSuperAdmin=false）。
   */
  private async createGoogleUserWithPersonalOrg(profile: GoogleUserInfo, email: string) {
    return db.transaction(async (trx) => {
      const createdUser = await User.create(
        {
          fullName: profile.name ?? email.split('@')[0],
          email,
          password: crypto.randomUUID(),
          authProvider: 'google',
          providerId: profile.sub,
          emailVerifiedAt: DateTime.utc(),
          isActive: true,
          isSuperAdmin: false,
          roleVersion: 0,
        },
        { client: trx },
      )
      const organizationName = `${createdUser.fullName ?? 'Google 用户'}的组织`
      const slug = await this.organizationService.generateUniqueSlug(
        organizationName,
        undefined,
        trx,
      )
      const organization = await Organization.create(
        {
          ownerId: createdUser.id,
          name: organizationName,
          slug,
          description: null,
          planTier: 'free',
        },
        { client: trx },
      )
      await OrganizationMember.create(
        {
          organizationId: organization.id,
          userId: createdUser.id,
          role: 'owner',
        },
        { client: trx },
      )
      return { user: createdUser, organization }
    })
  }

  /**
   * SAML2 SSO 登录：把**已验签**的断言换成系统会话（v3-sso-saml2 §5.1）。
   *
   * 与 `login` / `loginWithGoogle` 走**同一条** `issueTokens` 路径，因此 access token 的
   * `sub` / `organizationId` / `roleVersion` / `permissions` 与刷新语义完全一致——
   * 下游 API 不需要任何 SAML 专属分支（design Decision 3）。
   *
   * 前置条件由 `SsoSamlLoginService` 保证：断言已验签、relay state 已消费、
   * 用户已解析并确认属于 `organizationId`。本方法只做「账号状态门 + 签发 + 审计」，
   * **不做**用户创建、不做成员关系变更——那些副作用必须发生在断言校验之后、
   * 由 `SsoSamlIdentityService` 显式执行。
   */
  async loginWithSaml(
    input: { user: User; organizationId: number; providerRef: string },
    ctx: AuthContext = {},
  ): Promise<AuthResult> {
    const { user, organizationId } = input

    if (!user.isActive) {
      await this.audit.log({
        event: AuditEvent.LOGIN_FAILED,
        severity: 'warning',
        userId: user.id,
        organizationId,
        requestId: ctx.requestId ?? null,
        // 低敏：不记邮箱，只记 provider 引用与原因码
        metadata: {
          reason: 'account_inactive',
          provider: 'saml2',
          providerRef: input.providerRef,
        },
      })
      throw new AccountInactiveException('账户已被禁用')
    }

    // 重读 DB：JIT 刚建号 / roleVersion 刚 +1 时，内存里的实例可能是旧的。
    await user.refresh()

    const result = await this.issueTokens(user, organizationId)

    await this.audit.log({
      event: AuditEvent.LOGIN_SUCCESS,
      userId: user.id,
      organizationId,
      requestId: ctx.requestId ?? null,
      metadata: {
        provider: 'saml2',
        providerRef: input.providerRef,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    })

    return result
  }

  /**
   * OIDC SSO 登录：把**已验签**的 ID token 身份换成系统会话（v3-sso-oidc §5.4）。
   *
   * 与 `login` / `loginWithGoogle` / `loginWithSaml` 走**同一条** `issueTokens` 路径，
   * 因此 access token 的 `sub` / `organizationId` / `roleVersion` / `permissions`
   * 与刷新语义完全一致——下游 API 不需要任何 OIDC 专属分支（design Decision 3）。
   *
   * 前置条件由 `SsoOidcLoginService` 保证：ID token 已验签、state 已消费、
   * 用户已解析并确认属于 `organizationId`。本方法只做「账号状态门 + 签发 + 审计」，
   * **不做**用户创建、不做成员关系变更——那些副作用必须发生在 token 校验之后、
   * 由 `SsoOidcIdentityService` 显式执行。
   */
  async loginWithOidc(
    input: { user: User; organizationId: number; providerRef: string },
    ctx: AuthContext = {},
  ): Promise<AuthResult> {
    const { user, organizationId } = input

    if (!user.isActive) {
      await this.audit.log({
        event: AuditEvent.LOGIN_FAILED,
        severity: 'warning',
        userId: user.id,
        organizationId,
        requestId: ctx.requestId ?? null,
        // 低敏：不记邮箱，只记 provider 引用与原因码
        metadata: {
          reason: 'account_inactive',
          provider: 'oidc',
          providerRef: input.providerRef,
        },
      })
      throw new AccountInactiveException('账户已被禁用')
    }

    // 重读 DB：JIT 刚建号 / roleVersion 刚 +1 时，内存里的实例可能是旧的。
    await user.refresh()

    const result = await this.issueTokens(user, organizationId)

    await this.audit.log({
      event: AuditEvent.LOGIN_SUCCESS,
      userId: user.id,
      organizationId,
      requestId: ctx.requestId ?? null,
      metadata: {
        provider: 'oidc',
        providerRef: input.providerRef,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    })

    return result
  }

  /**
   * 刷新 token：用 refresh token 换发新的 access + refresh（单次轮换）。
   * 刷新时重新读取用户角色与 roleVersion。
   */
  async refresh(
    tokenValue: string,
    organizationId?: number | null,
    ctx: AuthContext = {},
  ): Promise<AuthResult> {
    const { user, dbToken } = await this.tokenService.verifyRefreshToken(tokenValue)

    if (!user.isActive) {
      throw new AccountInactiveException('账户已被禁用')
    }

    // 重读 DB 最新 roleVersion
    await user.refresh()

    const { token: refreshToken } = await this.tokenService.rotateRefreshToken(user, dbToken)
    const session = await this.sessionContext(user, organizationId)
    const accessToken = await this.tokenService.generateAccessToken({
      sub: user.id,
      organizationId: session.organizationId,
      planTier: session.planTier,
      roleVersion: user.roleVersion,
      permissions: session.permissions,
    })

    // 说明：空闲超时（SEC-04）由 DbAccessTokensProvider.verify() 在每次校验时
    // 自动更新 last_used_at 承载；新签发的 token createdAt=now，无需手动写回。

    await this.audit.log({
      event: AuditEvent.TOKEN_REFRESHED,
      userId: user.id,
      requestId: ctx.requestId ?? null,
    })

    return {
      user,
      accessToken,
      refreshToken,
      permissions: session.permissions,
      planTier: session.planTier,
    }
  }

  /**
   * 登出：撤销当前 refresh token。
   */
  async logout(user: User, tokenValue: string, ctx: AuthContext = {}): Promise<void> {
    const { dbToken } = await this.tokenService.verifyRefreshToken(tokenValue)
    await this.tokenService.revokeRefreshToken(user, dbToken.identifier)

    await this.audit.log({
      event: AuditEvent.LOGOUT,
      userId: user.id,
      requestId: ctx.requestId ?? null,
    })
  }

  /**
   * 递增用户 role_version（角色/成员关系变更时调用）——令旧 access token 即时失效（D9）。
   */
  async bumpRoleVersion(userId: number, ctx: AuthContext = {}): Promise<void> {
    const user = await User.find(userId)
    if (!user) return

    user.roleVersion += 1
    await user.save()

    await this.audit.log({
      event: AuditEvent.ROLE_CHANGED,
      userId,
      requestId: ctx.requestId ?? null,
      metadata: { roleVersion: user.roleVersion },
    })
  }

  /**
   * 校验用户是否处于活跃状态（供外部调用）。
   */
  async assertActive(user: User): Promise<void> {
    if (!user.isActive) {
      throw new AccountInactiveException('账户已被禁用')
    }
  }

  /**
   * 解析 refresh token 并返回用户（用于中间件/控制器获取当前会话）。
   */
  async resolveRefreshToken(tokenValue: string): Promise<{ user: User; dbToken: JwtRefreshToken }> {
    return this.tokenService.verifyRefreshToken(tokenValue)
  }

  /**
   * 返回 me 所需的用户组织与当前权限声明。
   */
  async me(user: User, organizationId: number | null) {
    const session = await this.sessionContext(user, organizationId)
    return { user, permissions: session.permissions, planTier: session.planTier }
  }

  /**
   * 签发 access + refresh token 对。
   */
  private async issueTokens(user: User, organizationId?: number | null): Promise<AuthResult> {
    const session = await this.sessionContext(user, organizationId)
    const accessToken = await this.tokenService.generateAccessToken({
      sub: user.id,
      organizationId: session.organizationId,
      planTier: session.planTier,
      roleVersion: user.roleVersion,
      permissions: session.permissions,
    })

    const { token: refreshToken } = await this.tokenService.generateRefreshToken(user)

    return {
      user,
      accessToken,
      refreshToken,
      permissions: session.permissions,
      planTier: session.planTier,
    }
  }

  private async sessionContext(user: User, requestedOrganizationId?: number | null) {
    await user.load('organizationMembers', (query) => query.preload('organization'))
    const memberships = user.organizationMembers.filter((membership) =>
      Boolean(membership.organization),
    )
    const defaultOrganizationId = memberships[0]
      ? Number(memberships[0].organizationId)
      : user.isSuperAdmin
        ? null
        : null
    const organizationId =
      requestedOrganizationId === undefined ? defaultOrganizationId : requestedOrganizationId

    if (
      organizationId !== null &&
      !user.isSuperAdmin &&
      !memberships.some((membership) => Number(membership.organizationId) === organizationId) &&
      // owner fallback：组织所有者可能没有 organization_members 行（历史数据 / 直接建组织），
      // 只按成员表判定会把所有者挡在自己组织外面。这与 V3 `TenantResolutionService`
      // 已确立的 owner fallback 语义一致（v3-multitenant-tenant-identification §3.3），
      // 此前 `sessionContext` 缺这一支，导致「显式选自己的组织」抛 401。
      // 只放宽到**自己拥有**的组织，不涉及任何他人组织。
      !(await OrganizationMember.belongsToOrganization(organizationId, user.id))
    ) {
      throw new InvalidCredentialsException('无权切换到该组织')
    }

    const permissions = await this.rbacService.resolveUserPermissions(user, organizationId)

    // 套餐层级随「当前生效组织」签发：无组织为 null。
    // 与权限解析共用一次组织查询的余地不大（resolveUserPermissions 内部按需查），
    // 登录/刷新/me 均为低频路径，这里单独查一次保持清晰。
    const organization = organizationId === null ? null : await Organization.find(organizationId)
    const planTier = organization?.planTier ?? null

    return { organizationId, permissions, planTier }
  }
}
