/**
 * v2-5-gitlab-readonly-oauth-connection —— GitLab 只读 OAuth 服务。
 *
 * 负责：
 * - 生成签名 state 的授权 URL（基于服务端配置的 base URL）
 * - state 校验（过期、provider/actor/org 绑定、防篡改）
 * - token exchange（通过 adapter 边界，默认 fixture）
 * - 低敏 token 加密/解密（复用 IntegrationTokenCipher）
 * - 短时 access token 刷新（复用 refresh token，Google 模式）
 * - 健康检查：调用 GitLab 低敏只读端点验证 token 有效性
 *
 * 设计 D1、D5：独立于 GithubOAuthService，所有外部调用通过 adapter，
 * 默认 fixture，真实调用需用户明确授权。
 */

import crypto from 'node:crypto'
import env from '#start/env'
import ApiException from '#exceptions/api_exception'
import IntegrationTokenCipher from './token_cipher.js'
import { validateGitlabBaseUrl, deriveGitlabEndpoint } from './provider_registry.js'
import type IntegrationConnection from '#models/integration_connection'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000
const DEFAULT_GITLAB_BASE_URL = 'https://gitlab.com'

// ---------------------------------------------------------------------------
// State payload types
// ---------------------------------------------------------------------------

export interface GitlabOAuthStatePayload {
  userId: number
  organizationId: number
  provider: 'gitlab'
  nonce: string
  expiresAt: number
  next?: string
}

// ---------------------------------------------------------------------------
// Token response types
// ---------------------------------------------------------------------------

export interface GitlabTokenResponse {
  access_token: string
  token_type?: string
  scope?: string
  refresh_token?: string
  expires_in?: number
  created_at?: number
  error?: string
  error_description?: string
}

export interface GitlabRefreshTokenResponse {
  access_token: string
  token_type?: string
  scope?: string
  refresh_token?: string
  expires_in?: number
  created_at?: number
  error?: string
  error_description?: string
}

export interface GitlabUserResponse {
  id: number
  username: string
  email: string
  name: string
  avatar_url: string
  web_url: string
  state: string
  last_sign_in_at?: string
  created_at?: string
  bio?: string
  location?: string
  public_email?: string
  skype?: string
  linkedin?: string
  twitter?: string
  website_url?: string
  organization?: string
  job_title?: string
  work_information?: string | null
  followers?: number
  following?: number
  is_admin?: boolean
  // 私有字段——健康检查不使用
  private_profile?: boolean
  // 写/提权相关字段——禁止存储或暴露
  can_create_group?: boolean
  can_create_project?: boolean
  extra_shared_runners_minutes_limit?: number | null
  extra_shared_runners_minutes_limit_used?: number | null
  namespaces?: Array<{
    id: number
    name: string
    path: string
    kind: string
    full_path: string
    parent_id?: number | null
  }>
}

/**
 * 低敏 GitLab 账户投影（用于 DTO/audit，不包含 token、private repos、admin 状态等敏感字段）。
 */
export interface GitlabAccountProjection {
  id: number
  username: string
  name: string
  email: string | null
  avatar_url: string
}

// ---------------------------------------------------------------------------
// Exception
// ---------------------------------------------------------------------------

export class GitlabOAuthException extends ApiException {
  constructor(
    code:
      | 'not_configured'
      | 'invalid_state'
      | 'token_exchange_failed'
      | 'gitlab_api_error'
      | 'insufficient_scope'
      | 'token_refresh_failed',
    message: string,
    details?: unknown,
    status = 400,
  ) {
    super(message, { code, status, details })
  }
}

// ---------------------------------------------------------------------------
// Token exchange adapter interface + fixture impl + production impl
// ---------------------------------------------------------------------------

export interface GitlabTokenExchangeAdapter {
  exchangeCode(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    tokenEndpoint: string,
  ): Promise<GitlabTokenResponse>
}

/**
 * Fixture adapter —— 默认测试使用，不发起真实网络请求。
 */
