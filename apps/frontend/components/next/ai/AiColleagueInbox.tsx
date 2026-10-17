'use client'

/**
 * AI 同事面板 · 建议收件箱（新轨接线）。
 *
 * 五来源建议（智能推荐/进度与风险预测/AI 风险识别/PMO 优先级推荐/健康诊断草案）
 * 的统一收件箱：数据层 100% 复用既有 `use-suggestion-inbox` hooks 与
 * `lib/api/suggestion-inbox`（与旧轨 Copilot 收件箱同源同后端），展示层按新轨
 * 暗黑仪器语言（--nx-* 令牌）重写。
 *
 * 纪律（沿用共享契约 copilot-suggestion-inbox）：
 * - 条目正文为读取时回源投影（不落库）；缺省时以问题种类作标题，不凭空编造；
 * - 来源不可用降级为标注缺失的部分聚合，不静默省略；
 * - 采纳走已归档动作边界（performAction 通道），面板无直写路径。
 */

import * as React from 'react'
import { Inbox, RefreshCw } from 'lucide-react'
import type { InboxEntry, InboxEntryState } from '@aiproj/types'
import {
  INBOX_ENTRY_STATE_LABELS,
  INBOX_PROBLEM_KIND_LABELS,
  INBOX_SEVERITY_LABELS,
  INBOX_SOURCE_KIND_LABELS,
} from '@aiproj/types'
import { useInboxAction, useInboxQuery, useInboxRefreshRunner } from '@/hooks/use-suggestion-inbox'
import { cn } from '@/lib/utils'

const SEVERITY_TONE: Record<string, string> = {
  critical: 'text-[var(--nx-status-danger)]',
  high: 'text-[var(--nx-status-warning)]',
  medium: 'text-[var(--nx-text-secondary)]',
  low: 'text-[var(--nx-text-muted)]',
  info: 'text-[var(--nx-text-muted)]',
}

const FILTER_OPTIONS: readonly { value: InboxEntryState | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'read', label: '已读' },
  { value: 'adopted', label: '已采纳' },
  { value: 'dismissed', label: '已忽略' },
  { value: 'expired', label: '已过期' },
]

function inboxErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

export interface AiColleagueInboxProps {
  /** 项目上下文（缺省为组织全域聚合）。 */
  projectId?: number
}

