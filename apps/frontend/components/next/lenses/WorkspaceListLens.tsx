'use client'

import * as React from 'react'
import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'
import { wbsApi, wbsKeys } from '@/lib/api/wbs'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ListFilter,
  Search,
  X,
} from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { projectMembersApi, projectKeys } from '@/lib/api/projects'
import { taskKeys, tasksApi, type Task, type TaskPriority, type TaskStatus } from '@/lib/api/tasks'
import { InRowTaskPlacementSlot } from '@/components/next/project-space/InRowTaskPlacementSlot'
import { TaskBatchActionBar } from '@/components/next/project-space/TaskBatchActionBar'
import { cn } from '@/lib/utils'
import {
  buildMemberAssigneeIndex,
  formatTaskRows,
  LIST_DEFAULT_PER_PAGE,
  LIST_EMPTY_PLACEHOLDER,
  LIST_MAX_SEARCH_LENGTH,
  LIST_PAGE_SIZE_OPTIONS,
  LIST_PRIORITY_LABEL,
  LIST_PRIORITY_ORDER,
  LIST_SORT_FIELD_LABEL,
  LIST_STATUS_LABEL,
  LIST_STATUS_ORDER,
  nextSortState,
  toTaskListFilters,
  withMemberAssignees,
  withWbsLabels,
  type FormattedTaskRow,
  type ListSortField,
  type ListSortState,
} from '@/lib/next/lenses-list-adapter'

/** 搜索防抖时长（ms，spec：300ms 防抖搜索框；测试可读取常量避免 magic number）。 */
export const LIST_SEARCH_DEBOUNCE_MS = 300

/** 高密度表格 8 列（勾选列 + 编号并入名称列次行）：勾选 / 名称 / 归属层级 / 状态 / 优先级 / 负责人 / 起止排期 / 进度。 */
const TABLE_GRID_TEMPLATE = '36px minmax(220px, 1.6fr) 132px 108px 88px 160px 224px 148px'
const TABLE_GRID_TEMPLATE_PRECISE = '32px minmax(220px, 1.6fr) 132px 108px 88px 160px 224px 148px'

/** 排序入口字段（其余列头非排序列，aria-sort="none"）。 */
const SORTABLE_FIELDS: readonly ListSortField[] = [
  'name',
  'status',
  'priority',
  'endDate',
  'progressPercent',
]

export interface WorkspaceListLensProps {
  projectId: number
  sharedDetail?: boolean
  className?: string
  /** 行激活回调（点击 / Enter / Space；外层装配共享详情抽屉时可接入）。 */
  onOpenTask?: (task: Task) => void
  /** 首屏数据就绪度量（供测试/性能断言，可选）。 */
  onRenderComplete?: (metric: { durationMs: number; activeElements: number }) => void
}

interface ListPreviewMetaRowProps {
  label: string
  children: React.ReactNode
}

/**
 * 列表精确面板镜头（v3-ui-next-remaining-lenses W2 / spec「列表精确面板镜头
 * 高密度渲染与查询联动」）。
 *
 * - 服务端联动：`tasksApi.list` + `taskKeys.list(projectId, filters)`；
 *   表头排序（名称/状态/优先级/截止日/进度：默认 → 升序 → 降序 → 默认）、
 *   状态/优先级下拉筛选、300ms 防抖搜索、底部 25/50 分页——全部只读 GET，
 *   0 POST/PATCH/DELETE（RL-06）；
 * - 高密度：1px 发丝线网格 + 暗黑冷黑曜石底色，36px 行高（精确档压至 32px）；
 *   行内状态发丝线微标 / 优先级徽章 / 负责人（缩写圆标或 AI Agent 天青微标）/
 *   等宽起止时间戳 / 紧凑进度条；
 * - 行交互：鼠标悬停微高亮，点击或键盘聚焦 Enter/Space 唤起只读详情预览
 *   （数据即页面行视图模型，零额外写请求）；
 * - 状态体系：发丝脉冲骨架屏（aria-busy）、筛选空态 + 清除筛选、错误卡 + 重试；
 * - 沉浸阶梯：precise 档压缩行高并停用全部过渡/阴影。
 */
