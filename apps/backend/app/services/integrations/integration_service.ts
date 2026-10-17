import crypto from 'node:crypto'
import { DateTime } from 'luxon'
import {
  INTEGRATION_PROVIDERS,
  type IntegrationAuthorizeResponse,
  type IntegrationCallbackResult,
  type IntegrationDisconnectResponse,
  type IntegrationCheckResponse,
  type IntegrationProvider,
  type IntegrationProviderDto,
  type IntegrationQrResponse,
} from '@aiproj/types'
import { EXTERNAL_LINK_PROVIDERS } from '@aiproj/types'
import ApiException from '#exceptions/api_exception'
import IntegrationConnection from '#models/integration_connection'
import AuditService, { AuditEvent } from '#services/audit_service'
import GoogleOAuthService from './google_oauth_service.js'
import GithubOAuthService from './github_oauth_service.js'
import GitlabOAuthService from './gitlab_oauth_service.js'
import CodeRepositoryProviderAdapter from './code_repository_adapter.js'
import {
  INTEGRATION_PROVIDER_CONFIGS,
  getIntegrationProviderConfig,
  missingEnvKeys,
  resolveIntegrationEnv,
  type IntegrationEnv,
  type IntegrationProviderConfig,
} from './provider_registry.js'

const STATE_TTL_MS = 10 * 60 * 1000
const TOKEN_EXCHANGE_DISABLED_MESSAGE =
  'OAuth 预连接已完成校验；当前版本尚未启用 token 交换和真实同步。'
const GOOGLE_CALENDAR_READ_PENDING_MESSAGE =
  '目前还未读取到 Google 日历；请确认 GCP Calendar 权限通过后重试。'

export class IntegrationException extends ApiException {
  constructor(
    code:
      | 'not_configured'
      | 'provider_disabled'
      | 'invalid_state'
      | 'token_exchange_not_enabled'
      | 'google_api_error'
      | 'gitlab_api_error',
    message: string,
    details?: unknown,
    status = 400,
  ) {
    super(message, { code, status, details })
  }
}

interface OAuthStatePayload {
  userId: number
  organizationId: number
  provider: IntegrationProvider
  nonce: string
  expiresAt: number
}

export interface IntegrationActor {
  userId: number
  organizationId: number
}

export default class IntegrationService {
  constructor(
    private envOverrides: IntegrationEnv = {},
    private google = new GoogleOAuthService(envOverrides),
    private github = new GithubOAuthService(envOverrides),
    private codeRepo = new CodeRepositoryProviderAdapter(envOverrides),
    private gitlab = new GitlabOAuthService(envOverrides),
    private audit = new AuditService(),
  ) {}

  async listProviders(actor?: IntegrationActor): Promise<IntegrationProviderDto[]> {
    return Promise.all(
      INTEGRATION_PROVIDER_CONFIGS.map((config) => this.toProviderDto(config, actor)),
    )
  }

  async getProvider(provider: string, actor?: IntegrationActor): Promise<IntegrationProviderDto> {
    const config = this.configOrFail(provider)
    return this.toProviderDto(config, actor)
  }

