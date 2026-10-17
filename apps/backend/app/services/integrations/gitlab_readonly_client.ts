/**
 * v2-5-gitlab-linked-item-read-refresh —— GitLab 只读 client 接口与 fixture 实现。
 *
 * 设计 D3/D4/D7/D8:
 * - 只读 client 接收结构化 locator（base URL、project path、kind、iid）
 *   和瞬时 access token
 * - Base URL 仅从服务端配置派生，locator 中的 base URL 用于确认而非发现
 * - 返回 provider-neutral 结果 union，与 GitHub client 共享结果契约
 * - 白名单投影，拒绝 description/notes/diff/commit/完整 author 进入 DTO
 * - 默认 fixture 实现，不发起真实网络请求
 * - 真实调用需用户明确授权
 */

import { validateGitlabBaseUrl, deriveGitlabEndpoint } from './provider_registry.js'

// ---------------------------------------------------------------------------
// Linked-item locator（v2-5-gitlab-readonly-oauth-connection D3 + D4）
// ---------------------------------------------------------------------------

export interface GitLabLinkLocator {
  /** GitLab 实例 base URL（仅用于确认 host allowlist 匹配） */
  baseUrl: string
  /** project path（namespace/project），来自本地受信链接字段 */
  projectPath: string
  /** kind: issue | merge_request */
  kind: 'issue' | 'merge_request'
  /** Issue/MR 编号 */
  iid: number
}

// ---------------------------------------------------------------------------
// 白名单快照 DTO（低敏，不含 description/notes/diff/commit/完整 author）
// ---------------------------------------------------------------------------

export interface GitLabSnapshot {
  /** 规范化后的状态 */
  status: 'opened' | 'closed' | 'merged' | 'locked' | 'unknown'
  /** Issue/MR 标题 */
  title: string
  /** 安全规范化 URL（仍经 allowlist 校验） */
  safeUrl: string
  /** 观测时间 */
  observedAt: string
  /** MR 是否已合并 */
  isMerged?: boolean
  /** 是否处于锁定状态（仅 MR） */
  isLocked?: boolean
}

// ---------------------------------------------------------------------------
// 刷新结果 union（稳定 reason code，低敏）
// ---------------------------------------------------------------------------

export type GitLabRefreshResult =
  | { type: 'refreshed'; snapshot: GitLabSnapshot }
  | { type: 'not_configured'; message: string }
  | { type: 'pre_connection_only'; message: string }
  | { type: 'connection_required'; message: string }
  | { type: 'reauthorization_required'; message: string }
  | { type: 'not_found'; message: string }
  | { type: 'forbidden'; message: string }
  | { type: 'rate_limited'; message: string; retryAfter?: number }
  | { type: 'temporarily_unavailable'; message: string }
  | { type: 'unsupported_link'; message: string }

// ---------------------------------------------------------------------------
// CI/pipeline 拉取结果 union（v2-5-code-repository-ci-status-display）
//
// 成功分支返回**原始 GitLab pipeline payload**（可能含敏感字段），由 ci_status_projector
// 白名单投影后再落库；client 本身不投影、不脱敏。
// ---------------------------------------------------------------------------

export type GitLabCiResult =
  | { type: 'ci'; payload: Record<string, unknown> }
  | { type: 'no_ci'; message: string }
  | { type: 'not_configured'; message: string }
  | { type: 'connection_required'; message: string }
  | { type: 'reauthorization_required'; message: string }
  | { type: 'not_found'; message: string }
  | { type: 'forbidden'; message: string }
  | { type: 'rate_limited'; message: string; retryAfter?: number }
  | { type: 'temporarily_unavailable'; message: string }
  | { type: 'unsupported_link'; message: string }

// ---------------------------------------------------------------------------
// GitLab 只读 client 接口
// ---------------------------------------------------------------------------

export interface GitLabReadonlyClient {
  /**
   * 查询单个 Issue 或 Merge Request 的最新状态。
   * @param locator 链接定位器（baseUrl、projectPath、kind、iid）
   * @param accessToken 解密后的 GitLab access token
   * @returns 刷新结果 union
   */
  fetchIssueOrMR(locator: GitLabLinkLocator, accessToken: string): Promise<GitLabRefreshResult>

  /**
   * 查询 Merge Request 关联的最新 pipeline CI 状态（原始 payload，交 projector 投影）。
   * 仅对 merge_request 有意义；issue 返回 no_ci。
   */
  fetchCiSummary(locator: GitLabLinkLocator, accessToken: string): Promise<GitLabCiResult>
}

// ---------------------------------------------------------------------------
// Fixture 实现 —— 默认测试使用，零网络
// ---------------------------------------------------------------------------

