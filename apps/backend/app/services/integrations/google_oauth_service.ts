import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import env from '#start/env'
import ApiException from '#exceptions/api_exception'
import IntegrationTokenCipher from './token_cipher.js'
import type IntegrationConnection from '#models/integration_connection'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'
const CALENDAR_LIST_ENDPOINT = 'https://www.googleapis.com/calendar/v3/users/me/calendarList'
const STATE_TTL_MS = 10 * 60 * 1000
const GOOGLE_REQUEST_TIMEOUT_MS = 10 * 1000
const APP_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

type GoogleFlow = 'login' | 'calendar'
type GoogleRequestFailureCode = 'token_exchange_failed' | 'google_api_error'
type GoogleRequestEndpoint = 'token' | 'userinfo' | 'calendar'

export interface GoogleOAuthState {
  flow: GoogleFlow
  nonce: string
  expiresAt: number
  next?: string
  userId?: number
  organizationId?: number
}

export interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  id_token?: string
}

export interface GoogleUserInfo {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
}

export interface GoogleCalendarListResult {
  calendarCount: number
  primaryCalendarSummary: string | null
}

interface GoogleClientSecretFile {
  web?: GoogleClientSecretPayload
  installed?: GoogleClientSecretPayload
}

interface GoogleClientSecretPayload {
  client_id?: string
  client_secret?: string
  redirect_uris?: string[]
}

export interface GoogleLoginPreflight {
  status:
    | 'configured'
    | 'disabled'
    | 'missing_file'
    | 'unreadable_file'
    | 'invalid_json'
    | 'invalid_client_shape'
    | 'redirect_not_configured'
  configured: boolean
  /** 只含键名（如 GOOGLE_OAUTH_CLIENT_ID），不含任何值/路径/片段 */
  missingEnvKeys: string[]
}

export class GoogleOAuthException extends ApiException {
  constructor(
    code:
      | 'not_configured'
      | 'invalid_state'
      | 'token_exchange_failed'
      | 'google_api_error'
      | 'missing_refresh_token',
    message: string,
    details?: unknown,
    status = 400,
  ) {
    super(message, { code, status, details })
  }
}

export default class GoogleOAuthService {
  private clientJsonCache = new Map<string, GoogleClientSecretPayload | null>()

  constructor(
    private envOverrides: Record<string, string | undefined> = {},
    private fetchImpl: typeof fetch = fetch,
    private cipher = new IntegrationTokenCipher(),
    private requestTimeoutMs = GOOGLE_REQUEST_TIMEOUT_MS,
  ) {}

  loginConfigured() {
    return this.missingKeys('login').length === 0
  }