export class GitlabTokenExchangeFixtureAdapter implements GitlabTokenExchangeAdapter {
  async exchangeCode(
    _code: string,
    _clientId: string,
    _clientSecret: string,
    _redirectUri: string,
    _tokenEndpoint: string,
  ): Promise<GitlabTokenResponse> {
    const now = Math.floor(Date.now() / 1000)
    return {
      access_token: 'glpat_fixture_token_' + crypto.randomBytes(8).toString('hex'),
      token_type: 'Bearer',
      scope: 'read_user',
      refresh_token: 'glrt_fixture_refresh_' + crypto.randomBytes(8).toString('hex'),
      expires_in: 7200,
      created_at: now,
    }
  }
}

/**
 * Production adapter —— 发起真实 GitLab API 调用。
 * 仅在用户明确授权后使用。
 */
export class GitlabTokenExchangeProductionAdapter implements GitlabTokenExchangeAdapter {
  async exchangeCode(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    tokenEndpoint: string,
  ): Promise<GitlabTokenResponse> {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!response.ok) {
      throw new GitlabOAuthException('token_exchange_failed', 'GitLab OAuth token 交换失败', {
        status: response.status,
      })
    }
    const body = (await response.json()) as GitlabTokenResponse
    if (body.error) {
      throw new GitlabOAuthException(
        'token_exchange_failed',
        body.error_description ?? body.error ?? 'token 交换失败',
        { error: body.error, errorDescription: body.error_description },
      )
    }
    return body
  }
}

// ---------------------------------------------------------------------------
// Token refresh adapter interface + fixture impl + production impl
// ---------------------------------------------------------------------------

export interface GitlabTokenRefreshAdapter {
  refreshToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
    tokenEndpoint: string,
  ): Promise<GitlabRefreshTokenResponse>
}

/**
 * Fixture token refresh adapter —— 默认测试使用。
 */
export class GitlabTokenRefreshFixtureAdapter implements GitlabTokenRefreshAdapter {
  async refreshToken(
    _refreshToken: string,
    _clientId: string,
    _clientSecret: string,
    _tokenEndpoint: string,
  ): Promise<GitlabRefreshTokenResponse> {
    const now = Math.floor(Date.now() / 1000)
    return {
      access_token: 'glpat_fixture_refreshed_' + crypto.randomBytes(8).toString('hex'),
      token_type: 'Bearer',
      scope: 'read_user',
      refresh_token: 'glrt_fixture_refreshed_' + crypto.randomBytes(8).toString('hex'),
      expires_in: 7200,
      created_at: now,
    }
  }
}

/**
 * Production token refresh adapter —— 发起真实 GitLab API 调用。
 */
export class GitlabTokenRefreshProductionAdapter implements GitlabTokenRefreshAdapter {
  async refreshToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string,
    tokenEndpoint: string,
  ): Promise<GitlabRefreshTokenResponse> {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!response.ok) {
      throw new GitlabOAuthException('token_refresh_failed', 'GitLab token 刷新失败', {
        status: response.status,
      })
    }
    const body = (await response.json()) as GitlabRefreshTokenResponse
    if (body.error) {
      throw new GitlabOAuthException(
        'token_refresh_failed',
        body.error_description ?? body.error ?? 'token 刷新失败',
        { error: body.error, errorDescription: body.error_description },
      )
    }
    return body
  }
}

// ---------------------------------------------------------------------------
// GitLab API client interface + fixture impl + production impl
// ---------------------------------------------------------------------------

export interface GitlabApiClient {
  getUser(accessToken: string, apiEndpoint: string): Promise<GitlabUserResponse>
}

/**
 * Fixture API client —— 默认测试使用。
 */