export class GitLabReadonlyFixtureClient implements GitLabReadonlyClient {
  async fetchIssueOrMR(
    locator: GitLabLinkLocator,
    accessToken: string,
  ): Promise<GitLabRefreshResult> {
    // 用 token 前缀区分测试场景
    if (accessToken.startsWith('glpat_invalid_') || accessToken.startsWith('glpat_expired_')) {
      return {
        type: 'reauthorization_required',
        message: 'GitLab token 无效或已过期，请重新授权',
      }
    }

    if (accessToken.startsWith('glpat_forbidden_')) {
      return {
        type: 'forbidden',
        message: '无权访问该项目或 Issue/Merge Request',
      }
    }

    if (accessToken.startsWith('glpat_notfound_')) {
      return {
        type: 'not_found',
        message: 'GitLab 上找不到该 Issue 或 Merge Request',
      }
    }

    if (accessToken.startsWith('glpat_ratelimited_')) {
      return {
        type: 'rate_limited',
        message: 'GitLab API 速率限制已达上限，请稍后重试',
        retryAfter: 60,
      }
    }

    if (accessToken.startsWith('glpat_timeout_')) {
      return {
        type: 'temporarily_unavailable',
        message: 'GitLab 服务暂时不可用，请稍后重试',
      }
    }

    if (accessToken.startsWith('glpat_5xx_')) {
      return {
        type: 'temporarily_unavailable',
        message: 'GitLab 服务暂时不可用，请稍后重试',
      }
    }

    if (accessToken.startsWith('glpat_malicious_')) {
      // 恶意 payload 场景：返回成功但内容已被 sanitize
      const safePath = encodeURIComponent(locator.projectPath)
      return {
        type: 'refreshed',
        snapshot: {
          status: locator.kind === 'merge_request' ? 'merged' : 'closed',
          title: 'Fixture malicious title <script>alert(1)</script>',
          safeUrl: `${locator.baseUrl}/${safePath}/${locator.kind === 'issue' ? 'issues' : 'merge_requests'}/${locator.iid}`,
          observedAt: new Date().toISOString(),
          ...(locator.kind === 'merge_request' ? { isMerged: true, isLocked: true } : {}),
        },
      }
    }

    // 默认成功场景
    const isMR = locator.kind === 'merge_request'
    const safePath = encodeURIComponent(locator.projectPath)
    return {
      type: 'refreshed',
      snapshot: {
        status: isMR ? 'merged' : 'closed',
        title: `Fixture ${isMR ? 'MR' : 'Issue'} #${locator.iid} in ${locator.projectPath}`,
        safeUrl: `${locator.baseUrl}/${safePath}/${isMR ? 'merge_requests' : 'issues'}/${locator.iid}`,
        observedAt: new Date().toISOString(),
        ...(isMR ? { isMerged: true, isLocked: false } : {}),
      },
    }
  }

  async fetchCiSummary(locator: GitLabLinkLocator, accessToken: string): Promise<GitLabCiResult> {
    if (accessToken.startsWith('glpat_invalid_') || accessToken.startsWith('glpat_expired_')) {
      return { type: 'reauthorization_required', message: 'GitLab token 无效或已过期，请重新授权' }
    }
    if (accessToken.startsWith('glpat_forbidden_')) {
      return { type: 'forbidden', message: '无权访问该项目的 CI 状态' }
    }
    if (accessToken.startsWith('glpat_notfound_')) {
      return { type: 'not_found', message: 'GitLab 上找不到该 Merge Request 或 pipeline' }
    }
    if (accessToken.startsWith('glpat_ratelimited_')) {
      return {
        type: 'rate_limited',
        message: 'GitLab API 速率限制已达上限，请稍后重试',
        retryAfter: 60,
      }
    }
    if (accessToken.startsWith('glpat_timeout_') || accessToken.startsWith('glpat_5xx_')) {
      return { type: 'temporarily_unavailable', message: 'GitLab 服务暂时不可用，请稍后重试' }
    }

    if (locator.kind === 'issue') {
      return { type: 'no_ci', message: 'Issue 无关联 pipeline' }
    }

    const safePath = encodeURIComponent(locator.projectPath)
    const status = accessToken.startsWith('glpat_ci_failed_')
      ? 'failed'
      : accessToken.startsWith('glpat_ci_running_')
        ? 'running'
        : 'success'

    // payload **故意携带敏感字段**以驱动脱敏测试（projector 必须丢弃它们）
    return {
      type: 'ci',
      payload: {
        id: 555,
        status,
        ref: 'main',
        sha: 'deadbeefcafe0000',
        web_url: `${locator.baseUrl}/${safePath}/-/pipelines/555`,
        // 敏感/高风险字段，projector 不得读取或带出
        yaml_errors: 'secret pipeline config with token glpat_should_not_leak',
        user: { username: 'ci-bot', email: 'private@example.com' },
        detailed_status: { details_path: `/${safePath}/-/pipelines/555?private_token=SECRET` },
      },
    }
  }
}

