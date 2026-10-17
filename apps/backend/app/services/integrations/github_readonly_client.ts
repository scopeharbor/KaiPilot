/**
 * v2-5-github-linked-item-read-refresh —— GitHub 只读 client 接口与 fixture 实现。
 *
 * 设计 D3/D4/D7:
 * - 只读 client 接收结构化 locator 和解密后的瞬时凭据
 * - 返回 provider-neutral 的结果 union
 * - 默认 fixture 实现，不发起真实网络请求
 * - 真实调用需用户明确授权
 */

import type { ExternalLinkType } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Linked-item locator（从本地受信链接字段构造）
// ---------------------------------------------------------------------------

export interface GitHubLinkLocator {
  owner: string
  repo: string
  kind: Extract<ExternalLinkType, 'issue' | 'pull_request'>
  number: number
}

// ---------------------------------------------------------------------------
// 白名单快照 DTO（低敏，不含 body/comments/diff/commit/完整 author）
// ---------------------------------------------------------------------------

export interface GitHubSnapshot {
  /** 规范化后的状态 */
  status: 'open' | 'closed' | 'merged' | 'draft' | 'unknown'
  /** Issue/PR 标题 */
  title: string
  /** 安全的规范化 URL */
  safeUrl: string
  /** 观测时间 */
  observedAt: string
  /** PR 是否已合并（仅 PR） */
  isMerged?: boolean
}

// ---------------------------------------------------------------------------
// 刷新结果 union（稳定 reason code，低敏）
// ---------------------------------------------------------------------------

export type GitHubRefreshResult =
  | { type: 'refreshed'; snapshot: GitHubSnapshot }
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
// CI/check 拉取结果 union（v2-5-code-repository-ci-status-display）
//
// 成功分支返回**原始 provider CI payload**（可能含敏感字段），由 ci_status_projector
// 白名单投影后再落库；client 本身不投影、不脱敏，脱敏边界在 projector。
// ---------------------------------------------------------------------------

export type GitHubCiResult =
  | { type: 'ci'; kind: 'checks' | 'status'; payload: Record<string, unknown> }
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
// GitHub 只读 client 接口
// ---------------------------------------------------------------------------

export interface GitHubReadonlyClient {
  /**
   * 查询单个 Issue 或 Pull Request 的最新状态。
   * @param locator 链接定位器（owner/repo/kind/number）
   * @param accessToken 解密后的 GitHub access token
   * @returns 刷新结果 union
   */
  fetchIssueOrPR(locator: GitHubLinkLocator, accessToken: string): Promise<GitHubRefreshResult>

  /**
   * 查询 Pull Request 关联的 CI/check 状态（原始 payload，交 projector 投影）。
   * 仅对 pull_request 有意义；issue 返回 no_ci。
   * @param locator 链接定位器
   * @param accessToken 解密后的 GitHub access token
   */
  fetchCiSummary(locator: GitHubLinkLocator, accessToken: string): Promise<GitHubCiResult>
}

// ---------------------------------------------------------------------------
// Fixture 实现 —— 默认测试使用，零网络
// ---------------------------------------------------------------------------

export class GitHubReadonlyFixtureClient implements GitHubReadonlyClient {
  async fetchIssueOrPR(
    locator: GitHubLinkLocator,
    _accessToken: string,
  ): Promise<GitHubRefreshResult> {
    // 用 token 前缀区分测试场景
    if (_accessToken.startsWith('gho_invalid_') || _accessToken.startsWith('gho_expired_')) {
      return {
        type: 'reauthorization_required',
        message: 'GitHub token 无效或已过期，请重新授权',
      }
    }

    if (_accessToken.startsWith('gho_forbidden_')) {
      return {
        type: 'forbidden',
        message: '无权访问该仓库或 Issue/PR',
      }
    }

    if (_accessToken.startsWith('gho_notfound_')) {
      return {
        type: 'not_found',
        message: 'GitHub 上找不到该 Issue 或 Pull Request',
      }
    }

    if (_accessToken.startsWith('gho_ratelimited_')) {
      return {
        type: 'rate_limited',
        message: 'GitHub API 速率限制已达上限，请稍后重试',
        retryAfter: 60,
      }
    }

    if (_accessToken.startsWith('gho_timeout_')) {
      return {
        type: 'temporarily_unavailable',
        message: 'GitHub 服务暂时不可用，请稍后重试',
      }
    }

    if (_accessToken.startsWith('gho_5xx_')) {
      return {
        type: 'temporarily_unavailable',
        message: 'GitHub 服务暂时不可用，请稍后重试',
      }
    }

    if (_accessToken.startsWith('gho_malicious_')) {
      // 恶意 payload 场景：返回成功但内容已被 sanitize
      return {
        type: 'refreshed',
        snapshot: {
          status: locator.kind === 'pull_request' ? 'merged' : 'closed',
          title: 'Fixture malicious title <script>alert(1)</script>',
          safeUrl: `https://github.com/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}/${locator.kind === 'issue' ? 'issues' : 'pull'}/${locator.number}`,
          observedAt: new Date().toISOString(),
          isMerged: locator.kind === 'pull_request',
        },
      }
    }

    // 默认成功场景
    const isPR = locator.kind === 'pull_request'
    return {
      type: 'refreshed',
      snapshot: {
        status: isPR ? 'merged' : 'closed',
        title: `Fixture ${isPR ? 'PR' : 'Issue'} #${locator.number} in ${locator.repo}`,
        safeUrl: `https://github.com/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}/${isPR ? 'pull' : 'issues'}/${locator.number}`,
        observedAt: new Date().toISOString(),
        isMerged: isPR,
      },
    }
  }

