import crypto from 'node:crypto'
import User from '#models/user'
import UserTwoFactorChallenge from '#models/user_two_factor_challenge'
import UserTwoFactorCredential from '#models/user_two_factor_credential'
import UserTwoFactorRecoveryCode from '#models/user_two_factor_recovery_code'
import AuditService, { AuditEvent } from '#services/audit_service'
import TwoFactorSecretCipher, {
  TwoFactorSecretUnreadableError,
} from '#services/two_factor/two_factor_secret_cipher'
import TwoFactorThrottleService from '#services/two_factor/two_factor_throttle_service'
import {
  buildOtpauthUri,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  TOTP_DEFAULTS,
  verifyTotpCode,
  type TotpAlgorithm,
} from '#services/two_factor/totp'
import {
  InvalidTwoFactorCodeException,
  TwoFactorChallengeInvalidException,
  TwoFactorStateConflictException,
  TwoFactorThrottledException,
  TwoFactorUnavailableException,
} from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import env from '#start/env'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { AuthContext } from '#types/auth'
import type { TwoFactorChallengePurpose } from '#models/user_two_factor_challenge'

export type { TwoFactorChallengePurpose }

/** 第二因子的可用方式。 */
export type TwoFactorMethod = 'totp' | 'recovery_code'

/**
 * 账号的两步验证状态机（服务端唯一事实，前端只做呈现）。
 *
 * - `disabled`：从未设置，登录只需密码（或按策略引导绑定）；
 * - `pending_setup`：已生成待确认密钥、尚未用验证码确认。**不拦登录**——
 *   没确认的密钥不能把用户锁在门外；
 * - `active`：已启用且密钥可用，登录必须过第二因子；
 * - `needs_reenrollment`：曾标记启用，但密钥已不可用（结构损坏）。
 *   绝不能把这种账号送进永远过不了的验证码页，必须回到绑定流程。
 */
export type TwoFactorState = 'disabled' | 'pending_setup' | 'active' | 'needs_reenrollment'

/**
 * 登录期绑定策略（env `TWO_FACTOR_LOGIN_ENROLLMENT`）。
 * - `off`：未绑定的账号密码通过即登录（本能力上线前的行为）；
 * - `optional`（默认）：登录中出现二维码引导绑定，但允许「暂时跳过」；
 * - `required`：必须完成绑定才能拿到会话，无跳过入口。
 */
export type TwoFactorLoginEnrollmentMode = 'off' | 'optional' | 'required'

/** 账号两步验证状态（低敏，可直接回给本人）。 */
export interface TwoFactorStatus {
  /** 显式状态机取值——`enabled`/`pending` 等布尔量是它的派生投影，便于既有 UI 消费。 */
  state: TwoFactorState
  enabled: boolean
  /** 已生成密钥但尚未用验证码确认——UI 据此提示「继续完成设置」。 */
  pending: boolean
  /** 「更换认证器」在途：已扫新二维码但尚未确认，旧认证器仍然有效。 */
  rebinding: boolean
  label: string | null
  confirmedAt: string | null
  lastUsedAt: string | null
  recoveryCodesRemaining: number
}

/** 注册向导第一步的产物。`secret` 是全流程唯一一次返回明文密钥。 */
export interface TwoFactorEnrollment {
  secret: string
  otpauthUri: string
  digits: number
  period: number
  algorithm: TotpAlgorithm
}

/** 密码校验通过、等待第二因子时下发的挑战票据。 */
export interface TwoFactorChallengeTicket {
  challengeToken: string
  expiresAt: string
  /** `verify` = 输认证器验证码；`enroll` = 先扫码绑定再输验证码。 */
  purpose: TwoFactorChallengePurpose
  methods: TwoFactorMethod[]
}

/**
 * 两步验证（TOTP）服务。
 *
 * 边界：本服务只负责「第二因子事实」——密钥生命周期、验证码校验、恢复码、登录挑战。
 * **不签发会话**：挑战校验通过后把 `User` 交回 `AuthService` 走既有 `issueTokens`
 * 路径，保证 2FA 登录与密码/Google/SAML/OIDC 登录拿到的 claims 完全一致，
 * 下游 API 不需要任何 2FA 专属分支。依赖方向单向（AuthService → TwoFactorService），
 * 不存在循环依赖。
 */
@inject()
export default class TwoFactorService {
  /** 挑战有效期：够用户打开认证器读一次码，又不至于长到值得被窃取重放。 */
  static readonly CHALLENGE_TTL_MINUTES = 5

  /** 单个挑战允许的错误次数；超出即作废，必须回到密码步重来。 */
  static readonly MAX_CHALLENGE_ATTEMPTS = 5

  /** 每次生成的恢复码条数。 */
  static readonly RECOVERY_CODE_COUNT = 10

