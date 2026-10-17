/**
 * v2-5-code-repository-ci-status-display —— provider-specific CI/check 投影器。
 *
 * 职责（设计 D2）：把 GitHub checks/statuses、GitLab pipeline 的原始 provider payload
 * 或安全 webhook 事件投影为 provider-neutral 的白名单 `CodeRepositoryCiSummary`。
 *
 * 红线（设计 D2/D3 + spec 脱敏要求）：
 * - 只提取白名单字段（状态、结论、低敏名称、已验证 checks URL）。
 * - 绝不把 token、Authorization、workflow log、artifact、commit diff、仓库文件、
 *   私有评论、完整 payload 带入 DTO、错误或日志。
 * - targetUrl 必须匹配 provider host 且为 https，否则置空。
 * - webhook/refresh 事件必须绑定已存链接 locator（provider/repo/number），不匹配不投影。
 */

import {
  type CodeRepositoryCiSummary,
  type CiSummaryState,
  type CiSummarySource,
  CI_SUMMARY_LABEL_MAX,
  CI_SUMMARY_CONCLUSION_MAX,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 对象绑定 locator（只来自服务端已存链接字段）
// ---------------------------------------------------------------------------

export interface CiEventLocator {
  provider: 'github' | 'gitlab'
  repositoryOwner: string
  repositoryName: string
  externalNumber: number
  linkType: string
}

export interface CiProjectionContext {
  /** provider-neutral 来源通道 */
  source: CiSummarySource
  /** 允许的 provider host（targetUrl allowlist），如 'github.com' */
  allowedHost: string
  /** 观测时间 ISO */
  observedAt: string
}

// ---------------------------------------------------------------------------
// GitHub Check Runs 投影（GET .../commits/:ref/check-runs）
// ---------------------------------------------------------------------------

/** GitHub check-run 状态权重（值越小越优先聚合，failed 优先）。 */
function aggregateGithubChecks(runs: unknown[]): {
  state: CiSummaryState
  conclusion: string | null
  label: string | null
  targetUrl: string | null
} {
  let hasFailure = false
  let hasRunning = false
  let hasCancelled = false
  let allCompletedOk = runs.length > 0
  let firstFailingName: string | null = null
  let firstRunUrl: string | null = null

  for (const item of runs) {
    if (!item || typeof item !== 'object') continue
    const run = item as Record<string, unknown>
    const status = typeof run.status === 'string' ? run.status : ''
    const conclusion = typeof run.conclusion === 'string' ? run.conclusion : ''
    const name = typeof run.name === 'string' ? run.name : ''
    const url =
      typeof run.html_url === 'string'
        ? run.html_url
        : typeof run.details_url === 'string'
          ? run.details_url
          : ''

    if (firstRunUrl === null && url) firstRunUrl = url

    if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(conclusion)) {
      hasFailure = true
      allCompletedOk = false
      if (firstFailingName === null && name) firstFailingName = name
    } else if (conclusion === 'cancelled') {
      hasCancelled = true
      allCompletedOk = false
    } else if (['queued', 'in_progress', 'pending', 'waiting', 'requested'].includes(status)) {
      hasRunning = true
      allCompletedOk = false
    } else if (status === 'completed' && ['success', 'neutral', 'skipped'].includes(conclusion)) {
      // ok
    } else {
      allCompletedOk = false
    }
  }

  let state: CiSummaryState
  let conclusion: string | null
  let label: string | null
  if (hasFailure) {
    state = 'failed'
    conclusion = 'failure'
    label = firstFailingName ?? 'CI'
  } else if (hasRunning) {
    state = 'running'
    conclusion = 'in_progress'
    label = 'CI'
  } else if (allCompletedOk) {
    state = 'passed'
    conclusion = 'success'
    label = 'CI'
  } else if (hasCancelled) {
    state = 'cancelled'
    conclusion = 'cancelled'
    label = 'CI'
  } else {
    state = 'unknown'
    conclusion = null
    label = null
  }

  return { state, conclusion, label, targetUrl: firstRunUrl }
}

