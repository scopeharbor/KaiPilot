'use client'

import { useEffect, useState } from 'react'
import { Search, Star, UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import type { TimelineCategory, TimelineFilters as Filters } from '@/lib/api/timeline'
import { CATEGORY_FILTER_GROUPS, hasActiveTimelineFilters } from '@/lib/timeline-state'

interface TimelineFiltersProps {
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
  onClear: () => void
}

/** 判断某分组是否被选中（分组内任一 category 在筛选集合中）。 */
function groupActive(
  selected: TimelineCategory[] | undefined,
  categories: TimelineCategory[],
): boolean {
  if (!selected || selected.length === 0) return false
  return categories.some((c) => selected.includes(c))
}

/**
 * Timeline 筛选工具栏：类型分组、关键事件、与我有关、时间范围、搜索关键字。
 * 所有变更通过 onChange 上抛，由页面写入 URL search params。
 */
export function TimelineFilters({ filters, onChange, onClear }: TimelineFiltersProps) {
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '')

  // 外部（URL）变化时同步输入框
  useEffect(() => {
    setSearchDraft(filters.search ?? '')
  }, [filters.search])

  const selected = filters.categories

  const toggleGroup = (categories: TimelineCategory[]) => {
    const current = new Set(selected ?? [])
    const isActive = groupActive(selected, categories)
    if (isActive) {
      categories.forEach((c) => current.delete(c))
    } else {
      categories.forEach((c) => current.add(c))
    }
    const next = Array.from(current)
    onChange({ categories: next.length > 0 ? next : undefined })
  }

  const commitSearch = () => {
    const trimmed = searchDraft.trim()
    onChange({ search: trimmed ? trimmed.slice(0, 100) : undefined })
  }

  const active = hasActiveTimelineFilters(filters)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {CATEGORY_FILTER_GROUPS.map((group) => {
          const isActive = groupActive(selected, group.categories)
          return (
            <button
              key={group.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => toggleGroup(group.categories)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                isActive
                  ? 'border-primary-300 bg-primary-50 text-primary-700'
                  : 'border-border bg-gray-0 text-gray-600 hover:bg-gray-50',
              )}
            >
              {group.label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={filters.keyOnly ?? false}
          onClick={() => onChange({ keyOnly: filters.keyOnly ? undefined : true })}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            filters.keyOnly
              ? 'border-warning bg-warning-bg text-warning'
              : 'border-border bg-gray-0 text-gray-600 hover:bg-gray-50',
          )}
        >
          <Star className="h-3.5 w-3.5" aria-hidden />
          关键事件
        </button>
        <button
          type="button"
          aria-pressed={filters.relatedToMe ?? false}
          onClick={() => onChange({ relatedToMe: filters.relatedToMe ? undefined : true })}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            filters.relatedToMe
              ? 'border-primary-300 bg-primary-50 text-primary-700'
              : 'border-border bg-gray-0 text-gray-600 hover:bg-gray-50',
          )}
        >
          <UserRound className="h-3.5 w-3.5" aria-hidden />
          与我有关
        </button>

        <label className="flex items-center gap-1 text-sm text-gray-500">
          <span className="sr-only">开始日期</span>
          <Input
            type="date"
            aria-label="开始日期"
            value={filters.from ?? ''}
            max={filters.to || undefined}
            onChange={(e) => onChange({ from: e.target.value || undefined })}
            className="h-8 w-[9.5rem]"
          />
        </label>
        <span className="text-gray-400" aria-hidden>
          —
        </span>
        <label className="flex items-center gap-1 text-sm text-gray-500">
          <span className="sr-only">结束日期</span>
          <Input
            type="date"
            aria-label="结束日期"
            value={filters.to ?? ''}
            min={filters.from || undefined}
            onChange={(e) => onChange({ to: e.target.value || undefined })}
            className="h-8 w-[9.5rem]"
          />
        </label>

        <div className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="搜索 Timeline 事件"
            placeholder="搜索事件摘要"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSearch()
            }}
            onBlur={commitSearch}
            className="h-8 pl-8"
          />
        </div>

        {active ? (
          <Button variant="ghost" size="sm" onClick={onClear} className="gap-1">
            <X className="h-3.5 w-3.5" aria-hidden />
            清除筛选
          </Button>
        ) : null}
      </div>
    </div>
  )
}
