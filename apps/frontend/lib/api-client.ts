import { getAuthScopeRevision, useAuthStore } from '@/stores/auth-store'

/**
 * API 基础地址。生产由 NEXT_PUBLIC_API_URL 注入；开发默认后端本机端口。
 */
export const API_BASE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:3333/api/v1'

export interface ApiError {
  status: number
  code: string
  message: string
  details?: unknown
}

/** API 抛的是普通对象；统一取 message，避免页面把它显示成 [object Object]。 */
export function apiErrorMessage(failure: unknown, fallback = '请求未能完成，请稍后重试。'): string {
  if (failure && typeof failure === 'object') {
    const value = failure as { status?: number; message?: unknown; name?: string }
    if (value.status === 524)
      return '网关等待超时（524），输入与已答内容仍保留。请重试查询分析结果。'
    if (value.name === 'TimeoutError') return '进度查询等待超时，后台分析可能仍在运行。请重试查询。'
    if (
      typeof value.message === 'string' &&
      value.message.trim() &&
      value.message !== '[object Object]'
    )
      return value.message
  }
  if (typeof failure === 'string' && failure.trim() && failure !== '[object Object]') return failure
  return fallback
}

/** 会话失效回调（刷新失败时触发，如跳转登录页）。由 App 层注入。 */
let onSessionExpired: (() => void) | null = null
export function setOnSessionExpired(cb: (() => void) | null) {
  onSessionExpired = cb
}

/**
 * 单飞（single-flight）刷新：并发的多个 401 只触发一次 refresh，其余等待同一 Promise。
 */
let refreshInFlight: Promise<boolean> | null = null
let refreshScopeRevision = -1

export function assertAuthScopeCurrent(revision: number): void {
  if (revision !== getAuthScopeRevision()) {
    throw {
      status: 409,
      code: 'AUTH_SCOPE_CHANGED',
      message: '登录身份已改变，请重新操作',
    } satisfies ApiError
  }
}

async function performRefresh(organizationId?: number | null): Promise<boolean> {
  const revision = getAuthScopeRevision()
  const { refreshToken, setTokens, clear, currentOrganizationId } = useAuthStore.getState()
  if (!refreshToken) return false

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken,
        organizationId: organizationId === undefined ? currentOrganizationId : organizationId,
      }),
    })
    if (revision !== getAuthScopeRevision()) return false
    if (!res.ok) {
      // 只有 refresh token 被明确判无效才登出；5xx / 429 等临时故障（如后端重启、限流）
      // 保留会话，下一次请求会再试一次刷新——否则开发时后端热重载一次就把人踢回登录页。
      if (REFRESH_TOKEN_REJECTED.has(res.status)) clear()
      return false
    }
    const body = await res.json()
    if (revision !== getAuthScopeRevision()) return false
    setTokens({
      accessToken: body.data.accessToken,
      refreshToken: body.data.refreshToken,
    })
    return true
  } catch {
    // 网络错误（后端不可达）同样不代表 refresh token 失效，保留会话。
    return false
  }
}

const REFRESH_TOKEN_REJECTED = new Set([400, 401, 403])

/**
 * 刷新失败后的收尾：refresh token 已被判无效（会话已清空）才通知会话过期；
 * 临时故障只让本次请求失败，不登出。
 */
function expireSessionIfRefreshRejected(): void {
  if (useAuthStore.getState().refreshToken) return
  useAuthStore.getState().clear()
  onSessionExpired?.()
}

/** 去重的刷新入口。 */
export function refreshSession(): Promise<boolean> {
  const revision = getAuthScopeRevision()
  if (!refreshInFlight || refreshScopeRevision !== revision) {
    refreshScopeRevision = revision
    const pending = performRefresh().finally(() => {
      if (refreshInFlight === pending) refreshInFlight = null
    })
    refreshInFlight = pending
  }
  return refreshInFlight
}

/** 主动切换组织：复用 refresh 轮换并写入新的 organizationId/permissions claims。 */
export function switchOrganizationSession(organizationId: number): Promise<boolean> {
  return performRefresh(organizationId)
}