  authorize(provider: string, actor: IntegrationActor): IntegrationAuthorizeResponse {
    const config = this.configOrFail(provider)
    if (config.provider === 'github') {
      if (!this.github.configured) {
        throw new IntegrationException(
          'not_configured',
          'GitHub OAuth 尚未配置完整',
          { provider: 'github', missingEnvKeys: this.github.missingKeys() },
          422,
        )
      }
      const authorization = this.github.buildAuthorizationUrl(actor)
      void this.audit.log({
        event: AuditEvent.INTEGRATION_AUTHORIZE_STARTED,
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'integration_connection',
        metadata: { provider: config.provider },
      })
      return {
        provider: config.provider,
        authorizationUrl: authorization.authorizationUrl,
        expiresAt: authorization.stateExpiresAt,
        stateExpiresAt: authorization.stateExpiresAt,
        status: 'authorization_ready',
        message: '已生成 GitHub 授权地址；授权完成后会保存加密连接。',
      }
    }
    if (config.provider === 'gitlab') {
      if (!this.gitlab.configured) {
        throw new IntegrationException(
          'not_configured',
          'GitLab OAuth 尚未配置完整',
          { provider: 'gitlab', missingEnvKeys: this.gitlab.missingKeys() },
          422,
        )
      }
      const authorization = this.gitlab.buildAuthorizationUrl(actor)
      void this.audit.log({
        event: AuditEvent.INTEGRATION_AUTHORIZE_STARTED,
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'integration_connection',
        metadata: { provider: config.provider, gitlabInstanceHost: this.gitlab.instanceHost },
      })
      return {
        provider: config.provider,
        authorizationUrl: authorization.authorizationUrl,
        expiresAt: authorization.stateExpiresAt,
        stateExpiresAt: authorization.stateExpiresAt,
        status: 'authorization_ready',
        message: `已生成 GitLab（${this.gitlab.instanceHost ?? 'gitlab.com'}）授权地址；授权完成后会保存加密连接。`,
      }
    }
    if (EXTERNAL_LINK_PROVIDERS.includes(config.provider as any)) {
      throw new IntegrationException(
        'token_exchange_not_enabled',
        `${config.displayName} 当前为代码仓库预连接模式，不支持 OAuth 授权。`,
        { provider: config.provider },
      )
    }
    if (config.provider === 'google_calendar') {
      const authorization = this.google.calendarAuthorizationUrl(actor)
      return {
        provider: config.provider,
        authorizationUrl: authorization.authorizationUrl,
        expiresAt: authorization.expiresAt,
        stateExpiresAt: authorization.stateExpiresAt,
        status: 'authorization_ready',
        message: '已生成 Google Calendar 授权地址；授权完成后会保存真实连接。',
      }
    }
    this.assertConfigured(config)
    const stateExpiresAt = new Date(Date.now() + STATE_TTL_MS)
    const state = this.signState({
      userId: actor.userId,
      organizationId: actor.organizationId,
      provider: config.provider,
      nonce: crypto.randomBytes(16).toString('hex'),
      expiresAt: stateExpiresAt.getTime(),
    })
    return {
      provider: config.provider,
      authorizationUrl: this.buildAuthorizationUrl(config, state),
      expiresAt: stateExpiresAt.toISOString(),
      stateExpiresAt: stateExpiresAt.toISOString(),
      status: 'authorization_ready',
      message: '已生成 OAuth 授权地址；完成授权后将进入预连接回调校验。',
    }
  }

  qr(provider: string, actor: IntegrationActor): IntegrationQrResponse {
    const config = this.configOrFail(provider)
    if (EXTERNAL_LINK_PROVIDERS.includes(config.provider as any)) {
      throw new IntegrationException(
        'token_exchange_not_enabled',
        `${config.displayName} 当前为代码仓库预连接模式，不支持二维码授权。`,
        { provider: config.provider },
      )
    }
    const authorization = this.authorize(provider, actor)
    return {
      provider: authorization.provider,
      authorizationUrl: authorization.authorizationUrl,
      expiresAt: authorization.expiresAt,
      qrTitle: `扫码连接 ${config.displayName}`,
      qrDescription: '二维码只打开同一个 OAuth 授权地址，不会绕过 state 校验或创建真实 token。',
    }
  }

  disconnect(provider: string): IntegrationDisconnectResponse {
    const config = this.configOrFail(provider)
    return {
      provider: config.provider,
      status: 'disconnected',
      message: '已清除当前预连接状态；当前版本没有保存第三方 token。',
    }
  }