  constructor(
    private cipher: TwoFactorSecretCipher,
    private audit: AuditService,
    private throttle: TwoFactorThrottleService,
  ) {}

  /** 认证器 App 中显示的签发方名称。 */
  private issuer(): string {
    return env.get('TWO_FACTOR_ISSUER') || '开项 Kaiplan'
  }

  /**
   * 该账号是否拥有「用户知道的密码」这一因子。
   *
   * Google/SAML/OIDC 建号时 `password` 写的是随机 UUID（见 `AuthService`
   * `createGoogleUserWithPersonalOrg`），用户从来不知道它。对这类账号要求「重新输入密码」
   * 等于把本人永久挡在自己的 2FA 管理之外，所以密码重认证只对 local 账号生效。
   */
  private hasLocalPassword(user: User): boolean {
    return user.authProvider === 'local'
  }

  /**
   * 高风险动作（更换认证器 / 关闭 2FA）的密码重认证。
   *
   * OWASP 把「Changing MFA Factors」「Disabling MFA」都列为需要重新验证身份的操作：
   * 拿到一个还没过期的会话不等于人还在电脑前。
   */
  private async assertPasswordReauth(
    user: User,
    password: string | undefined,
    ctx: AuthContext,
  ): Promise<void> {
    if (!this.hasLocalPassword(user)) return

    const candidate = password ?? ''
    if (candidate.length === 0) {
      throw new TwoFactorStateConflictException('该操作需要重新输入当前账号密码')
    }
    await this.assertNotThrottled(user.id, ctx)
    const ok = await hash.verify(user.password, candidate)
    await this.noteAttempt(user.id, ctx, ok)
    if (!ok) {
      throw new InvalidTwoFactorCodeException('当前账号密码不正确')
    }
  }

  /**
   * 登录期绑定策略。未配置时默认 `optional`——按 OWASP「Any MFA is better than no MFA」
   * 的取向主动引导用户绑定，同时留跳过口子，避免没有手机的用户被挡在门外。
   * 取值非法一律回落 `optional`，不因配置写错而静默关掉这道防线。
   */
  loginEnrollmentMode(): TwoFactorLoginEnrollmentMode {
    const configured = env.get('TWO_FACTOR_LOGIN_ENROLLMENT')
    return configured === 'off' || configured === 'required' ? configured : 'optional'
  }

  /** 读取用户凭据（含 pending）。 */
  private async findCredential(userId: number): Promise<UserTwoFactorCredential | null> {
    return UserTwoFactorCredential.query().where('user_id', userId).first()
  }

  /**
   * 解析账号的两步验证状态，并在发现**结构性损坏**时就地修复。
   *
   * 这是「2fa_enabled=true 但没有可用密钥 → 账号被永久卡死」那类事故的唯一防线：
   * 登录链路只认本方法的结论，不直接读 `status` 列。
   *
   * 两种「读不出密钥」的处置刻意不同（见 `TwoFactorSecretUnreadableError`）：
   * - `malformed`（密文结构就是坏的）→ 这条记录没救，清理成未绑定并审计，
   *   用户下次登录走正常绑定流程；
   * - `undecryptable`（结构完好但解不开 = 加密密钥变了）→ **抛 503**，绝不清理。
   *   否则一次 `TWO_FACTOR_ENCRYPTION_KEY` 配错就会静默抹掉全站第二因子。
   */
  async resolveState(
    userId: number,
    ctx: AuthContext = {},
  ): Promise<{ state: TwoFactorState; credential: UserTwoFactorCredential | null }> {
    const credential = await this.findCredential(userId)
    if (!credential) return { state: 'disabled', credential: null }
    if (credential.status !== 'active') return { state: 'pending_setup', credential }

    try {
      this.cipher.decrypt(credential.secretEncrypted)
      return { state: 'active', credential }
    } catch (error) {
      if (error instanceof TwoFactorSecretUnreadableError && error.reason === 'undecryptable') {
        // 密钥配置问题：全站性故障，fail closed 交人工处理。
        throw new TwoFactorUnavailableException('两步验证暂时不可用，请联系管理员')
      }
      await this.repairInvalidCredential(credential, ctx)
      return { state: 'needs_reenrollment', credential: null }
    }
  }

