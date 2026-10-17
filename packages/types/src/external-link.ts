/**
 * v2-github-gitlab-light-links —— GitHub/GitLab 轻量外部链接共享契约。
 *
 * 定义 provider、link type、status、status source、refresh result、DTO 和请求/
 * 响应 payload 类型，供前后端共享。
 *
 * 非目标：不做代码托管、Webhook 同步、外部写回或真实 token 交换。
 */

import type { CodeRepositoryCiSummary } from './code-repository-ci.js'

// ---------------------------------------------------------------------------
// Provider 枚举
// ---------------------------------------------------------------------------

export const EXTERNAL_LINK_PROVIDERS = ['github', 'gitlab'] as const
export type ExternalLinkProvider = (typeof EXTERNAL_LINK_PROVIDERS)[number]

/** GitHub 和 GitLab provider 统一常量（用于集成 provider registry 扩展）。 */
export const CODE_REPOSITORY_PROVIDERS: ExternalLinkProvider[] = ['github', 'gitlab']

// ---------------------------------------------------------------------------
// Link type 枚举
// ---------------------------------------------------------------------------

export const EXTERNAL_LINK_TYPES = ['issue', 'pull_request', 'merge_request'] as const
export type ExternalLinkType = (typeof EXTERNAL_LINK_TYPES)[number]

export const EXTERNAL_LINK_TYPE_LABELS: Record<ExternalLinkType, string> = {
  issue: 'Issue',
  pull_request: 'Pull Request',
  merge_request: 'Merge Request',
}

// ---------------------------------------------------------------------------
// 外部状态枚举（轻量映射，不做真实状态机）
// ---------------------------------------------------------------------------

export const EXTERNAL_LINK_STATUSES = [
  'open',
  'closed',
  'merged',
  'locked',
  'draft',
  'unknown',
] as const
export type ExternalLinkStatus = (typeof EXTERNAL_LINK_STATUSES)[number]

/** 状态排序权重（用于前端排序展示）。值越小越靠前。 */
export const EXTERNAL_LINK_STATUS_ORDER: Record<ExternalLinkStatus, number> = {
  open: 0,
  draft: 1,
  merged: 2,
  locked: 3,
  closed: 4,
  unknown: 99,
}

export const EXTERNAL_LINK_STATUS_LABELS: Record<ExternalLinkStatus, string> = {
  open: 'Open',
  closed: 'Closed',
  merged: 'Merged',
  locked: 'Locked',
  draft: 'Draft',
  unknown: '未知',
}

// ---------------------------------------------------------------------------
// 状态来源枚举
// ---------------------------------------------------------------------------

export const EXTERNAL_LINK_STATUS_SOURCES = [
  'manual',
  'pre_connection_only',
  'not_configured',
  'refresh_success',
  'refresh_degraded',
  'readonly_connection_ready',
  'github_readonly',
  'gitlab_readonly',
  'connection_required',
  'reauthorization_required',
  'not_found',
  'forbidden',
  'rate_limited',
  'temporarily_unavailable',
  'unsupported_link',
] as const
export type ExternalLinkStatusSource = (typeof EXTERNAL_LINK_STATUS_SOURCES)[number]

// ---------------------------------------------------------------------------
// Refresh 结果枚举
// ---------------------------------------------------------------------------

export const EXTERNAL_LINK_REFRESH_RESULTS = [
  'not_configured',
  'pre_connection_only',
  'success',
  'degraded',
  'readonly_connection_ready',
  'connection_required',
  'reauthorization_required',
  'not_found',
  'forbidden',
  'rate_limited',
  'temporarily_unavailable',
  'unsupported_link',
] as const
export type ExternalLinkRefreshResult = (typeof EXTERNAL_LINK_REFRESH_RESULTS)[number]

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function isValidExternalLinkProvider(v: string): v is ExternalLinkProvider {
  return EXTERNAL_LINK_PROVIDERS.includes(v as ExternalLinkProvider)
}

export function isValidExternalLinkType(v: string): v is ExternalLinkType {
  return EXTERNAL_LINK_TYPES.includes(v as ExternalLinkType)
}

export function isValidExternalLinkStatus(v: string): v is ExternalLinkStatus {
  return EXTERNAL_LINK_STATUSES.includes(v as ExternalLinkStatus)
}

export function isValidExternalLinkStatusSource(v: string): v is ExternalLinkStatusSource {
  return EXTERNAL_LINK_STATUS_SOURCES.includes(v as ExternalLinkStatusSource)
}

