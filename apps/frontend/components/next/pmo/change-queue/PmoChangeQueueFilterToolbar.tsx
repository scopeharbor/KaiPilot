'use client'

/**
 * PMO 全局变更审批队列多维组合筛选工具栏
 * (v3-ui-next-batch4-reports-change-queue W3 · tasks 3.5 / spec「多维即时组合筛选工具栏」).
 *
 * 职责：
 * 1. 状态分面 Tabs（全部 / 待审批 / 已批准 / 退回修改 / 已拒绝 / 已实施），默认待审批；
 * 2. 所属项目多选下拉，支持多选组织内活跃项目；
 * 3. 优先级与类型多选筛选；
 * 4. 300ms 防抖模糊搜索框（匹配 CR 编码、变更标题、申请人与描述）；
 * 5. 任何筛选条件变更后自动触发分页重置为第 1 页。
 */

import * as React from 'react'
import { Check, ChevronDown, Filter, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import type { ChangeRequestPriority, ChangeRequestType } from '@/lib/api/change-requests'
import type {
  ChangeQueueStatusFacet,
  CrossProjectChangeRequestItem,
} from '@/lib/next/pmo-change-queue-composer'
import { cn } from '@/lib/utils'

export interface ProjectOption {
  id: number
  name: string
  code?: string | null
}

export interface ChangeQueueFilterState {
  statusFacet: ChangeQueueStatusFacet
  projectIds: number[]
  priorities: ChangeRequestPriority[]
  types: ChangeRequestType[]
  search: string
}

export const DEFAULT_FILTER_STATE: ChangeQueueFilterState = {
  statusFacet: 'pending',
  projectIds: [],
  priorities: [],
  types: [],
  search: '',
}

export const STATUS_FACET_OPTIONS: Array<{
  key: ChangeQueueStatusFacet
  label: string
}> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审批' },
  { key: 'approved', label: '已批准' },
  { key: 'returned', label: '退回修改' },
  { key: 'rejected', label: '已拒绝' },
  { key: 'implemented', label: '已实施' },
]

export const PRIORITY_OPTIONS: Array<{
  key: ChangeRequestPriority
  label: string
  colorToken: string
}> = [
  { key: 'urgent', label: '紧急', colorToken: 'var(--nx-status-danger)' },
  { key: 'high', label: '高', colorToken: 'var(--nx-status-warning)' },
  { key: 'medium', label: '中', colorToken: 'var(--nx-space-cyan)' },
  { key: 'low', label: '低', colorToken: 'var(--nx-text-muted)' },
]

export const CHANGE_TYPE_OPTIONS: Array<{
  key: ChangeRequestType
  label: string
}> = [
  { key: 'scope', label: '范围' },
  { key: 'schedule', label: '进度' },
  { key: 'cost', label: '成本' },
  { key: 'resource', label: '资源' },
  { key: 'quality', label: '质量' },
  { key: 'risk', label: '风险' },
  { key: 'other', label: '其他' },
]

export const SEARCH_DEBOUNCE_MS = 300

/**
 * 纯函数：根据当前筛选条件过滤跨项目变更数据集。
 */