  async disconnectForActor(
    provider: string,
    actor: IntegrationActor,
  ): Promise<IntegrationDisconnectResponse> {
    const config = this.configOrFail(provider)
    if (
      EXTERNAL_LINK_PROVIDERS.includes(config.provider as any) &&
      config.provider !== 'github' &&
      config.provider !== 'gitlab'
    ) {
      return this.disconnect(provider)
    }
    if (config.provider === 'google_calendar') {
      const connection = await this.connection(actor)
      if (connection) {
        connection.status = 'disconnected'
        connection.accessTokenEncrypted = null
        connection.refreshTokenEncrypted = null
        connection.disconnectedAt = DateTime.utc()
        await connection.save()
        await this.audit.log({
          event: AuditEvent.INTEGRATION_DISCONNECTED,
          userId: actor.userId,
          organizationId: actor.organizationId,
          entityType: 'integration_connection',
          entityId: connection.id,
          metadata: { provider: config.provider },
        })
      }
      return {
        provider: config.provider,
        status: 'disconnected',
        message: 'Google Calendar 已断开，已清除本地 token。',
      }
    }
    if (config.provider === 'github') {
      const connection = await this.githubConnection(actor)
      if (connection) {
        connection.status = 'disconnected'
        connection.accessTokenEncrypted = null
        connection.refreshTokenEncrypted = null
        connection.disconnectedAt = DateTime.utc()
        await connection.save()
        await this.audit.log({
          event: AuditEvent.INTEGRATION_DISCONNECTED,
          userId: actor.userId,
          organizationId: actor.organizationId,
          entityType: 'integration_connection',
          entityId: connection.id,
          metadata: { provider: config.provider },
        })
      }
      return {
        provider: config.provider,
        status: 'disconnected',
        message: 'GitHub 已断开，已清除本地加密 token。',
      }
    }
    if (config.provider === 'gitlab') {
      const connection = await this.gitlabConnection(actor)
      if (connection) {
        connection.status = 'disconnected'
        connection.accessTokenEncrypted = null
        connection.refreshTokenEncrypted = null
        connection.disconnectedAt = DateTime.utc()
        await connection.save()
        await this.audit.log({
          event: AuditEvent.INTEGRATION_DISCONNECTED,
          userId: actor.userId,
          organizationId: actor.organizationId,
          entityType: 'integration_connection',
          entityId: connection.id,
          metadata: { provider: config.provider },
        })
      }
      return {
        provider: config.provider,
        status: 'disconnected',
        message: 'GitLab 已断开，已清除本地加密 token。',
      }
    }
    return this.disconnect(provider)
  }

  async check(provider: string, actor: IntegrationActor): Promise<IntegrationCheckResponse> {
    const config = this.configOrFail(provider)
    if (config.provider === 'github') {
      return this.checkGithub(actor)
    }
    if (config.provider === 'gitlab') {
      return this.checkGitlab(actor)
    }
    if (EXTERNAL_LINK_PROVIDERS.includes(config.provider as any)) {
      const result = this.codeRepo.check(config.provider as any)
      throw new IntegrationException(
        'not_configured',
        result.message,
        {
          provider: config.provider,
          ...(result.missingEnvKeys ? { missingEnvKeys: result.missingEnvKeys } : {}),
        },
        422,
      )
    }
    if (config.provider !== 'google_calendar') {
      throw new IntegrationException('provider_disabled', '当前 provider 尚未启用真实连接检查', {
        provider: config.provider,
      })
    }
    const connection = await this.connectedConnection(actor)
    const accessToken = await this.validAccessToken(connection)
    let calendars
    try {
      calendars = await this.google.calendarList(accessToken)
    } catch {
      const checkedAt = DateTime.utc()
      connection.lastCheckedAt = checkedAt
      connection.lastError = GOOGLE_CALENDAR_READ_PENDING_MESSAGE
      await connection.save()
      throw new IntegrationException(
        'google_api_error',
        GOOGLE_CALENDAR_READ_PENDING_MESSAGE,
        { provider: config.provider, status: 'calendar_read_pending' },
        409,
      )
    }
    connection.lastCheckedAt = DateTime.utc()
    connection.lastError = null
    await connection.save()
    await this.audit.log({
      event: AuditEvent.INTEGRATION_CHECKED,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'integration_connection',
      entityId: connection.id,
      metadata: { provider: config.provider, calendarCount: calendars.calendarCount },
    })
    return {
      provider: config.provider,
      status: 'connected',
      accountEmail: connection.externalAccountEmail,
      calendarCount: calendars.calendarCount,
      primaryCalendarSummary: calendars.primaryCalendarSummary,
      checkedAt: connection.lastCheckedAt.toISO() ?? new Date().toISOString(),
    }
  }

  async handleCallback(
    provider: string,
    input: { code?: string; state?: string; error?: string },
  ): Promise<IntegrationCallbackResult> {
    const config = this.configOrFail(provider)
    if (input.error) {
      await this.audit
        .log({
          event: AuditEvent.INTEGRATION_CALLBACK_FAILED,
          metadata: { provider: config.provider, errorCode: input.error },
        })
        .catch(() => {})
      return {
        provider: config.provider,
        status: 'error',
        codeReceived: false,
        message: '第三方授权返回错误，未建立预连接。',
        errorCode: input.error,
      } satisfies IntegrationCallbackResult
    }
    if (!input.state) {
      throw new IntegrationException('invalid_state', 'OAuth state 缺失或无效', {
        provider: config.provider,
      })
    }
    if (config.provider === 'google_calendar') {
      return this.handleGoogleCalendarCallback(input)
    }
    if (config.provider === 'github') {
      return this.handleGithubCallback(input)
    }
    if (config.provider === 'gitlab') {
      return this.handleGitlabCallback(input)
    }
    const payload = this.verifyState(input.state)
    if (payload.provider !== config.provider) {
      throw new IntegrationException('invalid_state', 'OAuth state 与 provider 不匹配', {
        provider: config.provider,
      })
    }
    if (!input.code) {
      throw new IntegrationException(
        'token_exchange_not_enabled',
        'OAuth code 缺失，无法进入预连接校验',
        {
          provider: config.provider,
        },
      )
    }
    return {
      provider: config.provider,
      status: 'preconnected',
      codeReceived: true,
      message: TOKEN_EXCHANGE_DISABLED_MESSAGE,
    } satisfies IntegrationCallbackResult
  }

