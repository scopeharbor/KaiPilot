'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, FileQuestion, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * 权限受限 / 404 隔离 / 409 冲突 / 网络异常错误卡片
 * （v3-ui-next-ai-colleague spec「权限守卫与错误防御呈现」）。
 *
 * - 403：暗黑仪器感权限拒绝横幅 + 联系组织管理员指引（`data-error="forbidden"`）；
 * - 404：统一中性「未找到指定的项目资源」，严禁泄露跨租户信息（RL-05）；
 * - 409：冷红版本冲突警示 + 「重新演练」自愈入口（`data-error="conflict"`）；
 * - 超时/网络：超时告警 + 「重新尝试」按钮；
 * - 任何失败局限在卡片内部，绝不引发主工作面崩溃。
 */

export type AiErrorKind =
  'forbidden' | 'not_found' | 'conflict' | 'timeout' | 'server_error' | 'network' | 'unknown'

export interface AiErrorCardProps {
  /** 显式错误类别；缺省时按 HTTP status 推导。 */
  kind?: AiErrorKind
  /** HTTP 状态码（403/404/409/5xx 等），用于推导与展示。 */
  status?: number | null
  /** 后端错误码（如 SCHEDULE_STALE），仅冲突场景展示。 */
  code?: string | null
  /** 后端错误消息（404 场景一律不展示原始消息，恪守 RL-05）。 */
  message?: string | null
  /** 命中工具名（诚实呈现微标）。 */
  toolName?: string
  /** 重试 / 重新演练按钮回调（timeout、server_error、conflict 类目提供）。 */
  onRetry?: () => void
}

function resolveKind(
  kind: AiErrorKind | undefined,
  status: number | null | undefined,
): AiErrorKind {
  if (kind) return kind
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 408 || status === 504) return 'timeout'
  if (status !== null && status !== undefined && status >= 500) return 'server_error'
  return 'unknown'
}

interface ErrorContent {
  icon: ReactNode
  title: string
  body: string
  retryLabel?: string
  /** 警示横幅色彩族（冷红冲突 / 琥珀一般异常 / 中性 404）。 */
  bannerClass: string
}

function errorContent(
  kind: AiErrorKind,
  status: number | null | undefined,
  code: string | null | undefined,
  message: string | null | undefined,
): ErrorContent {
  switch (kind) {
    case 'forbidden':
      return {
        icon: <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />,
        title: '权限不足 · 操作被拒绝',
        body: '你缺少执行此操作所需的权限（需具备相应操作授权）。请联系组织管理员开通相应权限后重试。',
        bannerClass: 'border-[var(--nx-status-danger)]/50 text-[var(--nx-status-danger)]',
      }
    case 'not_found':
      return {
        icon: <FileQuestion className="h-4 w-4 shrink-0" aria-hidden />,
        title: '未找到指定的项目资源',
        body: '该资源不存在或已归档，请检查项目编号后重试。',
        bannerClass: 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
      }
    case 'conflict':
      return {
        icon: <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />,
        title: '排程数据已被他人并发修改或预览已过期（版本冲突 409）',
        body: `当前预览基于过期快照计算，系统已安全终止本次写入事务${code ? `（错误码 ${code}）` : ''}。请重新演练以获取最新数据。`,
        retryLabel: '重新演练 · 获取最新数据',
        bannerClass: 'border-[var(--nx-status-danger)]/50 text-[var(--nx-status-danger)]',
      }
    case 'timeout':
      return {
        icon: <WifiOff className="h-4 w-4 shrink-0" aria-hidden />,
        title: '网络连接超时',
        body: '请求超过等待时限，请检查网络连接后重新尝试。',
        retryLabel: '重新尝试',
        bannerClass: 'border-[var(--nx-status-warning)]/50 text-[var(--nx-status-warning)]',
      }
    case 'server_error':
      return {
        icon: <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />,
        title: `服务暂时不可用${status ? `（HTTP ${status}）` : ''}`,
        body: 'AI 工具编排服务暂时不可用，请稍后重试。',
        retryLabel: '重试',
        bannerClass: 'border-[var(--nx-status-warning)]/50 text-[var(--nx-status-warning)]',
      }
    case 'network':
      return {
        icon: <WifiOff className="h-4 w-4 shrink-0" aria-hidden />,
        title: '网络连接失败',
        body: '无法连接服务器，请检查网络后重新尝试。',
        retryLabel: '重新尝试',
        bannerClass: 'border-[var(--nx-status-warning)]/50 text-[var(--nx-status-warning)]',
      }
    default:
      return {
        icon: <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />,
        title: '操作未能完成',
        body:
          typeof message === 'string' && message.trim() !== ''
            ? message
            : '发生未知异常，请稍后重试。',
        retryLabel: '重试',
        bannerClass: 'border-[var(--nx-status-warning)]/50 text-[var(--nx-status-warning)]',
      }
  }
}

export function AiErrorCard({ kind, status, code, message, toolName, onRetry }: AiErrorCardProps) {
  const resolvedKind = resolveKind(kind, status)
  const { icon, title, body, retryLabel, bannerClass } = errorContent(
    resolvedKind,
    status,
    code,
    message,
  )

  return (
    <article
      data-card="error"
      data-error={resolvedKind}
      data-status={resolvedKind === 'conflict' ? 'conflict' : undefined}
      className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--nx-text-primary)]">执行失败</span>
        {toolName ? <RuleMatchBadge toolName={toolName} /> : null}
      </div>

      <div className="px-3 py-3">
        <div
          data-error-banner
          className={cn(
            'flex items-start gap-2 rounded-sm border bg-[var(--nx-bg-0)] px-2.5 py-2',
            bannerClass,
          )}
        >
          <span className="mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0">
            <p data-error-title className="text-xs leading-5 font-medium">
              {title}
            </p>
            <p
              data-error-body
              className="mt-0.5 text-[11px] leading-4 text-[var(--nx-text-secondary)]"
            >
              {body}
            </p>
          </div>
        </div>

        {retryLabel && onRetry ? (
          <button
            type="button"
            data-error-retry
            onClick={onRetry}
            className="mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {retryLabel}
          </button>
        ) : null}
      </div>
    </article>
  )
}

export default AiErrorCard
