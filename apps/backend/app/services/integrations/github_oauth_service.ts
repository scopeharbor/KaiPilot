/**
 * v2-5-github-readonly-oauth-connection —— GitHub 只读 OAuth 服务。
 *
 * 负责：
 * - 生成签名 state 的授权 URL
 * - state 校验（过期、provider/actor/org 绑定、防篡改）
 * - token exchange（通过 adapter 边界，默认 fixture）
 * - 低敏 token 加密/解密（复用 IntegrationTokenCipher）
 * - 健康检查：调用 GitHub 低敏只读端点验证 token 有效性
 *
 * 设计 D5: 所有外部调用通过 adapter 边界，默认 fixture，真实调用需用户明确授权。
 */

import crypto from 'node:crypto'
import env from '#start/env'
import ApiException from '#exceptions/api_exception'
import IntegrationTokenCipher from './token_cipher.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_ENDPOINT = 'https://github.com/login/oauth/authorize'
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token'
const USER_ENDPOINT = 'https://api.github.com/user'
const STATE_TTL_MS = 10 * 60 * 1000

// ---------------------------------------------------------------------------
// State payload types
// ---------------------------------------------------------------------------

export interface GithubOAuthStatePayload {
  userId: number
  organizationId: number
  provider: 'github'
  nonce: string
  expiresAt: number
  next?: string
}

// ---------------------------------------------------------------------------
// Token response types
// ---------------------------------------------------------------------------

export interface GithubTokenResponse {
  access_token: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
}

export interface GithubUserResponse {
  login: string
  id: number
  node_id: string
  avatar_url: string
  gravatar_id: string | null
  url: string
  html_url: string
  followers_url: string
  following_url: string
  gists_url: string
  starred_url: string
  subscriptions_url: string
  organizations_url: string
  repos_url: string
  events_url: string
  received_events_url: string
  type: string
  site_admin: boolean
  name: string | null
  company: string | null
  blog: string | null
  location: string | null
  email: string | null
  hireable: boolean | null
  bio: string | null
  twitter_username: string | null
  public_repos: number
  public_gists: number
  followers: number
  following: number
  created_at: string
  updated_at: string
  private_gists?: number
  total_private_repos?: number
  owned_private_repos?: number
  disk_usage?: number
  collaborators?: number
  plan?: { name: string; space: number; private_repos: number; collaborators: number }
}

/**
 * 低敏 GitHub 账户投影（用于 DTO/audit，不包含 token、private repos 等敏感字段）。
 */
export interface GithubAccountProjection {
  login: string
  id: number
  name: string | null
  email: string | null
  avatar_url: string
}

// ---------------------------------------------------------------------------
// Exception
// ---------------------------------------------------------------------------

