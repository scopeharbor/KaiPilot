import env from '#start/env'
import type {
  IntegrationAuthMethod,
  IntegrationCapability,
  IntegrationCategory,
  IntegrationProvider,
  IntegrationSetupStep,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 代码仓库 provider 可选环境变量键
// ---------------------------------------------------------------------------

export const CODE_REPOSITORY_ENV_KEYS = {
  github: {
    appId: 'GITHUB_APP_ID',
    clientId: 'GITHUB_CLIENT_ID',
    clientSecret: 'GITHUB_CLIENT_SECRET',
    redirectUri: 'GITHUB_REDIRECT_URI',
  },
  gitlab: {
    clientId: 'GITLAB_CLIENT_ID',
    clientSecret: 'GITLAB_CLIENT_SECRET',
    baseUrl: 'GITLAB_BASE_URL',
    redirectUri: 'GITLAB_REDIRECT_URI',
  },
} as const

export type CodeRepositoryEnvKeys = typeof CODE_REPOSITORY_ENV_KEYS

export interface IntegrationProviderConfig {
  provider: IntegrationProvider
  displayName: string
  category: IntegrationCategory
  description: string
  capabilities: IntegrationCapability[]
  authEndpoint: string
  authMethods: IntegrationAuthMethod[]
  scopes: string[]
  envKeys: {
    clientId: string
    clientSecret: string
    redirectUri: string
    baseUrl?: string
  }
  setupGuide: IntegrationSetupStep[]
}

export type IntegrationEnv = Partial<Record<string, string | undefined>>

export const INTEGRATION_PROVIDER_CONFIGS: readonly IntegrationProviderConfig[] = [
  {
    provider: 'google_calendar',
    displayName: 'Google Calendar',
    category: 'calendar',
    description: '预留 Google 日历读取和写入任务日程的 OAuth 连接。',
    capabilities: ['calendar_read', 'calendar_write', 'qr_authorize'],
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    authMethods: ['oauth_redirect', 'qr_code'],
    scopes: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    envKeys: {
      clientId: 'GOOGLE_CALENDAR_CLIENT_ID',
      clientSecret: 'GOOGLE_CALENDAR_CLIENT_SECRET',
      redirectUri: 'GOOGLE_CALENDAR_REDIRECT_URI',
    },
    setupGuide: [
      {
        title: '创建 OAuth 客户端',
        description:
          '在 Google Cloud Console 的 APIs & Services > Credentials 创建 OAuth 2.0 Client ID。',
        href: 'https://console.cloud.google.com/apis/credentials',
      },
      {
        title: '启用 Calendar API',
        description:
          '在同一项目中启用 Google Calendar API，并把回调地址加入 Authorized redirect URIs。',
      },
    ],
  },
  {
    provider: 'outlook_calendar',
    displayName: 'Outlook Calendar',
    category: 'calendar',
    description: '预留 Microsoft Outlook/Graph 日历连接，用于后续日程同步。',
    capabilities: ['calendar_read', 'calendar_write', 'qr_authorize'],
    authEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    authMethods: ['oauth_redirect', 'qr_code'],
    scopes: ['Calendars.ReadWrite', 'User.Read', 'offline_access'],
    envKeys: {
      clientId: 'OUTLOOK_CALENDAR_CLIENT_ID',
      clientSecret: 'OUTLOOK_CALENDAR_CLIENT_SECRET',
      redirectUri: 'OUTLOOK_CALENDAR_REDIRECT_URI',
    },
    setupGuide: [
      {
        title: '注册应用',
        description: '在 Microsoft Entra admin center > App registrations 新增应用。',
        href: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
      },
      {
        title: '配置 Graph 权限',
        description:
          '添加 Calendars.ReadWrite、User.Read、offline_access，并配置 Web redirect URI。',
      },
    ],
  },
  {
    provider: 'slack',
    displayName: 'Slack',
    category: 'message',
    description: '预留 Slack 通知推送、命令和用户身份读取的 OAuth 连接。',
    capabilities: ['message_send', 'message_commands', 'qr_authorize'],
    authEndpoint: 'https://slack.com/oauth/v2/authorize',
    authMethods: ['oauth_redirect', 'qr_code'],
    scopes: ['chat:write', 'commands', 'users:read'],
    envKeys: {
      clientId: 'SLACK_CLIENT_ID',
      clientSecret: 'SLACK_CLIENT_SECRET',
      redirectUri: 'SLACK_REDIRECT_URI',
    },
    setupGuide: [
      {
        title: '创建 Slack App',
        description: '在 Slack API 控制台创建应用，并打开 OAuth & Permissions。',
        href: 'https://api.slack.com/apps',
      },
      {
        title: '配置 Redirect URL',
        description: '把本项目的 Slack redirect URI 添加到 OAuth Redirect URLs。',
      },
    ],
  },
  {
    provider: 'feishu',
    displayName: '飞书',
    category: 'message',
    description: '预留飞书卡片消息和机器人指令连接，当前只生成授权入口。',
    capabilities: ['message_send', 'message_commands', 'qr_authorize'],
    authEndpoint: 'https://open.feishu.cn/open-apis/authen/v1/authorize',
    authMethods: ['oauth_redirect', 'qr_code'],
    scopes: [],
    envKeys: {
      clientId: 'FEISHU_APP_ID',
      clientSecret: 'FEISHU_APP_SECRET',
      redirectUri: 'FEISHU_REDIRECT_URI',
    },
    setupGuide: [
      {
        title: '创建企业自建应用',
        description: '在飞书开放平台创建企业自建应用，复制 App ID 和 App Secret。',
        href: 'https://open.feishu.cn/app',
      },
      {
        title: '配置安全设置',
        description: '在应用安全设置中添加 redirect URI，后续真实接入再配置事件订阅。',
      },
    ],
  },
  {
    provider: 'dingtalk',
    displayName: '钉钉',
    category: 'message',
    description: '预留钉钉企业内部应用授权和扫码入口，当前不获取 access token。',
    capabilities: ['message_send', 'message_commands', 'qr_authorize'],
    authEndpoint: 'https://oapi.dingtalk.com/connect/oauth2/sns_authorize',
    authMethods: ['oauth_redirect', 'qr_code'],
    scopes: ['snsapi_auth'],
    envKeys: {
      clientId: 'DINGTALK_APP_ID',
      clientSecret: 'DINGTALK_APP_SECRET',
      redirectUri: 'DINGTALK_REDIRECT_URI',
    },
    setupGuide: [
      {
        title: '创建企业内部应用',
        description: '在钉钉开放平台创建企业内部应用，复制 AppKey/AppSecret 或应用 ID。',
        href: 'https://open-dev.dingtalk.com/',
      },
      {
        title: '配置回调域名',
        description: '在应用 OAuth 设置中登记 redirect URI；真实接入时再补加签和事件回调。',
      },
    ],
  },
  // -----------------------------------------------------------------------
  // v2-github-gitlab-light-links: GitHub/GitLab 代码仓库类 provider
  // 当前阶段只做 provider 声明和预连接；不交换 token、不回调、不同步。
  // -----------------------------------------------------------------------
  {
    provider: 'github',
    displayName: 'GitHub',
    category: 'code_repository',
    description:
      'GitHub 只读 OAuth 连接。当前版本只建立加密连接和健康检查，不做 Issue/PR 状态自动同步。',
    capabilities: [
      'task_external_link',
      'status_snapshot',
      'safe_open_url',
      'github_readonly_oauth',
    ],
    authEndpoint: 'https://github.com/login/oauth/authorize',
    authMethods: ['oauth_redirect'],
    scopes: ['read:user', 'user:email'],
    envKeys: {
      clientId: CODE_REPOSITORY_ENV_KEYS.github.clientId,
      clientSecret: CODE_REPOSITORY_ENV_KEYS.github.clientSecret,
      redirectUri: CODE_REPOSITORY_ENV_KEYS.github.redirectUri,
    },
    setupGuide: [
      {
        title: '创建 GitHub OAuth App',
        description:
          '在 GitHub Settings > Developer settings > OAuth Apps 新建 OAuth App。本版本只请求只读权限（read:user, user:email）。',
        href: 'https://github.com/settings/developers',
      },
      {
        title: '配置回调地址',
        description:
          '在 OAuth App 设置中将 Authorization callback URL 设为本项目的 GitHub 回调端点。',
      },
      {
        title: '配置环境变量',
        description:
          '设置 GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET 和 GITHUB_REDIRECT_URI 环境变量。',
      },
    ],
  },
  {
    provider: 'gitlab',
    displayName: 'GitLab',
    category: 'code_repository',
    description:
      'GitLab 只读 OAuth 连接。自托管 base URL 由服务端 GITLAB_BASE_URL 环境变量配置（默认 https://gitlab.com）。当前版本只建立加密连接和健康检查，不做 Issue/MR 状态自动同步。',
    capabilities: [
      'task_external_link',
      'status_snapshot',
      'safe_open_url',
      'gitlab_readonly_oauth',
    ],
    authEndpoint: 'https://gitlab.com/oauth/authorize',
    authMethods: ['oauth_redirect'],
    scopes: ['read_user'],
    envKeys: {
      clientId: CODE_REPOSITORY_ENV_KEYS.gitlab.clientId,
      clientSecret: CODE_REPOSITORY_ENV_KEYS.gitlab.clientSecret,
      redirectUri: CODE_REPOSITORY_ENV_KEYS.gitlab.redirectUri,
      baseUrl: CODE_REPOSITORY_ENV_KEYS.gitlab.baseUrl,
    },
    setupGuide: [
      {
        title: '创建 GitLab 应用',
        description:
          '在 GitLab User Settings > Applications 新建应用，设置只读 scope（read_user）。本版本只请求只读身份连接权限。',
        href: 'https://gitlab.com/-/profile/applications',
      },
      {
        title: '配置回调地址',
        description: '在 GitLab 应用设置中将 Redirect URI 设为本项目的 GitLab 回调端点。',
      },
      {
        title: '配置环境变量',
        description:
          '设置 GITLAB_CLIENT_ID、GITLAB_CLIENT_SECRET 和 GITLAB_REDIRECT_URI 环境变量。自托管实例还需设置 GITLAB_BASE_URL（默认 https://gitlab.com）。',
      },
    ],
  },
]

export function getIntegrationProviderConfig(
  provider: IntegrationProvider,
): IntegrationProviderConfig | null {
  return INTEGRATION_PROVIDER_CONFIGS.find((item) => item.provider === provider) ?? null
}

export function resolveIntegrationEnv(key: string, overrides: IntegrationEnv = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key]
  return env.get(key as never) as string | undefined
}