/**
 * 租户派生缓存清理回调（v3-multitenant-tenant-identification §8.2）。
 *
 * 由 `QueryProvider` 注入 —— store/api-client 层拿不到 React 上下文里的 QueryClient，
 * 而组织切换又必须能把**所有**租户派生的服务端态清掉。用注入回调而不是全局单例
 * QueryClient：后者会让 SSR/多实例场景共享缓存。
 */
let onTenantScopeChanged: (() => void) | null = null
export function setTenantScopeInvalidator(cb: (() => void) | null) {
  onTenantScopeChanged = cb
}

/** 触发一次租户派生缓存清理（切换成功后调用）。 */
export function invalidateTenantScopedCaches(): void {
  onTenantScopeChanged?.()
}

/** 有效租户上下文响应（后端 `/account/organization-selection`，低敏）。 */
export interface EffectiveTenantContextResponse {
  effectiveContext: {
    actorRef: string
    organizationId: number | null
    projectId?: number | null
    membershipRole?: string | null
    scopeMode: string
    selectionSource: string
    resolutionReason: string
    scopeHash: string
    resolvedAt: string
    warningCodes: string[]
    isSuperAdmin: boolean
  }
  scopeHash: string
  selectionEpoch: number
  resolved?: boolean
  /** 切换响应才有：带新组织 claims 的 access token。 */
  accessToken?: string
  invalidation?: {
    selectionEpoch: number
    previousScopeHash: string | null
    nextScopeHash: string
    entries: Array<{ target: string; status: string; removedCount?: number }>
  }
}

/**
 * 组织选择 API（§4.1 的受保护端点）。
 *
 * 与旧 `switchOrganizationSession`（走未认证的 refresh 轮换）的区别：这条路径带
 * owner fallback，且"非成员 / 组织不存在 / 组织已软删除"统一 404 不区分。
 */
export const organizationSelectionApi = {
  /** 读当前有效租户上下文（服务端事实，非本地推断）。 */
  current: () => apiFetch<EffectiveTenantContextResponse>('/account/organization-selection'),
  /** 显式切换 active organization；成功后服务端 selection epoch +1。 */
  select: (organizationId: number, previousScopeHash?: string | null) =>
    apiFetch<EffectiveTenantContextResponse>('/account/organization-selection', {
      method: 'POST',
      body: JSON.stringify({ organizationId, previousScopeHash: previousScopeHash ?? null }),
    }),
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers)
  // FormData（文件上传）由浏览器自动写 multipart 边界，不能强设 JSON
  if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  const { accessToken } = useAuthStore.getState()
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }
  return headers
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = res.status === 524 ? 'GATEWAY_TIMEOUT' : 'UNKNOWN'
  let message =
    res.status === 524
      ? '网关等待超时（524），输入与已答内容仍保留。请重试查询分析结果。'
      : res.status >= 500
        ? `服务暂时不可用（${res.status}），请稍后重试。`
        : res.statusText
  let details: unknown
  try {
    const body = await res.json()
    if (typeof body?.error?.code === 'string') code = body.error.code
    if (typeof body?.error?.message === 'string' && body.error.message.trim())
      message = body.error.message
    details = body?.error?.details
  } catch {
    /* 非 JSON 响应，保留默认 */
  }
  return { status: res.status, code, message, details }
}

