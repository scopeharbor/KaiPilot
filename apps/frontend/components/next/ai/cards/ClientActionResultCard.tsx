'use client'

import Link from 'next/link'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * AI 同事本地动作回执：打开页面（open_app_page）与切换界面偏好（set_ui_preference）。
 * 两者都在浏览器本地执行、无服务端副作用；打开页面附「再次前往」链接。
 */
export function ClientActionResultCard({
  toolName,
  title,
  path,
  detail,
}: {
  toolName: string
  title: string
  path?: string | null
  /** 可展开的细节（如页面截图的看图描述）。 */
  detail?: string | null
}) {
  return (
    <article
      data-card="client-action"
      data-tool={toolName}
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-status-success)]">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          {title}
        </p>
        <RuleMatchBadge toolName={toolName} />
      </div>
      {detail ? (
        <details
          data-client-action-detail
          className="mt-1.5 text-[11px] text-[var(--nx-text-secondary)]"
        >
          <summary className="cursor-pointer select-none text-[var(--nx-text-muted)]">
            看到的内容
          </summary>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed">{detail}</p>
        </details>
      ) : null}
      {path ? (
        <Link
          href={path}
          data-client-action-link
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--nx-accent)] hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          再次前往 · {path}
        </Link>
      ) : null}
    </article>
  )
}

export default ClientActionResultCard
