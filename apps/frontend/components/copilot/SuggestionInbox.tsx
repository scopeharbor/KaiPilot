'use client'

/**
 * v3-copilot-suggestion-inbox — 收件箱视图组件（任务 7.7–7.10）
 *
 * 五来源建议的统一收件箱视图：
 * - 按状态筛选
 * - 逐条采纳/忽略交互
 * - 缺失来源标注（不静默省略）
 * - 未读计数徽章
 * - 键盘可达与屏幕阅读器可读
 * - 移动端响应式
 *
 * 条目正文来自后端读取时的回源投影（`entry.content`，不落库）；
 * 缺省时以问题种类作标题，不凭空编造正文。
 */

import * as React from 'react'
import {
  Inbox,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import type { InboxEntry, InboxEntryState, InboxMissingSource } from '@aiproj/types'
import {
  INBOX_ENTRY_STATE_LABELS,
  INBOX_PROBLEM_KIND_LABELS,
  INBOX_SOURCE_KIND_LABELS,
  INBOX_SEVERITY_LABELS,
  INBOX_EXPIRY_REASON_LABELS,
} from '@aiproj/types'

interface SuggestionInboxProps {
  /** 收件箱条目列表 */
  entries: InboxEntry[]
  /** 不可用来源列表 */
  missingSources: InboxMissingSource[]
  /** 未读计数 */
  unreadCount: number
  /** 加载中 */
  loading?: boolean
  /** 当前筛选状态 */
  filterState?: InboxEntryState | 'all'
  /** 筛选回调 */
  onFilterChange?: (state: InboxEntryState | 'all') => void
  /** 标记已读回调 */
  onMarkRead?: (entryId: string) => void
  /** 采纳回调 */
  onAdopt?: (entryId: string) => void | Promise<void>
  /** 忽略回调 */
  onDismiss?: (entryId: string) => void | Promise<void>
  /** 刷新回调 */
  onRefresh?: () => void
  /** 刷新不可用的原因（有值时禁用刷新按钮并展示原因） */
  refreshDisabledReason?: string
  /** 头部下方的提示区（错误、采纳结果等） */
  notice?: React.ReactNode
}

/**
 * 收件箱视图组件。
 */
export function SuggestionInbox({
  entries,
  missingSources,
  unreadCount,
  loading = false,
  filterState = 'all',
  onFilterChange,
  onMarkRead,
  onAdopt,
  onDismiss,
  onRefresh,
  refreshDisabledReason,
  notice,
}: SuggestionInboxProps) {
  const [expandedEntry, setExpandedEntry] = React.useState<string | null>(null)

  // 按状态分组统计
  const stateCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: entries.length }
    for (const entry of entries) {
      counts[entry.state] = (counts[entry.state] || 0) + 1
    }
    return counts
  }, [entries])

  // 筛选后的条目
  const filteredEntries = React.useMemo(() => {
    if (filterState === 'all') return entries
    return entries.filter((e) => e.state === filterState)
  }, [entries, filterState])

  return (
    <div className="flex flex-col h-full" role="region" aria-label="AI 建议收件箱">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-semibold">建议收件箱</h2>
          {unreadCount > 0 && (
            <span
              className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-primary text-primary-foreground"
              aria-label={`${unreadCount} 条未读`}
            >
              {unreadCount}
            </span>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className={cn(
              'p-1.5 rounded-md hover:bg-muted transition-colors disabled:opacity-50',
              focusRing,
            )}
            disabled={loading || Boolean(refreshDisabledReason)}
            title={refreshDisabledReason}
            aria-label="刷新收件箱"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        )}
      </div>

      {refreshDisabledReason && (
        <p className="px-4 py-2 border-b text-xs text-muted-foreground">{refreshDisabledReason}</p>
      )}

      {notice && <div className="px-4 py-2 border-b text-xs">{notice}</div>}

      {/* 缺失来源提示 */}
      {missingSources.length > 0 && (
        <div className="px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b" role="alert">
          <div className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>
              以下来源暂时不可用：
              {missingSources.map((m) => INBOX_SOURCE_KIND_LABELS[m.sourceKind]).join('、')}
            </span>
          </div>
        </div>
      )}

      {/* 状态筛选标签 */}
      <div className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto" role="tablist">
        {(['all', 'unread', 'read', 'adopted', 'dismissed', 'expired'] as const).map((state) => (
          <button
            key={state}
            role="tab"
            aria-selected={filterState === state}
            onClick={() => onFilterChange?.(state)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
              filterState === state
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted',
              focusRing,
            )}
          >
            {state === 'all' ? '全部' : INBOX_ENTRY_STATE_LABELS[state]}
            {stateCounts[state] !== undefined && (
              <span className="ml-1 text-xs opacity-70">{stateCounts[state]}</span>
            )}
          </button>
        ))}
      </div>

      {/* 条目列表 */}
      <div className="flex-1 overflow-y-auto" role="list">
        {loading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            加载中…
          </div>
        )}

        {!loading && filteredEntries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Inbox className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">暂无建议</p>
          </div>
        )}

        {!loading &&
          filteredEntries.map((entry) => (
            <InboxEntryCard
              key={entry.id}
              entry={entry}
              expanded={expandedEntry === entry.id}
              onToggle={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
              onMarkRead={() => onMarkRead?.(entry.id)}
              onAdopt={() => onAdopt?.(entry.id)}
              onDismiss={() => onDismiss?.(entry.id)}
            />
          ))}
      </div>
    </div>
  )
}

// ── 单条目卡片 ──────────────────────────────────────────────────────────

interface InboxEntryCardProps {
  entry: InboxEntry
  expanded: boolean
  onToggle: () => void
  onMarkRead: () => void
  onAdopt: () => void | Promise<void>
  onDismiss: () => void | Promise<void>
}

