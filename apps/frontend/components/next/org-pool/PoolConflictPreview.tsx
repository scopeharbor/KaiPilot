'use client'

import * as React from 'react'
import { AlertCircle, AlertTriangle, EyeOff, RotateCw } from 'lucide-react'
import type { OrganizationResourcePoolConflict } from '@aiproj/types'
import {
  getPoolConflictSeverityLabel,
  getPoolConflictSeverityTone,
} from '@/lib/next/org-pool/org-pool-adapter'

/**
 * 组织资源池冲突预览（v3-ui-next-org-portfolio-domains W4 · tasks 4.3）。
 *
 * - 冲突条目卡：严重度徽标（--nx-* 色阶 + 文字双通道）、描述、资源/项目/日期
 *   上下文与 remediation 建议；全部只读（RL-01）；
 * - 脱敏条目（redacted）中性呈现，不泄露资源/项目名（RL-05）；
 * - 加载骨架 / 空态 / 错误重试三态闭环；分页由外层 URL 状态驱动。
 */

export interface PoolConflictPreviewProps {
  conflicts?: OrganizationResourcePoolConflict[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function PoolConflictPreview({
  conflicts,
  isLoading,
  isError,
  onRetry,
  page,
  totalPages,
  onPageChange,
}: PoolConflictPreviewProps) {
  if (isLoading) {
    return (
      <div
        data-pool-conflicts-skeleton
        aria-busy
        className="space-y-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4"
      >
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded bg-[var(--nx-bg-0)]" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div
        data-pool-conflicts-error
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center"
      >
        <AlertCircle className="h-6 w-6 text-[var(--nx-status-danger)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-primary)]">冲突数据加载失败</p>
        <button
          type="button"
          data-pool-conflicts-retry
          onClick={onRetry}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          重试
        </button>
      </div>
    )
  }

  if (!conflicts || conflicts.length === 0) {
    return (
      <div
        data-pool-conflicts-empty
        className="flex flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-10 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-primary)]">无冲突</p>
        <p className="text-xs text-[var(--nx-text-muted)]">当前没有检测到资源冲突</p>
      </div>
    )
  }

  return (
    <div data-pool-conflicts-view className="space-y-2.5">
      {conflicts.map((conflict) => {
        const tone = getPoolConflictSeverityTone(conflict.severity)
        const redacted = conflict.redacted
        return (
          <div
            key={conflict.conflictId}
            data-pool-conflict={conflict.conflictId}
            className="flex items-start gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3.5 py-3"
          >
            <span
              data-severity={conflict.severity}
              className="mt-0.5 shrink-0 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[11px] font-medium"
              style={{ color: `var(${tone})` }}
            >
              {getPoolConflictSeverityLabel(conflict.severity)}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm leading-relaxed text-[var(--nx-text-primary)]">
                {redacted ? (
                  <span
                    data-restricted
                    className="inline-flex items-center gap-1.5 text-[var(--nx-text-muted)]"
                  >
                    <EyeOff className="h-3.5 w-3.5" aria-hidden />
                    已脱敏
                  </span>
                ) : (
                  conflict.description
                )}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--nx-text-muted)]">
                {!redacted && conflict.resourceName ? (
                  <span>资源：{conflict.resourceName}</span>
                ) : null}
                {!redacted && conflict.projectNames && conflict.projectNames.length > 0 ? (
                  <span>项目：{conflict.projectNames.join('、')}</span>
                ) : null}
                {conflict.date ? <span>日期：{conflict.date}</span> : null}
              </div>
              {!redacted && conflict.remediationHint ? (
                <p className="text-[11px] text-[var(--nx-text-muted)]">
                  建议：{conflict.remediationHint}
                </p>
              ) : null}
            </div>
          </div>
        )
      })}
      {totalPages > 1 ? (
        <PoolPager page={page} totalPages={totalPages} onPageChange={onPageChange} />
      ) : null}
    </div>
  )
}

/** 统一分页条（写回 URL，restorable）。 */
export function PoolPager({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  return (
    <div data-pool-pager className="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        data-pool-page-prev
        aria-label="上一页"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="flex h-7 items-center rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        上一页
      </button>
      <span className="font-mono text-[11px] text-[var(--nx-text-muted)]">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        data-pool-page-next
        aria-label="下一页"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="flex h-7 items-center rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        下一页
      </button>
    </div>
  )
}

export default PoolConflictPreview