  private async handleGoogleCalendarCallback(input: {
    code?: string
    state?: string
    error?: string
  }) {
    if (!input.state) {
      throw new IntegrationException('invalid_state', 'Google Calendar OAuth state 缺失')
    }
    if (!input.code) {
      throw new IntegrationException('invalid_state', 'Google Calendar OAuth code 缺失')
    }
    const state = this.google.verifyState(input.state, 'calendar')
    if (!state.userId || !state.organizationId) {
      throw new IntegrationException('invalid_state', 'Google Calendar OAuth state 缺少用户或组织')
    }
    const token = await this.google.exchangeCode('calendar', input.code)
    if (!token.refresh_token) {
      const existing = await this.connection({
        userId: state.userId,
        organizationId: state.organizationId,
      })
      if (!existing?.refreshTokenEncrypted) {
        throw new IntegrationException(
          'google_api_error',
          'Google 未返回 refresh token，请重新授权并确认 prompt=consent',
          { provider: 'google_calendar' },
          502,
        )
      }
    }
    const profile = await this.google.userInfo(token.access_token)
    const connection = await this.upsertGoogleConnection(
      { userId: state.userId, organizationId: state.organizationId },
      token,
      profile,
    )
    return {
      provider: 'google_calendar',
      status: 'connected',
      codeReceived: true,
      message: `Google Calendar 已连接：${connection.externalAccountEmail ?? profile.email}`,
    } satisfies IntegrationCallbackResult
  }

  private async handleGithubCallback(input: { code?: string; state?: string; error?: string }) {
    if (!input.state) {
      throw new IntegrationException('invalid_state', 'GitHub OAuth state 缺失')
    }
    if (!input.code) {
      throw new IntegrationException('invalid_state', 'GitHub OAuth code 缺失')
    }
    const state = this.github.verifyState(input.state)
    if (!state.userId || !state.organizationId) {
      throw new IntegrationException('invalid_state', 'GitHub OAuth state 缺少用户或组织')
    }
    const token = await this.github.exchangeCode(input.code)
    const profile = await this.github.getUserProfile(token.access_token)
    const connection = await this.upsertGithubConnection(
      { userId: state.userId, organizationId: state.organizationId },
      token,
      profile,
    )
    await this.audit.log({
      event: AuditEvent.INTEGRATION_CONNECTED,
      userId: state.userId,
      organizationId: state.organizationId,
      entityType: 'integration_connection',
      entityId: connection.id,
      metadata: { provider: 'github', accountLogin: profile.login },
    })
    return {
      provider: 'github',
      status: 'connected',
      codeReceived: true,
      message: `GitHub 已连接：${profile.login}`,
    } satisfies IntegrationCallbackResult
  }

  private async handleGitlabCallback(input: { code?: string; state?: string; error?: string }) {
    if (!input.state) {
      throw new IntegrationException('invalid_state', 'GitLab OAuth state 缺失')
    }
    if (!input.code) {
      throw new IntegrationException('invalid_state', 'GitLab OAuth code 缺失')
    }
    const state = this.gitlab.verifyState(input.state)
    if (!state.userId || !state.organizationId) {
      throw new IntegrationException('invalid_state', 'GitLab OAuth state 缺少用户或组织')
    }
    const token = await this.gitlab.exchangeCode(input.code)
    const profile = await this.gitlab.getUserProfile(token.access_token)
    const connection = await this.upsertGitlabConnection(
      { userId: state.userId, organizationId: state.organizationId },
      token,
      profile,
    )
    await this.audit.log({
      event: AuditEvent.INTEGRATION_CONNECTED,
      userId: state.userId,
      organizationId: state.organizationId,
      entityType: 'integration_connection',
      entityId: connection.id,
      metadata: { provider: 'gitlab', accountLogin: profile.username },
    })
    return {
      provider: 'gitlab',
      status: 'connected',
      codeReceived: true,
      message: `GitLab 已连接：${profile.username}`,
    } satisfies IntegrationCallbackResult
  }