  async fetchCiSummary(locator: GitHubLinkLocator, accessToken: string): Promise<GitHubCiResult> {
    // 失败场景复用 token 前缀约定
    if (accessToken.startsWith('gho_invalid_') || accessToken.startsWith('gho_expired_')) {
      return { type: 'reauthorization_required', message: 'GitHub token 无效或已过期，请重新授权' }
    }
    if (accessToken.startsWith('gho_forbidden_')) {
      return { type: 'forbidden', message: '无权访问该仓库的 CI 状态' }
    }
    if (accessToken.startsWith('gho_notfound_')) {
      return { type: 'not_found', message: 'GitHub 上找不到该 Pull Request 或提交' }
    }
    if (accessToken.startsWith('gho_ratelimited_')) {
      return {
        type: 'rate_limited',
        message: 'GitHub API 速率限制已达上限，请稍后重试',
        retryAfter: 60,
      }
    }
    if (accessToken.startsWith('gho_timeout_') || accessToken.startsWith('gho_5xx_')) {
      return { type: 'temporarily_unavailable', message: 'GitHub 服务暂时不可用，请稍后重试' }
    }

    // Issue 无 CI/check 概念
    if (locator.kind === 'issue') {
      return { type: 'no_ci', message: 'Issue 无关联 CI/check' }
    }

    const baseUrl = `https://github.com/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}`
    // 结论按 token 前缀切换，payload **故意携带敏感字段**以驱动脱敏测试（projector 必须丢弃它们）
    const conclusion = accessToken.startsWith('gho_ci_failed_')
      ? 'failure'
      : accessToken.startsWith('gho_ci_running_')
        ? null
        : 'success'
    const status = accessToken.startsWith('gho_ci_running_') ? 'in_progress' : 'completed'

    return {
      type: 'ci',
      kind: 'checks',
      payload: {
        total_count: 1,
        check_runs: [
          {
            id: 101,
            name: 'build-and-test',
            status,
            conclusion,
            html_url: `${baseUrl}/runs/101`,
            // 以下均为敏感/高风险字段，projector 不得读取或带出
            details_url: `${baseUrl}/runs/101?token=gho_secret_query_param`,
            output: {
              title: 'Build',
              summary: 'SENSITIVE build log with token gho_should_not_leak',
              text: 'full workflow logs ... commit diff ... private comment ...',
            },
            app: { name: 'GitHub Actions', client_id: 'CLIENT', client_secret: 'SECRET' },
            artifacts_url: `${baseUrl}/artifacts/1`,
          },
        ],
        _authorization: 'Bearer gho_secret_token',
      },
    }
  }
}

// ---------------------------------------------------------------------------
// Production 实现 —— 真实 GitHub API 调用
// 仅在用户明确授权后使用。
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = 'https://api.github.com'

