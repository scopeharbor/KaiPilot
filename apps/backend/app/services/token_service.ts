import { DateTime } from 'luxon'
import User from '#models/user'
import env from '#start/env'
import { AccountInactiveException, AuthRequiredException } from '#exceptions/api_exception'
import { AccessToken, type DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import { RuntimeException } from '@adonisjs/core/exceptions'
import { Secret } from '@adonisjs/core/helpers'
import db from '@adonisjs/lucid/services/db'
import { type JWTPayload, SignJWT, jwtVerify } from 'jose'
import type { JwtAccessPayload, JwtRefreshToken } from '#types/auth'

/**
 * TokenService 负责 JWT access token 与可撤销 refresh token 的全生命周期。
 *
 * 策略（design D1/D7）：
 * - access token：自包含 JWT（HS256），claims 含 sub / organizationId / roleVersion / exp。
 *   前端可解析权限声明用于展示层，服务端仅校验签名与有效期；即时失效依赖 auth_middleware
 *   每请求核对 roleVersion + isActive（D9）。
 * - refresh token：不透明、DB 存储、单次使用轮换；复用既有 auth_access_tokens 表，
 *   type='refresh'，abilities='[]'。`lastUsedAt` 支撑空闲 2h 失效（D7）。
 */
export default class TokenService {
  /**
   * 刷新 token 的 type 标记（复用 auth_access_tokens 表）
   */
  static readonly REFRESH_TOKEN_TYPE = 'refresh'

  /**
   * refresh token 允许的最大空闲时长（SEC-04：2h）
   */
  static readonly REFRESH_IDLE_TTL_MINUTES = 120

  /**
   * access token TTL（默认 15m）
   */
  private readonly accessTtlSeconds: number

  /**
   * refresh token 绝对有效期（默认 8h）
   */
  private readonly refreshTtlSeconds: number

  /**
   * HS256 签名密钥（Uint8Array）
   */
  private readonly secret: Uint8Array

  constructor() {
    const secret = env.get('JWT_ACCESS_SECRET')
    if (!secret) {
      throw new RuntimeException('JWT_ACCESS_SECRET is not configured')
    }
    this.secret = Buffer.from(secret)
    this.accessTtlSeconds = this.parseDuration(env.get('JWT_ACCESS_TTL') ?? '15m')
    this.refreshTtlSeconds = this.parseDuration(env.get('JWT_REFRESH_TTL') ?? '8h')
  }

  /**
   * 签发 access JWT。
   */
  async generateAccessToken(payload: JwtAccessPayload): Promise<string> {
    // 注意：jose 的 setExpirationTime 传「数字」时按**绝对 NumericDate（epoch 秒）**处理，
    // 而非相对时长。故显式换算为 now + ttl；直接传 accessTtlSeconds 会得到 1970 年的 exp，
    // 令 token 一签发即过期。
    const nowSeconds = Math.floor(Date.now() / 1000)
    return new SignJWT({
      sub: String(payload.sub),
      organizationId: payload.organizationId,
      planTier: payload.planTier ?? null,
      roleVersion: payload.roleVersion,
      permissions: payload.permissions ?? [],
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + this.accessTtlSeconds)
      .sign(this.secret)
  }

  /**
   * 校验 access JWT，返回 payload。
   */
  async verifyAccessToken(token: string): Promise<JwtAccessPayload & JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
      })
      return {
        sub: Number(payload.sub),
        organizationId: payload.organizationId as number | null,
        planTier: (payload.planTier as string | null | undefined) ?? null,
        roleVersion: payload.roleVersion as number,
        permissions: payload.permissions as string[],
        ...payload,
      } as JwtAccessPayload & JWTPayload
    } catch {
      throw new AuthRequiredException('访问令牌无效或已过期')
    }
  }

  /**
   * 签发 refresh token（不透明、DB 存储）。
   * 返回 { token: 原始值（仅返回一次）, dbToken: 数据库记录对象 }。
   */
  async generateRefreshToken(user: User): Promise<{ token: string; dbToken: JwtRefreshToken }> {
    const dbToken = (await User.accessTokens.create(user, [], {
      name: TokenService.REFRESH_TOKEN_TYPE,
      expiresIn: `${this.refreshTtlSeconds}s`,
    })) as unknown as JwtRefreshToken

    return { token: dbToken.value!.release(), dbToken }
  }

  /**
   * 验证 refresh token 并返回对应用户 + token 记录。
   * 校验内容：存在性、是否过期、是否已被撤销（lastUsedAt 提前于 createdAt 即视为轮换作废）、
   * 空闲是否超过 2h（D7）。
   */
  async verifyRefreshToken(tokenValue: string): Promise<{ user: User; dbToken: JwtRefreshToken }> {
    const accessTokens = User.accessTokens as unknown as DbAccessTokensProvider<typeof User>

    // 空闲超时（SEC-04）判定须在 provider.verify 之前取「上一次」last_used_at——
    // 因为 verify 每次都会把 last_used_at 重置为 now，事后读到的永远是当前时间。
    const previousUsedAt = await this.readPreviousUsedAt(tokenValue)

    const dbToken = (await accessTokens.verify(
      new Secret(tokenValue),
    )) as unknown as JwtRefreshToken | null

    // verify 对无效/绝对过期（isExpired）的 token 返回 null
    if (!dbToken) {
      throw new AuthRequiredException('刷新令牌无效或已过期')
    }

    const user = await User.find(dbToken.tokenableId)
    if (!user) {
      throw new AuthRequiredException('刷新令牌无效')
    }

    if (!user.isActive) {
      throw new AccountInactiveException('账户已被禁用')
    }

    // 冗余绝对过期校验（provider 已处理，双保险）
    if (dbToken.expiresAt && dbToken.expiresAt < new Date()) {
      throw new AuthRequiredException('刷新令牌已过期')
    }

    // 空闲超时：以 verify 之前的 last_used_at（或 createdAt）为基准
    const idleDeadline = DateTime.now().minus({ minutes: TokenService.REFRESH_IDLE_TTL_MINUTES })
    const reference = previousUsedAt ?? dbToken.createdAt
    if (DateTime.fromJSDate(reference) < idleDeadline) {
      throw new AuthRequiredException('刷新令牌空闲超时')
    }

    return { user, dbToken }
  }

  /**
   * 读取本次校验之前该 refresh token 的 last_used_at（用于空闲超时判定）。
   * provider.verify 会把 last_used_at 重置为 now，故须在其之前直接查库。
   */
  private async readPreviousUsedAt(tokenValue: string): Promise<Date | null> {
    const decoded = AccessToken.decode('oat_', tokenValue)
    if (!decoded) return null

    const row = await db
      .from('auth_access_tokens')
      .where('id', decoded.identifier as unknown as number)
      .first()
    if (!row) return null

    const raw = row.last_used_at ?? row.created_at
    if (raw === null || raw === undefined) return null
    return raw instanceof Date ? raw : new Date(raw)
  }

  /**
   * 单次轮换：使旧 refresh token 失效，发放新的 refresh token。
   */
  async rotateRefreshToken(
    user: User,
    oldToken: JwtRefreshToken,
  ): Promise<{ token: string; dbToken: JwtRefreshToken }> {
    await this.revokeRefreshToken(user, oldToken.identifier)
    return this.generateRefreshToken(user)
  }

  /**
   * 撤销指定 refresh token。
   */
  async revokeRefreshToken(user: User, identifier: string | number | bigint): Promise<void> {
    await User.accessTokens.delete(user, identifier as string | number)
  }

  /**
   * 将人类可读的 TTL 字符串解析为秒数。
   * 支持格式：数字（视为秒）、数字+m/h/d（例如 15m / 8h / 7d）。
   */
  private parseDuration(value: string): number {
    const trimmed = String(value).trim()
    const match = trimmed.match(/^(\d+)\s*([smhd]?)$/i)
    if (!match) {
      throw new RuntimeException(`Invalid JWT TTL format: ${value}`)
    }

    const amount = Number.parseInt(match[1]!, 10)
    const unit = match[2]!.toLowerCase()
    switch (unit) {
      case 's':
        return amount
      case 'm':
        return amount * 60
      case 'h':
        return amount * 60 * 60
      case 'd':
        return amount * 24 * 60 * 60
      default:
        return amount
    }
  }
}