/**
 * 统一 API 请求封装（design D11 / 任务 9.2）：
 * - 自动附加 access token；
 * - 401 触发一次静默 refresh 后**重放**原请求；
 * - refresh 失败清会话并触发 onSessionExpired（跳登录）。
 *
 * @param path 以 / 开头的资源路径（相对 API_BASE_URL）
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const revision = getAuthScopeRevision()
  const url = `${API_BASE_URL}${path}`

  let res = await fetch(url, { ...init, headers: buildHeaders(init) })
  assertAuthScopeCurrent(revision)

  // 401：尝试静默刷新后重放（仅重试一次，避免死循环）
  if (res.status === 401) {
    const refreshed = await refreshSession()
    if (!refreshed) {
      if (useAuthStore.getState().isAuthenticated) assertAuthScopeCurrent(revision)
      expireSessionIfRefreshRejected()
      throw await toApiError(res)
    }
    assertAuthScopeCurrent(revision)
    res = await fetch(url, { ...init, headers: buildHeaders(init) })
    assertAuthScopeCurrent(revision)
    if (res.status === 401) {
      useAuthStore.getState().clear()
      onSessionExpired?.()
      throw await toApiError(res)
    }
  }

  if (!res.ok) {
    throw await toApiError(res)
  }

  if (res.status === 204) {
    return undefined as T
  }
  const body = await res.json()
  assertAuthScopeCurrent(revision)
  return (Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body) as T
}

/** 与 apiFetch 共用认证/刷新，但把原始 Response 交给 SSE/文件流调用方。 */
export async function apiRawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const revision = getAuthScopeRevision()
  const url = `${API_BASE_URL}${path}`
  let res = await fetch(url, { ...init, headers: buildHeaders(init) })
  assertAuthScopeCurrent(revision)
  if (res.status === 401 && (await refreshSession())) {
    assertAuthScopeCurrent(revision)
    res = await fetch(url, { ...init, headers: buildHeaders(init) })
  }
  assertAuthScopeCurrent(revision)
  if (!res.ok) throw await toApiError(res)
  return res
}

/**
 * TanStack Query 重试策略：401/403 不重试（对齐 sec06）。
 * 在后续 app-shell change 建 QueryClient 时用于 defaultOptions.queries.retry。
 */
export function queryRetry(failureCount: number, error: unknown): boolean {
  const status = (error as ApiError | undefined)?.status
  if (status === 401 || status === 403) return false
  return failureCount < 2
}

export interface OrganizationSummary {
  id: number
  name: string
  slug: string
  role: string
}

export interface ManagedUser {
  id: number
  fullName: string | null
  email: string
  isActive: boolean
  isSuperAdmin: boolean
  /** 登录来源：local / google / saml / oidc。 */
  authProvider?: string
  /** 个人版是否允许自行配置 AI 连接（默认 false = 使用平台统一 AI 配置）。 */
  allowSelfAiConfig?: boolean
  /** 免两步验证（仅部署机命令写入，界面只读）。 */
  twoFactorExempt?: boolean
  organizations: OrganizationSummary[]
}

export interface Organization {
  id: number
  name: string
  slug: string
  description: string | null
  settings: Record<string, unknown> | null
  ownerId: number
  role?: string
  /** 套餐与人数上限（组织设置概况展示「已用 / 上限」）。 */
  planTier?: string
  maxMembers?: number
}

export interface OrganizationMember {
  id: number
  organizationId: number
  userId: number
  role: 'owner' | 'admin' | 'member' | 'viewer'
  invitedBy: number | null
  /**
   * 成员账号关联——后端 DTO 在个人账号/关联缺失场景可能不返回该字段
   *（个人免费组织成员可能没有完整 user 关联）。渲染必须做缺失防御。
   */
  user?: {
    id: number
    fullName: string | null
    email: string
    isActive: boolean
  } | null
}