export class GitHubReadonlyProductionClient implements GitHubReadonlyClient {
  async fetchIssueOrPR(
    locator: GitHubLinkLocator,
    accessToken: string,
  ): Promise<GitHubRefreshResult> {
    const endpoint =
      locator.kind === 'issue'
        ? `${GITHUB_API_BASE}/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}/issues/${locator.number}`
        : `${GITHUB_API_BASE}/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}/pulls/${locator.number}`

    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'aiproj-github-readonly',
        },
      })

      if (response.status === 401) {
        return {
          type: 'reauthorization_required',
          message: 'GitHub token 无效或已过期，请重新授权',
        }
      }

      if (response.status === 403) {
        const retryAfter = response.headers.get('X-RateLimit-Remaining')
        if (retryAfter === '0') {
          const resetHeader = response.headers.get('X-RateLimit-Reset')
          const retryAfterSeconds = resetHeader
            ? Math.max(0, Number.parseInt(resetHeader, 10) - Math.floor(Date.now() / 1000))
            : 60
          return {
            type: 'rate_limited',
            message: 'GitHub API 速率限制已达上限，请稍后重试',
            retryAfter: Math.min(retryAfterSeconds, 3600), // bounded retry-after
          }
        }
        return {
          type: 'forbidden',
          message: '无权访问该仓库或 Issue/PR',
        }
      }

      if (response.status === 404) {
        return {
          type: 'not_found',
          message: 'GitHub 上找不到该 Issue 或 Pull Request',
        }
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After')
        const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 60
        return {
          type: 'rate_limited',
          message: 'GitHub API 速率限制已达上限，请稍后重试',
          retryAfter: Math.min(retryAfter, 3600), // bounded retry-after
        }
      }

      if (response.status >= 500) {
        return {
          type: 'temporarily_unavailable',
          message: 'GitHub 服务暂时不可用，请稍后重试',
        }
      }

      if (!response.ok) {
        return {
          type: 'temporarily_unavailable',
          message: `GitHub API 请求失败 (${response.status})`,
        }
      }

      const data = (await response.json()) as Record<string, unknown>

      // 白名单投影：只提取允许的字段
      const title = typeof data.title === 'string' ? data.title : ''
      const state = typeof data.state === 'string' ? data.state : 'unknown'
      const htmlUrl = typeof data.html_url === 'string' ? data.html_url : ''
      const merged =
        locator.kind === 'pull_request'
          ? typeof data.merged === 'boolean'
            ? data.merged
            : false
          : undefined

      // 映射 canonical status
      let status: GitHubSnapshot['status']
      if (state === 'open') {
        status = 'open'
      } else if (state === 'closed') {
        status = merged ? 'merged' : 'closed'
      } else if (state === 'draft') {
        status = 'draft'
      } else {
        status = 'unknown'
      }

      return {
        type: 'refreshed',
        snapshot: {
          status,
          title,
          safeUrl: htmlUrl,
          observedAt: new Date().toISOString(),
          isMerged: merged,
        },
      }
    } catch (error) {
      return {
        type: 'temporarily_unavailable',
        message: 'GitHub 请求失败，请稍后重试',
      }
    }
  }

  /**
   * 真实 GitHub check-runs 拉取（受授权门控，默认不联网）。
   * 两跳：先取 PR head sha，再取该 commit 的 check-runs；只回传原始 payload 交 projector。
   */
  async fetchCiSummary(locator: GitHubLinkLocator, accessToken: string): Promise<GitHubCiResult> {
    if (locator.kind === 'issue') {
      return { type: 'no_ci', message: 'Issue 无关联 CI/check' }
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'aiproj-github-readonly',
    }
    const owner = encodeURIComponent(locator.owner)
    const repo = encodeURIComponent(locator.repo)

    try {
      const prResp = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${locator.number}`,
        {
          headers,
        },
      )
      const prError = this.mapCiHttpError(prResp)
      if (prError) return prError

      const prData = (await prResp.json()) as Record<string, unknown>
      const head = prData.head as Record<string, unknown> | undefined
      const sha = head && typeof head.sha === 'string' ? head.sha : ''
      if (!sha) return { type: 'no_ci', message: '无法确定 PR head 提交' }

      const checksResp = await fetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}/check-runs`,
        { headers },
      )
      const checksError = this.mapCiHttpError(checksResp)
      if (checksError) return checksError

      const payload = (await checksResp.json()) as Record<string, unknown>
      return { type: 'ci', kind: 'checks', payload }
    } catch {
      return { type: 'temporarily_unavailable', message: 'GitHub 请求失败，请稍后重试' }
    }
  }

  private mapCiHttpError(response: Response): GitHubCiResult | null {
    if (response.status === 401) {
      return { type: 'reauthorization_required', message: 'GitHub token 无效或已过期，请重新授权' }
    }
    if (response.status === 403) {
      if (response.headers.get('X-RateLimit-Remaining') === '0') {
        const resetHeader = response.headers.get('X-RateLimit-Reset')
        const retryAfterSeconds = resetHeader
          ? Math.max(0, Number.parseInt(resetHeader, 10) - Math.floor(Date.now() / 1000))
          : 60
        return {
          type: 'rate_limited',
          message: 'GitHub API 速率限制已达上限，请稍后重试',
          retryAfter: Math.min(retryAfterSeconds, 3600),
        }
      }
      return { type: 'forbidden', message: '无权访问该仓库的 CI 状态' }
    }
    if (response.status === 404) {
      return { type: 'not_found', message: 'GitHub 上找不到该 Pull Request 或提交' }
    }
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After')
      const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 60
      return {
        type: 'rate_limited',
        message: 'GitHub API 速率限制已达上限，请稍后重试',
        retryAfter: Math.min(retryAfter, 3600),
      }
    }
    if (response.status >= 500) {
      return { type: 'temporarily_unavailable', message: 'GitHub 服务暂时不可用，请稍后重试' }
    }
    if (!response.ok) {
      return {
        type: 'temporarily_unavailable',
        message: `GitHub API 请求失败 (${response.status})`,
      }
    }
    return null
  }
}