function InboxEntryCard({
  entry,
  expanded,
  onToggle,
  onMarkRead,
  onAdopt,
  onDismiss,
}: InboxEntryCardProps) {
  const [acting, setActing] = React.useState(false)
  // 回调每次渲染都是新函数：不加锚点的话，状态回写前每次重渲染都会重复发 mark_read，
  // 第二次起被后端状态机以 read → read 非法拒绝。
  const markReadSent = React.useRef(false)

  // 查看时标记已读
  React.useEffect(() => {
    if (expanded && entry.state === 'unread' && !markReadSent.current) {
      markReadSent.current = true
      onMarkRead()
    }
  }, [expanded, entry.state, onMarkRead])

  const severityColor = {
    critical: 'text-red-600 bg-red-50 dark:bg-red-900/20',
    high: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20',
    medium: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20',
    low: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20',
    info: 'text-gray-600 bg-gray-50 dark:bg-gray-900/20',
  }[entry.severity]

  const isTerminal =
    entry.state === 'adopted' || entry.state === 'dismissed' || entry.state === 'expired'

  const title = entry.content?.title ?? INBOX_PROBLEM_KIND_LABELS[entry.problemKind]

  const runAction = async (fn: () => void | Promise<void>) => {
    setActing(true)
    try {
      await fn()
    } finally {
      setActing(false)
    }
  }

  return (
    <div
      role="listitem"
      className={cn(
        'border-b transition-colors',
        entry.state === 'unread' && 'bg-blue-50/50 dark:bg-blue-900/10',
        entry.state === 'expired' && 'opacity-60',
      )}
    >
      {/* 条目头部 */}
      <button
        onClick={onToggle}
        className={cn('w-full px-4 py-3 text-left flex items-start gap-3', focusRing)}
        aria-expanded={expanded}
      >
        {/* 严重度指示 */}
        <span
          className={cn(
            'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 mt-0.5',
            severityColor,
          )}
          aria-label={`严重度：${INBOX_SEVERITY_LABELS[entry.severity]}`}
        >
          {entry.severity === 'critical' ? '!' : (entry.severity[0] ?? '?').toUpperCase()}
        </span>

        {/* 内容区 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium break-words mb-1" data-inbox-entry-title>
            {title}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{INBOX_ENTRY_STATE_LABELS[entry.state]}</span>
            <span>·</span>
            <span>{INBOX_SEVERITY_LABELS[entry.severity]}</span>
            <span>·</span>
            <span>{entry.sourceRefs.length} 个来源</span>
            <span>·</span>
            <span>{new Date(entry.createdAt).toLocaleDateString('zh-CN')}</span>
            {entry.state === 'expired' && entry.expiryReason && (
              <span className="text-orange-600">
                {INBOX_EXPIRY_REASON_LABELS[entry.expiryReason]}
              </span>
            )}
          </div>
        </div>

        {/* 展开箭头 */}
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform flex-shrink-0 mt-1',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-4 pb-3">
          {/* 回源正文 */}
          {entry.content ? (
            <div className="mb-3 space-y-1.5 text-sm">
              {entry.content.summary && <p className="break-words">{entry.content.summary}</p>}
              {entry.content.suggestedAction && (
                <p className="break-words">
                  <span className="font-medium">建议动作：</span>
                  {entry.content.suggestedAction}
                </p>
              )}
            </div>
          ) : entry.content === null ? (
            <p className="mb-3 text-xs text-muted-foreground">
              来源正文不可读：你无权查看该来源，或来源记录已不存在。
            </p>
          ) : null}

          {/* 来源列表 */}
          <div className="mb-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">来源</p>
            <div className="flex flex-wrap gap-1">
              {entry.sourceRefs.map((ref, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-0.5 text-xs rounded-md bg-muted"
                >
                  {INBOX_SOURCE_KIND_LABELS[ref.sourceKind]}
                </span>
              ))}
            </div>
          </div>

          {/* 过期原因 */}
          {entry.state === 'expired' && entry.expiryDetail && (
            <div className="mb-3 p-2 rounded-md bg-orange-50 dark:bg-orange-900/20 text-sm text-orange-800 dark:text-orange-200">
              {entry.expiryDetail}
            </div>
          )}

          {/* 操作按钮（仅 read 状态可操作） */}
          {!isTerminal && (
            <div className="flex items-center gap-2">
              {entry.state === 'read' ? (
                <>
                  <button
                    onClick={() => runAction(onAdopt)}
                    disabled={acting}
                    className={cn(
                      'inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md',
                      'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
                      focusRing,
                    )}
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    采纳
                  </button>
                  <button
                    onClick={() => runAction(onDismiss)}
                    disabled={acting}
                    className={cn(
                      'inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md',
                      'bg-muted text-muted-foreground hover:bg-muted/80 transition-colors',
                      focusRing,
                    )}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    忽略
                  </button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">正在标记为已读…</span>
              )}
            </div>
          )}

          {/* 终态标记 */}
          {isTerminal && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {entry.state === 'adopted' && <CheckCircle className="h-3.5 w-3.5 text-green-600" />}
              {entry.state === 'dismissed' && <XCircle className="h-3.5 w-3.5" />}
              {entry.state === 'expired' && <Clock className="h-3.5 w-3.5 text-orange-600" />}
              <span>
                {entry.state === 'adopted' && '已采纳'}
                {entry.state === 'dismissed' && '已忽略'}
                {entry.state === 'expired' && '已过期'}
                {entry.actionedAt && ` · ${new Date(entry.actionedAt).toLocaleString('zh-CN')}`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