export class GithubOAuthException extends ApiException {
  constructor(
    code:
      | 'not_configured'
      | 'invalid_state'
      | 'token_exchange_failed'
      | 'github_api_error'
      | 'insufficient_scope',
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

export interface GithubTokenExchangeAdapter {
  exchangeCode(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<GithubTokenResponse>
}

/**
 * Fixture adapter —— 默认测试使用，不发起真实网络请求。
 */
export class GithubTokenExchangeFixtureAdapter implements GithubTokenExchangeAdapter {
  async exchangeCode(
    _code: string,
    _clientId: string,
    _clientSecret: string,
    _redirectUri: string,
  ): Promise<GithubTokenResponse> {
    return {
      access_token: 'gho_fixture_token_' + crypto.randomBytes(8).toString('hex'),
      token_type: 'Bearer',
      scope: 'read:user,user:email',
    }
  }
}

/**
 * Production adapter —— 发起真实 GitHub API 调用。
 * 仅在用户明确授权后使用。
 */
export class GithubTokenExchangeProductionAdapter implements GithubTokenExchangeAdapter {
  async exchangeCode(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<GithubTokenResponse> {
    const response = await fetch(TOKEN_ENDPOINT, {
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
      }),
    })
    if (!response.ok) {
      throw new GithubOAuthException('token_exchange_failed', 'GitHub OAuth token 交换失败', {
        status: response.status,
      })
    }
    const body = (await response.json()) as GithubTokenResponse
    if (body.error) {
      throw new GithubOAuthException(
        'token_exchange_failed',
        body.error_description ?? body.error ?? 'token 交换失败',
        { error: body.error, errorDescription: body.error_description },
      )
    }
    return body
  }
}

// ---------------------------------------------------------------------------
// GitHub API client interface + fixture impl + production impl
// ---------------------------------------------------------------------------

export interface GithubApiClient {
  getUser(accessToken: string): Promise<GithubUserResponse>
  checkToken(accessToken: string): Promise<{ scopes: string[] }>
}

/**
 * Fixture API client —— 默认测试使用。
 */
export class GithubApiFixtureClient implements GithubApiClient {
  async getUser(_accessToken: string): Promise<GithubUserResponse> {
    return {
      login: 'fixture-user',
      id: 12345,
      node_id: 'MDQ6VXNlcjEyMzQ1',
      avatar_url: 'https://avatars.githubusercontent.com/u/12345?v=4',
      gravatar_id: null,
      url: 'https://api.github.com/users/fixture-user',
      html_url: 'https://github.com/fixture-user',
      followers_url: 'https://api.github.com/users/fixture-user/followers',
      following_url: 'https://api.github.com/users/fixture-user/following{/other_user}',
      gists_url: 'https://api.github.com/users/fixture-user/gists{/gist_id}',
      starred_url: 'https://api.github.com/users/fixture-user/starred{/owner}{/repo}',
      subscriptions_url: 'https://api.github.com/users/fixture-user/subscriptions',
      organizations_url: 'https://api.github.com/users/fixture-user/orgs',
      repos_url: 'https://api.github.com/users/fixture-user/repos',
      events_url: 'https://api.github.com/users/fixture-user/events{/privacy}',
      received_events_url: 'https://api.github.com/users/fixture-user/received_events',
      type: 'User',
      site_admin: false,
      name: 'Fixture User',
      company: null,
      blog: null,
      location: null,
      email: 'fixture@example.com',
      hireable: null,
      bio: null,
      twitter_username: null,
      public_repos: 10,
      public_gists: 2,
      followers: 5,
      following: 3,
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    }
  }

  async checkToken(accessToken: string): Promise<{ scopes: string[] }> {
    const token = accessToken
    // 用 token 前缀区分测试场景
    if (token.startsWith('gho_invalid_') || token.startsWith('gho_expired_')) {
      throw new GithubOAuthException('github_api_error', 'GitHub token 无效或已过期', {
        status: 401,
      })
    }
    return { scopes: ['read:user', 'user:email'] }
  }
}

/**
 * Production API client —— 调真实 GitHub API（需用户授权）。
 */
export class GithubApiProductionClient implements GithubApiClient {
  async getUser(accessToken: string): Promise<GithubUserResponse> {
    const response = await fetch(USER_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'aiproj-github-oauth',
      },
    })
    if (!response.ok) {
      throw new GithubOAuthException('github_api_error', '读取 GitHub 用户信息失败', {
        status: response.status,
      })
    }
    return (await response.json()) as GithubUserResponse
  }

  async checkToken(accessToken: string): Promise<{ scopes: string[] }> {
    const response = await fetch(USER_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'aiproj-github-oauth',
      },
    })
    if (!response.ok) {
      if (response.status === 401) {
        throw new GithubOAuthException(
          'github_api_error',
          'GitHub token 无效或权限不足，请重新授权',
          { status: 401, reasonCode: 'token_invalid_or_expired' },
        )
      }
      if (response.status === 403) {
        throw new GithubOAuthException('github_api_error', 'GitHub API rate limit 已达上限', {
          status: 403,
          reasonCode: 'rate_limit_exceeded',
        })
      }
      throw new GithubOAuthException('github_api_error', 'GitHub API 请求失败', {
        status: response.status,
      })
    }
    // 从响应头获取 scope
    const scopes = (response.headers.get('X-OAuth-Scopes') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return { scopes }
  }
}

// ---------------------------------------------------------------------------
// GitHub OAuth Service
// ---------------------------------------------------------------------------

export default class GithubOAuthService {
  constructor(
    private envOverrides: Record<string, string | undefined> = {},
    private tokenExchange: GithubTokenExchangeAdapter = new GithubTokenExchangeFixtureAdapter(),
    private apiClient: GithubApiClient = new GithubApiFixtureClient(),
    private cipher = new IntegrationTokenCipher(),
  ) {}

  // -----------------------------------------------------------------------
  // Config helpers
  // -----------------------------------------------------------------------

