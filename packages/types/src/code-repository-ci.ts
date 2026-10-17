/**
 * v2-5-code-repository-ci-status-display —— 代码仓库 CI/check 状态摘要共享契约（前后端）。
 *
 * 只读、低敏、provider-neutral：把已关联 GitHub/GitLab Issue/PR/MR 背后的 CI/check
 * 结果收敛为稳定状态枚举、结论标签、来源、reason code、观测时间和 stale 标记。
 *
 * 非目标（红线）：不承载 token、Authorization、workflow log、artifact、commit diff、
 * 仓库文件、私有评论或完整 provider payload；不驱动任务事实变化；不触发/重跑外部 CI。
 */

// ---------------------------------------------------------------------------
// CI/check 状态枚举（provider-neutral）
// ---------------------------------------------------------------------------

export const CI_SUMMARY_STATES = [
  'passed',
  'failed',
  'running',
  'pending',
  'cancelled',
  'unknown',
  'not_configured',
  'needs_reauthorization',
  'unavailable',
] as const
export type CiSummaryState = (typeof CI_SUMMARY_STATES)[number]

export const CI_SUMMARY_STATE_LABELS: Record<CiSummaryState, string> = {
  passed: '通过',
  failed: '失败',
  running: '运行中',
  pending: '等待中',
  cancelled: '已取消',
  unknown: '未知',
  not_configured: '未配置',
  needs_reauthorization: '需重新授权',
  unavailable: '暂不可用',
}

/**
 * 状态排序权重（值越小越靠前，用于前端展示与「需要关注」排序）。
 * 失败/需关注态排前，通过/终态其次，未知/降级态最后。
 */
export const CI_SUMMARY_STATE_ORDER: Record<CiSummaryState, number> = {
  failed: 0,
  needs_reauthorization: 1,
  running: 2,
  pending: 3,
  cancelled: 4,
  passed: 5,
  unavailable: 6,
  not_configured: 7,
  unknown: 99,
}

// ---------------------------------------------------------------------------
// 来源枚举（provider-neutral，标识 CI 数据从哪个只读通道观测）
// ---------------------------------------------------------------------------

export const CI_SUMMARY_SOURCES = [
  'github_checks',
  'github_status',
  'gitlab_pipeline',
  'webhook',
  'manual',
  'none',
] as const
export type CiSummarySource = (typeof CI_SUMMARY_SOURCES)[number]

export const CI_SUMMARY_SOURCE_LABELS: Record<CiSummarySource, string> = {
  github_checks: 'GitHub Checks',
  github_status: 'GitHub Status',
  gitlab_pipeline: 'GitLab Pipeline',
  webhook: 'Webhook 事件',
  manual: '手动',
  none: '无',
}

// ---------------------------------------------------------------------------
// reason code（稳定，解释成功/失败/降级；不含敏感信息）
// ---------------------------------------------------------------------------

export const CI_SUMMARY_REASON_CODES = [
  'ok',
  'no_ci',
  'not_configured',
  'connection_required',
  'needs_reauthorization',
  'not_found',
  'forbidden',
  'rate_limited',
  'temporarily_unavailable',
  'unsupported_link',
  'stale',
] as const
export type CiSummaryReasonCode = (typeof CI_SUMMARY_REASON_CODES)[number]

// ---------------------------------------------------------------------------
// 字段长度上限（防止超长/敏感内容注入）
// ---------------------------------------------------------------------------

export const CI_SUMMARY_LABEL_MAX = 100
export const CI_SUMMARY_CONCLUSION_MAX = 60

// ---------------------------------------------------------------------------
// DTO —— 低敏 CI/check 状态摘要
// ---------------------------------------------------------------------------