// ---------------------------------------------------------------------------
// Production 实现 —— 真实 GitLab API 调用
// 仅当用户明确授权后使用。
// ---------------------------------------------------------------------------

export class GitLabReadonlyProductionClient implements GitLabReadonlyClient {
  async fetchIssueOrMR(
    locator: GitLabLinkLocator,
    accessToken: string,
  ): Promise<GitLabRefreshResult> {
    // D3: 仅使用服务端配置 derived 的 API base URL
    const baseUrlValidation = validateGitlabBaseUrl(locator.baseUrl)
    if (!baseUrlValidation.valid || !baseUrlValidation.url) {
      return {
        type: 'unsupported_link',
        message: 'GitLab 实例 base URL 无效或非 https',
      }
    }

    const apiBase = deriveGitlabEndpoint(baseUrlValidation.url.origin, 'api')
    const encodedPath = encodeURIComponent(locator.projectPath)
    const endpoint =
      locator.kind === 'issue'
        ? `${apiBase}/projects/${encodedPath}/issues/${locator.iid}`
        : `${apiBase}/projects/${encodedPath}/merge_requests/${locator.iid}`

    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'aiproj-gitlab-readonly',
        },
      })

      if (response.status === 401) {
        return {
          type: 'reauthorization_required',
          message: 'GitLab token 无效或已过期，请重新授权',
        }
      }

      if (response.status === 403) {
        // GitLab 403 可能因 rate limit 或 scope 不足
        const rateLimitHeader = response.headers.get('RateLimit-Remaining')
        if (rateLimitHeader === '0' || response.headers.get('Retry-After')) {
          const retryAfterHeader = response.headers.get('Retry-After')
          return {
            type: 'rate_limited',
            message: 'GitLab API 速率限制已达上限，请稍后重试',
            retryAfter: retryAfterHeader
              ? Math.min(Number.parseInt(retryAfterHeader, 10), 3600)
              : 60,
          }
        }
        return {
          type: 'forbidden',
          message: '无权访问该项目或 Issue/Merge Request',
        }
      }

      if (response.status === 404) {
        return {
          type: 'not_found',
          message: 'GitLab 上找不到该 Issue 或 Merge Request',
        }
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After')
        const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 60
        return {
          type: 'rate_limited',
          message: 'GitLab API 速率限制已达上限，请稍后重试',
          retryAfter: Math.min(retryAfter, 3600),
        }
      }

      if (response.status >= 500) {
        return {
          type: 'temporarily_unavailable',
          message: 'GitLab 服务暂时不可用，请稍后重试',
        }
      }

      if (!response.ok) {
        return {
          type: 'temporarily_unavailable',
          message: `GitLab API 请求失败 (${response.status})`,
        }
      }

      const data = (await response.json()) as Record<string, unknown>

      // D4: 白名单投影 —— 只提取允许的字段
      return this.projectResponse(data, locator)
    } catch {
      return {
        type: 'temporarily_unavailable',
        message: 'GitLab 请求失败，请稍后重试',
      }
    }
  }

  /**
   * 真实 GitLab MR pipeline 拉取（受授权门控，默认不联网）。
   * 取该 MR 最新一条 pipeline，只回传原始 payload 交 projector。
   */
  async fetchCiSummary(locator: GitLabLinkLocator, accessToken: string): Promise<GitLabCiResult> {
    if (locator.kind === 'issue') {
      return { type: 'no_ci', message: 'Issue 无关联 pipeline' }
    }

    const baseUrlValidation = validateGitlabBaseUrl(locator.baseUrl)
    if (!baseUrlValidation.valid || !baseUrlValidation.url) {
      return { type: 'unsupported_link', message: 'GitLab 实例 base URL 无效或非 https' }
    }
    const apiBase = deriveGitlabEndpoint(baseUrlValidation.url.origin, 'api')
    const encodedPath = encodeURIComponent(locator.projectPath)
    const endpoint = `${apiBase}/projects/${encodedPath}/merge_requests/${locator.iid}/pipelines`

    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'aiproj-gitlab-readonly',
        },
      })

      if (response.status === 401) {
        return {
          type: 'reauthorization_required',
          message: 'GitLab token 无效或已过期，请重新授权',
        }
      }
      if (response.status === 403) {
        if (
          response.headers.get('RateLimit-Remaining') === '0' ||
          response.headers.get('Retry-After')
        ) {
          const retryAfterHeader = response.headers.get('Retry-After')
          return {
            type: 'rate_limited',
            message: 'GitLab API 速率限制已达上限，请稍后重试',
            retryAfter: retryAfterHeader
              ? Math.min(Number.parseInt(retryAfterHeader, 10), 3600)
              : 60,
          }
        }
        return { type: 'forbidden', message: '无权访问该项目的 CI 状态' }
      }
      if (response.status === 404) {
        return { type: 'not_found', message: 'GitLab 上找不到该 Merge Request 或 pipeline' }
      }
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After')
        return {
          type: 'rate_limited',
          message: 'GitLab API 速率限制已达上限，请稍后重试',
          retryAfter: retryAfterHeader ? Math.min(Number.parseInt(retryAfterHeader, 10), 3600) : 60,
        }
      }
      if (response.status >= 500) {
        return { type: 'temporarily_unavailable', message: 'GitLab 服务暂时不可用，请稍后重试' }
      }
      if (!response.ok) {
        return {
          type: 'temporarily_unavailable',
          message: `GitLab API 请求失败 (${response.status})`,
        }
      }

      const data = (await response.json()) as unknown
      // MR pipelines 端点返回数组，最新一条在首位
      const latest = Array.isArray(data) && data.length > 0 ? data[0] : null
      if (!latest || typeof latest !== 'object') {
        return { type: 'no_ci', message: '该 Merge Request 暂无 pipeline' }
      }
      return { type: 'ci', payload: latest as Record<string, unknown> }
    } catch {
      return { type: 'temporarily_unavailable', message: 'GitLab 请求失败，请稍后重试' }
    }
  }

  /**
   * D4: GitLab 响应白名单投影。
   * 拒绝 description/notes/diff/commit/pipeline/完整 author/外部跳转 URL。
   */
  private projectResponse(
    data: Record<string, unknown>,
    locator: GitLabLinkLocator,
  ): GitLabRefreshResult {
    const title = typeof data.title === 'string' ? data.title : ''
    const state = typeof data.state === 'string' ? data.state : 'unknown'
    const webUrl = typeof data.web_url === 'string' ? data.web_url : ''
    const isMR = locator.kind === 'merge_request'

    // MR 专有字段
    const merged =
      isMR && typeof (data as any).state === 'string' ? (data as any).state === 'merged' : false
    const discussionLocked =
      isMR && typeof (data as any).discussion_locked === 'boolean'
        ? (data as any).discussion_locked
        : false

    // 映射 canonical status
    // GitLab Issue: opened / closed
    // GitLab MR: opened / closed / merged / locked
    let status: GitLabSnapshot['status']
    if (state === 'opened') {
      status = 'opened'
    } else if (state === 'closed' && isMR && merged) {
      status = 'merged'
    } else if (state === 'closed') {
      status = 'closed'
    } else if (state === 'merged') {
      status = 'merged'
    } else if (state === 'locked') {
      status = 'locked'
    } else if (state === 'opened' && isMR && discussionLocked) {
      status = 'locked'
    } else {
      status = 'unknown'
    }

    // 安全 URL 校验
    const safeUrl = this.validateSafeUrl(webUrl, locator.baseUrl)

    return {
      type: 'refreshed',
      snapshot: {
        status: this.mapToCanonicalStatus(status),
        title,
        safeUrl,
        observedAt: new Date().toISOString(),
        isMerged: merged || status === 'merged',
        isLocked: discussionLocked || status === 'locked',
      },
    }
  }

  /**
   * 将 GitLab 状态映射为规范化的 Snapshot status。
   */
  private mapToCanonicalStatus(gitlabStatus: GitLabSnapshot['status']): GitLabSnapshot['status'] {
    switch (gitlabStatus) {
      case 'opened':
      case 'closed':
      case 'merged':
      case 'locked':
        return gitlabStatus
      default:
        return 'unknown'
    }
  }

  /**
   * 验证 web_url 是否属于当前 GitLab 实例。
   * 拒绝外部跳转 URL 或非 https URL。
   */
  private validateSafeUrl(url: string, baseUrl: string): string {
    try {
      const urlObj = new URL(url)
      const baseObj = new URL(baseUrl)
      // hostname 必须匹配
      if (urlObj.hostname !== baseObj.hostname) {
        return ''
      }
      // 必须是 https
      if (urlObj.protocol !== 'https:') {
        return ''
      }
      return url
    } catch {
      return ''
    }
  }
}
