import { apiFetch } from '@/lib/api-client'
import type {
  CreateExternalLinkRequest,
  ExternalLinkDto,
  RefreshExternalLinkResponse,
  UpdateExternalLinkRequest,
  CodeRepositoryCiSummary,
} from '@aiproj/types'
import { CI_SUMMARY_STATE_LABELS, CI_SUMMARY_SOURCE_LABELS } from '@aiproj/types'

/**
 * v2-github-gitlab-light-links —— 任务外部链接 API 客户端。
 * v2-5-github-linked-item-read-refresh —— 扩展刷新结果类型和状态处理。
 */

export const taskExternalLinkKeys = {
  all: ['task-external-links'] as const,
  list: (projectId: number, taskId: number) =>
    [...taskExternalLinkKeys.all, 'list', projectId, taskId] as const,
  detail: (projectId: number, taskId: number, linkId: number) =>
    [...taskExternalLinkKeys.all, 'detail', projectId, taskId, linkId] as const,
}

export const taskExternalLinksApi = {
  list: (projectId: number, taskId: number) =>
    apiFetch<ExternalLinkDto[]>(`/projects/${projectId}/tasks/${taskId}/external-links`),

  create: (projectId: number, taskId: number, data: CreateExternalLinkRequest) =>
    apiFetch<{ data: ExternalLinkDto }>(`/projects/${projectId}/tasks/${taskId}/external-links`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (projectId: number, taskId: number, linkId: number, data: UpdateExternalLinkRequest) =>
    apiFetch<{ data: ExternalLinkDto }>(
      `/projects/${projectId}/tasks/${taskId}/external-links/${linkId}`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),

  delete: (projectId: number, taskId: number, linkId: number) =>
    apiFetch<void>(`/projects/${projectId}/tasks/${taskId}/external-links/${linkId}`, {
      method: 'DELETE',
    }),

  refresh: (projectId: number, taskId: number, linkId: number) =>
    apiFetch<{ data: RefreshExternalLinkResponse }>(
      `/projects/${projectId}/tasks/${taskId}/external-links/${linkId}/refresh`,
      { method: 'POST' },
    ),
}

// ---------------------------------------------------------------------------
// 刷新结果类型和辅助函数
// ---------------------------------------------------------------------------

export type RefreshResultType =
  | 'success'
  | 'not_configured'
  | 'pre_connection_only'
  | 'readonly_connection_ready'
  | 'connection_required'
  | 'reauthorization_required'
  | 'not_found'
  | 'forbidden'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'unsupported_link'
  | 'degraded'

export interface RefreshResultInfo {
  type: RefreshResultType
  message: string
  isError: boolean
  isRetryable: boolean
  requiresReauthorization: boolean
  retryAfter?: number
}

/**
 * 将 API 刷新结果映射为前端可展示的状态信息。
 * 支持 GitHub 和 GitLab provider 感知消息。
 */
export function mapRefreshResult(
  result: RefreshExternalLinkResponse,
  provider?: string,
): RefreshResultInfo {
  const resultCode = result.result as RefreshResultType
  const isGitLab = provider === 'gitlab'

  switch (resultCode) {
    case 'success':
      return {
        type: resultCode,
        message: result.message || '链接状态已刷新',
        isError: false,
        isRetryable: false,
        requiresReauthorization: false,
      }
    case 'reauthorization_required':
      return {
        type: resultCode,
        message:
          result.message ||
          (isGitLab ? 'GitLab 授权已过期，请重新授权' : 'GitHub 授权已过期，请重新授权'),
        isError: true,
        isRetryable: false,
        requiresReauthorization: true,
      }
    case 'rate_limited':
      return {
        type: resultCode,
        message: result.message || '请求过于频繁，请稍后重试',
        isError: true,
        isRetryable: true,
        requiresReauthorization: false,
        retryAfter: result.retryAfter,
      }
    case 'not_found':
      return {
        type: resultCode,
        message:
          result.message ||
          (isGitLab ? '找不到该 Issue 或 Merge Request' : '找不到该 Issue 或 Pull Request'),
        isError: true,
        isRetryable: false,
        requiresReauthorization: false,
      }
    case 'forbidden':
      return {
        type: resultCode,
        message: result.message || '无权访问该仓库',
        isError: true,
        isRetryable: false,
        requiresReauthorization: false,
      }
    case 'temporarily_unavailable':
      return {
        type: resultCode,
        message:
          result.message ||
          (isGitLab ? 'GitLab 服务暂时不可用，请稍后重试' : 'GitHub 服务暂时不可用，请稍后重试'),
        isError: true,
        isRetryable: true,
        requiresReauthorization: false,
      }
    case 'connection_required':
      return {
        type: resultCode,
        message: result.message || (isGitLab ? '请先连接 GitLab 账号' : '请先连接 GitHub 账号'),
        isError: true,
        isRetryable: false,
        requiresReauthorization: true,
      }
    case 'unsupported_link':
      return {
        type: resultCode,
        message: result.message || '不支持的链接类型',
        isError: true,
        isRetryable: false,
        requiresReauthorization: false,
      }
    case 'not_configured':
    case 'pre_connection_only':
    case 'readonly_connection_ready':
      return {
        type: resultCode,
        message: result.message || (isGitLab ? 'GitLab 连接尚未配置' : 'GitHub 连接尚未配置'),
        isError: false,
        isRetryable: false,
        requiresReauthorization: false,
      }
    default:
      return {
        type: resultCode,
        message: result.message || '刷新失败',
        isError: true,
        isRetryable: true,
        requiresReauthorization: false,
      }
  }
}

/**
 * 判断刷新结果是否需要用户注意（显示提示或引导）。
 */
export function refreshResultNeedsAttention(result: RefreshResultInfo): boolean {
  return result.isError || result.requiresReauthorization
}

/**
 * 获取刷新结果对应的 UI 状态颜色。
 */
export function getRefreshResultColor(result: RefreshResultInfo): string {
  if (result.type === 'success') return 'green'
  if (result.requiresReauthorization) return 'orange'
  if (result.isRetryable) return 'blue'
  if (result.isError) return 'red'
  return 'gray'
}

// ---------------------------------------------------------------------------
// v2-5-code-repository-ci-status-display —— CI/check 只读摘要展示映射
//
// 只读观测信息：仅用于呈现，不驱动任务状态/健康分/其他任务写操作。
// ---------------------------------------------------------------------------

export type CiBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'outline' | 'primary'

export interface CiSummaryDisplay {
  /** 状态中文标签 */
  label: string
  /** Badge 视觉变体 */
  variant: CiBadgeVariant
  /** 来源通道标签（如 GitHub Checks / GitLab Pipeline / Webhook） */
  sourceLabel: string
  /** 是否可能过期 */
  isStale: boolean
  /** 上次观测时间（ISO 原样，供组件格式化） */
  observedAt: string | null
  /** 已验证 https 同 host 的 checks/pipeline 页面 URL（可能为 null） */
  targetUrl: string | null
  /** 补充说明（未配置 / 需重连 / 限流 / 暂时不可用 / 过期等） */
  hint?: string
}

const CI_STATE_VARIANT: Record<string, CiBadgeVariant> = {
  passed: 'success',
  failed: 'danger',
  running: 'primary',
  pending: 'warning',
  cancelled: 'neutral',
  unknown: 'outline',
  not_configured: 'neutral',
  needs_reauthorization: 'warning',
  unavailable: 'warning',
}

const CI_REASON_HINTS: Partial<Record<string, string>> = {
  no_ci: '无关联 CI',
  not_configured: '仓库未配置 CI',
  connection_required: '请先连接账号后刷新',
  needs_reauthorization: '需重新授权后再刷新',
  not_found: '未找到关联 CI',
  forbidden: '无权访问该仓库 CI',
  rate_limited: '限流中，稍后重试',
  temporarily_unavailable: '暂时不可用，稍后重试',
  unsupported_link: '不支持的链接类型',
}

/**
 * 将只读 CI 摘要映射为可展示信息；无摘要返回 null（旧链接空态）。
 */
export function mapCiSummary(
  ci: CodeRepositoryCiSummary | null | undefined,
): CiSummaryDisplay | null {
  if (!ci) return null
  const hint = ci.isStale ? '摘要可能已过期' : CI_REASON_HINTS[ci.reasonCode]
  return {
    label: CI_SUMMARY_STATE_LABELS[ci.state] ?? ci.state,
    variant: CI_STATE_VARIANT[ci.state] ?? 'outline',
    sourceLabel: CI_SUMMARY_SOURCE_LABELS[ci.source] ?? ci.source,
    isStale: ci.isStale,
    observedAt: ci.observedAt ?? null,
    targetUrl: ci.targetUrl ?? null,
    hint,
  }
}