export function WorkspaceListLens({
  projectId,
  sharedDetail = false,
  className,
  onOpenTask,
  onRenderComplete,
}: WorkspaceListLensProps) {
  const mobile = useMobileWorkspace()
  const tier = useImmersionTier()

  // ---- UI 查询状态（全部只读，仅在内存与 GET 参数层运作） ----
  const [statusFilter, setStatusFilter] = React.useState<TaskStatus | null>(null)
  const [priorityFilter, setPriorityFilter] = React.useState<TaskPriority | null>(null)
  const [roleFilter, setRoleFilter] = React.useState<string | null>(null)
  const roleHintsQuery = useQuery({
    queryKey: [...taskKeys.lists(projectId), 'role-hints'] as const,
    queryFn: () => tasksApi.roleHints(projectId),
    staleTime: 60_000,
  })
  const [searchInput, setSearchInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [sort, setSort] = React.useState<ListSortState | null>(null)
  const [page, setPage] = React.useState(1)
  const [perPage, setPerPage] = React.useState<number>(LIST_DEFAULT_PER_PAGE)
  const [previewRow, setPreviewRow] = React.useState<FormattedTaskRow | null>(null)

  // 搜索防抖（300ms）：提交 trim 后关键词并重置回第 1 页。
  React.useEffect(() => {
    const value = searchInput.trim().slice(0, LIST_MAX_SEARCH_LENGTH)
    if (value === search) return undefined
    const timer = window.setTimeout(() => {
      setSearch(value)
      setPage(1)
    }, LIST_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchInput, search])

  const filters = React.useMemo(
    () =>
      toTaskListFilters({
        status: statusFilter ?? undefined,
        priority: priorityFilter ?? undefined,
        roleHint: roleFilter ?? undefined,
        search,
        sort,
        page,
        perPage,
      }),
    [statusFilter, priorityFilter, roleFilter, search, sort, page, perPage],
  )

  const tasksQuery = useQuery({
    queryKey: taskKeys.list(projectId, filters),
    queryFn: () => tasksApi.list(projectId, filters),
    placeholderData: keepPreviousData,
  })

  // 人类负责人补齐（只读成员索引；失败静默——负责人列降级为占位符，不阻塞主数据）。
  const membersQuery = useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectMembersApi.list(projectId),
    staleTime: 60_000,
    retry: 1,
  })
  const memberIndex = React.useMemo(
    () => buildMemberAssigneeIndex(membersQuery.data ?? []),
    [membersQuery.data],
  )

  const wbsQuery = useQuery({
    queryKey: wbsKeys.tree(projectId),
    queryFn: () => wbsApi.tree(projectId),
    staleTime: 60_000,
  })
  const wbsIndex = React.useMemo(
    () =>
      new Map(
        (Array.isArray(wbsQuery.data) ? wbsQuery.data : []).map((node) => [
          node.id,
          { code: node.code, name: node.name },
        ]),
      ),
    [wbsQuery.data],
  )
  const rows = React.useMemo(
    () =>
      withWbsLabels(
        withMemberAssignees(formatTaskRows(tasksQuery.data?.data ?? []), memberIndex),
        wbsIndex,
      ),
    [tasksQuery.data, memberIndex, wbsIndex],
  )
  const meta = tasksQuery.data?.meta

  const hasActiveFilters =
    statusFilter !== null || priorityFilter !== null || roleFilter !== null || search.trim() !== ''
  const showSkeleton = tasksQuery.isPending
  const showErrorCard = tasksQuery.isError && tasksQuery.data === undefined
  const showEmpty =
    !showSkeleton && !showErrorCard && tasksQuery.data !== undefined && rows.length === 0

  // ---- 交互（纯前端状态 / 只读查询参数；零写请求） ----
  const handleSort = (field: ListSortField) => {
    setSort((current) => nextSortState(current, field))
    setPage(1)
  }

  const handleStatusFilter = (value: string) => {
    setStatusFilter((value === 'all' ? null : value) as TaskStatus | null)
    setPage(1)
  }

  const handlePriorityFilter = (value: string) => {
    setPriorityFilter((value === 'all' ? null : value) as TaskPriority | null)
    setPage(1)
  }

  const handlePerPage = (value: string) => {
    setPerPage(Number(value) || LIST_DEFAULT_PER_PAGE)
    setPage(1)
  }

  const clearFilters = () => {
    setStatusFilter(null)
    setPriorityFilter(null)
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  // ---- 多选状态与行间放置建任务（W3 任务 3.1 / 3.5） ----
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(() => new Set())
  const [placementAfterTaskId, setPlacementAfterTaskId] = React.useState<number | null>(null)
  const lastSelectedRowIndexRef = React.useRef<number | null>(null)

  const currentPageTaskIds = React.useMemo(() => rows.map((r) => r.id), [rows])
  const pageSelectedCount = React.useMemo(
    () => currentPageTaskIds.filter((id) => selectedIds.has(id)).length,
    [currentPageTaskIds, selectedIds],
  )
  const isAllPageSelected =
    currentPageTaskIds.length > 0 && pageSelectedCount === currentPageTaskIds.length
  const isIndeterminate =
    (pageSelectedCount > 0 && !isAllPageSelected) || (selectedIds.size > 0 && !isAllPageSelected)

  const handleSelectAllCurrentPage = React.useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (isAllPageSelected) {
        for (const id of currentPageTaskIds) {
          next.delete(id)
        }
      } else {
        for (const id of currentPageTaskIds) {
          next.add(id)
        }
      }
      return next
    })
    lastSelectedRowIndexRef.current = null
  }, [currentPageTaskIds, isAllPageSelected])

  const handleToggleRow = React.useCallback(
    (rowId: number, rowIndex: number, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (shiftKey && lastSelectedRowIndexRef.current !== null) {
          const start = Math.min(lastSelectedRowIndexRef.current, rowIndex)
          const end = Math.max(lastSelectedRowIndexRef.current, rowIndex)
          for (let i = start; i <= end; i++) {
            const targetRow = rows[i]
            if (targetRow) {
              next.add(targetRow.id)
            }
          }
        } else {
          if (next.has(rowId)) {
            next.delete(rowId)
          } else {
            next.add(rowId)
          }
        }
        lastSelectedRowIndexRef.current = rowIndex
        return next
      })
    },
    [rows],
  )

  const openTask = (row: FormattedTaskRow) => {
    onOpenTask?.(row.raw)
    if (!sharedDetail) setPreviewRow(row)
  }

  const handleRowKeyDown = (event: React.KeyboardEvent, row: FormattedTaskRow) => {
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault()
      setPlacementAfterTaskId(row.id)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openTask(row)
    }
  }

  const handlePageStep = (delta: number) => {
    setPage((current) => Math.max(1, current + delta))
  }

  // 首屏度量（可选 onRenderComplete：数据就绪到渲染完成的耗时 + 活动行 DOM 数）。
  const mountedAtRef = React.useRef<number>(performance.now())
  const metricSentRef = React.useRef(false)
  const onRenderCompleteRef = React.useRef(onRenderComplete)
  onRenderCompleteRef.current = onRenderComplete
  React.useEffect(() => {
    if (metricSentRef.current || tasksQuery.isPending || rows.length === 0) return
    metricSentRef.current = true
    const activeElements = document.querySelectorAll('[data-list-lens-row]').length
    onRenderCompleteRef.current?.({
      durationMs: performance.now() - mountedAtRef.current,
      activeElements,
    })
  }, [tasksQuery.isPending, rows.length])

  const rowHeightClass = tier === 'precise' ? 'h-8' : 'h-9'

  return (
    <div
      data-list-lens
      data-immersion={tier}
      role="region"
      aria-label="任务列表镜头"
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]',
        tier === 'precise' && '[transition:none]',
        className,
      )}
    >
      {/* 顶部工具栏：搜索 + 状态下拉 + 优先级下拉 */}
      <div
        data-list-toolbar
        className="flex flex-wrap items-center gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2"
      >
        <div
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2.5',
            'transition-colors focus-within:border-[var(--nx-border-focus)]',
            tier === 'precise' && '[transition:none]',
          )}
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
          <input
            data-list-search
            type="text"
            value={searchInput}
            maxLength={LIST_MAX_SEARCH_LENGTH}
            placeholder="搜索任务名称或描述…"
            aria-label="搜索任务"
            onChange={(event) => setSearchInput(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-[var(--nx-text-primary)] outline-none placeholder:text-[var(--nx-text-muted)]"
          />
          {searchInput !== '' ? (
            <button
              type="button"
              data-list-search-clear
              aria-label="清除搜索"
              onClick={() => {
                setSearchInput('')
                setSearch('')
                setPage(1)
              }}
              className="shrink-0 rounded p-0.5 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <select
          data-list-status-filter
          aria-label="按状态筛选"
          value={statusFilter ?? 'all'}
          onChange={(event) => handleStatusFilter(event.target.value)}
          className={cn(
            'h-8 shrink-0 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 text-xs',
            'text-[var(--nx-text-secondary)] outline-none transition-colors hover:text-[var(--nx-text-primary)]',
            'focus-visible:border-[var(--nx-border-focus)]',
          )}
        >
          <option value="all">全部状态</option>
          {LIST_STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {LIST_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        <select
          data-list-priority-filter
          aria-label="按优先级筛选"
          value={priorityFilter ?? 'all'}
          onChange={(event) => handlePriorityFilter(event.target.value)}
          className={cn(
            'h-8 shrink-0 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 text-xs',
            'text-[var(--nx-text-secondary)] outline-none transition-colors hover:text-[var(--nx-text-primary)]',
            'focus-visible:border-[var(--nx-border-focus)]',
          )}
        >
          <option value="all">全部优先级</option>
          {LIST_PRIORITY_ORDER.map((priority) => (
            <option key={priority} value={priority}>
              {LIST_PRIORITY_LABEL[priority]}
            </option>
          ))}
        </select>
        {(roleHintsQuery.data?.length ?? 0) > 0 ? (
          <select
            data-list-role-filter
            aria-label="按 AI 建议岗位筛选"
            value={roleFilter ?? 'all'}
            onChange={(event) => {
              setRoleFilter(event.target.value === 'all' ? null : event.target.value)
              setPage(1)
            }}
            className={cn(
              'h-8 shrink-0 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 text-xs',
              'text-[var(--nx-text-secondary)] outline-none transition-colors hover:text-[var(--nx-text-primary)]',
              'focus-visible:border-[var(--nx-border-focus)]',
            )}
          >
            <option value="all">全部岗位</option>
            {roleHintsQuery.data!.map(({ role, count }) => (
              <option key={role} value={role}>
                {role}（{count}）
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {/* 数据区：骨架屏 / 错误卡 / 空态 / 表格 */}
      <div className="relative min-h-0 flex-1">
        {showSkeleton ? <ListLensSkeleton tier={tier} /> : null}

        {showErrorCard ? (
          <div
            data-list-error
            role="alert"
            aria-label="任务列表加载错误"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6"
          >
            <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
            <p className="max-w-sm text-center text-xs leading-5 text-[var(--nx-text-secondary)]">
              任务列表加载失败，请检查网络连接后重试。
            </p>
            <button
              type="button"
              data-list-retry
              onClick={() => void tasksQuery.refetch()}
              className={cn(
                'inline-flex h-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)]',
                'bg-[var(--nx-workspace-surface)] px-4 text-xs text-[var(--nx-text-primary)]',
                'transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                tier === 'precise' && '[transition:none]',
              )}
            >
              重新载入
            </button>
          </div>
        ) : null}

        {showEmpty ? (
          <ListLensEmpty filtered={hasActiveFilters} onClearFilters={clearFilters} tier={tier} />
        ) : null}

        {!showSkeleton && !showErrorCard && !showEmpty && tasksQuery.data ? (
          mobile ? (
            <div data-mobile-task-list className="h-full space-y-3 overflow-y-auto p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isAllPageSelected}
                    onChange={handleSelectAllCurrentPage}
                  />
                  全选本页
                </label>
                <select
                  aria-label="任务排序"
                  value={sort ? `${sort.field}:${sort.direction}` : ''}
                  onChange={(event) => {
                    const [field, direction] = event.target.value.split(':')
                    setSort(
                      field
                        ? { field: field as ListSortField, direction: direction as 'asc' | 'desc' }
                        : null,
                    )
                    setPage(1)
                  }}
                  className="min-h-11 max-w-full rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-sm"
                >
                  <option value="">默认排序</option>
                  {SORTABLE_FIELDS.flatMap((field) =>
                    ['asc', 'desc'].map((direction) => (
                      <option key={`${field}:${direction}`} value={`${field}:${direction}`}>
                        {LIST_SORT_FIELD_LABEL[field]}
                        {direction === 'asc' ? '升序' : '降序'}
                      </option>
                    )),
                  )}
                </select>
              </div>
              {rows.map((row, index) => (
                <article
                  key={row.id}
                  data-list-lens-row
                  className="rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
                >
                  <div className="flex items-start gap-2">
                    <label className="flex h-11 w-11 shrink-0 items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label={`选择任务：${row.raw.name}`}
                        checked={selectedIds.has(row.id)}
                        onChange={() => handleToggleRow(row.id, index, false)}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => openTask(row)}
                      className="min-h-11 min-w-0 flex-1 break-words text-left text-base font-medium"
                    >
                      {row.raw.name}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-sm text-[var(--nx-text-secondary)]">
                    <span>{LIST_STATUS_LABEL[row.raw.status]}</span>
                    <span>{LIST_PRIORITY_LABEL[row.raw.priority]}优先级</span>
                    <span>{row.assigneeName}</span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--nx-text-muted)]">{row.dateSpanText}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <progress
                      aria-label="完成进度"
                      value={row.progressPercent}
                      max={100}
                      className="h-2 min-w-0 flex-1 accent-[var(--nx-accent)]"
                    />
                    <span className="text-sm">{row.progressPercent}%</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <ListLensTable
              projectId={projectId}
              rows={rows}
              sort={sort}
              total={meta?.total ?? 0}
              totalPages={meta?.totalPages ?? 1}
              page={page}
              tier={tier}
              rowHeightClass={rowHeightClass}
              selectedTaskId={previewRow?.id ?? null}
              selectedIds={selectedIds}
              isAllPageSelected={isAllPageSelected}
              isIndeterminate={isIndeterminate}
              onSelectAllCurrentPage={handleSelectAllCurrentPage}
              onToggleRow={handleToggleRow}
              placementAfterTaskId={placementAfterTaskId}
              onPlacementOpenChange={setPlacementAfterTaskId}
              onTaskCreated={() => void tasksQuery.refetch()}
              onSort={handleSort}
              onOpenTask={openTask}
              onRowKeyDown={handleRowKeyDown}
            />
          )
        ) : null}
      </div>

      {/* 底部常驻分页控制器 */}
      <div
        data-list-pagination
        className={cn(
          'flex flex-wrap items-center justify-end gap-3 border-t border-[var(--nx-border-hairline)] px-3 py-1.5',
          mobile ? 'min-h-14 py-2' : tier === 'precise' ? 'h-8' : 'h-9',
        )}
      >
        <span className="mr-auto text-[11px] tabular-nums text-[var(--nx-text-muted)]">
          共 {meta?.total ?? 0} 项
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          每页
          <select
            data-list-per-page
            aria-label="每页条数"
            value={perPage}
            onChange={(event) => handlePerPage(event.target.value)}
            className="h-6 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-1 text-[11px] text-[var(--nx-text-secondary)] outline-none focus-visible:border-[var(--nx-border-focus)]"
          >
            {LIST_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          项
        </label>
        <span className="text-[11px] tabular-nums text-[var(--nx-text-muted)]">
          第 {page} / {Math.max(1, meta?.totalPages ?? 1)} 页
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-list-page-prev
            aria-label="上一页"
            disabled={page <= 1}
            onClick={() => handlePageStep(-1)}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
              'transition-colors hover:text-[var(--nx-text-primary)]',
              'disabled:cursor-not-allowed disabled:opacity-40',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]',
              tier === 'precise' && '[transition:none]',
            )}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            data-list-page-next
            aria-label="下一页"
            disabled={page >= (meta?.totalPages ?? 1)}
            onClick={() => handlePageStep(1)}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
              'transition-colors hover:text-[var(--nx-text-primary)]',
              'disabled:cursor-not-allowed disabled:opacity-40',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]',
              tier === 'precise' && '[transition:none]',
            )}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* 浮动暗黑仪器感批量操作栏（已选任务 ≥ 1 时滑出，W3 任务 3.3） */}
      <TaskBatchActionBar
        projectId={projectId}
        selectedIds={Array.from(selectedIds)}
        members={membersQuery.data ?? []}
        onClear={() => setSelectedIds(new Set())}
        onSuccess={() => setSelectedIds(new Set())}
      />

      {/* 只读详情预览（行点击 / Enter / Space 唤起） */}
      {previewRow ? (
        <ListTaskPreview row={previewRow} onClose={() => setPreviewRow(null)} tier={tier} />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 表格
// ---------------------------------------------------------------------------

interface ListLensTableProps {
  projectId: number
  rows: FormattedTaskRow[]
  sort: ListSortState | null
  total: number
  totalPages: number
  page: number
  tier: string
  rowHeightClass: string
  selectedTaskId: number | null
  selectedIds: Set<number>
  isAllPageSelected: boolean
  isIndeterminate: boolean
  onSelectAllCurrentPage: () => void
  onToggleRow: (rowId: number, rowIndex: number, shiftKey: boolean) => void
  placementAfterTaskId: number | null
  onPlacementOpenChange: (taskId: number | null) => void
  onTaskCreated?: () => void
  onSort: (field: ListSortField) => void
  onOpenTask: (row: FormattedTaskRow) => void
  onRowKeyDown: (event: React.KeyboardEvent, row: FormattedTaskRow) => void
}

type AriaSortValue = 'none' | 'ascending' | 'descending'

function ariaSortOf(sort: ListSortState | null, field: ListSortField): AriaSortValue {
  if (!sort || sort.field !== field) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

function ListLensTable({
  projectId,
  rows,
  sort,
  total,
  totalPages,
  page,
  tier,
  rowHeightClass,
  selectedTaskId,
  selectedIds,
  isAllPageSelected,
  isIndeterminate,
  onSelectAllCurrentPage,
  onToggleRow,
  placementAfterTaskId,
  onPlacementOpenChange,
  onTaskCreated,
  onSort,
  onOpenTask,
  onRowKeyDown,
}: ListLensTableProps) {
  const sortParamOf = (field: ListSortField): string | undefined =>
    sort?.field === field ? (sort.direction === 'asc' ? '+' : '-') + field : undefined

  const gridTemplate = tier === 'precise' ? TABLE_GRID_TEMPLATE_PRECISE : TABLE_GRID_TEMPLATE

  const headerCheckboxRef = React.useRef<HTMLInputElement | null>(null)
  const lastShiftKeyRef = React.useRef(false)

  React.useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isIndeterminate
    }
  }, [isIndeterminate])

  return (
    <div className="h-full overflow-auto">
      <div
        role="table"
        aria-label="项目任务高密度列表"
        aria-colcount={8}
        aria-rowcount={total + 1}
        className="min-w-[1080px]"
        data-list-table
        data-list-sort-param={
          sort ? `${sort.direction === 'asc' ? '+' : '-'}${sort.field}` : undefined
        }
      >
        {/* 表头（sticky + 1px 发丝底边） */}
        <div
          role="row"
          className={cn(
            'sticky top-0 z-10 grid border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]',
            tier === 'precise' ? 'h-8' : 'h-9',
          )}
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {/* 行头多选全选复选框（W3 任务 3.1） */}
          <div
            role="columnheader"
            aria-sort="none"
            className="flex items-center justify-center px-1"
          >
            <input
              type="checkbox"
              ref={headerCheckboxRef}
              data-list-select-all
              aria-label="全选当前页任务"
              checked={isAllPageSelected}
              onChange={onSelectAllCurrentPage}
              className="h-3.5 w-3.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-space-cyan)] accent-[var(--nx-space-cyan)]"
            />
          </div>
          <SortableHeaderCell
            label={LIST_SORT_FIELD_LABEL.name}
            field="name"
            sort={sort}
            ariaSort={ariaSortOf(sort, 'name')}
            sortParam={sortParamOf('name')}
            onSort={onSort}
          >
            {selectedIds.size > 0 ? (
              <span
                data-list-selection-count
                className="ml-2 rounded border border-[var(--nx-space-cyan)]/40 bg-[var(--nx-space-cyan)]/10 px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-space-cyan)]"
              >
                已选 {selectedIds.size} 项
              </span>
            ) : null}
          </SortableHeaderCell>
          <div
            role="columnheader"
            aria-sort="none"
            className="flex items-center px-2 text-[10px] font-medium tracking-wide text-[var(--nx-text-muted)]"
            title="所属 WBS 节点或父级任务层级（当前任务接口未附带 WBS 节点名称）"
          >
            归属层级
          </div>
          <SortableHeaderCell
            label={LIST_SORT_FIELD_LABEL.status}
            field="status"
            sort={sort}
            ariaSort={ariaSortOf(sort, 'status')}
            sortParam={sortParamOf('status')}
            onSort={onSort}
          />
          <SortableHeaderCell
            label={LIST_SORT_FIELD_LABEL.priority}
            field="priority"
            sort={sort}
            ariaSort={ariaSortOf(sort, 'priority')}
            sortParam={sortParamOf('priority')}
            onSort={onSort}
          />
          <div
            role="columnheader"
            aria-sort="none"
            className="flex items-center px-2 text-[10px] font-medium tracking-wide text-[var(--nx-text-muted)]"
          >
            负责人
          </div>
          <SortableHeaderCell
            label={LIST_SORT_FIELD_LABEL.endDate}
            field="endDate"
            sort={sort}
            ariaSort={ariaSortOf(sort, 'endDate')}
            sortParam={sortParamOf('endDate')}
            onSort={onSort}
          />
          <SortableHeaderCell
            label={LIST_SORT_FIELD_LABEL.progressPercent}
            field="progressPercent"
            sort={sort}
            ariaSort={ariaSortOf(sort, 'progressPercent')}
            sortParam={sortParamOf('progressPercent')}
            onSort={onSort}
          />
        </div>

        {/* 数据行与行间放置插槽 */}
        {rows.map((row, index) => (
          <React.Fragment key={row.id}>
            <div
              data-list-lens-row
              data-list-row={row.id}
              role="row"
              tabIndex={0}
              aria-selected={selectedTaskId === row.id || undefined}
              aria-label={`任务：${row.name}，状态${row.statusLabel}，进度 ${row.progressPercent}%`}
              onClick={() => onOpenTask(row)}
              onKeyDown={(event) => onRowKeyDown(event, row)}
              className={cn(
                'grid cursor-pointer border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]',
                rowHeightClass,
                'transition-colors hover:bg-[var(--nx-workspace-surface)]',
                'focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-[inset_2px_0_0_var(--nx-space-cyan)] focus-visible:bg-[var(--nx-workspace-surface)]',
                selectedTaskId === row.id && 'bg-[var(--nx-workspace-surface)]',
                selectedIds.has(row.id) && 'bg-[var(--nx-workspace-surface)]/60',
                tier === 'precise' && '[transition:none]',
              )}
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {/* 行头勾选框（W3 任务 3.1） */}
              <div
                role="cell"
                className="flex items-center justify-center px-1"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  data-list-row-checkbox={row.id}
                  aria-label={`选择任务 ${row.name}`}
                  checked={selectedIds.has(row.id)}
                  onClick={(e) => {
                    e.stopPropagation()
                    lastShiftKeyRef.current = e.shiftKey
                  }}
                  onChange={(e) => {
                    e.stopPropagation()
                    const shiftKey = lastShiftKeyRef.current
                    lastShiftKeyRef.current = false
                    onToggleRow(row.id, index, shiftKey)
                  }}
                  className="h-3.5 w-3.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-space-cyan)] accent-[var(--nx-space-cyan)]"
                />
              </div>

              {/* 名称（#编号 次行） */}
              <div role="cell" className="flex min-w-0 flex-col justify-center px-2">
                <span
                  className="truncate text-xs font-medium text-[var(--nx-text-primary)]"
                  title={row.name}
                >
                  {row.name}
                </span>
                <span className="mt-0.5 font-mono text-[10px] tabular-nums text-[var(--nx-text-muted)]">
                  {row.code}
                </span>
              </div>
              {/* 归属层级 */}
              <div role="cell" className="flex items-center px-2">
                <span
                  className="truncate rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                  title={row.wbsLabel !== LIST_EMPTY_PLACEHOLDER ? row.wbsLabel : undefined}
                >
                  {row.wbsLabel}
                </span>
              </div>
              {/* 状态发丝线微标 */}
              <div role="cell" className="flex items-center px-2">
                <StatusHairlineBadge row={row} />
              </div>
              {/* 优先级徽章 */}
              <div role="cell" className="flex items-center px-2">
                <PriorityBadge row={row} />
              </div>
              {/* 负责人 */}
              <div role="cell" className="flex items-center gap-1.5 px-2">
                <AssigneeCell row={row} />
              </div>
              {/* 起止排期（等宽） */}
              <div role="cell" className="flex items-center px-2">
                <span className="font-mono text-[11px] tabular-nums text-[var(--nx-text-secondary)]">
                  {row.dateSpanText}
                </span>
              </div>
              {/* 进度 */}
              <div role="cell" className="flex items-center gap-2 px-2">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={row.progressPercent}
                  aria-label={`${row.name} 进度 ${row.progressPercent}%`}
                  className="h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-[var(--nx-border-hairline)]"
                >
                  <div
                    className="h-full rounded-sm bg-[var(--nx-workspace-blue)]"
                    style={{ width: `${row.progressPercent}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--nx-text-muted)]">
                  {row.progressPercent}%
                </span>
              </div>
            </div>

            {/* 行间放置建任务插槽（W3 任务 3.5） */}
            <InRowTaskPlacementSlot
              projectId={projectId}
              afterTaskId={row.id}
              open={placementAfterTaskId === row.id}
              onOpenChange={(isOpen) => onPlacementOpenChange(isOpen ? row.id : null)}
              onCreated={onTaskCreated}
            />
          </React.Fragment>
        ))}
      </div>
      <div className="sr-only" aria-live="polite">
        第 {page} 页，共 {totalPages} 页，共 {total} 项任务
      </div>
    </div>
  )
}

function SortableHeaderCell({
  label,
  field,
  sort,
  ariaSort,
  sortParam,
  onSort,
  children,
}: {
  label: string
  field: ListSortField
  sort: ListSortState | null
  ariaSort: AriaSortValue
  sortParam?: string
  onSort: (field: ListSortField) => void
  children?: React.ReactNode
}) {
  const active = sort?.field === field
  const isSortable = (SORTABLE_FIELDS as readonly string[]).includes(field)
  return (
    <div
      role="columnheader"
      aria-sort={ariaSort}
      data-list-sortable-header={isSortable ? field : undefined}
      data-list-sort-param={sortParam}
      className="flex items-center px-2"
    >
      {isSortable ? (
        <button
          type="button"
          data-list-sort={field}
          aria-label={`按${label}排序（当前：${active ? (sort?.direction === 'asc' ? '升序' : '降序') : '默认序'}）`}
          onClick={() => onSort(field)}
          className={cn(
            'inline-flex h-full min-w-0 items-center gap-1 text-[10px] font-medium tracking-wide',
            active ? 'text-[var(--nx-text-primary)]' : 'text-[var(--nx-text-muted)]',
            'transition-colors hover:text-[var(--nx-text-primary)]',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]',
          )}
        >
          <span className="truncate">{label}</span>
          {active && sort?.direction === 'asc' ? (
            <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
          ) : active && sort?.direction === 'desc' ? (
            <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
          ) : (
            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
          )}
        </button>
      ) : (
        <span className="text-[10px] font-medium tracking-wide text-[var(--nx-text-muted)]">
          {label}
        </span>
      )}
      {children}
    </div>
  )
}

function StatusHairlineBadge({ row }: { row: FormattedTaskRow }) {
  return (
    <span
      data-list-status={row.status}
      className="inline-flex max-w-full items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[10px] leading-none"
      style={{
        borderColor: `var(${row.statusToken})`,
        color: 'var(--nx-text-secondary)',
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: `var(${row.statusToken})` }}
      />
      <span className="truncate">{row.statusLabel}</span>
    </span>
  )
}

function PriorityBadge({ row }: { row: FormattedTaskRow }) {
  return (
    <span
      data-list-priority={row.priority}
      className="inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] leading-none"
      style={{
        borderColor: `var(${row.priorityToken})`,
        color: `var(${row.priorityToken})`,
      }}
    >
      {row.priorityLabel}
    </span>
  )
}

function AssigneeCell({ row }: { row: FormattedTaskRow }) {
  if (row.isAgentAssignee) {
    return (
      <span
        data-list-agent-assignee
        className="inline-flex min-w-0 items-center gap-1 rounded-sm border border-[var(--nx-space-cyan)]/50 bg-[var(--nx-space-cyan)]/10 px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-space-cyan)]"
        aria-label={`AI 负责人：${row.assigneeName}`}
      >
        <Bot className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{row.assigneeName}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        data-list-assignee-initials
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--nx-border-hairline)] text-[9px]',
          row.assigneeInitials === LIST_EMPTY_PLACEHOLDER
            ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-muted)]'
            : 'bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)]',
        )}
      >
        {row.assigneeInitials}
      </span>
      <span
        data-list-assignee-name
        className="truncate text-xs text-[var(--nx-text-secondary)]"
        title={row.assigneeName}
      >
        {row.assigneeName}
      </span>
      {row.raw.roleHint ? (
        <span
          data-list-role-hint
          title={`AI 建议岗位：${row.raw.roleHint}`}
          className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1 py-0.5 text-[10px] leading-none text-[var(--nx-text-muted)]"
        >
          {row.raw.roleHint}
        </span>
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 状态反馈：骨架屏 / 空态
// ---------------------------------------------------------------------------

function ListLensSkeleton({ tier }: { tier: string }) {
  const bar = (className: string) => (
    <div className={cn('animate-pulse rounded-sm bg-[var(--nx-bg-1)]', className)} />
  )
  return (
    <div
      data-list-skeleton
      role="status"
      aria-label="正在加载任务列表"
      aria-busy="true"
      className="absolute inset-0 z-10 overflow-hidden bg-[var(--nx-workspace-bg)]"
    >
      <div
        className={cn(
          'grid items-center border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]',
          tier === 'precise' ? 'h-8' : 'h-9',
        )}
        style={{
          gridTemplateColumns:
            tier === 'precise' ? TABLE_GRID_TEMPLATE_PRECISE : TABLE_GRID_TEMPLATE,
        }}
      >
        <div className="flex items-center justify-center px-1">{bar('h-3.5 w-3.5')}</div>
        {['任务名称', '归属层级', '状态', '优先级', '负责人', '起止排期', '进度'].map((label) => (
          <div
            key={label}
            className="px-2 text-[10px] font-medium tracking-wide text-[var(--nx-text-muted)]"
          >
            {label}
          </div>
        ))}
      </div>
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className={cn(
            'grid items-center gap-2 border-b border-[var(--nx-border-hairline)] px-2',
            tier === 'precise' ? 'h-8' : 'h-9',
          )}
          style={{
            gridTemplateColumns:
              tier === 'precise' ? TABLE_GRID_TEMPLATE_PRECISE : TABLE_GRID_TEMPLATE,
          }}
        >
          <div className="flex items-center justify-center">{bar('h-3.5 w-3.5')}</div>
          <div className="flex flex-col gap-1.5">
            {bar('h-2.5 w-3/5')}
            {bar('h-1.5 w-1/4')}
          </div>
          {bar('h-4 w-3/4')}
          {bar('h-4 w-2/3')}
          {bar('h-4 w-1/2')}
          <div className="flex items-center gap-1.5">
            {bar('h-5 w-5 rounded-full')}
            {bar('h-2.5 w-2/3')}
          </div>
          {bar('h-2.5 w-5/6')}
          {bar('h-2 w-3/4')}
        </div>
      ))}
    </div>
  )
}

function ListLensEmpty({
  filtered,
  onClearFilters,
  tier,
}: {
  filtered: boolean
  onClearFilters: () => void
  tier: string
}) {
  return (
    <div
      data-list-empty
      role="status"
      aria-label={filtered ? '未找到匹配的任务' : '当前项目暂无任务'}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6"
    >
      <ListFilter className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
      <p className="text-sm font-medium text-[var(--nx-text-primary)]">
        {filtered ? '未找到匹配的任务' : '当前项目暂无任务'}
      </p>
      <p className="max-w-sm text-center text-xs leading-5 text-[var(--nx-text-muted)]">
        {filtered
          ? '请尝试调整筛选条件，或清除筛选查看全部任务。'
          : '任务创建后将在此以高密度列表呈现，便于精确排序、筛选与批量审阅。'}
      </p>
      {filtered ? (
        <button
          type="button"
          data-list-clear-filters
          onClick={onClearFilters}
          className={cn(
            'inline-flex h-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)]',
            'bg-[var(--nx-workspace-surface)] px-4 text-xs text-[var(--nx-text-primary)]',
            'transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
            tier === 'precise' && '[transition:none]',
          )}
        >
          清除筛选
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 只读任务详情预览（行点击 / Enter / Space 唤起；Esc / 遮罩 / 关闭按钮退出）
// ---------------------------------------------------------------------------

function ListTaskPreview({
  row,
  onClose,
  tier,
}: {
  row: FormattedTaskRow
  onClose: () => void
  tier: string
}) {
  const closeRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const raw = row.raw
  const metaCell = ({ label, children }: ListPreviewMetaRowProps) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--nx-border-hairline)] py-2">
      <span className="shrink-0 text-[11px] text-[var(--nx-text-muted)]">{label}</span>
      <span className="min-w-0 truncate text-xs text-[var(--nx-text-secondary)]">{children}</span>
    </div>
  )

  return (
    <div
      data-list-preview-backdrop
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={onClose}
    >
      <aside
        data-list-preview
        role="dialog"
        aria-modal="true"
        aria-label={`任务详情：${row.name}`}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'flex h-full w-full max-w-[420px] flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]',
          tier === 'precise' ? '[transition:none]' : 'transition-transform duration-200 ease-out',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-[var(--nx-text-primary)]">
              {row.name}
            </h3>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--nx-text-muted)]">
              {row.code}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            data-list-preview-close
            aria-label="关闭任务详情"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex items-center gap-2 px-4 pt-3">
          <StatusHairlineBadge row={row} />
          <PriorityBadge row={row} />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          {metaCell({
            label: '负责人',
            children: (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {row.isAgentAssignee ? (
                  <>
                    <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--nx-space-cyan)]" aria-hidden />
                    <span className="text-[var(--nx-space-cyan)]">AI 负责人</span>
                  </>
                ) : null}
                <span className="truncate">{row.assigneeName}</span>
              </span>
            ),
          })}
          {metaCell({
            label: '审核人',
            children: raw.reviewer?.fullName || raw.reviewer?.email || LIST_EMPTY_PLACEHOLDER,
          })}
          {metaCell({
            label: '起止排期',
            children: (
              <span className="font-mono text-[11px] tabular-nums">{row.dateSpanText}</span>
            ),
          })}
          {metaCell({ label: '工期', children: row.durationText })}
          {metaCell({
            label: '进度',
            children: (
              <span className="inline-flex items-center gap-2">
                <span
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={row.progressPercent}
                  aria-label={`进度 ${row.progressPercent}%`}
                  className="h-1.5 w-24 overflow-hidden rounded-sm bg-[var(--nx-border-hairline)]"
                >
                  <span
                    className="block h-full rounded-sm bg-[var(--nx-workspace-blue)]"
                    style={{ width: `${row.progressPercent}%` }}
                  />
                </span>
                <span className="font-mono tabular-nums">{row.progressPercent}%</span>
              </span>
            ),
          })}
          {metaCell({
            label: '任务类型',
            children:
              { task: '任务', milestone: '里程碑', summary: '汇总', deliverable: '交付物' }[
                raw.taskType
              ] ?? raw.taskType,
          })}
          {metaCell({
            label: '依赖关联',
            children:
              raw.dependencyCount !== undefined
                ? `${raw.dependencyCount} 项（前置 / 后置合计）`
                : LIST_EMPTY_PLACEHOLDER,
          })}
          {metaCell({
            label: '子任务',
            children:
              raw.subtaskCount !== undefined ? `${raw.subtaskCount} 项` : LIST_EMPTY_PLACEHOLDER,
          })}
          {metaCell({
            label: '创建时间',
            children: raw.createdAt.slice(0, 10) || LIST_EMPTY_PLACEHOLDER,
          })}
        </div>

        <section className="border-t border-[var(--nx-border-hairline)] px-4 py-3">
          <h4 className="text-[11px] font-medium text-[var(--nx-text-muted)]">描述</h4>
          <p
            data-list-preview-description
            className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-[var(--nx-text-secondary)]"
          >
            {raw.description || '暂无描述'}
          </p>
        </section>
      </aside>
    </div>
  )
}

export default WorkspaceListLens