/**
 * 投影 GitHub check-runs 列表 payload（白名单）。
 * 传入的 raw 可能包含 output/logs/app 等敏感字段——本函数只读白名单字段。
 */
export function projectGithubChecks(
  raw: unknown,
  ctx: CiProjectionContext,
): CodeRepositoryCiSummary {
  const runs = extractArray(raw, 'check_runs')
  if (runs.length === 0) {
    return baseSummary('unknown', ctx, {
      conclusion: null,
      label: null,
      targetUrl: null,
      reasonCode: 'no_ci',
    })
  }
  const agg = aggregateGithubChecks(runs)
  return baseSummary(agg.state, ctx, {
    conclusion: agg.conclusion,
    label: agg.label,
    targetUrl: agg.targetUrl,
    reasonCode: 'ok',
  })
}

// ---------------------------------------------------------------------------
// GitHub Combined Status 投影（GET .../commits/:ref/status）
// ---------------------------------------------------------------------------

export function projectGithubStatus(
  raw: unknown,
  ctx: CiProjectionContext,
): CodeRepositoryCiSummary {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const state = typeof obj.state === 'string' ? obj.state : ''
  let mapped: CiSummaryState
  let conclusion: string | null
  switch (state) {
    case 'success':
      mapped = 'passed'
      conclusion = 'success'
      break
    case 'failure':
    case 'error':
      mapped = 'failed'
      conclusion = 'failure'
      break
    case 'pending':
      mapped = 'pending'
      conclusion = 'pending'
      break
    default:
      mapped = 'unknown'
      conclusion = null
  }
  const targetUrl = typeof obj.target_url === 'string' ? obj.target_url : null
  return baseSummary(mapped, ctx, {
    conclusion,
    label: mapped === 'unknown' ? null : 'Status',
    targetUrl,
    reasonCode: mapped === 'unknown' ? 'no_ci' : 'ok',
  })
}

// ---------------------------------------------------------------------------
// GitLab Pipeline 投影（GET .../merge_requests/:iid/pipelines 最新一条 或 pipeline 对象）
// ---------------------------------------------------------------------------

export function projectGitlabPipeline(
  raw: unknown,
  ctx: CiProjectionContext,
): CodeRepositoryCiSummary {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const status = typeof obj.status === 'string' ? obj.status : ''
  let mapped: CiSummaryState
  let conclusion: string | null
  switch (status) {
    case 'success':
      mapped = 'passed'
      conclusion = 'success'
      break
    case 'failed':
      mapped = 'failed'
      conclusion = 'failed'
      break
    case 'running':
      mapped = 'running'
      conclusion = 'running'
      break
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'pending':
    case 'scheduled':
      mapped = 'pending'
      conclusion = 'pending'
      break
    case 'canceled':
    case 'cancelled':
      mapped = 'cancelled'
      conclusion = 'canceled'
      break
    case '':
      mapped = 'unknown'
      conclusion = null
      break
    default:
      // skipped / manual / 其他 → 无明确结论
      mapped = 'unknown'
      conclusion = null
  }
  const targetUrl = typeof obj.web_url === 'string' ? obj.web_url : null
  return baseSummary(mapped, ctx, {
    conclusion,
    label: mapped === 'unknown' ? null : 'Pipeline',
    targetUrl,
    reasonCode: mapped === 'unknown' ? 'no_ci' : 'ok',
  })
}

// ---------------------------------------------------------------------------
// Webhook CI 事件投影（低敏白名单字段 + 对象绑定）
// ---------------------------------------------------------------------------

/** 安全 webhook CI 事件（只含白名单字段，调用方在解析原始 body 时已脱敏）。 */
export interface WebhookCiEvent {
  provider: 'github' | 'gitlab'
  eventType: string
  /** "owner/repo"（github）或 "group/project"（gitlab） */
  repositoryFullName?: string
  /** 关联 PR/MR 编号 */
  externalNumber?: number
  /** provider 原始状态 */
  status?: string
  /** provider 原始结论 */
  conclusion?: string
  /** 低敏名称（check suite / pipeline 名） */
  name?: string
  /** checks/pipeline 页面 URL */
  targetUrl?: string
  /** 事件观测时间 ISO */
  observedAt?: string
}