export function AiColleagueInbox({ projectId }: AiColleagueInboxProps) {
  const [filter, setFilter] = React.useState<InboxEntryState | 'all'>('all')
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  const query = useInboxQuery({
    projectId,
    state: filter === 'all' ? undefined : filter,
    perPage: 50,
  })
  const action = useInboxAction()
  const { refresh, refreshing } = useInboxRefreshRunner()

  const entries: readonly InboxEntry[] = query.data?.entries ?? []
  const missingSources = query.data?.missingSources ?? []

  const handleAction = (entryId: string, kind: 'adopt' | 'dismiss') => {
    setNotice(null)
    action.mutate(
      { entryId, action: kind },
      {
        onError: (error) => setNotice(`操作失败：${inboxErrorMessage(error)}`),
      },
    )
  }

  const handleRefresh = () => {
    if (projectId == null) return
    setNotice(null)
    refresh(projectId).catch((error: unknown) => setNotice(`刷新失败：${inboxErrorMessage(error)}`))
  }

  return (
    <div
      data-ai-colleague-inbox
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2"
      role="region"
      aria-label="AI 建议收件箱"
    >
      {/* 筛选 + 刷新 */}
      <div className="mb-2 flex items-center gap-1.5">
        <div
          className="flex flex-1 flex-wrap items-center gap-1"
          role="group"
          aria-label="状态筛选"
        >
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-inbox-filter={option.value}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={cn(
                'h-6 rounded-sm border px-2 text-[10px] transition-colors',
                filter === option.value
                  ? 'border-[var(--nx-border-focus)] text-[var(--nx-accent)]'
                  : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-inbox-refresh
          disabled={refreshing || projectId == null}
          onClick={handleRefresh}
          title={projectId == null ? '全域视图下不触发聚合刷新' : '重新聚合五来源建议'}
          className="inline-flex h-6 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[10px] text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} aria-hidden />
          刷新
        </button>
      </div>

      {notice ? (
        <p
          role="alert"
          data-inbox-notice
          className="mb-2 text-[11px] text-[var(--nx-status-danger)]"
        >
          {notice}
        </p>
      ) : null}

      {/* 缺失来源标注（部分聚合不静默省略） */}
      {missingSources.length > 0 ? (
        <div
          data-inbox-missing-sources
          className="mb-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--nx-text-muted)]"
        >
          部分来源暂不可用：
          {missingSources
            .map((source) => `${INBOX_SOURCE_KIND_LABELS[source.sourceKind]}（${source.reason}）`)
            .join('；')}
        </div>
      ) : null}

      {query.isLoading ? (
        <div data-inbox-loading className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((k) => (
            <div
              key={k}
              className="h-14 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            />
          ))}
        </div>
      ) : query.isError ? (
        <div
          data-inbox-error
          className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-[11px] text-[var(--nx-status-danger)]"
        >
          加载失败：{inboxErrorMessage(query.error)}
        </div>
      ) : entries.length === 0 ? (
        <div
          data-inbox-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] px-4 py-8 text-center"
        >
          <Inbox className="h-5 w-5 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            {filter === 'all' ? '收件箱为空：五来源当前没有建议。' : '该状态下没有条目。'}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-inbox-list>
          {entries.map((entry) => {
            const expanded = expandedId === entry.id
            const actionable = entry.state === 'unread' || entry.state === 'read'
            const title = entry.content?.title ?? INBOX_PROBLEM_KIND_LABELS[entry.problemKind]
            return (
              <li
                key={entry.id}
                data-inbox-entry={entry.id}
                data-state={entry.state}
                className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2"
              >
                <button
                  type="button"
                  data-inbox-entry-toggle={entry.id}
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  className="flex w-full items-start gap-2 text-left"
                >
                  <span
                    className={cn(
                      'mt-0.5 shrink-0 text-[10px] font-medium',
                      SEVERITY_TONE[entry.severity],
                    )}
                  >
                    {INBOX_SEVERITY_LABELS[entry.severity]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-[var(--nx-text-primary)]">
                      {title}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-[var(--nx-text-muted)]">
                      {INBOX_PROBLEM_KIND_LABELS[entry.problemKind]} ·{' '}
                      {entry.sourceRefs
                        .map((ref) => INBOX_SOURCE_KIND_LABELS[ref.sourceKind] ?? ref.sourceKind)
                        .join('、')}
                      {' · '}
                      {INBOX_ENTRY_STATE_LABELS[entry.state]}
                    </span>
                  </span>
                </button>

                {expanded ? (
                  <div
                    data-inbox-entry-detail={entry.id}
                    className="mt-2 border-t border-[var(--nx-border-hairline)] pt-2"
                  >
                    {entry.content?.summary ? (
                      <p className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                        {entry.content.summary}
                      </p>
                    ) : null}
                    {entry.content?.suggestedAction ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                        建议动作：{entry.content.suggestedAction}
                      </p>
                    ) : null}
                    {entry.state === 'expired' && entry.expiryDetail ? (
                      <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
                        过期原因：{entry.expiryDetail}
                      </p>
                    ) : null}
                    {actionable ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          data-inbox-adopt={entry.id}
                          disabled={action.isPending}
                          onClick={() => handleAction(entry.id, 'adopt')}
                          className="h-6 rounded-sm border border-[var(--nx-border-focus)] px-2 text-[10px] text-[var(--nx-accent)] transition-colors hover:bg-[var(--nx-bg-0)] disabled:opacity-50"
                        >
                          采纳
                        </button>
                        <button
                          type="button"
                          data-inbox-dismiss={entry.id}
                          disabled={action.isPending}
                          onClick={() => handleAction(entry.id, 'dismiss')}
                          className="h-6 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[10px] text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                        >
                          忽略
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default AiColleagueInbox