export interface PaginatedUsers {
  data: ManagedUser[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

/** 平台超管视角：单个用户的 AI 用量（统一 AI 调用账本，跨组织按用户聚合）。 */
export interface UserAiUsage {
  user: { id: number; email: string; fullName: string | null; authProvider: string }
  windowDays: number
  totals: {
    calls: number
    succeeded: number
    failed: number
    aborted: number
    inputTokens: number
    outputTokens: number
    totalTokens: number
    lastUsedAt: string | null
  }
  costs: { currency: string; amount: number }[]
  byModel: { provider: string | null; model: string | null; calls: number; totalTokens: number }[]
  bySurface: { surface: string; calls: number }[]
  recent: {
    id: number
    organizationId: number
    surface: string
    capability: string
    status: string
    provider: string | null
    model: string | null
    totalTokens: number | null
    estimatedCost: number | null
    currency: string | null
    durationMs: number | null
    occurredAt: string
  }[]
}

export interface UserAiConversation {
  sessionId: string
  title: string
  scope: string
  status: string
  archived: boolean
  organizationId: number
  organizationName: string | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface UserAiConversationMessage {
  messageId: string
  role: string
  content: string
  truncated: boolean
  sequence: number
  createdAt: string
}

type PageMeta = { total: number; page: number; perPage: number; totalPages: number }

export async function apiFetchEnvelope<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  let res = await fetch(url, { ...init, headers: buildHeaders(init) })
  if (res.status === 401) {
    const refreshed = await refreshSession()
    if (!refreshed) {
      expireSessionIfRefreshRejected()
      throw await toApiError(res)
    }
    res = await fetch(url, { ...init, headers: buildHeaders(init) })
  }
  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const usersApi = {
  list: (
    params: { page?: number; search?: string; isActive?: boolean; authProvider?: string } = {},
  ) => {
    const query = new URLSearchParams()
    if (params.page) query.set('page', String(params.page))
    if (params.search) query.set('search', params.search)
    if (params.isActive !== undefined) query.set('is_active', String(params.isActive))
    if (params.authProvider) query.set('auth_provider', params.authProvider)
    const suffix = query.size ? `?${query.toString()}` : ''
    return apiFetchEnvelope<PaginatedUsers>(`/users${suffix}`)
  },
  create: (input: { email: string; password: string; fullName?: string | null }) =>
    apiFetch<ManagedUser>('/users', { method: 'POST', body: JSON.stringify(input) }),
  update: (
    id: number,
    input: Partial<Pick<ManagedUser, 'fullName' | 'email' | 'isActive' | 'allowSelfAiConfig'>>,
  ) => apiFetch<ManagedUser>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  delete: (id: number) => apiFetch<void>(`/users/${id}`, { method: 'DELETE' }),
  /** 平台超管：用户 AI 用量（每次读取后端留痕）。 */
  aiUsage: (id: number, days = 30) => apiFetch<UserAiUsage>(`/users/${id}/ai-usage?days=${days}`),
  /** 平台超管：Google 个人版用户的 AI 对话列表（企业账号后端返回 403）。 */
  aiConversations: (id: number, page = 1) =>
    apiFetchEnvelope<{ data: UserAiConversation[]; meta: PageMeta }>(
      `/users/${id}/ai-conversations?page=${page}`,
    ),
  aiConversationMessages: (id: number, sessionId: string) =>
    apiFetchEnvelope<{
      session: {
        sessionId: string
        title: string
        scope: string
        status: string
        createdAt: string
      }
      data: UserAiConversationMessage[]
      meta: PageMeta
    }>(`/users/${id}/ai-conversations/${encodeURIComponent(sessionId)}/messages?perPage=200`),
}

export const organizationsApi = {
  list: () => apiFetch<Organization[]>('/organizations'),
  get: (id: number) => apiFetch<Organization>(`/organizations/${id}`),
  create: (input: { name: string; ownerId: number; description?: string | null }) =>
    apiFetch<Organization>('/organizations', { method: 'POST', body: JSON.stringify(input) }),
  update: (
    id: number,
    input: Partial<Pick<Organization, 'name' | 'slug' | 'description' | 'settings'>>,
  ) =>
    apiFetch<Organization>(`/organizations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  delete: (id: number) => apiFetch<void>(`/organizations/${id}`, { method: 'DELETE' }),
  transferOwner: (organizationId: number, memberId: number) =>
    apiFetch<{
      organization: Organization
      previousOwnerId: number
      newOwnerId: number
    }>(`/organizations/${organizationId}/transfer-owner`, {
      method: 'POST',
      body: JSON.stringify({ memberId }),
    }),
}

export const membersApi = {
  createAccount: (
    organizationId: number,
    input: {
      fullName: string
      email: string
      password: string
      role: 'admin' | 'member' | 'viewer'
    },
  ) =>
    apiFetch<OrganizationMember>(`/organizations/${organizationId}/members/accounts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  list: (organizationId: number) =>
    apiFetch<OrganizationMember[]>(`/organizations/${organizationId}/members`),
  invite: (
    organizationId: number,
    input: { email: string; role?: Exclude<OrganizationMember['role'], 'owner'> },
  ) =>
    apiFetch<OrganizationMember>(`/organizations/${organizationId}/members/invite`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (organizationId: number, memberId: number, role: OrganizationMember['role']) =>
    apiFetch<OrganizationMember>(`/organizations/${organizationId}/members/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  delete: (organizationId: number, memberId: number) =>
    apiFetch<void>(`/organizations/${organizationId}/members/${memberId}`, { method: 'DELETE' }),
}
