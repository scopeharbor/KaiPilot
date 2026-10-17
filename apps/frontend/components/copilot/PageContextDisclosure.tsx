'use client'

/**
 * v3-copilot-authoritative-page-context —— 页面语境披露 chips（任务 2.4）。
 *
 * 透明性表面（spec REQ / design §G）：
 * - 显示服务端授权解析后的 项目/页面/筛选/数据时间；
 * - 显示固定隐私说明（读取已授权产品数据，不读取屏幕像素/隐藏 DOM）；
 * - `context_unavailable` 时给出诚实文案 + 重试入口（不假装有项目事实）；
 * - 页面切换竞态：回答绑定提交时的快照；路由修订变化时明确标注并给
 *   「使用当前页面重试」（design §F-4）入口。
 *
 * 数据来源：store 的 turn.pageContextDisclosure（服务端权威）+
 * turnContextSnapshot（提交时冻结）；当前路由修订由 next/navigation 派生
 * （纯结构化可见状态，不读 DOM）。
 */
import * as React from 'react'
import { usePathname, useParams, useSearchParams } from 'next/navigation'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import type { CopilotPageContextDisclosureV1 } from '@aiproj/types'
import { useCopilotStore } from '@/stores/copilot-store'
import { derivePageContextDescriptor, PAGE_CONTEXT_ROUTE_LABELS } from '@/lib/copilot/page-context'

/** 数据时间 chip：HH:MM（与消息时间戳同格式）。 */
export function formatContextChipTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** 筛选摘要（短文本；长文本由 CSS 截断，测试覆盖长文本显示）。 */
export function summarizeAppliedFilters(disclosure: CopilotPageContextDisclosureV1): string {
  const parts = disclosure.filters.map((filter) => {
    const value = Array.isArray(filter.value) ? filter.value.join('|') : filter.value
    return `${filter.key}=${value}`
  })
  if (disclosure.ignoredFilters.length > 0) {
    parts.push(`已忽略 ${disclosure.ignoredFilters.length} 项未知筛选`)
  }
  return parts.join('、')
}

export interface PageContextDisclosureProps {
  /** 「使用当前页面重试」：传入当前页面新派生的 descriptor（design §F-4）。 */
  readonly onRetryCurrentPage?: (
    descriptor: import('@aiproj/types').CopilotPageContextDescriptorV1,
  ) => void
  /** 覆盖默认重试（缺省走 retryCopilotTurn：沿用提交时的快照）。 */
  readonly onRetrySnapshot?: () => void
  /** 项目名（可选；缺省显示 `项目 #id`，不额外发查询）。 */
  readonly projectName?: string | null
}

function Chip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      data-context-chip
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] text-gray-600"
    >
      <span className="shrink-0 text-gray-400">{label}</span>
      <span className="max-w-[160px] truncate" data-context-chip-value title={title}>
        {value || '—'}
      </span>
    </span>
  )
}

/**
 * 页面语境披露区块。
 *
 * 无披露（未携带 pageContext 的回合 / 非法描述符）时渲染 null（干净折叠）。
 */
export function PageContextDisclosure({
  onRetryCurrentPage,
  onRetrySnapshot,
  projectName,
}: PageContextDisclosureProps) {
  const turn = useCopilotStore((s) => s.turn)
  const snapshot = useCopilotStore((s) => s.turnContextSnapshot)
  const disclosure = turn?.pageContextDisclosure ?? null

  // 当前路由修订（结构化派生，不读 DOM）——用于页面切换竞态标注与
  // 「使用当前页面重试」换绑。
  const pathname = usePathname() ?? '/'
  const params = useParams() ?? {}
  const searchParams = useSearchParams() ?? new URLSearchParams()
  const currentDescriptor = React.useMemo(
    () =>
      derivePageContextDescriptor({
        pathname,
        params: params as Record<string, string | string[]>,
        searchParams,
      }),
    [pathname, params, searchParams],
  )
  const currentRevision = currentDescriptor.routeRevision

  if (!disclosure) return null

  const routeLabel =
    PAGE_CONTEXT_ROUTE_LABELS[disclosure.routeId as keyof typeof PAGE_CONTEXT_ROUTE_LABELS] ??
    disclosure.routeId
  const projectChip =
    disclosure.projectId !== undefined ? `${projectName ?? `#${disclosure.projectId}`}` : null
  const timeChip = formatContextChipTime(disclosure.observedAt)
  const filtersText = summarizeAppliedFilters(disclosure)

  // 页面切换竞态：回答绑定提交时的快照，页面已变 → 标注 + 换绑入口（design §F-4）。
  const pageChanged =
    snapshot !== null &&
    currentRevision.length > 0 &&
    snapshot.pageContext.routeRevision.length > 0 &&
    currentRevision !== snapshot.pageContext.routeRevision

  const unavailable = disclosure.status === 'context_unavailable'

  return (
    <div
      data-copilot-page-context
      className="flex flex-col gap-1.5 border-b border-border bg-gray-50/70 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-1.5" data-context-chips>
        {projectChip !== null ? <Chip label="当前项目" value={projectChip} /> : null}
        <Chip label="页面" value={routeLabel} />
        {filtersText ? <Chip label="筛选" value={filtersText} title={filtersText} /> : null}
        {timeChip ? <Chip label="数据时间" value={timeChip} /> : null}
      </div>

      {unavailable ? (
        <p data-context-unavailable className="text-[11px] leading-4 text-gray-600">
          我目前无法取得这个项目的数据。你可以重试，或告诉我想查看的项目。
        </p>
      ) : null}

      {pageChanged ? (
        <p data-context-stale-page className="text-[11px] leading-4 text-gray-500">
          页面已切换，本次回答基于提交时的页面语境。
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <p
          data-context-privacy-note
          className="flex min-w-0 items-start gap-1 text-[10px] leading-3 text-gray-400"
        >
          <ShieldCheck className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{disclosure.privacyNote}</span>
        </p>
        {(pageChanged || unavailable) && (
          <button
            type="button"
            data-context-retry-current-page
            className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-100"
            onClick={() => {
              if (onRetryCurrentPage) {
                onRetryCurrentPage(currentDescriptor)
              } else if (onRetrySnapshot) {
                onRetrySnapshot()
              }
            }}
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            使用当前页面重试
          </button>
        )}
      </div>
    </div>
  )
}