  missingKeys(): string[] {
    const keys = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI']
    return keys.filter((key) => {
      const value = this.resolveEnv(key)
      return value === undefined || value.trim() === ''
    })
  }

  get configured(): boolean {
    return this.missingKeys().length === 0
  }

  clientId(): string {
    return this.resolveEnv('GITHUB_CLIENT_ID') ?? ''
  }

  clientSecret(): string {
    return this.resolveEnv('GITHUB_CLIENT_SECRET') ?? ''
  }

  redirectUri(): string {
    return this.resolveEnv('GITHUB_REDIRECT_URI') ?? ''
  }

  private resolveEnv(key: string): string | undefined {
    if (Object.prototype.hasOwnProperty.call(this.envOverrides, key)) {
      return this.envOverrides[key]
    }
    return env.get(key as never) as string | undefined
  }

  private assertConfigured(): void {
    const missing = this.missingKeys()
    if (missing.length > 0) {
      throw new GithubOAuthException(
        'not_configured',
        'GitHub OAuth 尚未配置完整',
        { missingEnvKeys: missing },
        422,
      )
    }
  }

  // -----------------------------------------------------------------------
  // Scope helpers
  // -----------------------------------------------------------------------

  /** 首期最小只读 scope */
  static readonly DEFAULT_SCOPES = ['read:user', 'user:email']

  /** 检查 scope 是否包含写权限 */
  static hasWriteScopes(scopes: string[]): boolean {
    const writePatterns = [
      'repo',
      'admin:',
      'delete_',
      'workflow',
      'write:',
      'manage_',
      'packages:',
    ]
    return scopes.some((s) => writePatterns.some((pattern) => s.startsWith(pattern)))
  }

  // -----------------------------------------------------------------------
  // Authorization URL generation
  // -----------------------------------------------------------------------

  /**
   * 生成 GitHub OAuth 授权 URL，包含签名 state。
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
      provider: 'github',
      nonce: crypto.randomBytes(16).toString('hex'),
      expiresAt,
      next,
    })
    const url = new URL(AUTH_ENDPOINT)
    url.searchParams.set('client_id', this.clientId())
    url.searchParams.set('redirect_uri', this.redirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', GithubOAuthService.DEFAULT_SCOPES.join(' '))
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

  signState(payload: GithubOAuthStatePayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const sig = crypto.createHmac('sha256', this.stateSecret()).update(encoded).digest('base64url')
    return `${encoded}.${sig}`
  }

  verifyState(state: string): GithubOAuthStatePayload {
    const [encoded, sig] = state.split('.')
    if (!encoded || !sig) {
      throw new GithubOAuthException('invalid_state', 'GitHub OAuth state 格式无效')
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
      throw new GithubOAuthException('invalid_state', 'GitHub OAuth state 签名无效')
    }
    let payload: GithubOAuthStatePayload
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    } catch {
      throw new GithubOAuthException('invalid_state', 'GitHub OAuth state 内容无效')
    }
    if (payload.provider !== 'github') {
      throw new GithubOAuthException('invalid_state', 'GitHub OAuth state provider 无效')
    }
    if (Date.now() > payload.expiresAt) {
      throw new GithubOAuthException('invalid_state', 'GitHub OAuth state 已过期')
    }
    return payload
  }

  // -----------------------------------------------------------------------
  // Token exchange
  // -----------------------------------------------------------------------

  async exchangeCode(code: string): Promise<GithubTokenResponse> {
    this.assertConfigured()
    return this.tokenExchange.exchangeCode(
      code,
      this.clientId(),
      this.clientSecret(),
      this.redirectUri(),
    )
  }

  // -----------------------------------------------------------------------
  // User info & health check
  // -----------------------------------------------------------------------

  /**
   * 获取 GitHub 用户信息并返回低敏投影。
   */
  async getUserProfile(accessToken: string): Promise<GithubAccountProjection> {
    const user = await this.apiClient.getUser(accessToken)
    return {
      login: user.login,
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
    }
  }

  /**
   * 健康检查：验证 token 有效并返回 scope 摘要。
   * 只调用低敏只读端点，不做任何 mutation。
   */
  async healthCheck(accessToken: string): Promise<{ scopes: string[]; login: string }> {
    const user = await this.apiClient.getUser(accessToken)
    const scopes = await this.apiClient.checkToken(accessToken).then((r) => r.scopes)
    return { scopes, login: user.login }
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