  /**
   * 登录流无秘密 preflight（design D，v3-docker-google-oauth-runtime-wiring）。
   *
   * 只返回状态码 + 缺失的 env **键名**，供部署人员/登录页诊断；绝不返回：
   * 文件路径（含用户目录）、client id 全值、client secret、private key、
   * token 或 JSON 片段。状态码闭集：
   *   configured              —— id/secret/redirect 全部可解析
   *   disabled                —— 未配置任何 env/JSON 路径
   *   missing_file            —— 配置了 JSON 路径但文件不存在
   *   unreadable_file         —— 文件存在但不可读（权限/类型等）
   *   invalid_json            —— 文件不是合法 JSON
   *   invalid_client_shape    —— JSON 缺 web/installed 段或 client_id/client_secret
   *   redirect_not_configured —— 剩余缺失只能落在回调地址未配置
   *
   * 解析语义与运行时完全一致（env 优先 → JSON 兜底，GOOGLE_OAUTH_* →
   * GOOGLE_CALENDAR_* fallback），唯一差异：envOverrides 显式传入空串视为
   * 「显式未设置」，让容器/测试可以割断进程环境回退（运行时不传空串，行为不变）。
   */
  loginPreflight(): GoogleLoginPreflight {
    const jsonPath =
      this.preflightValue('GOOGLE_OAUTH_CLIENT_JSON_PATH') ||
      this.preflightValue('GOOGLE_CLIENT_SECRET_JSON_PATH')

    // 先探测文件（env 未配置完整时才需要 JSON 兜底）
    let payload: GoogleClientSecretPayload | null = null
    let fileStatus:
      'missing_file' | 'unreadable_file' | 'invalid_json' | 'invalid_client_shape' | null = null
    if (jsonPath) {
      const resolved = this.resolveJsonPath(jsonPath)
      if (!existsSync(resolved)) {
        fileStatus = 'missing_file'
      } else {
        let raw: string
        try {
          raw = readFileSync(resolved, 'utf8')
        } catch {
          fileStatus = 'unreadable_file'
        }
        if (fileStatus === null) {
          try {
            const parsed = JSON.parse(raw!) as GoogleClientSecretFile
            payload = parsed.web ?? parsed.installed ?? null
            if (!payload || !payload.client_id || !payload.client_secret) {
              fileStatus = 'invalid_client_shape'
              payload = null
            }
          } catch {
            fileStatus = 'invalid_json'
          }
        }
      }
    }

    // 解析后的最终值（env 优先 → JSON 兜底；与运行时 clientId()/clientSecret()/redirectUri() 一致）
    const envId = this.preflightValue('GOOGLE_OAUTH_CLIENT_ID')
    const envSecret = this.preflightValue('GOOGLE_OAUTH_CLIENT_SECRET')
    const envRedirect = this.preflightValue('GOOGLE_OAUTH_REDIRECT_URI')
    const id = envId || payload?.client_id || ''
    const secret = envSecret || payload?.client_secret || ''
    const redirect = envRedirect || (payload ? this.redirectUriFromPayload(payload, 'login') : '')

    const missingEnvKeys = (
      [
        [!id, 'GOOGLE_OAUTH_CLIENT_ID'],
        [!secret, 'GOOGLE_OAUTH_CLIENT_SECRET'],
        [!redirect, 'GOOGLE_OAUTH_REDIRECT_URI'],
      ] as const
    )
      .filter(([missing]) => missing)
      .map(([, key]) => key)

    if (id && secret && redirect) {
      return { status: 'configured', configured: true, missingEnvKeys: [] }
    }
    if (!jsonPath) {
      return { status: 'disabled', configured: false, missingEnvKeys }
    }
    if (fileStatus) {
      return { status: fileStatus, configured: false, missingEnvKeys }
    }
    // 文件结构正常但仍有缺项：id/secret 已由 JSON 提供时，剩余只可能是回调地址
    return { status: 'redirect_not_configured', configured: false, missingEnvKeys }
  }

  /**
   * preflight 专用取值（语义与 `value(key, 'login')` 一致，含 calendar fallback）；
   * 差异：envOverrides 显式空串 = 显式未设置，不回退进程环境。
   */
  private preflightValue(key: string): string {
    const override = this.envOverrides[key]
    if (override !== undefined) return override
    const direct = env.get(key as never) as string | undefined
    if (direct) return direct
    const fallbackKey = key.replace('GOOGLE_OAUTH_', 'GOOGLE_CALENDAR_')
    const fallbackOverride = this.envOverrides[fallbackKey]
    if (fallbackOverride !== undefined) return fallbackOverride
    return (env.get(fallbackKey as never) as string | undefined) ?? ''
  }

  calendarConfigured() {
    return this.missingKeys('calendar').length === 0
  }

  missingKeys(flow: GoogleFlow): string[] {
    const keys =
      flow === 'login'
        ? ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI']
        : [
            'GOOGLE_CALENDAR_CLIENT_ID',
            'GOOGLE_CALENDAR_CLIENT_SECRET',
            'GOOGLE_CALENDAR_REDIRECT_URI',
          ]
    const values = [this.clientId(flow), this.clientSecret(flow), this.redirectUri(flow)]
    return keys.filter((_, index) => !values[index])
  }

