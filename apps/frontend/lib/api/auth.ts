import { API_BASE_URL, type ApiError } from '@/lib/api-client'
import type { AuthUser } from '@/stores/auth-store'
import type { TwoFactorEnrollment, TwoFactorMethod } from '@/lib/api/two-factor'

/** 登录中断的用途。 */
export type TwoFactorChallengePurpose = 'verify' | 'enroll'

export interface LoginInput {
  email: string
  password: string
}

export interface AuthSession {
  user: AuthUser
  accessToken: string
  refreshToken: string
}

/**
 * 账号启用了两步验证时 `POST /auth/login` 的响应形状。
 *
 * 刻意**不含任何会话凭证**——密码通过只换到一张待兑换的票据，
 * 必须再调 `loginTwoFactor` 才拿得到 token。
 */
export interface TwoFactorChallenge {
  twoFactorRequired: true
  challengeToken: string
  expiresAt: string
  /**
   * `verify` = 账号已绑定，输认证器验证码；
   * `enroll` = 尚未绑定，登录界面直接给二维码，扫码后输码完成绑定并登录
   *（Auth0 / Okta Universal Login 的 enrollment-at-login 形态）。
   */
  purpose: TwoFactorChallengePurpose
  /** 绑定挑战是否允许「暂时跳过」（服务端 `required` 策略下为 false）。 */
  skippable?: boolean
  methods: TwoFactorMethod[]
}

/** 登录第一步的结果：直接得到会话，或得到第二因子挑战。 */
export type LoginResult = AuthSession | TwoFactorChallenge

/** 判别登录结果是否需要第二因子（用判别字段而非嗅探 token 是否存在）。 */
export function isTwoFactorChallenge(result: LoginResult): result is TwoFactorChallenge {
  return (result as TwoFactorChallenge).twoFactorRequired === true
}

export interface TwoFactorLoginInput {
  challengeToken: string
  code: string
}

/**
 * 第二因子登录成功的结果。
 * `recoveryCodes` 只有在这次登录**顺便完成了首次绑定**时非空，且只此一次。
 */
export interface TwoFactorLoginResult extends AuthSession {
  recoveryCodes: string[] | null
  /** 本次用恢复码而非认证器登录——UI 据此引导尽快重新绑定。 */
  usedRecoveryCode?: boolean
}

export type GooglePreflightStatus =
  | 'configured'
  | 'disabled'
  | 'missing_file'
  | 'unreadable_file'
  | 'invalid_json'
  | 'invalid_client_shape'
  | 'redirect_not_configured'

export interface GoogleAuthConfig {
  configured: boolean
  missingEnvKeys: string[]
  authorizationUrl: string | null
  /** 无秘密 preflight 状态码（v3-docker-google-oauth-runtime-wiring，design D） */
  preflight?: { status: GooglePreflightStatus }
}

/**
 * 把 backend 失败回跳携带的 typed code 映射成中文文案（design D / DGO-08）。
 * 未知 code 返回 null，由调用方归一为通用提示；绝不由前端回显服务端原始消息。
 */
export function googleErrorMessage(code: string | null | undefined): string | null {
  switch (code) {
    case 'access_denied':
      return '已取消 Google 授权。'
    case 'invalid_state':
      return 'Google 登录请求已失效，请重新登录。'
    case 'token_exchange_failed':
      return 'Google 登录暂时不可用，请稍后再试。'
    case 'google_api_error':
      return '读取 Google 账号信息失败，请稍后再试。'
    case 'account_inactive':
      return '账户已被禁用，请联系管理员。'
    case 'not_configured':
      return 'Google 登录未配置完整。'
    case 'google_login_failed':
      return 'Google 登录失败，请重试。'
    default:
      return null
  }
}

/** 把 preflight 状态码映射成部署人员可操作的中文提示；返回 null 表示无需额外提示。 */
export function googlePreflightMessage(status: GooglePreflightStatus): string | null {
  switch (status) {
    case 'missing_file':
      return 'Google 登录未配置：凭据文件未挂载或路径不存在，请按部署手册设置 AIPROJ_GOOGLE_OAUTH_SECRET_FILE。'
    case 'unreadable_file':
      return 'Google 登录未配置：凭据文件不可读，请检查文件权限。'
    case 'invalid_json':
      return 'Google 登录未配置：凭据文件不是有效 JSON。'
    case 'invalid_client_shape':
      return 'Google 登录未配置：凭据文件缺少 client_id 或 client_secret。'
    case 'redirect_not_configured':
      return 'Google 登录未配置：回调地址未登记，请在 Google Console 登记 {origin}/api/v1/auth/google/callback。'
    default:
      return null
  }
}

async function readApiError(response: Response): Promise<ApiError> {
  let code = 'UNKNOWN'
  let message = response.statusText || '请求失败'
  let details: unknown
  try {
    const body = await response.json()
    code = body?.error?.code ?? code
    message = body?.error?.message ?? message
    details = body?.error?.details
  } catch {
    // 非 JSON 错误沿用 HTTP 状态文本。
  }
  return { status: response.status, code, message, details }
}

export const authApi = {
  async googleConfig(nextPath = '/'): Promise<GoogleAuthConfig> {
    const query = new URLSearchParams({ next: nextPath })
    const response = await fetch(`${API_BASE_URL}/auth/google/config?${query.toString()}`)
    if (!response.ok) throw await readApiError(response)
    const body = await response.json()
    return body.data as GoogleAuthConfig
  },

  async login(input: LoginInput): Promise<LoginResult> {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw await readApiError(response)
    const body = await response.json()
    return body.data as LoginResult
  },

  /**
   * 登录第二步：用挑战票据 + 一次性口令/恢复码换正式会话。
   *
   * 与 login 一样是未认证端点——会话正是它要产出的东西，因此不走带 Authorization
   * 头的 `apiFetch`，直接裸 fetch。
   */
  async loginTwoFactor(input: TwoFactorLoginInput): Promise<TwoFactorLoginResult> {
    const response = await fetch(`${API_BASE_URL}/auth/login/two-factor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw await readApiError(response)
    const body = await response.json()
    return body.data as TwoFactorLoginResult
  },

  /**
   * 用绑定挑战票据换该次的二维码内容。
   *
   * 密钥刻意不随登录响应下发：Google 登录是 302 回前端，那条路径只能经 URL 传值，
   * 会把密钥留在浏览器历史里。改为「令牌换密钥」后两条路径共用同一套前端代码。
   */
  async loginTwoFactorEnrollment(challengeToken: string): Promise<TwoFactorEnrollment> {
    const response = await fetch(`${API_BASE_URL}/auth/login/two-factor/enrollment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken }),
    })
    if (!response.ok) throw await readApiError(response)
    const body = await response.json()
    return body.data as TwoFactorEnrollment
  },

  /** 登录期绑定的「暂时跳过」（仅服务端策略为 optional 时可用）。 */
  async loginTwoFactorSkip(challengeToken: string): Promise<AuthSession> {
    const response = await fetch(`${API_BASE_URL}/auth/login/two-factor/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken }),
    })
    if (!response.ok) throw await readApiError(response)
    const body = await response.json()
    return body.data as AuthSession
  },

  async logout(accessToken: string, refreshToken: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/account/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    })
    if (!response.ok && response.status !== 401) throw await readApiError(response)
  },
}