export interface CodeRepositoryCiSummary {
  /** provider-neutral 状态枚举 */
  state: CiSummaryState
  /** 低敏结论标签（如 'success' / 'failure' / 'timed_out'），来自白名单映射，可空 */
  conclusion: string | null
  /** 低敏名称（如 'CI' / 'build' / check suite 名），已 sanitize + 截断，可空 */
  label: string | null
  /** 观测来源通道 */
  source: CiSummarySource
  /** 已验证的 checks 页 URL（同 provider host、https），可空 */
  targetUrl: string | null
  /** 最近观测到 CI 状态的时间（ISO），可空 */
  observedAt: string | null
  /** 最近落库时间（ISO），可空 */
  updatedAt: string | null
  /** 稳定 reason code */
  reasonCode: CiSummaryReasonCode
  /** 是否已陈旧（超过新鲜度窗口或被更新观测标记） */
  isStale: boolean
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function isValidCiSummaryState(v: string): v is CiSummaryState {
  return CI_SUMMARY_STATES.includes(v as CiSummaryState)
}

export function isValidCiSummarySource(v: string): v is CiSummarySource {
  return CI_SUMMARY_SOURCES.includes(v as CiSummarySource)
}

export function isValidCiSummaryReasonCode(v: string): v is CiSummaryReasonCode {
  return CI_SUMMARY_REASON_CODES.includes(v as CiSummaryReasonCode)
}

// ---------------------------------------------------------------------------
// 状态语义辅助
// ---------------------------------------------------------------------------

/** 成功态（CI 通过）。 */
export function isCiSuccessState(state: CiSummaryState): boolean {
  return state === 'passed'
}

/** 失败态（CI 失败，需要用户关注）。 */
export function isCiFailureState(state: CiSummaryState): boolean {
  return state === 'failed'
}

/** 终态（不会再自然流转的结论态）。 */
export function isCiTerminalState(state: CiSummaryState): boolean {
  return state === 'passed' || state === 'failed' || state === 'cancelled'
}

/** 降级态（因连接/配置/限流/网络等原因无法得到真实结论）。 */
export function isCiDegradedState(state: CiSummaryState): boolean {
  return (
    state === 'not_configured' ||
    state === 'needs_reauthorization' ||
    state === 'unavailable' ||
    state === 'unknown'
  )
}

// ---------------------------------------------------------------------------
// 序列化 / 解析降级
// ---------------------------------------------------------------------------

/**
 * 从任意（可能来自旧数据、旧 API 或被污染的 metadata）输入安全解析出
 * CodeRepositoryCiSummary。未知字段丢弃、非法枚举降级为安全默认、超长文本截断、
 * 非 https targetUrl 置空。无法解析（null/非对象/缺 state）时返回 null，
 * 使旧链接的空 ciSummary 与前端旧消费者继续正常工作。
 */
export function parseCiSummary(raw: unknown): CodeRepositoryCiSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>

  const stateRaw = typeof obj.state === 'string' ? obj.state : ''
  if (!stateRaw) return null
  const state: CiSummaryState = isValidCiSummaryState(stateRaw) ? stateRaw : 'unknown'

  const sourceRaw = typeof obj.source === 'string' ? obj.source : ''
  const source: CiSummarySource = isValidCiSummarySource(sourceRaw) ? sourceRaw : 'none'

  const reasonRaw = typeof obj.reasonCode === 'string' ? obj.reasonCode : ''
  const reasonCode: CiSummaryReasonCode = isValidCiSummaryReasonCode(reasonRaw) ? reasonRaw : 'ok'

  const conclusion = sanitizeLabel(obj.conclusion, CI_SUMMARY_CONCLUSION_MAX)
  const label = sanitizeLabel(obj.label, CI_SUMMARY_LABEL_MAX)
  const targetUrl = sanitizeHttpsUrl(obj.targetUrl)
  const observedAt = sanitizeIso(obj.observedAt)
  const updatedAt = sanitizeIso(obj.updatedAt)
  const isStale = obj.isStale === true

  return { state, conclusion, label, source, targetUrl, observedAt, updatedAt, reasonCode, isStale }
}

/** 从 reason code 构造降级摘要（无真实结论时使用）。 */
export function ciSummaryFromReason(
  state: CiSummaryState,
  reasonCode: CiSummaryReasonCode,
  source: CiSummarySource = 'none',
  observedAt: string | null = null,
): CodeRepositoryCiSummary {
  return {
    state,
    conclusion: null,
    label: null,
    source,
    targetUrl: null,
    observedAt,
    updatedAt: observedAt,
    reasonCode,
    isStale: false,
  }
}

/**
 * 判断 incoming 摘要是否应替换 existing。
 *
 * 时间优先：更新的观测覆盖旧观测；旧观测（如迟到的失败 webhook 事件）不覆盖较新成功摘要。
 * 观测时间相等时按状态权重决定（成功/终态优先于 running/pending），并对完全相同的重复事件保持幂等（不替换）。
 */
export function shouldReplaceCiSummary(
  existing: CodeRepositoryCiSummary | null,
  incoming: CodeRepositoryCiSummary,
): boolean {
  if (!existing) return true

  const existingTime = existing.observedAt ? Date.parse(existing.observedAt) : NaN
  const incomingTime = incoming.observedAt ? Date.parse(incoming.observedAt) : NaN

  const eHas = !Number.isNaN(existingTime)
  const iHas = !Number.isNaN(incomingTime)

  if (iHas && eHas) {
    if (incomingTime > existingTime) return true
    if (incomingTime < existingTime) return false
    // 同一观测时间：终态优先级更高者替换；相等则幂等（不替换）
    return CI_SUMMARY_STATE_ORDER[incoming.state] < CI_SUMMARY_STATE_ORDER[existing.state]
  }

  // incoming 有时间、existing 无时间 → 用 incoming
  if (iHas && !eHas) return true
  // incoming 无时间、existing 有时间 → 保留 existing（不用无时间的观测覆盖有时间的）
  if (!iHas && eHas) return false
  // 两者都无时间 → 幂等，不替换
  return false
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function sanitizeLabel(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

function sanitizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('https://')) return null
  return trimmed
}

function sanitizeIso(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (Number.isNaN(Date.parse(trimmed))) return null
  return trimmed
}