  signState(payload: OAuthStatePayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const sig = crypto.createHmac('sha256', this.stateSecret()).update(encoded).digest('base64url')
    return `${encoded}.${sig}`
  }

  verifyState(state: string): OAuthStatePayload {
    const [encoded, sig] = state.split('.')
    if (!encoded || !sig) {
      throw new IntegrationException('invalid_state', 'OAuth state 格式无效')
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
      throw new IntegrationException('invalid_state', 'OAuth state 签名无效')
    }
    let payload: OAuthStatePayload
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    } catch {
      throw new IntegrationException('invalid_state', 'OAuth state 内容无效')
    }
    if (!INTEGRATION_PROVIDERS.includes(payload.provider)) {
      throw new IntegrationException('invalid_state', 'OAuth state provider 无效')
    }
    if (Date.now() > payload.expiresAt) {
      throw new IntegrationException('invalid_state', 'OAuth state 已过期')
    }
    return payload
  }

  private async toProviderDto(
    config: IntegrationProviderConfig,
    actor?: IntegrationActor,
  ): Promise<IntegrationProviderDto> {
    const isCodeRepo = EXTERNAL_LINK_PROVIDERS.includes(config.provider as any)
    const missing =
      config.provider === 'google_calendar'
        ? this.google.missingKeys('calendar')
        : missingEnvKeys(config, this.envOverrides)
    const redirectUri =
      config.provider === 'google_calendar'
        ? (this.envOverrides.GOOGLE_CALENDAR_REDIRECT_URI ??
          this.envOverrides.GOOGLE_OAUTH_REDIRECT_URI ??
          (process.env.GOOGLE_CALENDAR_REDIRECT_URI || process.env.GOOGLE_OAUTH_REDIRECT_URI) ??
          null)
        : (resolveIntegrationEnv(config.envKeys.redirectUri, this.envOverrides) ?? null)
    const configured = missing.length === 0
    const connection =
      actor && config.provider === 'google_calendar' ? await this.connection(actor) : null
    const githubConn =
      actor && config.provider === 'github' ? await this.githubConnection(actor) : null
    const gitlabConn =
      actor && config.provider === 'gitlab' ? await this.gitlabConnection(actor) : null
    const connected =
      connection?.status === 'connected' && Boolean(connection.refreshTokenEncrypted)

    let note: string
    let status:
      | 'not_configured'
      | 'ready'
      | 'preconnected'
      | 'connected'
      | 'needs_reauth'
      | 'check_failed'
      | 'disconnected'
      | 'disabled'

    if (isCodeRepo && config.provider !== 'github' && config.provider !== 'gitlab') {
      const checkResult = this.codeRepo.check(config.provider as any)
      status = 'not_configured'
      note = checkResult.message
    } else if (connected) {
      status = 'connected'
      note = 'Google Calendar 已真实连接，可执行连接检查和后续日历同步。'
    } else if (configured && config.provider === 'github') {
      if (githubConn?.status === 'connected' && githubConn.lastError) {
        status = 'check_failed'
        note = 'GitHub 连接仍保留，但最近一次健康检查失败，可重试检查。'
      } else if (githubConn?.status === 'connected') {
        status = 'connected'
        note = `GitHub 已通过 ${githubConn.externalAccountEmail ?? githubConn.externalAccountId ?? 'unknown'} 连接，可执行健康检查。`
      } else if (githubConn?.status === 'reauthorize') {
        status = 'needs_reauth'
        note = 'GitHub 连接需要重新授权。'
      } else if (githubConn?.status === 'disconnected') {
        status = 'disconnected'
        note = 'GitHub 连接已断开，可重新授权。'
      } else {
        status = 'ready'
        note = 'GitHub OAuth 应用配置已就绪；点击连接后会建立只读加密连接。'
      }
    } else if (configured) {
      status = 'ready'
      note =
        config.provider === 'google_calendar'
          ? 'Google OAuth 应用配置已就绪；点击连接后会保存真实 Calendar 授权。'
          : 'OAuth 应用配置已就绪；当前版本只进行预连接校验，不交换 token。'
    } else {
      status = 'not_configured'
      note = '缺少 OAuth 应用配置；填写可选环境变量后即可生成授权地址。'
    }

    return {
      provider: config.provider,
      displayName: config.displayName,
      category: config.category,
      description: config.description,
      capabilities: config.capabilities,
      status,
      configured,
      enabled: true,
      authMethods: config.authMethods,
      requiredEnvKeys: [
        config.envKeys.clientId,
        config.envKeys.clientSecret,
        config.envKeys.redirectUri,
      ],
      missingEnvKeys: missing,
      scopes: config.scopes,
      redirectUri,
      setupGuide: config.setupGuide,
      note,
      connectedAccountEmail:
        connection?.externalAccountEmail ??
        githubConn?.externalAccountEmail ??
        gitlabConn?.externalAccountEmail ??
        null,
      connectedAccountLogin: githubConn?.externalAccountId ?? gitlabConn?.externalAccountId ?? null,
      connectedAt:
        connection?.connectedAt?.toISO() ??
        githubConn?.connectedAt?.toISO() ??
        gitlabConn?.connectedAt?.toISO() ??
        null,
      lastCheckedAt:
        connection?.lastCheckedAt?.toISO() ??
        githubConn?.lastCheckedAt?.toISO() ??
        gitlabConn?.lastCheckedAt?.toISO() ??
        null,
      lastError: connection?.lastError ?? githubConn?.lastError ?? gitlabConn?.lastError ?? null,
      reasonCode: githubConn?.lastError ?? gitlabConn?.lastError ?? null,
    }
  }

  private buildAuthorizationUrl(config: IntegrationProviderConfig, state: string): string {
    const clientId = resolveIntegrationEnv(config.envKeys.clientId, this.envOverrides) ?? ''
    const redirectUri = resolveIntegrationEnv(config.envKeys.redirectUri, this.envOverrides) ?? ''
    const url = new URL(config.authEndpoint)
    if (config.provider === 'feishu') {
      url.searchParams.set('app_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      return url.toString()
    }
    if (config.provider === 'dingtalk') {
      url.searchParams.set('appid', clientId)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', config.scopes[0] ?? 'snsapi_auth')
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      return url.toString()
    }
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    if (config.provider === 'google_calendar') {
      url.searchParams.set('scope', config.scopes.join(' '))
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')
      return url.toString()
    }
    if (config.provider === 'outlook_calendar') {
      url.searchParams.set('scope', config.scopes.join(' '))
      url.searchParams.set('prompt', 'select_account')
      return url.toString()
    }
    if (config.provider === 'slack') {
      url.searchParams.set('scope', config.scopes.join(','))
      url.searchParams.set('user_scope', 'identity.basic')
      return url.toString()
    }
    return url.toString()
  }

  private configOrFail(provider: string): IntegrationProviderConfig {
    if (!INTEGRATION_PROVIDERS.includes(provider as IntegrationProvider)) {
      throw new IntegrationException('provider_disabled', '不支持的第三方集成 provider', {
        provider,
      })
    }
    const config = getIntegrationProviderConfig(provider as IntegrationProvider)
    if (!config) {
      throw new IntegrationException('provider_disabled', '第三方集成 provider 未启用', {
        provider,
      })
    }
    return config
  }

  private assertConfigured(config: IntegrationProviderConfig) {
    const missing = missingEnvKeys(config, this.envOverrides)
    if (missing.length > 0) {
      throw new IntegrationException(
        'not_configured',
        `${config.displayName} 尚未配置 OAuth 应用参数`,
        { provider: config.provider, missingEnvKeys: missing },
        422,
      )
    }
  }

  private stateSecret(): string {
    return process.env.APP_KEY || 'test-integration-state-secret'
  }

  private connection(actor: IntegrationActor) {
    return IntegrationConnection.query()
      .where('organization_id', actor.organizationId)
      .where('user_id', actor.userId)
      .where('provider', 'google_calendar')
      .first()
  }

  private async connectedConnection(actor: IntegrationActor) {
    const connection = await this.connection(actor)
    if (!connection || connection.status !== 'connected' || !connection.accessTokenEncrypted) {
      throw new IntegrationException(
        'google_api_error',
        'Google Calendar 尚未连接',
        {
          provider: 'google_calendar',
        },
        409,
      )
    }
    return connection
  }

  private async validAccessToken(connection: IntegrationConnection): Promise<string> {
    if (
      connection.expiresAt &&
      connection.expiresAt.diffNow('seconds').seconds <= 60 &&
      connection.refreshTokenEncrypted
    ) {
      return this.google.refreshAccessToken(connection)
    }
    if (!connection.accessTokenEncrypted) {
      return this.google.refreshAccessToken(connection)
    }
    return this.google.decryptToken(connection.accessTokenEncrypted)
  }

  private async upsertGoogleConnection(
    actor: IntegrationActor,
    token: {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      token_type?: string
    },
    profile: { sub: string; email: string },
  ) {
    const existing = await this.connection(actor)
    const connection =
      existing ??
      new IntegrationConnection().fill({
        organizationId: actor.organizationId,
        userId: actor.userId,
        provider: 'google_calendar',
      })
    connection.status = 'connected'
    connection.externalAccountId = profile.sub
    connection.externalAccountEmail = profile.email
    connection.scopesJson = token.scope?.split(/\s+/).filter(Boolean) ?? null
    connection.accessTokenEncrypted = this.google.encryptToken(token.access_token)
    if (token.refresh_token) {
      connection.refreshTokenEncrypted = this.google.encryptToken(token.refresh_token)
    }
    connection.tokenType = token.token_type ?? 'Bearer'
    connection.expiresAt = token.expires_in
      ? DateTime.utc().plus({ seconds: token.expires_in })
      : null
    connection.connectedAt = DateTime.utc()
    connection.disconnectedAt = null
    connection.lastError = null
    await connection.save()
    await this.audit.log({
      event: AuditEvent.INTEGRATION_CONNECTED,
      userId: actor.userId,
      organizationId: actor.organizationId,
      entityType: 'integration_connection',
      entityId: connection.id,
      metadata: { provider: 'google_calendar', accountEmail: profile.email },
    })
    return connection
  }

  // -----------------------------------------------------------------------
  // GitHub 连接方法
  // -----------------------------------------------------------------------

  private githubConnection(actor: IntegrationActor) {
    return IntegrationConnection.query()
      .where('organization_id', actor.organizationId)
      .where('user_id', actor.userId)
      .where('provider', 'github')
      .first()
  }

  private async connectedGithubConnection(actor: IntegrationActor) {
    const connection = await this.githubConnection(actor)
    if (!connection || connection.status !== 'connected' || !connection.accessTokenEncrypted) {
      throw new IntegrationException(
        'not_configured',
        'GitHub 尚未连接',
        { provider: 'github' },
        409,
      )
    }
    return connection
  }

  private async checkGithub(actor: IntegrationActor): Promise<IntegrationCheckResponse> {
    const connection = await this.connectedGithubConnection(actor)
    if (!connection.accessTokenEncrypted) {
      throw new IntegrationException(
        'not_configured',
        'GitHub 尚未连接',
        { provider: 'github' },
        409,
      )
    }
    const token = this.github.decryptToken(connection.accessTokenEncrypted)
    try {
      const health = await this.github.healthCheck(token)
      connection.lastCheckedAt = DateTime.utc()
      connection.lastError = null
      await connection.save()
      await this.audit.log({
        event: AuditEvent.INTEGRATION_CHECKED,
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'integration_connection',
        entityId: connection.id,
        metadata: { provider: 'github', accountLogin: health.login, scopes: health.scopes },
      })
      return {
        provider: 'github',
        status: 'connected',
        accountEmail: connection.externalAccountEmail,
        accountLogin: health.login,
        scopeSummary: health.scopes.join(', '),
        calendarCount: null,
        primaryCalendarSummary: null,
        checkedAt: connection.lastCheckedAt.toISO() ?? new Date().toISOString(),
      }
    } catch (err) {
      connection.lastCheckedAt = DateTime.utc()
      if (err instanceof Error) {
        connection.lastError = err.message
      }
      await connection.save()
      await this.audit.log({
        event: AuditEvent.INTEGRATION_CHECK_FAILED,
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'integration_connection',
        entityId: connection.id,
        metadata: { provider: 'github', reasonCode: 'check_failed' },
      })
      throw new IntegrationException(
        'not_configured',
        connection.lastError ?? 'GitHub 健康检查失败',
        { provider: 'github', status: 'check_failed' },
        409,
      )
    }
  }

  private async upsertGithubConnection(
    actor: IntegrationActor,
    token: { access_token: string; token_type?: string; scope?: string },
    profile: { login: string; id: number; email: string | null },
  ) {
    const existing = await this.githubConnection(actor)
    const connection =
      existing ??
      new IntegrationConnection().fill({
        organizationId: actor.organizationId,
        userId: actor.userId,
        provider: 'github',
      })
    connection.status = 'connected'
    connection.externalAccountId = String(profile.id)
    connection.externalAccountEmail = profile.login
    connection.scopesJson =
      token.scope
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? null
    connection.accessTokenEncrypted = this.github.encryptToken(token.access_token)
    // GitHub OAuth 当前版本不返回 refresh token
    connection.tokenType = token.token_type ?? 'Bearer'
    connection.expiresAt = null
    connection.connectedAt = DateTime.utc()
    connection.disconnectedAt = null
    connection.lastError = null
    await connection.save()
    return connection
  }

  // -----------------------------------------------------------------------
  // GitLab 连接方法
  // -----------------------------------------------------------------------

  private gitlabConnection(actor: IntegrationActor) {
    return IntegrationConnection.query()
      .where('organization_id', actor.organizationId)
      .where('user_id', actor.userId)
      .where('provider', 'gitlab')
      .first()
  }

  private async connectedGitlabConnection(actor: IntegrationActor) {
    const connection = await this.gitlabConnection(actor)
    if (!connection || connection.status !== 'connected' || !connection.accessTokenEncrypted) {
      throw new IntegrationException(
        'not_configured',
        'GitLab 尚未连接',
        { provider: 'gitlab' },
        409,
      )
    }
    return connection
  }

  private async checkGitlab(actor: IntegrationActor): Promise<IntegrationCheckResponse> {
    const connection = await this.connectedGitlabConnection(actor)
    if (!connection.accessTokenEncrypted) {
      throw new IntegrationException(
        'not_configured',
        'GitLab 尚未连接',
        { provider: 'gitlab' },
        409,
      )
    }
    const token = this.gitlab.decryptToken(connection.accessTokenEncrypted)
    try {
      const health = await this.gitlab.healthCheck(token)
      connection.lastCheckedAt = DateTime.utc()
      connection.lastError = null
      await connection.save()
      await this.audit.log({
        event: AuditEvent.INTEGRATION_CHECKED,
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'integration_connection',
        entityId: connection.id,
        metadata: { provider: 'gitlab', accountLogin: health.username },
      })
      return {
        provider: 'gitlab',
        status: 'connected',
        accountEmail: connection.externalAccountEmail,
        accountLogin: health.username,
        scopeSummary: connection.scopesJson?.join(', ') ?? null,
        calendarCount: null,
        primaryCalendarSummary: null,
        checkedAt: connection.lastCheckedAt.toISO() ?? new Date().toISOString(),
      }
    } catch (err) {
      connection.lastCheckedAt = DateTime.utc()
      if (err instanceof Error) {
        connection.lastError = err.message
      }
      await connection.save()
      await this.audit.log({
        event: AuditEvent.INTEGRATION_CHECK_FAILED,
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'integration_connection',
        entityId: connection.id,
        metadata: { provider: 'gitlab', reasonCode: 'check_failed' },
      })
      throw new IntegrationException(
        'gitlab_api_error',
        connection.lastError ?? 'GitLab 健康检查失败',
        { provider: 'gitlab', status: 'check_failed' },
        409,
      )
    }
  }

  private async upsertGitlabConnection(
    actor: IntegrationActor,
    token: {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      token_type?: string
    },
    profile: {
      id: number
      username: string
      email: string | null
      name: string
      avatar_url: string
    },
  ) {
    const existing = await this.gitlabConnection(actor)
    const connection =
      existing ??
      new IntegrationConnection().fill({
        organizationId: actor.organizationId,
        userId: actor.userId,
        provider: 'gitlab',
      })
    connection.status = 'connected'
    connection.externalAccountId = String(profile.id)
    connection.externalAccountEmail = profile.username
    connection.scopesJson = token.scope?.split(/\s+/).filter(Boolean) ?? null
    connection.accessTokenEncrypted = this.gitlab.encryptToken(token.access_token)
    if (token.refresh_token) {
      connection.refreshTokenEncrypted = this.gitlab.encryptToken(token.refresh_token)
    }
    connection.tokenType = token.token_type ?? 'Bearer'
    connection.expiresAt = token.expires_in
      ? DateTime.utc().plus({ seconds: token.expires_in })
      : null
    connection.connectedAt = DateTime.utc()
    connection.disconnectedAt = null
    connection.lastError = null
    await connection.save()
    return connection
  }
}
