/**
 * v2-lightweight-calendar-message-integrations —— 第三方日历/消息集成预连接契约。
 *
 * 当前阶段只定义 OAuth 预连接、状态、二维码授权和配置说明；不表示真实 token
 * 交换、同步或外部推送已启用。
 *
 * v2-github-gitlab-light-links: 扩展 code_repository 类别和 GitHub/GitLab provider，
 * 以及 task_external_link/status_snapshot/safe_open_url 能力声明。
 */

export const INTEGRATION_PROVIDERS = [
  'google_calendar',
  'outlook_calendar',
  'slack',
  'feishu',
  'dingtalk',
  'github',
  'gitlab',
] as const
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]

export const INTEGRATION_CATEGORIES = ['calendar', 'message', 'code_repository'] as const
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number]

export const INTEGRATION_CAPABILITIES = [
  'calendar_read',
  'calendar_write',
  'message_send',
  'message_commands',
  'qr_authorize',
  'task_external_link',
  'status_snapshot',
  'safe_open_url',
  'github_readonly_oauth',
  'gitlab_readonly_oauth',
] as const
export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number]

export const INTEGRATION_STATUSES = [
  'not_configured',
  'ready',
  'preconnected',
  'connected',
  'needs_reauth',
  'check_failed',
  'disconnected',
  'disabled',
] as const
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number]

export const INTEGRATION_AUTH_METHODS = ['oauth_redirect', 'qr_code'] as const
export type IntegrationAuthMethod = (typeof INTEGRATION_AUTH_METHODS)[number]

export interface IntegrationSetupStep {
  title: string
  description: string
  href?: string
}

export interface IntegrationProviderDto {
  provider: IntegrationProvider
  displayName: string
  category: IntegrationCategory
  description: string
  capabilities: IntegrationCapability[]
  status: IntegrationStatus
  configured: boolean
  enabled: boolean
  authMethods: IntegrationAuthMethod[]
  requiredEnvKeys: string[]
  missingEnvKeys: string[]
  scopes: string[]
  redirectUri: string | null
  setupGuide: IntegrationSetupStep[]
  note: string
  connectedAccountEmail?: string | null
  connectedAccountLogin?: string | null
  connectedAt?: string | null
  lastCheckedAt?: string | null
  lastError?: string | null
  reasonCode?: string | null
}

export interface IntegrationAuthorizeResponse {
  provider: IntegrationProvider
  authorizationUrl: string
  expiresAt: string
  stateExpiresAt: string
  status: 'authorization_ready'
  message: string
}

export interface IntegrationQrResponse {
  provider: IntegrationProvider
  authorizationUrl: string
  expiresAt: string
  qrTitle: string
  qrDescription: string
}

export interface IntegrationDisconnectResponse {
  provider: IntegrationProvider
  status: 'disconnected'
  message: string
}

export interface IntegrationCheckResponse {
  provider: IntegrationProvider
  status: 'connected' | 'needs_reauth' | 'check_failed'
  accountEmail: string | null
  accountLogin?: string | null
  accountId?: string | null
  scopeSummary?: string | null
  calendarCount: number | null
  primaryCalendarSummary: string | null
  checkedAt: string
  reasonCode?: string | null
}

export interface IntegrationCallbackResult {
  provider: IntegrationProvider
  status: 'preconnected' | 'connected' | 'error'
  codeReceived: boolean
  message: string
  errorCode?: string
}

// ---------------------------------------------------------------------------
// v2-5-github-readonly-oauth-connection: GitHub 连接专用类型
// ---------------------------------------------------------------------------

export type GithubConnectionStatus =
  | 'not_configured'
  | 'authorization_ready'
  | 'connected'
  | 'needs_reauth'
  | 'check_failed'
  | 'disconnected'

export interface GithubConnectionState {
  provider: 'github'
  status: GithubConnectionStatus
  accountLogin: string | null
  accountId: string | null
  scopeSummary: string | null
  tokenType: string | null
  expiresAt: string | null
  checkedAt: string | null
  lastError: string | null
  reasonCode: string | null
}

// ---------------------------------------------------------------------------
// v2-5-gitlab-readonly-oauth-connection: GitLab 连接专用类型
// ---------------------------------------------------------------------------

export type GitlabConnectionStatus =
  | 'not_configured'
  | 'authorization_ready'
  | 'connected'
  | 'needs_reauth'
  | 'check_failed'
  | 'disconnected'

export interface GitlabConnectionState {
  provider: 'gitlab'
  status: GitlabConnectionStatus
  accountLogin: string | null
  accountId: string | null
  instanceHost: string | null
  scopeSummary: string | null
  tokenType: string | null
  expiresAt: string | null
  checkedAt: string | null
  lastError: string | null
  reasonCode: string | null
}

export interface IntegrationErrorDetails {
  provider?: IntegrationProvider
  missingEnvKeys?: string[]
}
