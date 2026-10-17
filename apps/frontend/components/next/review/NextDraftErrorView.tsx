'use client'

import * as React from 'react'
import { AlertTriangle, Home, RefreshCw } from 'lucide-react'

export interface NextDraftErrorViewProps {
  /** 规范错误码（如 DRAFT_LOAD_FAILED / NETWORK_DISCONNECTED）；缺省 DRAFT_LOAD_FAILED。 */
  code?: string | null
  /** 中文排查指引；缺省网络断开文案。 */
  message?: string | null
  /** 点击「重新载入」重新发起请求。 */
  onReload?: () => void
  /** 可选「返回首页」导航。 */
  onBackHome?: () => void
}

/**
 * 接口异常错误恢复卡（v3-ui-next-draft-review-panel tasks 3.4 / spec「错误与网络断开态」）。
 *
 * - 展示规范错误码与中文排查指引，提供「重新载入」显式重试；
 * - 暗黑仪器风：发丝线边框 + 警示图标 + 中文文案双通道（RL-15）；
 * - 纯展示组件，零网络副作用；重试动作由装配层注入。
 */
export function NextDraftErrorView({
  code = 'DRAFT_LOAD_FAILED',
  message = '无法连接到草案服务，请检查网络设置。',
  onReload,
  onBackHome,
}: NextDraftErrorViewProps) {
  return (
    <section
      data-next-draft-error-view
      role="alert"
      aria-label="草案加载错误"
      className="mx-auto w-full max-w-md rounded-lg border border-[var(--nx-status-danger)]/40 bg-[var(--nx-workspace-surface)] p-8 text-center"
    >
      <AlertTriangle className="mx-auto h-8 w-8 text-[var(--nx-status-danger)]" aria-hidden />
      <h2 className="mt-4 text-base font-semibold text-[var(--nx-text-primary)]">
        草案数据加载失败
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--nx-text-secondary)]">{message}</p>
      <p
        data-error-code
        className="mt-3 inline-block rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1 font-mono text-xs text-[var(--nx-text-muted)]"
      >
        [{code}]
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          data-error-reload
          onClick={onReload}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          重新载入
        </button>
        {onBackHome ? (
          <button
            type="button"
            data-error-back-home
            onClick={onBackHome}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <Home className="h-4 w-4" aria-hidden />
            返回首页
          </button>
        ) : null}
      </div>
    </section>
  )
}

export default NextDraftErrorView
