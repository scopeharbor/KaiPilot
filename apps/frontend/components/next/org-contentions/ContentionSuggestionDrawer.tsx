'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Lightbulb, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { resourceContentionApi, resourceContentionKeys } from '@/lib/api/resource-contentions'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import type { ResourceContentionSuggestionPreview } from '@aiproj/types'
import {
  asSinglePayload,
  classifyApiError,
  CONTENTION_NOT_FOUND_COPY,
  CONTENTION_RESTRICTED_COPY,
  CONTENTION_SERVER_ERROR_COPY,
  formatContentionDate,
  resolveErrorMessageText,
} from '@/lib/next/org-contentions/org-contentions-adapter'

/**
 * 争用建议抽屉（v3-ui-next-org-portfolio-domains W5 · tasks 5.3，
 * spec「资源争用检测与需求预测：建议抽屉只读」）。
 *
 * - 数据源复用既有端点 GET …/resource-contentions/:contentionId/suggestions?kind=，
 *   规则建议（rule，确定性处置建议）与 AI 建议（ai，advisory 卡片）双 kind 切换，
 *   全部只读呈现（RL-01：不提供任何「采纳/执行」写入口）；
 * - 既有 hook `useResourceContentionSuggestions` 的 query key 不含 kind（同一
 *   contentionId 下 rule/ai 共享缓存条目），故切换 kind 前先按该 key 失效缓存，
 *   再以新 kind 的 queryFn 重查——杜绝「AI 标签下回显规则内容」的串档（确定性）；
 * - AI kind 建议卡以 AIMarker 语义标注（来源=AI 建议、仅供审查不自动执行），
 *   结果卡均回显 candidateActions 清单；403 → 中性限制态（不泄露存在性），
 *   5xx → 可重试；抽屉常驻「仅供参考，不自动执行」咨询红线文案。
 */

export type ContentionSuggestionKind = 'rule' | 'ai'

export interface ContentionSuggestionDrawerProps {
  /** 目标争用条目 ID；null 时抽屉不发起任何请求。 */
  contentionId: string | null
  open: boolean
  /** 初始建议 kind（缺省规则建议）。 */
  initialKind?: ContentionSuggestionKind
  onClose: () => void
}

const KIND_TABS: ReadonlyArray<{ id: ContentionSuggestionKind; label: string }> = [
  { id: 'rule', label: '规则建议' },
  { id: 'ai', label: 'AI 建议' },
]

const KIND_AI_MARKER_COPY = {
  source: '来源：AI 洞察',
  note: '仅供决策参考，未经人工确认绝不写入任何正式资源记录',
}