  loginAuthorizationUrl(next = '/'): { authorizationUrl: string; expiresAt: string } {
    this.assertConfigured('login')
    const expiresAt = Date.now() + STATE_TTL_MS
    const state = this.signState({
      flow: 'login',
      nonce: crypto.randomBytes(16).toString('hex'),
      expiresAt,
      next: this.safeNext(next),
    })
    return {
      authorizationUrl: this.buildAuthorizationUrl('login', state, ['openid', 'email', 'profile']),
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  calendarAuthorizationUrl(actor: { userId: number; organizationId: number }) {
    this.assertConfigured('calendar')
    const expiresAt = Date.now() + STATE_TTL_MS
    const state = this.signState({
      flow: 'calendar',
      nonce: crypto.randomBytes(16).toString('hex'),
      expiresAt,
      userId: actor.userId,
      organizationId: actor.organizationId,
    })
    return {
      authorizationUrl: this.buildAuthorizationUrl('calendar', state, [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
      ]),
      expiresAt: new Date(expiresAt).toISOString(),
      stateExpiresAt: new Date(expiresAt).toISOString(),
    }
  }

  async exchangeCode(flow: GoogleFlow, code: string): Promise<GoogleTokenResponse> {
    this.assertConfigured(flow)
    const response = await this.googleRequest(
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.clientId(flow),
          client_secret: this.clientSecret(flow),
          redirect_uri: this.redirectUri(flow),
          grant_type: 'authorization_code',
        }),
      },
      'token_exchange_failed',
      'token',
      'Google OAuth token 交换失败',
    )
    if (!response.ok) {
      throw new GoogleOAuthException('token_exchange_failed', 'Google OAuth token 交换失败', {
        status: response.status,
      })
    }
    return (await response.json()) as GoogleTokenResponse
  }

  async refreshAccessToken(connection: IntegrationConnection): Promise<string> {
    if (!connection.refreshTokenEncrypted) {
      throw new GoogleOAuthException('missing_refresh_token', 'Google refresh token 缺失', {
        provider: connection.provider,
      })
    }
    const refreshToken = this.cipher.decrypt(connection.refreshTokenEncrypted)
    const response = await this.googleRequest(
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: this.clientId('calendar'),
          client_secret: this.clientSecret('calendar'),
          grant_type: 'refresh_token',
        }),
      },
      'token_exchange_failed',
      'token',
      'Google OAuth refresh 失败',
    )
    if (!response.ok) {
      throw new GoogleOAuthException('token_exchange_failed', 'Google OAuth refresh 失败', {
        status: response.status,
      })
    }
    const token = (await response.json()) as GoogleTokenResponse
    connection.accessTokenEncrypted = this.cipher.encrypt(token.access_token)
    connection.tokenType = token.token_type ?? connection.tokenType
    if (token.expires_in) {
      const { DateTime } = await import('luxon')
      connection.expiresAt = DateTime.utc().plus({ seconds: token.expires_in })
    }
    await connection.save()
    return token.access_token
  }

  async userInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await this.googleRequest(
      USERINFO_ENDPOINT,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      'google_api_error',
      'userinfo',
      '读取 Google 用户信息失败',
    )
    if (!response.ok) {
      throw new GoogleOAuthException('google_api_error', '读取 Google 用户信息失败', {
        status: response.status,
      })
    }
    return (await response.json()) as GoogleUserInfo
  }

  async calendarList(accessToken: string): Promise<GoogleCalendarListResult> {
    const url = new URL(CALENDAR_LIST_ENDPOINT)
    url.searchParams.set('maxResults', '10')
    const response = await this.googleRequest(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      'google_api_error',
      'calendar',
      '读取 Google Calendar 列表失败',
    )
    if (!response.ok) {
      throw new GoogleOAuthException('google_api_error', '读取 Google Calendar 列表失败', {
        status: response.status,
      })
    }
    const body = (await response.json()) as {
      items?: Array<{ summary?: string; primary?: boolean }>
    }
    const items = body.items ?? []
    const primary = items.find((item) => item.primary) ?? items[0]
    return {
      calendarCount: items.length,
      primaryCalendarSummary: primary?.summary ?? null,
    }
  }

  signState(payload: GoogleOAuthState): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const sig = crypto.createHmac('sha256', this.stateSecret()).update(encoded).digest('base64url')
    return `${encoded}.${sig}`
  }

  verifyState(state: string, flow: GoogleFlow): GoogleOAuthState {
    const [encoded, sig] = state.split('.')
    if (!encoded || !sig)
      throw new GoogleOAuthException('invalid_state', 'Google OAuth state 格式无效')
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
      throw new GoogleOAuthException('invalid_state', 'Google OAuth state 签名无效')
    }
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as GoogleOAuthState
    if (payload.flow !== flow || Date.now() > payload.expiresAt) {
      throw new GoogleOAuthException('invalid_state', 'Google OAuth state 已失效')
    }
    return payload
  }

  encryptToken(token: string) {
    return this.cipher.encrypt(token)
  }

  decryptToken(token: string) {
    return this.cipher.decrypt(token)
  }

  private buildAuthorizationUrl(flow: GoogleFlow, state: string, scopes: string[]): string {
    const url = new URL(AUTH_ENDPOINT)
    url.searchParams.set('client_id', this.clientId(flow))
    url.searchParams.set('redirect_uri', this.redirectUri(flow))
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', scopes.join(' '))
    url.searchParams.set('state', state)
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    return url.toString()
  }

  /**
   * Google 外部请求必须在 edge 超时前结束，并只暴露闭集错误分类。
   * Promise.race 同时覆盖不响应 AbortSignal 的测试替身或异常 fetch 实现。
   */
  private async googleRequest(
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
    failureCode: GoogleRequestFailureCode,
    endpoint: GoogleRequestEndpoint,
    failureMessage: string,
  ): Promise<Response> {
    const controller = new AbortController()
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => {
          controller.abort()
          reject(
            new GoogleOAuthException(
              failureCode,
              failureMessage,
              { reason: 'timeout', endpoint },
              504,
            ),
          )
        },
        Math.max(1, this.requestTimeoutMs),
      )
    })

    try {
      return await Promise.race([
        this.fetchImpl(input, { ...init, signal: controller.signal }),
        timeout,
      ])
    } catch (error) {
      if (error instanceof GoogleOAuthException) throw error
      throw new GoogleOAuthException(
        failureCode,
        failureMessage,
        { reason: 'network_error', endpoint },
        502,
      )
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  private assertConfigured(flow: GoogleFlow) {
    const missing = this.missingKeys(flow)
    if (missing.length > 0) {
      throw new GoogleOAuthException(
        'not_configured',
        'Google OAuth 尚未配置完整',
        {
          missingEnvKeys: missing,
        },
        422,
      )
    }
  }

  private clientId(flow: GoogleFlow) {
    return (
      this.value(flow === 'login' ? 'GOOGLE_OAUTH_CLIENT_ID' : 'GOOGLE_CALENDAR_CLIENT_ID', flow) ||
      this.clientJson(flow)?.client_id ||
      ''
    )
  }

  private clientSecret(flow: GoogleFlow) {
    return (
      this.value(
        flow === 'login' ? 'GOOGLE_OAUTH_CLIENT_SECRET' : 'GOOGLE_CALENDAR_CLIENT_SECRET',
        flow,
      ) ||
      this.clientJson(flow)?.client_secret ||
      ''
    )
  }

  private redirectUri(flow: GoogleFlow) {
    return (
      this.value(
        flow === 'login' ? 'GOOGLE_OAUTH_REDIRECT_URI' : 'GOOGLE_CALENDAR_REDIRECT_URI',
        flow,
      ) ||
      this.redirectUriFromJson(flow) ||
      ''
    )
  }

  private value(key: string, flow?: GoogleFlow): string {
    const direct = this.envOverrides[key] ?? (env.get(key as never) as string | undefined)
    if (direct) return direct
    if (flow === 'login') {
      const fallbackKey = key.replace('GOOGLE_OAUTH_', 'GOOGLE_CALENDAR_')
      return (
        this.envOverrides[fallbackKey] ??
        (env.get(fallbackKey as never) as string | undefined) ??
        ''
      )
    }
    if (flow === 'calendar') {
      const fallbackKey = key.replace('GOOGLE_CALENDAR_', 'GOOGLE_OAUTH_')
      return (
        this.envOverrides[fallbackKey] ??
        (env.get(fallbackKey as never) as string | undefined) ??
        ''
      )
    }
    return ''
  }

  private clientJson(flow: GoogleFlow): GoogleClientSecretPayload | null {
    const jsonPath =
      this.value(
        flow === 'login' ? 'GOOGLE_OAUTH_CLIENT_JSON_PATH' : 'GOOGLE_CALENDAR_CLIENT_JSON_PATH',
      ) || this.value('GOOGLE_CLIENT_SECRET_JSON_PATH')
    if (!jsonPath) return null
    const resolved = this.resolveJsonPath(jsonPath)
    const cached = this.clientJsonCache.get(resolved)
    if (cached !== undefined) return cached
    try {
      const parsed = JSON.parse(readFileSync(resolved, 'utf8')) as GoogleClientSecretFile
      const payload = parsed.web ?? parsed.installed ?? null
      this.clientJsonCache.set(resolved, payload)
      return payload
    } catch {
      this.clientJsonCache.set(resolved, null)
      return null
    }
  }

  private redirectUriFromJson(flow: GoogleFlow): string {
    return this.redirectUriFromPayload(this.clientJson(flow), flow)
  }

  private redirectUriFromPayload(
    payload: GoogleClientSecretPayload | null,
    flow: GoogleFlow,
  ): string {
    const uris = payload?.redirect_uris ?? []
    const marker =
      flow === 'login'
        ? '/api/v1/auth/google/callback'
        : '/api/v1/integrations/google_calendar/callback'
    return uris.find((uri) => uri.includes(marker)) ?? uris[0] ?? ''
  }

  private resolveJsonPath(jsonPath: string): string {
    if (path.isAbsolute(jsonPath)) return jsonPath
    const candidates = [path.resolve(process.cwd(), jsonPath), path.resolve(APP_ROOT, jsonPath)]
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
  }

  private safeNext(next: string): string {
    if (!next.startsWith('/') || next.startsWith('//')) return '/'
    return next
  }

  private stateSecret(): string {
    return String(env.get('APP_KEY'))
  }
}