export function filterChangeQueueItems(
  items: CrossProjectChangeRequestItem[],
  filters: ChangeQueueFilterState,
): CrossProjectChangeRequestItem[] {
  return items.filter((item) => {
    // 1. 状态分面过滤
    if (filters.statusFacet === 'pending') {
      if (item.status !== 'submitted' && item.status !== 'under_review') {
        return false
      }
    } else if (filters.statusFacet !== 'all') {
      if (item.status !== filters.statusFacet) {
        return false
      }
    }

    // 2. 所属项目过滤
    if (filters.projectIds.length > 0) {
      if (!filters.projectIds.includes(item.projectId)) {
        return false
      }
    }

    // 3. 优先级过滤
    if (filters.priorities.length > 0) {
      if (!filters.priorities.includes(item.priority)) {
        return false
      }
    }

    // 4. 类型过滤
    if (filters.types.length > 0) {
      if (!filters.types.includes(item.changeType)) {
        return false
      }
    }

    // 5. 模糊搜索匹配 (crCode, title, requesterName, description)
    if (filters.search.trim()) {
      const query = filters.search.trim().toLowerCase()
      const matchCode = item.crCode ? item.crCode.toLowerCase().includes(query) : false
      const matchTitle = item.title ? item.title.toLowerCase().includes(query) : false
      const matchRequester =
        (item.requesterName ? item.requesterName.toLowerCase().includes(query) : false) ||
        (item.requestedBy !== null && String(item.requestedBy).includes(query))
      const matchDesc = item.description ? item.description.toLowerCase().includes(query) : false

      if (!matchCode && !matchTitle && !matchRequester && !matchDesc) {
        return false
      }
    }

    return true
  })
}

export interface PmoChangeQueueFilterToolbarProps {
  projects?: ProjectOption[]
  filters: ChangeQueueFilterState
  onFilterChange: (newFilters: ChangeQueueFilterState) => void
  onResetPage?: () => void
  facetCounts?: Partial<Record<ChangeQueueStatusFacet, number>>
  className?: string
}