function SuggestionCard({
  item,
}: {
  item: {
    suggestionId: string
    kind: 'rule' | 'ai'
    title: string
    description: string
    candidateActions: string[]
    isAdvisory: boolean
    createdAt: string
  }
}) {
  const isAi = item.kind === 'ai'
  return (
    <article
      data-contention-suggestion-card
      data-contention-suggestion-kind={item.kind}
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
            isAi
              ? 'border-[rgba(0,240,255,0.35)] bg-[rgba(0,240,255,0.08)] text-[var(--nx-ai)]'
              : 'border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.08)] text-[var(--nx-accent)]',
          )}
        >
          {isAi ? (
            <Sparkles className="h-3 w-3" aria-hidden />
          ) : (
            <Lightbulb className="h-3 w-3" aria-hidden />
          )}
          {item.title}
        </span>
        {item.isAdvisory ? (
          <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
            仅供参考
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[10px] text-[var(--nx-text-muted)]">
          {formatContentionDate(item.createdAt)}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
        {item.description}
      </p>
      {item.candidateActions.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {item.candidateActions.map((action, index) => (
            <li
              key={action}
              className="flex items-center gap-2 text-[11px] text-[var(--nx-text-secondary)]"
            >
              <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                {(index + 1).toString().padStart(2, '0')}
              </span>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {isAi ? (
        <div
          data-ai-marker
          className="mt-2.5 rounded-sm border border-[rgba(139,92,246,0.25)] bg-[rgba(139,92,246,0.06)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
        >
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span data-ai-marker-source className="font-medium text-[var(--nx-accent)]">
              {KIND_AI_MARKER_COPY.source}
            </span>
            <span className="text-[var(--nx-text-muted)]">advisory · 零自动执行</span>
          </p>
          <p data-ai-marker-reason className="mt-0.5 text-[var(--nx-text-muted)]">
            {KIND_AI_MARKER_COPY.note}
          </p>
        </div>
      ) : null}
    </article>
  )
}

export function ContentionSuggestionDrawer({
  contentionId,
  open,
  initialKind = 'rule',
  onClose,
}: ContentionSuggestionDrawerProps) {
  const queryClient = useQueryClient()
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const [activeKind, setActiveKind] = React.useState<ContentionSuggestionKind>(initialKind)
  // 抽屉打开期间的生效目标（与 props 解耦一拍：先清缓存再启用查询，杜绝串档）。
  const [targetId, setTargetId] = React.useState<string | null>(null)
  const panelRef = React.useRef<HTMLElement | null>(null)

  // 只读建议抽屉无写路径（无在途 mutation、无表单脏值）：Escape 默认可关，与点击关闭同语义。
  useDialogA11y({ ref: panelRef, open, onClose })

  // 数据层复用既有 lib/api 契约与 query key 工厂（同 ContentionWorkspace 说明：
  // 既有 hooks 的二次解包已在 W1（D-A）修复、单对象端点直出载荷；但其 query key
  // 不含 kind——rule/ai 共享缓存条目，此处仍以标准 useQuery 直连已查证契约，并在
  // 打开/切 kind 前 removeQueries 清缓存，保证新 kind 实查）。
  const suggestionsQuery = useQuery({
    queryKey: resourceContentionKeys.suggestions(organizationId ?? 0, targetId ?? ''),
    queryFn: () =>
      resourceContentionApi
        .suggestions(organizationId as number, targetId as string, activeKind)
        .then((result) => asSinglePayload<ResourceContentionSuggestionPreview[]>(result)),
    enabled: organizationId !== null && targetId !== null,
    staleTime: 30_000,
  })

  React.useEffect(() => {
    if (!(open && contentionId)) {
      setTargetId(null)
      return
    }
    // 既有 query key 不含 kind（rule/ai 共享缓存条目）：打开即清空该 key 缓存，
    // 本次会话必然以目标 kind 的 queryFn 实查，杜绝跨 kind 缓存串档（确定性渲染）。
    if (organizationId !== null) {
      queryClient.removeQueries({
        queryKey: resourceContentionKeys.suggestions(organizationId, contentionId),
      })
    }
    setActiveKind(initialKind)
    setTargetId(contentionId)
  }, [open, contentionId, initialKind, organizationId, queryClient])

  const switchKind = (kind: ContentionSuggestionKind) => {
    if (kind === activeKind) return
    // 同上：先清共享缓存再切 kind，新 kind 的 queryFn 必然实查。
    if (organizationId !== null && contentionId !== null) {
      queryClient.removeQueries({
        queryKey: resourceContentionKeys.suggestions(organizationId, contentionId),
      })
    }
    setActiveKind(kind)
  }

  if (!open) return null

  const errorKind = suggestionsQuery.isError ? classifyApiError(suggestionsQuery.error).kind : null
  const suggestions = suggestionsQuery.data ?? []
  const isAi = activeKind === 'ai'

  return (
    <div data-contention-suggestion-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="关闭争用建议"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="争用处置建议"
        data-contention-suggestion-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Lightbulb className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">争用处置建议</h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                GET …/resource-contentions/:id/suggestions?kind={activeKind} · 只读
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭争用建议"
            data-contention-suggestion-close
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* kind 切换（纯只读重查） */}
          <div
            role="tablist"
            aria-label="建议类型切换"
            className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
          >
            {KIND_TABS.map((tab) => {
              const active = activeKind === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-contention-suggestion-kind-tab={tab.id}
                  onClick={() => switchKind(tab.id)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors',
                    active
                      ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                      : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                  )}
                >
                  {tab.id === 'ai' ? (
                    <Sparkles className="h-3 w-3" aria-hidden />
                  ) : (
                    <Lightbulb className="h-3 w-3" aria-hidden />
                  )}
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* RL-01 咨询红线（常驻） */}
          <div
            data-contention-suggestion-disclaimer
            className="flex gap-2 rounded-sm border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2.5"
          >
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
              aria-hidden
            />
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              <span className="font-semibold text-[var(--nx-status-warning)]">
                以上建议仅供审查
              </span>
              ：不会自动修改分配、任务负责人、任务日期或工作日历。如需执行请走正式资源调配
              或分配流程并二次确认。
            </p>
          </div>

          {suggestionsQuery.isLoading && suggestions.length === 0 ? (
            <div
              data-contention-suggestion-loading
              role="status"
              aria-busy="true"
              aria-label="正在加载处置建议"
              className="space-y-2"
            >
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
                />
              ))}
              <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-[var(--nx-text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {isAi ? 'AI 正在生成争用处置建议…' : '正在加载规则建议…'}
              </p>
            </div>
          ) : errorKind === 'forbidden' ? (
            <div
              data-contention-suggestion-restricted
              className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
            >
              <Sparkles className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">
                {CONTENTION_RESTRICTED_COPY.title}
              </p>
              <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                {CONTENTION_RESTRICTED_COPY.description}
              </p>
            </div>
          ) : errorKind === 'not_found' ? (
            <div
              data-contention-suggestion-notfound
              className="flex flex-col items-center gap-2.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
            >
              <p className="text-sm text-[var(--nx-text-secondary)]">
                {CONTENTION_NOT_FOUND_COPY.title}
              </p>
              <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                {CONTENTION_NOT_FOUND_COPY.description}
              </p>
            </div>
          ) : suggestionsQuery.isError ? (
            <div
              data-contention-suggestion-error
              className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
            >
              <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">
                {CONTENTION_SERVER_ERROR_COPY.title}
              </p>
              <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                {resolveErrorMessageText(
                  suggestionsQuery.error,
                  CONTENTION_SERVER_ERROR_COPY.description,
                )}
              </p>
              <button
                type="button"
                data-contention-suggestion-retry
                onClick={() => void suggestionsQuery.refetch()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                重试
              </button>
            </div>
          ) : suggestions.length === 0 ? (
            <div data-contention-suggestion-empty className="px-6 py-10 text-center">
              <Lightbulb className="mx-auto mb-2 h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">
                {isAi ? '当前条目暂无可展示的 AI 建议' : '当前条目暂无可展示的规则建议'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {suggestions.map((suggestion) => (
                <SuggestionCard key={suggestion.suggestionId} item={suggestion} />
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <p className="text-[10px] text-[var(--nx-text-muted)]">
            {contentionId ? (
              <span className="font-mono">{contentionId.slice(0, 8)}…</span>
            ) : (
              '未选择条目'
            )}{' '}
            · 建议零自动执行（RL-01）
          </p>
          <button
            type="button"
            data-contention-suggestion-close-footer
            onClick={onClose}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            关闭
          </button>
        </footer>
      </aside>
    </div>
  )
}

export default ContentionSuggestionDrawer