export function isValidExternalLinkRefreshResult(v: string): v is ExternalLinkRefreshResult {
  return EXTERNAL_LINK_REFRESH_RESULTS.includes(v as ExternalLinkRefreshResult)
}

// ---------------------------------------------------------------------------
// DTO 定义
// ---------------------------------------------------------------------------

/** 外部链接 DTO（返回给前端/API 消费者）。 */
export interface ExternalLinkDto {
  id: number
  provider: ExternalLinkProvider
  linkType: ExternalLinkType
  repositoryOwner: string
  repositoryName: string
  externalNumber: number
  externalId: string | null
  externalTitle: string | null
  externalStatus: ExternalLinkStatus
  externalUrl: string
  statusSource: ExternalLinkStatusSource
  lastObservedAt: string | null
  note: string | null
  /**
   * v2-5-code-repository-ci-status-display —— 只读低敏 CI/check 状态摘要。
   * 旧链接或无 CI 数据时为 null；旧消费者可忽略该字段。
   */
  ciSummary?: CodeRepositoryCiSummary | null
  createdAt: string
  updatedAt: string
  createdBy: number
  updatedBy: number
}

/** 外部链接摘要（用于任务详情 include/preload）。低敏，不含 metadata。 */
export interface ExternalLinkSummary {
  id: number
  provider: ExternalLinkProvider
  linkType: ExternalLinkType
  repositoryOwner: string
  repositoryName: string
  externalNumber: number
  externalTitle: string | null
  externalStatus: ExternalLinkStatus
  externalUrl: string
  statusSource: ExternalLinkStatusSource
  lastObservedAt: string | null
  /** v2-5-code-repository-ci-status-display —— 只读低敏 CI/check 状态摘要，旧链接为 null。 */
  ciSummary?: CodeRepositoryCiSummary | null
}

// ---------------------------------------------------------------------------
// Request / Response payloads
// ---------------------------------------------------------------------------

export interface CreateExternalLinkRequest {
  provider: ExternalLinkProvider
  linkType: ExternalLinkType
  repositoryOwner: string
  repositoryName: string
  externalNumber: number
  externalId?: string | null
  externalTitle?: string | null
  externalStatus: ExternalLinkStatus
  externalUrl: string
  note?: string | null
}

export interface UpdateExternalLinkRequest {
  externalTitle?: string | null
  externalStatus?: ExternalLinkStatus
  note?: string | null
}

export interface RefreshExternalLinkResponse {
  id: number
  previousStatus: ExternalLinkStatus | null
  previousStatusSource: ExternalLinkStatusSource | null
  result: ExternalLinkRefreshResult
  message: string
  retryAfter?: number
  /**
   * v2-5-code-repository-ci-status-display —— 刷新后的 CI/check 摘要（成功刷新时可能更新，
   * 失败时保留既有摘要）。旧消费者可忽略。
   */
  ciSummary?: CodeRepositoryCiSummary | null
}

export interface ExternalLinkListResponse {
  data: ExternalLinkDto[]
}

// ---------------------------------------------------------------------------
// Audit / Activity event metadata（低敏，不含 secrets、token 或完整外部 payload）
// ---------------------------------------------------------------------------

export interface ExternalLinkAuditEventMeta {
  provider: ExternalLinkProvider
  linkType: ExternalLinkType
  repositoryOwner: string
  repositoryName: string
  externalNumber: number
  externalStatus?: ExternalLinkStatus
  statusSource?: ExternalLinkStatusSource
  taskId?: number
  /**
   * v2-5-code-repository-ci-status-display —— 低敏 CI 审计元数据（仅前后状态/来源/reason/观测时间，
   * 不含 token、完整 payload、log、artifact、diff 或私有评论）。
   */
  ciPreviousState?: string | null
  ciNewState?: string | null
  ciSource?: string | null
  ciReasonCode?: string | null
  ciObservedAt?: string | null
}

// ---------------------------------------------------------------------------
// Search result payload（低敏，用于高级搜索结果）
// ---------------------------------------------------------------------------

export interface ExternalLinkSearchResultMeta {
  provider: ExternalLinkProvider
  linkType: ExternalLinkType
  repositoryOwner: string
  repositoryName: string
  externalNumber: number
  externalStatus: ExternalLinkStatus
  linkedTaskTitle: string
  linkedTaskId: number
}