export class GitlabApiFixtureClient implements GitlabApiClient {
  async getUser(_accessToken: string, _apiEndpoint: string): Promise<GitlabUserResponse> {
    return {
      id: 54321,
      username: 'fixture-gitlab-user',
      email: 'fixture@gitlab.com',
      name: 'Fixture GitLab User',
      avatar_url: 'https://gitlab.com/uploads/-/system/user/avatar/54321/avatar.png',
      web_url: 'https://gitlab.com/fixture-gitlab-user',
      state: 'active',
      last_sign_in_at: '2024-06-01T00:00:00.000Z',
      created_at: '2023-01-01T00:00:00.000Z',
      bio: 'Fixture user for testing',
      location: 'Shanghai',
      public_email: 'fixture@gitlab.com',
      organization: 'Fixture Org',
      job_title: 'Engineer',
      followers: 10,
      following: 5,
      is_admin: false,
      private_profile: false,
      can_create_group: false,
      can_create_project: false,
    }
  }
}

/**
 * Production API client —— 调真实 GitLab API（需用户授权）。
 */
export class GitlabApiProductionClient implements GitlabApiClient {
  async getUser(accessToken: string, apiEndpoint: string): Promise<GitlabUserResponse> {
    const response = await fetch(`${apiEndpoint}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'aiproj-gitlab-oauth',
      },
    })
    if (!response.ok) {
      if (response.status === 401) {
        throw new GitlabOAuthException(
          'gitlab_api_error',
          'GitLab token 无效或权限不足，请重新授权',
          { status: 401, reasonCode: 'token_invalid_or_expired' },
        )
      }
      if (response.status === 403) {
        throw new GitlabOAuthException(
          'gitlab_api_error',
          'GitLab API 权限不足或 rate limit 已达上限',
          { status: 403, reasonCode: 'rate_limit_or_insufficient_scope' },
        )
      }
      throw new GitlabOAuthException('gitlab_api_error', 'GitLab API 请求失败', {
        status: response.status,
      })
    }
    return (await response.json()) as GitlabUserResponse
  }
}

// ---------------------------------------------------------------------------
// GitLab OAuth Service
// ---------------------------------------------------------------------------

export default class GitlabOAuthService {
  constructor(
    private envOverrides: Record<string, string | undefined> = {},
    private tokenExchange: GitlabTokenExchangeAdapter = new GitlabTokenExchangeFixtureAdapter(),
    private tokenRefresh: GitlabTokenRefreshAdapter = new GitlabTokenRefreshFixtureAdapter(),
    private apiClient: GitlabApiClient = new GitlabApiFixtureClient(),
    private cipher = new IntegrationTokenCipher(),
  ) {}

  // -----------------------------------------------------------------------
  // Base URL helpers
  // -----------------------------------------------------------------------

  /**
   * 解析并校验 GitLab base URL。
   * 仅从服务端 env 或 envOverrides 获取，不接受用户/请求输入。
   */
  resolveBaseUrl(): { valid: true; url: string } | { valid: false; reason: string } {
    const envValue = this.resolveEnv('GITLAB_BASE_URL') ?? DEFAULT_GITLAB_BASE_URL
    const result = validateGitlabBaseUrl(envValue)
    if (!result.valid || !result.url) {
      return { valid: false, reason: result.reason ?? 'base_url_invalid' }
    }
    return { valid: true, url: result.url.origin }
  }

  /** 派生的授权端点 */
  get authEndpoint(): string {
    const base = this.resolveBaseUrl()
    if (!base.valid) return ''
    return deriveGitlabEndpoint(base.url, 'authorize')
  }

  /** 派生的 token 端点 */
  get tokenEndpoint(): string {
    const base = this.resolveBaseUrl()
    if (!base.valid) return ''
    return deriveGitlabEndpoint(base.url, 'token')
  }

  /** 派生的 API 端点 */
  get apiEndpoint(): string {
    const base = this.resolveBaseUrl()
    if (!base.valid) return ''
    return deriveGitlabEndpoint(base.url, 'api')
  }

  /** 当前实例主机 */
  get instanceHost(): string | null {
    const base = this.resolveBaseUrl()
    if (!base.valid) return null
    try {
      const url = new URL(base.url)
      return url.hostname
    } catch {
      return null
    }
  }

  // -----------------------------------------------------------------------
  // Config helpers
  // -----------------------------------------------------------------------

  missingKeys(): string[] {
    const keys = ['GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET', 'GITLAB_REDIRECT_URI']
    return keys.filter((key) => {
      const value = this.resolveEnv(key)
      return value === undefined || value.trim() === ''
    })
  }

  get configured(): boolean {
    return this.missingKeys().length === 0 && this.resolveBaseUrl().valid
  }

  clientId(): string {
    return this.resolveEnv('GITLAB_CLIENT_ID') ?? ''
  }

  clientSecret(): string {
    return this.resolveEnv('GITLAB_CLIENT_SECRET') ?? ''
  }

  redirectUri(): string {
    return this.resolveEnv('GITLAB_REDIRECT_URI') ?? ''
  }

  private resolveEnv(key: string): string | undefined {
    if (Object.prototype.hasOwnProperty.call(this.envOverrides, key)) {
      return this.envOverrides[key]
    }
    return env.get(key as never) as string | undefined
  }

  private assertConfigured(): void {
    const missing = this.missingKeys()
    const baseUrlResult = this.resolveBaseUrl()
    if (missing.length > 0 || !baseUrlResult.valid) {
      throw new GitlabOAuthException(
        'not_configured',
        'GitLab OAuth 尚未配置完整',
        {
          missingEnvKeys: missing,
          baseUrlError: !baseUrlResult.valid ? baseUrlResult.reason : undefined,
        },
        422,
      )
    }
  }

  // -----------------------------------------------------------------------
  // Scope helpers
  // -----------------------------------------------------------------------

  /** 首期最小只读 scope */
  static readonly DEFAULT_SCOPES = ['read_user']

  /** 检查 scope 是否包含写/提权权限 */
  static hasWriteScopes(scopes: string[]): boolean {
    const forbiddenScopes = [
      'api',
      'write_repository',
      'sudo',
      'admin_mode',
      'create_runner',
      'k8s_proxy',
      'write_registry',
      'write_',
    ]
    return scopes.some((s) =>
      forbiddenScopes.some((pattern) => s === pattern || s.startsWith(pattern)),
    )
  }

  // -----------------------------------------------------------------------
  // Authorization URL generation
  // -----------------------------------------------------------------------

  /**
   * 生成 GitLab OAuth 授权 URL，包含签名 state。
   */
  buildAuthorizationUrl(
    actor: { userId: number; organizationId: number },
    next?: string,
  ): { authorizationUrl: string; stateExpiresAt: string; state: string } {
    this.assertConfigured()
    const expiresAt = Date.now() + STATE_TTL_MS
    const state = this.signState({
      userId: actor.userId,
      organizationId: actor.organizationId,
      provider: 'gitlab',
      nonce: crypto.randomBytes(16).toString('hex'),
      expiresAt,
      next,
    })
    const url = new URL(this.authEndpoint)
    url.searchParams.set('client_id', this.clientId())
    url.searchParams.set('redirect_uri', this.redirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', GitlabOAuthService.DEFAULT_SCOPES.join(' '))
    url.searchParams.set('state', state)
    return {
      authorizationUrl: url.toString(),
      stateExpiresAt: new Date(expiresAt).toISOString(),
      state,
    }
  }

  // -----------------------------------------------------------------------
  // State signing & verification
  // -----------------------------------------------------------------------

  signState(payload: GitlabOAuthStatePayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const sig = crypto.createHmac('sha256', this.stateSecret()).update(encoded).digest('base64url')
    return `${encoded}.${sig}`
  }

  verifyState(state: string): GitlabOAuthStatePayload {
    const [encoded, sig] = state.split('.')
    if (!encoded || !sig) {
      throw new GitlabOAuthException('invalid_state', 'GitLab OAuth state 格式无效')
    }
    const expected = crypto
      .createHmac('sha256', this.stateSecret())
      .update(encoded)
      .digest('base64url')
    const actualBuffer = Buffer.from(sig)
    const expectedBuffer = Buffer.from(expected)
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new GitlabOAuthException('invalid_state', 'GitLab OAuth state 签名无效')
    }
    let payload: GitlabOAuthStatePayload
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    } catch {
      throw new GitlabOAuthException('invalid_state', 'GitLab OAuth state 内容无效')
    }
    if (payload.provider !== 'gitlab') {
      throw new GitlabOAuthException('invalid_state', 'GitLab OAuth state provider 无效')
    }
    if (Date.now() > payload.expiresAt) {
      throw new GitlabOAuthException('invalid_state', 'GitLab OAuth state 已过期')
    }
    return payload
  }

  // -----------------------------------------------------------------------
  // Token exchange
  // -----------------------------------------------------------------------

  async exchangeCode(code: string): Promise<GitlabTokenResponse> {
    this.assertConfigured()
    return this.tokenExchange.exchangeCode(
      code,
      this.clientId(),
      this.clientSecret(),
      this.redirectUri(),
      this.tokenEndpoint,
    )
  }

  // -----------------------------------------------------------------------
  // Token refresh
  // -----------------------------------------------------------------------

  /**
   * 使用加密存储的 refresh token 换取新 access token。
   * 刷新只读、幂等，不触发任何写请求。
   */
  async refreshAccessToken(
    connection: Pick<
      IntegrationConnection,
      'refreshTokenEncrypted' | 'accessTokenEncrypted' | 'expiresAt'
    > & { save?: () => Promise<unknown> },
  ): Promise<string> {
    if (!connection.refreshTokenEncrypted) {
      throw new GitlabOAuthException(
        'token_refresh_failed',
        'GitLab refresh token 缺失，需重新授权',
        { reasonCode: 'needs_reauth' },
      )
    }
    const refreshToken = this.cipher.decrypt(connection.refreshTokenEncrypted)
    const result = await this.tokenRefresh.refreshToken(
      refreshToken,
      this.clientId(),
      this.clientSecret(),
      this.tokenEndpoint,
    )
    // 重新加密存储新材料
    const newAccessToken = this.cipher.encrypt(result.access_token)
    const newRefreshToken = result.refresh_token
      ? this.cipher.encrypt(result.refresh_token)
      : connection.refreshTokenEncrypted
    // 更新 connection 对象（由调用方保存）
    Object.assign(connection, {
      accessTokenEncrypted: newAccessToken,
      refreshTokenEncrypted: newRefreshToken,
      expiresAt: result.expires_in
        ? new Date(Date.now() + result.expires_in * 1000).toISOString()
        : null,
    })
    if (connection.save) {
      await connection.save()
    }
    return result.access_token
  }

  // -----------------------------------------------------------------------
  // User info & health check
  // -----------------------------------------------------------------------

  /**
   * 获取 GitLab 用户信息并返回低敏投影。
   */
  async getUserProfile(accessToken: string): Promise<GitlabAccountProjection> {
    const user = await this.apiClient.getUser(accessToken, this.apiEndpoint)
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.public_email || user.email || null,
      avatar_url: user.avatar_url,
    }
  }

  /**
   * 健康检查：验证 token 有效并返回账户摘要。
   * 只调用低敏只读端点（/api/v4/user），不做任何 mutation。
   */
  async healthCheck(accessToken: string): Promise<{ username: string; id: number }> {
    const user = await this.apiClient.getUser(accessToken, this.apiEndpoint)
    return { username: user.username, id: user.id }
  }

  // -----------------------------------------------------------------------
  // Token encryption (delegates to IntegrationTokenCipher)
  // -----------------------------------------------------------------------

  encryptToken(token: string): string {
    return this.cipher.encrypt(token)
  }

  decryptToken(encrypted: string): string {
    return this.cipher.decrypt(encrypted)
  }

  // -----------------------------------------------------------------------
  // State secret
  // -----------------------------------------------------------------------

  private stateSecret(): string {
    return String(env.get('APP_KEY'))
  }
}