  /**
   * 清理一条无法使用的凭据，把账号安全地退回「未绑定」。
   *
   * 连同恢复码与在途挑战一起删：留着它们只会让用户在一个已经不存在的第二因子上打转。
   * 审计只记「发生了自动修复」，不记任何密文/密钥内容。
   */
  private async repairInvalidCredential(
    credential: UserTwoFactorCredential,
    ctx: AuthContext,
  ): Promise<void> {
    const userId = credential.userId
    await db.transaction(async (trx) => {
      await UserTwoFactorRecoveryCode.query({ client: trx }).where('user_id', userId).delete()
      await UserTwoFactorChallenge.query({ client: trx }).where('user_id', userId).delete()
      await UserTwoFactorCredential.query({ client: trx }).where('user_id', userId).delete()
    })
    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_INVALID_STATE_REPAIRED,
      severity: 'warning',
      userId,
      entityType: 'user',
      entityId: userId,
      requestId: ctx.requestId ?? null,
      metadata: { reason: 'secret_malformed' },
    })
  }

  /** 账号是否已启用且**可用**的两步验证（登录链路的唯一判据）。 */
  async isEnabled(userId: number, ctx: AuthContext = {}): Promise<boolean> {
    const { state } = await this.resolveState(userId, ctx)
    return state === 'active'
  }

  /** 账号两步验证状态投影（经 `resolveState`，坏数据在这里就已被修复）。 */
  async status(user: User, ctx: AuthContext = {}): Promise<TwoFactorStatus> {
    const { state, credential } = await this.resolveState(user.id, ctx)
    if (!credential) {
      return {
        state,
        enabled: false,
        pending: false,
        rebinding: false,
        label: null,
        confirmedAt: null,
        lastUsedAt: null,
        recoveryCodesRemaining: 0,
      }
    }

    const remaining = await this.countUnusedRecoveryCodes(user.id)
    return {
      state,
      enabled: state === 'active',
      pending: state === 'pending_setup',
      rebinding: state === 'active' && credential.pendingSecretEncrypted !== null,
      label: credential.label,
      confirmedAt: credential.confirmedAt?.toISO() ?? null,
      lastUsedAt: credential.lastUsedAt?.toISO() ?? null,
      recoveryCodesRemaining: remaining,
    }
  }

  private async countUnusedRecoveryCodes(userId: number): Promise<number> {
    const rows = await UserTwoFactorRecoveryCode.query()
      .where('user_id', userId)
      .whereNull('used_at')
      .count('* as total')
    const extras = (rows[0] as unknown as { $extras?: Record<string, unknown> })?.$extras
    return Number(extras?.total ?? 0)
  }

  /**
   * 第一步：生成待确认密钥并返回二维码内容。
   *
   * 两种入口共用本方法：
   * - **首次绑定**（无凭据或凭据仍是 pending）：直接生成/覆盖 pending 密钥；
   * - **更换认证器**（凭据已生效）：必须先用**当前**第二因子授权（`currentCode`），
   *   否则被窃取的会话就能把第二因子换成攻击者的手机——OWASP 明确要求
   *   「Changing MFA Factors」本身也要过 MFA。新密钥先落 `pendingSecretEncrypted`，
   *   确认成功才提升，中途放弃不影响旧认证器。
   */
  async startEnrollment(
    user: User,
    input: { label?: string | null; currentCode?: string; password?: string } = {},
    ctx: AuthContext = {},
  ): Promise<TwoFactorEnrollment> {
    const existing = await this.findCredential(user.id)
    const secret = generateSecret()
    const label = input.label?.trim() ? input.label.trim().slice(0, 64) : null

    if (existing?.isActive) {
      // 更换认证器 = 换掉第二因子本身，两个因子都要重新出示：密码 + 当前 TOTP/恢复码。
      await this.assertPasswordReauth(user, input.password, ctx)

      const currentCode = input.currentCode?.trim() ?? ''
      if (currentCode.length === 0) {
        throw new TwoFactorStateConflictException('更换认证器需要先输入当前认证器的验证码')
      }
      await this.assertNotThrottled(user.id, ctx)
      const authorized = await this.consumeSecondFactor(existing, currentCode, ctx)
      await this.noteAttempt(user.id, ctx, authorized.verified)
      if (!authorized.verified) {
        throw new InvalidTwoFactorCodeException('当前认证器的验证码或恢复码不正确')
      }

      existing.pendingSecretEncrypted = this.cipher.encrypt(secret)
      existing.pendingStartedAt = DateTime.utc()
      if (label) existing.label = label
      await existing.save()
    } else if (existing) {
      existing.secretEncrypted = this.cipher.encrypt(secret)
      existing.label = label
      existing.lastUsedStep = null
      existing.pendingSecretEncrypted = null
      existing.pendingStartedAt = null
      await existing.save()
    } else {
      await UserTwoFactorCredential.create({
        userId: user.id,
        status: 'pending',
        secretEncrypted: this.cipher.encrypt(secret),
        pendingSecretEncrypted: null,
        pendingStartedAt: null,
        algorithm: TOTP_DEFAULTS.algorithm,
        digits: TOTP_DEFAULTS.digits,
        period: TOTP_DEFAULTS.period,
        label,
        confirmedAt: null,
        lastUsedAt: null,
        lastUsedStep: null,
      })
    }

    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_ENROLLMENT_STARTED,
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      requestId: ctx.requestId ?? null,
    })

    return {
      secret,
      otpauthUri: buildOtpauthUri({
        secret,
        accountName: user.email,
        issuer: this.issuer(),
        digits: TOTP_DEFAULTS.digits,
        period: TOTP_DEFAULTS.period,
        algorithm: TOTP_DEFAULTS.algorithm,
      }),
      digits: TOTP_DEFAULTS.digits,
      period: TOTP_DEFAULTS.period,
      algorithm: TOTP_DEFAULTS.algorithm,
    }
  }

  /**
   * 第二步：用认证器验证码确认，凭据转 `active` 并整批签发恢复码。
   *
   * 恢复码明文只在这一次返回；服务端只留 sha256，此后无从还原。
   */
  async confirmEnrollment(user: User, code: string, ctx: AuthContext = {}): Promise<string[]> {
    const credential = await this.findCredential(user.id)
    if (!credential) {
      throw new TwoFactorStateConflictException('尚未开始设置两步验证')
    }

    // 已生效的凭据只有在「更换认证器」在途时才接受确认——校验对象是新扫的密钥。
    const rebinding = credential.isActive
    if (rebinding && !credential.pendingSecretEncrypted) {
      throw new TwoFactorStateConflictException('两步验证已启用')
    }

    await this.assertNotThrottled(user.id, ctx)
    const targetSecret = rebinding ? credential.pendingSecretEncrypted! : credential.secretEncrypted
    const step = this.verifySecretCode(credential, targetSecret, code, {
      // 更换认证器时新密钥是全新的，不该受旧密钥的 lastUsedStep 约束。
      lastUsedStep: rebinding ? null : credential.lastUsedStep,
    })
    await this.noteAttempt(user.id, ctx, step !== null)
    if (step === null) {
      throw new InvalidTwoFactorCodeException('验证码不正确，请确认认证器时间同步后重试')
    }

    const codes = generateRecoveryCodes(TwoFactorService.RECOVERY_CODE_COUNT)
    const now = DateTime.utc()

    await db.transaction(async (trx) => {
      credential.useTransaction(trx)
      if (rebinding) {
        // 提升在途密钥：这一刻起旧认证器立即失效。
        credential.secretEncrypted = targetSecret
        credential.pendingSecretEncrypted = null
        credential.pendingStartedAt = null
      }
      credential.status = 'active'
      credential.confirmedAt = now
      credential.lastUsedAt = now
      credential.lastUsedStep = step
      await credential.save()

      // 确认即整批重置恢复码：pending 阶段不该有遗留码，重复设置也不该叠加。
      await UserTwoFactorRecoveryCode.query({ client: trx }).where('user_id', user.id).delete()
      await UserTwoFactorRecoveryCode.createMany(
        codes.map((value) => ({
          userId: user.id,
          codeHash: hashRecoveryCode(value),
          usedAt: null,
        })),
        { client: trx },
      )
    })

    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_ENABLED,
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: { recoveryCodesIssued: codes.length },
    })

    return codes
  }

  /**
   * 关闭两步验证。必须提供有效的一次性口令或恢复码——拿到会话不等于拿到第二因子，
   * 会话被窃取时这道门决定攻击者能否把 2FA 直接摘掉。
   */
  async disable(
    user: User,
    code: string,
    ctx: AuthContext = {},
    options: { password?: string } = {},
  ): Promise<void> {
    const credential = await this.findCredential(user.id)
    if (!credential?.isActive) {
      throw new TwoFactorStateConflictException('两步验证未启用')
    }

    // 关闭 2FA 是把账号的保护整个摘掉，与更换认证器同级：密码 + 第二因子都要出示。
    await this.assertPasswordReauth(user, options.password, ctx)
    await this.assertNotThrottled(user.id, ctx)
    const verified = await this.consumeSecondFactor(credential, code, ctx)
    await this.noteAttempt(user.id, ctx, verified.verified)
    if (!verified.verified) {
      throw new InvalidTwoFactorCodeException('验证码或恢复码不正确')
    }

    await db.transaction(async (trx) => {
      await UserTwoFactorRecoveryCode.query({ client: trx }).where('user_id', user.id).delete()
      await UserTwoFactorChallenge.query({ client: trx }).where('user_id', user.id).delete()
      await UserTwoFactorCredential.query({ client: trx }).where('user_id', user.id).delete()
    })

    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_DISABLED,
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      requestId: ctx.requestId ?? null,
    })
  }

  /** 整批重置恢复码（旧码立即全部作废）。同样需要有效第二因子。 */
  async regenerateRecoveryCodes(
    user: User,
    code: string,
    ctx: AuthContext = {},
  ): Promise<string[]> {
    const credential = await this.findCredential(user.id)
    if (!credential?.isActive) {
      throw new TwoFactorStateConflictException('两步验证未启用')
    }

    await this.assertNotThrottled(user.id, ctx)
    const verified = await this.consumeSecondFactor(credential, code, ctx)
    await this.noteAttempt(user.id, ctx, verified.verified)
    if (!verified.verified) {
      throw new InvalidTwoFactorCodeException('验证码或恢复码不正确')
    }

    const codes = generateRecoveryCodes(TwoFactorService.RECOVERY_CODE_COUNT)
    await db.transaction(async (trx) => {
      await UserTwoFactorRecoveryCode.query({ client: trx }).where('user_id', user.id).delete()
      await UserTwoFactorRecoveryCode.createMany(
        codes.map((value) => ({
          userId: user.id,
          codeHash: hashRecoveryCode(value),
          usedAt: null,
        })),
        { client: trx },
      )
    })

    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_RECOVERY_CODES_REGENERATED,
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: { recoveryCodesIssued: codes.length },
    })

    return codes
  }

  /**
   * 管理员代为重置他人两步验证（**高风险动作**）。
   *
   * 为什么是管理员而不是邮件自助：本项目没有任何邮件基础设施（无 `config/mail.ts`、
   * 无密码重置/邮箱验证流程），凭空引入「发邮件即可关掉 2FA」等于把第二因子降级成
   * 「谁能收到这个邮箱谁就能进」——那正是 OWASP 说的「Processes implemented to allow
   * users to bypass or reset MFA may be exploitable by attackers」。
   *
   * 因此兜底走人工核身：管理员确认身份后调用本方法，把目标账号退回未绑定态，
   * 用户下次登录重新扫码。调用方负责 RBAC 门（`system:admin`），本方法只保证
   * 「清干净 + 留痕」。审计记录 actor 与 target，绝不记密钥、验证码或恢复码。
   */
  async adminReset(
    input: { actor: User; targetUserId: number; reason: string },
    ctx: AuthContext = {},
  ): Promise<void> {
    const target = await User.find(input.targetUserId)
    if (!target) {
      throw new TwoFactorStateConflictException('目标用户不存在')
    }

    await db.transaction(async (trx) => {
      await UserTwoFactorRecoveryCode.query({ client: trx }).where('user_id', target.id).delete()
      await UserTwoFactorChallenge.query({ client: trx }).where('user_id', target.id).delete()
      await UserTwoFactorCredential.query({ client: trx }).where('user_id', target.id).delete()
    })

    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_ADMIN_RESET,
      severity: 'warning',
      userId: input.actor.id,
      entityType: 'user',
      entityId: target.id,
      requestId: ctx.requestId ?? null,
      metadata: {
        targetUserId: target.id,
        // 理由是人工核身的凭据，必须留痕；长度截断避免把大段自由文本塞进审计。
        reason: input.reason.trim().slice(0, 500),
        ip: ctx.ip ?? null,
      },
    })
  }

  /**
   * 密码校验通过后下发登录挑战（`verify`：账号已绑定认证器）。
   *
   * 明文令牌只在返回值里出现一次，库里只存 sha256——数据库读权限不足以伪造挑战。
   * 顺带清理该用户的过期/已消费挑战，避免表无界增长（无需额外定时任务）。
   */
  async createLoginChallenge(user: User, ctx: AuthContext = {}): Promise<TwoFactorChallengeTicket> {
    const { token, expiresAt } = await this.issueChallenge(user, 'verify')
    const remaining = await this.countUnusedRecoveryCodes(user.id)

    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_CHALLENGE_ISSUED,
      userId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: { ip: ctx.ip ?? null, purpose: 'verify' },
    })

    return {
      challengeToken: token,
      expiresAt: expiresAt.toISO()!,
      purpose: 'verify',
      methods: remaining > 0 ? ['totp', 'recovery_code'] : ['totp'],
    }
  }

  /**
   * 密码校验通过、但账号**尚未绑定**认证器时下发绑定挑战（enrollment-at-login）。
   *
   * 这是 Auth0 / Okta 等 Universal Login 的既定形态：密码过了以后，登录界面直接给出
   * 二维码让用户当场扫码绑定，再输入认证器生成的验证码完成登录。二维码里装的是
   * **一次性生成的新密钥**，与该次挑战绑定；未完成确认前不签发任何会话。
   *
   * 与设置页的 `startEnrollment` 共用同一份 pending 凭据语义：重复发起会覆盖上一个
   * 待确认密钥（用户重新扫码即可），已绑定的账号不会走到这里。
   */
  async createEnrollmentChallenge(
    user: User,
    ctx: AuthContext = {},
  ): Promise<{ ticket: TwoFactorChallengeTicket; enrollment: TwoFactorEnrollment }> {
    const enrollment = await this.startEnrollment(user, {}, ctx)
    const { token, expiresAt } = await this.issueChallenge(user, 'enroll')

    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_CHALLENGE_ISSUED,
      userId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: { ip: ctx.ip ?? null, purpose: 'enroll' },
    })

    return {
      ticket: {
        challengeToken: token,
        expiresAt: expiresAt.toISO()!,
        purpose: 'enroll',
        // 绑定阶段还没有恢复码，唯一可用方式就是刚扫进认证器的一次性口令。
        methods: ['totp'],
      },
      enrollment,
    }
  }

  /**
   * 用挑战票据取回该次绑定的二维码内容。
   *
   * 单独一个端点而不是塞进登录响应：Google OAuth 回调是 302 回前端，若把密钥放进
   * 登录响应就得经 URL 传递，会落进浏览器历史。改为「令牌换密钥」后，密钥只走
   * POST body，两条登录路径共用同一套前端代码。
   */
  async enrollmentForChallenge(challengeToken: string): Promise<TwoFactorEnrollment> {
    const { challenge, user } = await this.resolveActiveChallenge(challengeToken)
    if (challenge.purpose !== 'enroll') {
      throw new TwoFactorChallengeInvalidException('登录验证已失效，请重新登录')
    }

    const credential = await this.findCredential(user.id)
    if (!credential || credential.isActive) {
      throw new TwoFactorChallengeInvalidException('登录验证已失效，请重新登录')
    }

    let secret: string
    try {
      secret = this.cipher.decrypt(credential.secretEncrypted)
    } catch {
      throw new TwoFactorChallengeInvalidException('登录验证已失效，请重新登录')
    }

    return {
      secret,
      otpauthUri: buildOtpauthUri({
        secret,
        accountName: user.email,
        issuer: this.issuer(),
        digits: credential.digits,
        period: credential.period,
        algorithm: credential.algorithm as TotpAlgorithm,
      }),
      digits: credential.digits,
      period: credential.period,
      algorithm: credential.algorithm as TotpAlgorithm,
    }
  }

  /** 生成并落库一张挑战票据（只存 sha256），顺带清理该用户的过期/已消费挑战。 */
  private async issueChallenge(
    user: User,
    purpose: TwoFactorChallengePurpose,
  ): Promise<{ token: string; expiresAt: DateTime }> {
    const token = crypto.randomBytes(32).toString('base64url')
    const now = DateTime.utc()
    const expiresAt = now.plus({ minutes: TwoFactorService.CHALLENGE_TTL_MINUTES })

    await UserTwoFactorChallenge.query()
      .where('user_id', user.id)
      .where((query) => {
        query
          .whereNotNull('consumed_at')
          .orWhere('expires_at', '<', now.toSQL({ includeOffset: false })!)
      })
      .delete()

    await UserTwoFactorChallenge.create({
      userId: user.id,
      tokenHash: this.hashChallengeToken(token),
      purpose,
      attempts: 0,
      expiresAt,
      consumedAt: null,
    })

    return { token, expiresAt }
  }

  /**
   * 解析一张仍然可用的挑战票据。
   * 无效/过期/已消费/尝试超限/用户不存在，一律归一到同一个异常——不区分原因，
   * 避免把「这张票据存在但过期了」这类信息透露给持票人以外的人。
   */
  private async resolveActiveChallenge(
    challengeToken: string,
  ): Promise<{ challenge: UserTwoFactorChallenge; user: User }> {
    const challenge = await UserTwoFactorChallenge.query()
      .where('token_hash', this.hashChallengeToken(challengeToken))
      .first()

    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= DateTime.utc() ||
      challenge.attempts >= TwoFactorService.MAX_CHALLENGE_ATTEMPTS
    ) {
      throw new TwoFactorChallengeInvalidException('登录验证已失效，请重新登录')
    }

    const user = await User.find(challenge.userId)
    if (!user) {
      await challenge.delete()
      throw new TwoFactorChallengeInvalidException('登录验证已失效，请重新登录')
    }

    return { challenge, user }
  }

  /**
   * 校验挑战 + 第二因子，成功返回对应用户（**不签发会话**，由 AuthService 完成）。
   *
   * 失败语义：
   * - 挑战本身无效/过期/已消费/尝试超限 → `TwoFactorChallengeInvalidException`（前端退回密码步）；
   * - 挑战有效但验证码错 → 计数 +1 后 `InvalidTwoFactorCodeException`（前端留在验证码步）。
   */
  async verifyLoginChallenge(
    challengeToken: string,
    code: string,
    ctx: AuthContext = {},
  ): Promise<{ user: User; recoveryCodes: string[] | null; usedRecoveryCode?: boolean }> {
    const { challenge, user } = await this.resolveActiveChallenge(challengeToken)
    const credential = await this.findCredential(user.id)

    // `verify` 要求凭据已生效；`enroll` 要求凭据仍是待确认状态。
    // 两者都不满足即说明挑战下发后状态被改动（2FA 被关掉、被别处绑定完成……），
    // 一律作废重来，绝不在状态不明时放行。
    const expectedActive = challenge.purpose === 'verify'
    if (!credential || credential.isActive !== expectedActive) {
      await challenge.delete()
      throw new TwoFactorChallengeInvalidException('登录验证已失效，请重新登录')
    }

    await this.assertNotThrottled(user.id, ctx)

    if (challenge.purpose === 'enroll') {
      // 绑定挑战只认刚扫进认证器的一次性口令（此时还没有恢复码）。
      // 校验通过即在同一步内完成「激活 + 签发恢复码」，随后才允许签发会话。
      // 计数由 `confirmEnrollment` 内部统一记（它是唯一的校验点），这里只管挑战票据自身。
      let recoveryCodes: string[]
      try {
        recoveryCodes = await this.confirmEnrollment(user, code, ctx)
      } catch (error) {
        if (error instanceof InvalidTwoFactorCodeException) {
          await this.recordChallengeFailure(challenge, user, ctx)
        }
        throw error
      }
      await this.consumeChallenge(challenge, user, ctx)
      return { user, recoveryCodes }
    }

    const outcome = await this.consumeSecondFactor(credential, code, ctx)
    if (!outcome.verified) {
      await this.noteAttempt(user.id, ctx, false)
      await this.recordChallengeFailure(challenge, user, ctx)
      throw new InvalidTwoFactorCodeException('验证码或恢复码不正确')
    }

    await this.noteAttempt(user.id, ctx, true)
    await this.consumeChallenge(challenge, user, ctx)
    // 用恢复码登录说明认证器多半已不可用——把这个事实带给上层，让 UI 引导重新绑定
    // （OWASP：失去第二因子后应引导用户尽快恢复到可用状态，而不是让恢复码越用越少）。
    return { user, recoveryCodes: null, usedRecoveryCode: outcome.method === 'recovery_code' }
  }

  /** 记一次挑战失败（计数 +1 + 低敏审计）。计数达上限后该票据即作废。 */
  private async recordChallengeFailure(
    challenge: UserTwoFactorChallenge,
    user: User,
    ctx: AuthContext,
  ): Promise<void> {
    challenge.attempts += 1
    await challenge.save()
    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_CHALLENGE_FAILED,
      severity: 'warning',
      userId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: {
        ip: ctx.ip ?? null,
        purpose: challenge.purpose,
        attempts: challenge.attempts,
        remaining: Math.max(0, TwoFactorService.MAX_CHALLENGE_ATTEMPTS - challenge.attempts),
      },
    })
  }

  /** 标记挑战已消费（一次性）。 */
  private async consumeChallenge(
    challenge: UserTwoFactorChallenge,
    user: User,
    ctx: AuthContext,
  ): Promise<void> {
    challenge.consumedAt = DateTime.utc()
    await challenge.save()
    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_CHALLENGE_SUCCEEDED,
      userId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: { ip: ctx.ip ?? null, purpose: challenge.purpose },
    })
  }

  /**
   * 放弃一张绑定挑战（用户选择「暂时跳过」）。
   *
   * 只对 `enroll` 挑战有效——`verify` 挑战不存在跳过一说，那会直接把 2FA 变成摆设。
   * 跳过会连同待确认凭据一起删掉，下次登录重新生成新密钥。
   */
  async skipEnrollmentChallenge(challengeToken: string, ctx: AuthContext = {}): Promise<User> {
    const { challenge, user } = await this.resolveActiveChallenge(challengeToken)
    if (challenge.purpose !== 'enroll') {
      throw new TwoFactorChallengeInvalidException('登录验证已失效，请重新登录')
    }

    const credential = await this.findCredential(user.id)
    if (credential?.isActive) {
      await challenge.delete()
      throw new TwoFactorChallengeInvalidException('登录验证已失效，请重新登录')
    }

    await db.transaction(async (trx) => {
      await UserTwoFactorCredential.query({ client: trx }).where('user_id', user.id).delete()
      await UserTwoFactorChallenge.query({ client: trx }).where('user_id', user.id).delete()
    })

    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_ENROLLMENT_SKIPPED,
      userId: user.id,
      entityType: 'user',
      entityId: user.id,
      requestId: ctx.requestId ?? null,
      metadata: { ip: ctx.ip ?? null },
    })

    return user
  }

  /**
   * 校验并消费第二因子：先试一次性口令，再试恢复码。
   *
   * 两条路径都带副作用（写 `lastUsedStep` / 标记恢复码已用），故命名为 consume——
   * 调用方拿到 `true` 时该因子已经被用掉，不可重复使用。
   */
  private async consumeSecondFactor(
    credential: UserTwoFactorCredential,
    code: string,
    ctx: AuthContext,
  ): Promise<{ verified: boolean; method: TwoFactorMethod | null }> {
    const step = this.verifyTotp(credential, code)
    if (step !== null) {
      credential.lastUsedStep = step
      credential.lastUsedAt = DateTime.utc()
      await credential.save()
      return { verified: true, method: 'totp' }
    }
    const usedRecovery = await this.consumeRecoveryCode(credential.userId, code, ctx)
    return { verified: usedRecovery, method: usedRecovery ? 'recovery_code' : null }
  }

  /** 校验一次性口令（对当前生效密钥），返回命中的时间步；不匹配返回 null。 */
  private verifyTotp(credential: UserTwoFactorCredential, code: string): number | null {
    return this.verifySecretCode(credential, credential.secretEncrypted, code, {
      lastUsedStep: credential.lastUsedStep,
    })
  }

  /**
   * 对**指定密文密钥**校验一次性口令。抽出来是因为「更换认证器」要验的是在途新密钥，
   * 而不是当前生效的那把。已消费的时间步一律拒绝（重放防护）。
   */
  private verifySecretCode(
    credential: UserTwoFactorCredential,
    encryptedSecret: string,
    code: string,
    options: { lastUsedStep: number | null },
  ): number | null {
    let secret: string
    try {
      secret = this.cipher.decrypt(encryptedSecret)
    } catch (error) {
      // 加密密钥变了 = 全站性故障：fail closed，绝不降级成「验证码不对」，
      // 否则运维会以为是用户输错，而真正的原因被静默吞掉。
      if (error instanceof TwoFactorSecretUnreadableError && error.reason === 'undecryptable') {
        throw new TwoFactorUnavailableException('两步验证暂时不可用，请联系管理员')
      }
      // 密文结构损坏：按验证失败处理；`resolveState` 会在下一次读取时清理这条记录。
      return null
    }
    return verifyTotpCode(secret, code, {
      digits: credential.digits,
      period: credential.period,
      algorithm: credential.algorithm as TotpAlgorithm,
      lastUsedStep: options.lastUsedStep,
    })
  }

  /** 消费一条未使用的恢复码；命中即标记 `used_at`。 */
  private async consumeRecoveryCode(
    userId: number,
    code: string,
    ctx: AuthContext,
  ): Promise<boolean> {
    const normalized = normalizeRecoveryCode(code)
    if (normalized.length === 0) return false

    const row = await UserTwoFactorRecoveryCode.query()
      .where('user_id', userId)
      .where('code_hash', hashRecoveryCode(normalized))
      .whereNull('used_at')
      .first()
    if (!row) return false

    row.usedAt = DateTime.utc()
    await row.save()

    const remaining = await this.countUnusedRecoveryCodes(userId)
    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_RECOVERY_CODE_USED,
      severity: 'warning',
      userId,
      requestId: ctx.requestId ?? null,
      metadata: { remaining },
    })
    return true
  }

  private hashChallengeToken(token: string): string {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
  }

  /**
   * 尝试校验第二因子前的节流闸（OWASP：strict attempt limits）。
   *
   * 与单张挑战票据的 `MAX_CHALLENGE_ATTEMPTS` 是两道独立的门：那道防「同一张票据反复试」，
   * 这道防「用密码不断换新票据继续试」。
   */
  private async assertNotThrottled(userId: number, ctx: AuthContext): Promise<void> {
    const ip = ctx.ip ?? 'unknown'
    if (!(await this.throttle.isThrottled(userId, ip))) return

    await this.audit.log({
      event: AuditEvent.TWO_FACTOR_THROTTLED,
      severity: 'warning',
      userId,
      requestId: ctx.requestId ?? null,
      metadata: { ip },
    })
    throw new TwoFactorThrottledException('两步验证尝试过于频繁，请 15 分钟后再试')
  }

  /** 记录一次尝试结果：成功清零计数，失败累加。 */
  private async noteAttempt(userId: number, ctx: AuthContext, succeeded: boolean): Promise<void> {
    const ip = ctx.ip ?? 'unknown'
    if (succeeded) {
      await this.throttle.clear(userId, ip)
      return
    }
    await this.throttle.recordFailure(userId, ip)
  }
}