export function requiredEnvKeys(config: IntegrationProviderConfig): string[] {
  const keys = [config.envKeys.clientId, config.envKeys.clientSecret, config.envKeys.redirectUri]
  if (config.envKeys.baseUrl) {
    keys.push(config.envKeys.baseUrl)
  }
  return keys
}

export function missingEnvKeys(
  config: IntegrationProviderConfig,
  overrides: IntegrationEnv = {},
): string[] {
  return requiredEnvKeys(config).filter((key) => {
    const value = resolveIntegrationEnv(key, overrides)
    return value === undefined || value.trim() === ''
  })
}

/**
 * 验证 GitLab base URL 是否为有效的 https URL。
 * base URL 只能来自服务端环境变量，不接受用户/请求输入。
 * 返回 validation 结果（valid/invalid 及原因）。
 */
export function validateGitlabBaseUrl(baseUrl: string | undefined): {
  valid: boolean
  reason?: string
  url?: URL
} {
  if (!baseUrl || baseUrl.trim() === '') {
    return { valid: false, reason: 'base_url_missing' }
  }
  try {
    const url = new URL(baseUrl.trim())
    if (url.protocol !== 'https:') {
      return { valid: false, reason: 'base_url_not_https' }
    }
    if (!url.hostname) {
      return { valid: false, reason: 'base_url_no_host' }
    }
    return { valid: true, url }
  } catch {
    return { valid: false, reason: 'base_url_malformed' }
  }
}

/**
 * 从服务端配置的 GitLab base URL 派生 OAuth 端点。
 */
export function deriveGitlabEndpoint(
  baseUrl: string,
  endpoint: 'authorize' | 'token' | 'api',
): string {
  const base = baseUrl.replace(/\/+$/, '')
  switch (endpoint) {
    case 'authorize':
      return `${base}/oauth/authorize`
    case 'token':
      return `${base}/oauth/token`
    case 'api':
      return `${base}/api/v4`
  }
}