/**
 * 判断 CI 事件对象是否绑定到已存链接 locator。
 * 要求 provider、repository（owner/name）、externalNumber 全部匹配。
 * 缺失编号（无法安全绑定到具体 PR/MR）视为不匹配。
 */
export function ciEventMatchesLink(event: WebhookCiEvent, link: CiEventLocator): boolean {
  if (event.provider !== link.provider) return false
  const expectedRepo = `${link.repositoryOwner}/${link.repositoryName}`
  if (!event.repositoryFullName || event.repositoryFullName !== expectedRepo) return false
  if (typeof event.externalNumber !== 'number' || event.externalNumber !== link.externalNumber) {
    return false
  }
  return true
}

/**
 * 投影 webhook CI 事件为 summary，并强制对象绑定。
 * 不匹配 locator 时返回 { matched: false, summary: null }，调用方不得更新链接。
 */
export function projectWebhookCiEvent(
  event: WebhookCiEvent,
  link: CiEventLocator,
  allowedHost: string,
): { matched: boolean; summary: CodeRepositoryCiSummary | null } {
  if (!ciEventMatchesLink(event, link)) {
    return { matched: false, summary: null }
  }

  const ctx: CiProjectionContext = {
    source: 'webhook',
    allowedHost,
    observedAt: event.observedAt ?? new Date().toISOString(),
  }

  // 复用 provider 语义映射
  if (event.provider === 'github') {
    // 用 check_suite 语义：status（queued/in_progress/completed）+ conclusion
    const runs = [
      {
        status: event.status,
        conclusion: event.conclusion,
        name: event.name,
        html_url: event.targetUrl,
      },
    ]
    const agg = aggregateGithubChecks(runs)
    return {
      matched: true,
      summary: baseSummary(agg.state, ctx, {
        conclusion: agg.conclusion,
        label: agg.label,
        targetUrl: agg.targetUrl,
        reasonCode: agg.state === 'unknown' ? 'no_ci' : 'ok',
      }),
    }
  }

  // gitlab pipeline 事件
  const summary = projectGitlabPipeline({ status: event.status, web_url: event.targetUrl }, ctx)
  if (event.name) {
    summary.label = sanitizeLabel(event.name, CI_SUMMARY_LABEL_MAX) ?? summary.label
  }
  return { matched: true, summary }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function extractArray(raw: unknown, key: string): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const v = (raw as Record<string, unknown>)[key]
    if (Array.isArray(v)) return v
  }
  return []
}

function baseSummary(
  state: CiSummaryState,
  ctx: CiProjectionContext,
  fields: {
    conclusion: string | null
    label: string | null
    targetUrl: string | null
    reasonCode: CodeRepositoryCiSummary['reasonCode']
  },
): CodeRepositoryCiSummary {
  return {
    state,
    conclusion: sanitizeLabel(fields.conclusion, CI_SUMMARY_CONCLUSION_MAX),
    label: sanitizeLabel(fields.label, CI_SUMMARY_LABEL_MAX),
    source: ctx.source,
    targetUrl: sanitizeCiUrl(fields.targetUrl, ctx.allowedHost),
    observedAt: ctx.observedAt,
    updatedAt: ctx.observedAt,
    reasonCode: fields.reasonCode,
    isStale: false,
  }
}

function sanitizeLabel(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

/**
 * 只接受 https 且 host 严格等于 allowedHost 的 URL；query/fragment 剥离以防敏感参数泄露。
 */
function sanitizeCiUrl(value: string | null | undefined, allowedHost: string): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:') return null
    if (url.hostname !== allowedHost) return null
    // 剥离 query/fragment（可能带 token 或敏感参数）
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}
