/**
 * v2-github-gitlab-light-links —— URL 规范化和 allowlist 校验。
 *
 * 设计 D4: provider allowlist + 规范化。
 * GitHub 默认允许 github.com; GitLab 默认允许 gitlab.com（含自定义 base URL）。
 * 禁止 javascript:、file:、内网探测 URL、缺少 host 的 URL 和 provider 不匹配的 URL。
 */

import env from '#start/env'

// ---------------------------------------------------------------------------
// 定义
// ---------------------------------------------------------------------------

export interface NormalizedUrlParts {
  owner: string
  repo: string
  type: 'issue' | 'pull_request' | 'merge_request'
  number: number
  normalizedUrl: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
  normalized?: NormalizedUrlParts
}

// ---------------------------------------------------------------------------
// GitHub URL 模式
// ---------------------------------------------------------------------------

const GITHUB_ISSUE_PATTERN =
  /^https:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/issues\/(\d+)$/
const GITHUB_PR_PATTERN =
  /^https:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/pull\/(\d+)$/

// ---------------------------------------------------------------------------
// GitLab URL 模式（gitlab.com + 自托管）
// ---------------------------------------------------------------------------

const GITLAB_ISSUE_PATTERN = /^https:\/\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9.\/_ -]+)\/-\/issues\/(\d+)$/
const GITLAB_MR_PATTERN =
  /^https:\/\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9.\/_ -]+)\/-\/merge_requests\/(\d+)$/

// ---------------------------------------------------------------------------
// 允许的 scheme 白名单
// ---------------------------------------------------------------------------

const ALLOWED_SCHEMES = ['https:']

// ---------------------------------------------------------------------------
// 安全的 GitLab host（gitlab.com 始终可用）
// ---------------------------------------------------------------------------

function allowedGitLabHosts(): string[] {
  const defaultHost = 'gitlab.com'
  const customBaseUrl = env.get('GITLAB_BASE_URL')
  if (customBaseUrl) {
    try {
      const parsed = new URL(customBaseUrl)
      return [defaultHost, parsed.hostname]
    } catch {
      return [defaultHost]
    }
  }
  return [defaultHost]
}

// ---------------------------------------------------------------------------
// 核心函数：校验并规范化 GitHub URL
// ---------------------------------------------------------------------------

function validateGitHubUrl(urlStr: string): ValidationResult {
  // 检查 scheme
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    return { valid: false, error: 'URL 格式无效' }
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return { valid: false, error: `不支持的 URL 协议: ${parsed.protocol}` }
  }

  if (parsed.hostname !== 'github.com') {
    return { valid: false, error: 'GitHub provider 只允许 github.com URL' }
  }

  // 匹配 Issue 模式
  const issueMatch = urlStr.match(GITHUB_ISSUE_PATTERN)
  if (issueMatch) {
    const [, owner, repo, num] = issueMatch
    return {
      valid: true,
      normalized: {
        owner,
        repo,
        type: 'issue',
        number: Number.parseInt(num, 10),
        normalizedUrl: urlStr,
      },
    }
  }

  // 匹配 PR 模式
  const prMatch = urlStr.match(GITHUB_PR_PATTERN)
  if (prMatch) {
    const [, owner, repo, num] = prMatch
    return {
      valid: true,
      normalized: {
        owner,
        repo,
        type: 'pull_request',
        number: Number.parseInt(num, 10),
        normalizedUrl: urlStr,
      },
    }
  }

  return { valid: false, error: 'GitHub URL 必须是 Issue 或 Pull Request 格式' }
}

// ---------------------------------------------------------------------------
// 核心函数：校验并规范化 GitLab URL
// ---------------------------------------------------------------------------

function validateGitLabUrl(urlStr: string): ValidationResult {
  // 检查 scheme
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    return { valid: false, error: 'URL 格式无效' }
  }

  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return { valid: false, error: `不支持的 URL 协议: ${parsed.protocol}` }
  }

  const allowedHosts = allowedGitLabHosts()
  if (!allowedHosts.includes(parsed.hostname)) {
    return {
      valid: false,
      error: `GitLab provider 只允许 gitlab.com${allowedHosts.length > 1 ? ' 或已配置的自托管 base URL' : ''} URL`,
    }
  }

  // 匹配 Issue 模式
  const issueMatch = urlStr.match(GITLAB_ISSUE_PATTERN)
  if (issueMatch) {
    const [, , path, num] = issueMatch
    const pathClean = path.replace(/\/$/, '')
    // Extract owner/repo from path
    const parts = pathClean.split('/').filter(Boolean)
    const number = Number.parseInt(num, 10)
    return {
      valid: true,
      normalized: {
        owner: parts[0] ?? '',
        repo: parts.slice(1).join('/'),
        type: 'issue',
        number,
        normalizedUrl: urlStr,
      },
    }
  }

  // 匹配 MR 模式
  const mrMatch = urlStr.match(GITLAB_MR_PATTERN)
  if (mrMatch) {
    const [, , path, num] = mrMatch
    const pathClean = path.replace(/\/$/, '')
    const parts = pathClean.split('/').filter(Boolean)
    const number = Number.parseInt(num, 10)
    return {
      valid: true,
      normalized: {
        owner: parts[0] ?? '',
        repo: parts.slice(1).join('/'),
        type: 'merge_request',
        number,
        normalizedUrl: urlStr,
      },
    }
  }

  return { valid: false, error: 'GitLab URL 必须是 Issue 或 Merge Request 格式' }
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 校验并规范化外部链接 URL。
 *
 * @param provider 外部链接 provider（'github' | 'gitlab'）
 * @param url 用户提交的 URL
 * @returns ValidationResult
 */
export function validateAndNormalizeUrl(provider: string, url: string): ValidationResult {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL 不能为空' }
  }

  const trimmed = url.trim()

  if (provider === 'github') {
    return validateGitHubUrl(trimmed)
  }

  if (provider === 'gitlab') {
    return validateGitLabUrl(trimmed)
  }

  return { valid: false, error: `不支持的 provider: ${provider}` }
}

/**
 * 检测外部 provider 类型（基于 URL host）。
 */
export function detectProviderFromUrl(url: string): 'github' | 'gitlab' | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'github.com') return 'github'
    if (parsed.hostname === 'gitlab.com') return 'gitlab'
    const customBaseUrl = env.get('GITLAB_BASE_URL')
    if (customBaseUrl) {
      try {
        const custom = new URL(customBaseUrl)
        if (parsed.hostname === custom.hostname) return 'gitlab'
      } catch {
        // ignore
      }
    }
    return null
  } catch {
    return null
  }
}
