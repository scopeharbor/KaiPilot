'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Bell, History, Inbox, SearchX } from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useProjectTimeline, useTimelineRealtimeHint } from '@/hooks/use-timeline'
import type { TimelineEvent, TimelineFilters as Filters } from '@/lib/api/timeline'
import {
  groupKeyForDate,
  hasActiveTimelineFilters,
  TIMELINE_GROUP_LABELS,
  TIMELINE_GROUP_ORDER,
  type TimelineGroupKey,
} from '@/lib/timeline-state'
import { TimelineEventCard } from './TimelineEventCard'
import { TimelineFilters } from './TimelineFilters'

interface TimelineViewProps {
  projectId: number
  filters: Filters
  onFiltersChange: (patch: Partial<Filters>) => void
  onClearFilters: () => void
}

function groupEvents(
  events: TimelineEvent[],
): { key: TimelineGroupKey; events: TimelineEvent[] }[] {
  const buckets = new Map<TimelineGroupKey, TimelineEvent[]>()
  for (const event of events) {
    const key = groupKeyForDate(event.occurredAt)
    const list = buckets.get(key)
    if (list) list.push(event)
    else buckets.set(key, [event])
  }
  return TIMELINE_GROUP_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    key: k,
    events: buckets.get(k)!,
  }))
}

/**
 * 项目记忆 Timeline 主视图。
 *
 * REST 为事实来源；WebSocket 仅提供「有新动态」提示。只读——渲染、刷新、加载更多
 * 都不修改任何业务数据。
 */
export function TimelineView({
  projectId,
  filters,
  onFiltersChange,
  onClearFilters,
}: TimelineViewProps) {
  const query = useProjectTimeline(projectId, filters)
  const { hasNew, refresh, dismiss } = useTimelineRealtimeHint(projectId)
  const [loadMoreError, setLoadMoreError] = useState(false)

  const events = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data])
  const groups = useMemo(() => groupEvents(events), [events])
  const filtersActive = hasActiveTimelineFilters(filters)

  const handleLoadMore = () => {
    setLoadMoreError(false)
    query.fetchNextPage().then((res) => {
      if (res.isError) setLoadMoreError(true)
    })
  }

  const handleRefreshFromHint = () => {
    refresh()
    query.refetch()
  }

  return (
    <div className="flex flex-col gap-4">
      <TimelineFilters filters={filters} onChange={onFiltersChange} onClear={onClearFilters} />

      {hasNew ? (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-700">
          <span className="inline-flex items-center gap-1.5">
            <Bell className="h-4 w-4" aria-hidden />
            项目有新动态
          </span>
          <span className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={handleRefreshFromHint}>
              刷新
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              忽略
            </Button>
          </span>
        </div>
      ) : null}

      {query.isPending ? <TimelineSkeleton /> : null}

      {query.isError ? (
        <Alert variant="danger" className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4" aria-hidden />
            加载 Timeline 失败，请稍后重试。
          </span>
          <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
            重试
          </Button>
        </Alert>
      ) : null}

      {!query.isPending && !query.isError && events.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={SearchX}
            title="当前筛选没有匹配的动态"
            description="试试调整或清除筛选条件。"
            action={
              <Button variant="secondary" size="sm" onClick={onClearFilters}>
                清除筛选
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="项目暂无动态"
            description="随着任务、里程碑、风险和变更推进，这里会记录项目的关键历程。"
            action={
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/projects/${projectId}/list`}>查看任务</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/ai-create">用 AI 创建</Link>
                </Button>
              </div>
            }
          />
        )
      ) : null}

      {groups.length > 0 ? (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.key} aria-label={TIMELINE_GROUP_LABELS[group.key]}>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <History className="h-3.5 w-3.5" aria-hidden />
                {TIMELINE_GROUP_LABELS[group.key]}
              </h3>
              <ul className="flex flex-col gap-2">
                {group.events.map((event) => (
                  <TimelineEventCard key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}

      {loadMoreError ? (
        <Alert variant="warning" className="flex items-center justify-between gap-3">
          <span>加载更多失败。</span>
          <Button size="sm" variant="secondary" onClick={handleLoadMore}>
            重试
          </Button>
        </Alert>
      ) : null}

      {query.hasNextPage && !loadMoreError ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleLoadMore}
            loading={query.isFetchingNextPage}
          >
            加载更多
          </Button>
        </div>
      ) : null}

      {events.length > 0 ? (
        <p className="pt-1 text-center text-xs text-gray-400">
          Timeline 为只读的项目记忆视图，展示项目历程，不用于排程编辑。
        </p>
      ) : null}
    </div>
  )
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border p-3"
        >
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