export function PmoChangeQueueFilterToolbar({
  projects = [],
  filters,
  onFilterChange,
  onResetPage,
  facetCounts,
  className,
}: PmoChangeQueueFilterToolbarProps) {
  const [searchInput, setSearchInput] = React.useState(filters.search)
  const [isProjectMenuOpen, setIsProjectMenuOpen] = React.useState(false)
  const [isPriorityMenuOpen, setIsPriorityMenuOpen] = React.useState(false)
  const [isTypeMenuOpen, setIsTypeMenuOpen] = React.useState(false)

  const projectDropdownRef = React.useRef<HTMLDivElement | null>(null)
  const priorityDropdownRef = React.useRef<HTMLDivElement | null>(null)
  const typeDropdownRef = React.useRef<HTMLDivElement | null>(null)

  // 同步外部 search
  React.useEffect(() => {
    setSearchInput(filters.search)
  }, [filters.search])

  // 300ms 防抖模糊搜索
  React.useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === filters.search) return undefined

    const timer = window.setTimeout(() => {
      onFilterChange({ ...filters, search: trimmed })
      onResetPage?.()
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [searchInput, filters, onFilterChange, onResetPage])

  // 点击外部关闭下拉菜单
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        projectDropdownRef.current &&
        !projectDropdownRef.current.contains(event.target as Node)
      ) {
        setIsProjectMenuOpen(false)
      }
      if (
        priorityDropdownRef.current &&
        !priorityDropdownRef.current.contains(event.target as Node)
      ) {
        setIsPriorityMenuOpen(false)
      }
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(event.target as Node)) {
        setIsTypeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 状态 Tab 切换
  const handleStatusFacetChange = (facet: ChangeQueueStatusFacet) => {
    if (facet === filters.statusFacet) return
    onFilterChange({ ...filters, statusFacet: facet })
    onResetPage?.()
  }

  // 项目多选切换
  const handleToggleProject = (projectId: number) => {
    const exists = filters.projectIds.includes(projectId)
    const nextIds = exists
      ? filters.projectIds.filter((id) => id !== projectId)
      : [...filters.projectIds, projectId]

    onFilterChange({ ...filters, projectIds: nextIds })
    onResetPage?.()
  }

  // 优先级多选切换
  const handleTogglePriority = (p: ChangeRequestPriority) => {
    const exists = filters.priorities.includes(p)
    const nextPriorities = exists
      ? filters.priorities.filter((item) => item !== p)
      : [...filters.priorities, p]

    onFilterChange({ ...filters, priorities: nextPriorities })
    onResetPage?.()
  }

  // 变更类型多选切换
  const handleToggleType = (t: ChangeRequestType) => {
    const exists = filters.types.includes(t)
    const nextTypes = exists ? filters.types.filter((item) => item !== t) : [...filters.types, t]

    onFilterChange({ ...filters, types: nextTypes })
    onResetPage?.()
  }

  // 重置全部筛选条件
  const handleResetFilters = () => {
    setSearchInput('')
    onFilterChange(DEFAULT_FILTER_STATE)
    onResetPage?.()
  }

  const hasActiveFilters =
    filters.statusFacet !== 'pending' ||
    filters.projectIds.length > 0 ||
    filters.priorities.length > 0 ||
    filters.types.length > 0 ||
    filters.search !== ''

  return (
    <div
      data-change-filter-toolbar
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3',
        className,
      )}
    >
      {/* 上层：状态分面标签页 */}
      <div
        data-change-status-tabs
        role="tablist"
        aria-label="变更审批状态分面"
        className="flex flex-wrap items-center gap-1.5 border-b border-[var(--nx-border-hairline)] pb-2.5"
      >
        {STATUS_FACET_OPTIONS.map((facet) => {
          const isActive = filters.statusFacet === facet.key
          const count = facetCounts?.[facet.key]

          return (
            <button
              key={facet.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-change-status-tab={facet.key}
              data-active={isActive ? 'true' : 'false'}
              onClick={() => handleStatusFacetChange(facet.key)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)] shadow-sm'
                  : 'border border-transparent text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-hairline)] hover:bg-[var(--nx-bg-0)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              <span>{facet.label}</span>
              {typeof count === 'number' ? (
                <span
                  data-change-facet-count={facet.key}
                  className={cn(
                    'inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-mono leading-none',
                    isActive
                      ? 'bg-[var(--nx-accent)] text-[var(--nx-space-bg)] font-bold'
                      : 'bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)]',
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* 下层：搜索 + 项目多选 + 优先级 + 类型 + 重置 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 模糊搜索框 (300ms 防抖) */}
        <div className="relative flex h-8 min-w-[200px] flex-1 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 focus-within:border-[var(--nx-border-focus)]">
          <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
          <input
            type="text"
            data-change-search-input
            aria-label="搜索变更编码、标题或申请人"
            placeholder="搜索变更编码、标题或申请人…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full bg-transparent text-xs text-[var(--nx-text-primary)] outline-none placeholder:text-[var(--nx-text-muted)]"
          />
          {searchInput ? (
            <button
              type="button"
              data-change-search-clear
              aria-label="清除搜索关键字"
              onClick={() => {
                setSearchInput('')
                onFilterChange({ ...filters, search: '' })
                onResetPage?.()
              }}
              className="ml-1 rounded p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        {/* 所属项目多选下拉 */}
        <div ref={projectDropdownRef} className="relative">
          <button
            type="button"
            data-change-project-filter
            aria-haspopup="listbox"
            aria-expanded={isProjectMenuOpen}
            onClick={() => setIsProjectMenuOpen((prev) => !prev)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
              filters.projectIds.length > 0
                ? 'border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] text-[var(--nx-accent)] font-medium'
                : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
            )}
          >
            <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {filters.projectIds.length > 0 ? `项目 (${filters.projectIds.length})` : '全部项目'}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          </button>

          {isProjectMenuOpen ? (
            <div
              data-change-project-menu
              role="listbox"
              className="absolute left-0 top-full z-30 mt-1 max-h-60 w-56 overflow-y-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-1.5 shadow-xl"
            >
              {projects.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-[var(--nx-text-muted)]">
                  暂无可选项目
                </div>
              ) : (
                projects.map((proj) => {
                  const isChecked = filters.projectIds.includes(proj.id)
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      role="option"
                      aria-selected={isChecked}
                      data-change-project-option={proj.id}
                      onClick={() => handleToggleProject(proj.id)}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-[var(--nx-text-primary)] hover:bg-[var(--nx-bg-0)]"
                    >
                      <span className="truncate mr-2">
                        {proj.name}
                        {proj.code ? (
                          <span className="ml-1 text-[10px] text-[var(--nx-text-muted)] font-mono">
                            [{proj.code}]
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                          isChecked
                            ? 'border-[var(--nx-space-cyan)] bg-[var(--nx-space-cyan)] text-black'
                            : 'border-[var(--nx-border-hairline)] bg-transparent',
                        )}
                      >
                        {isChecked ? <Check className="h-2.5 w-2.5 stroke-[3]" /> : null}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          ) : null}
        </div>

        {/* 优先级多选下拉 */}
        <div ref={priorityDropdownRef} className="relative">
          <button
            type="button"
            data-change-priority-filter
            aria-haspopup="listbox"
            aria-expanded={isPriorityMenuOpen}
            onClick={() => setIsPriorityMenuOpen((prev) => !prev)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
              filters.priorities.length > 0
                ? 'border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] text-[var(--nx-accent)] font-medium'
                : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {filters.priorities.length > 0
                ? `优先级 (${filters.priorities.length})`
                : '全部优先级'}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          </button>

          {isPriorityMenuOpen ? (
            <div
              data-change-priority-menu
              role="listbox"
              className="absolute left-0 top-full z-30 mt-1 w-40 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-1.5 shadow-xl"
            >
              {PRIORITY_OPTIONS.map((opt) => {
                const isChecked = filters.priorities.includes(opt.key)
                return (
                  <button
                    key={opt.key}
                    type="button"
                    role="option"
                    aria-selected={isChecked}
                    data-change-priority-option={opt.key}
                    onClick={() => handleTogglePriority(opt.key)}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-[var(--nx-text-primary)] hover:bg-[var(--nx-bg-0)]"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: opt.colorToken }}
                      />
                      <span>{opt.label}</span>
                    </span>
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                        isChecked
                          ? 'border-[var(--nx-space-cyan)] bg-[var(--nx-space-cyan)] text-black'
                          : 'border-[var(--nx-border-hairline)] bg-transparent',
                      )}
                    >
                      {isChecked ? <Check className="h-2.5 w-2.5 stroke-[3]" /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        {/* 变更类型多选下拉 */}
        <div ref={typeDropdownRef} className="relative">
          <button
            type="button"
            data-change-type-filter
            aria-haspopup="listbox"
            aria-expanded={isTypeMenuOpen}
            onClick={() => setIsTypeMenuOpen((prev) => !prev)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
              filters.types.length > 0
                ? 'border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] text-[var(--nx-accent)] font-medium'
                : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
            )}
          >
            <span>{filters.types.length > 0 ? `类型 (${filters.types.length})` : '全部类型'}</span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          </button>

          {isTypeMenuOpen ? (
            <div
              data-change-type-menu
              role="listbox"
              className="absolute left-0 top-full z-30 mt-1 w-36 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-1.5 shadow-xl"
            >
              {CHANGE_TYPE_OPTIONS.map((opt) => {
                const isChecked = filters.types.includes(opt.key)
                return (
                  <button
                    key={opt.key}
                    type="button"
                    role="option"
                    aria-selected={isChecked}
                    data-change-type-option={opt.key}
                    onClick={() => handleToggleType(opt.key)}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-[var(--nx-text-primary)] hover:bg-[var(--nx-bg-0)]"
                  >
                    <span>{opt.label}</span>
                    <span
                      className={cn(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                        isChecked
                          ? 'border-[var(--nx-space-cyan)] bg-[var(--nx-space-cyan)] text-black'
                          : 'border-[var(--nx-border-hairline)] bg-transparent',
                      )}
                    >
                      {isChecked ? <Check className="h-2.5 w-2.5 stroke-[3]" /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        {/* 重置筛选条件按钮 */}
        {hasActiveFilters ? (
          <button
            type="button"
            data-change-filter-reset
            onClick={handleResetFilters}
            className="flex h-8 items-center gap-1 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-transparent px-2 text-xs text-[var(--nx-text-muted)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            <span>重置</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
