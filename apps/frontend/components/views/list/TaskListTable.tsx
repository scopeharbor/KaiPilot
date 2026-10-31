'use client'

import { useMemo, useRef } from 'react'
import { flexRender, type SortingState } from '@tanstack/react-table'
import {
  getCoreRowModel,
  useLegacyTable,
  type LegacyColumnDef as ColumnDef,
} from '@tanstack/react-table/legacy'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Bot } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Checkbox } from '@/components/ui/Checkbox'
import { Progress } from '@/components/ui/Progress'
import type { ListSortTerm } from '@/lib/api/list-view'
import type { Task, TaskPriority } from '@/lib/api/tasks'
import { TaskStatusPill } from '@/components/views/tasks/TaskStatusPill'
import { isAgentAssignee } from '@/types/agent-assignee'
import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

const PRIORITY_VARIANTS: Record<TaskPriority, 'neutral' | 'info' | 'warning' | 'danger'> = {
  lowest: 'neutral',
  low: 'info',
  medium: 'neutral',
  high: 'warning',
  highest: 'danger',
}

export interface TaskListTableProps {
  rows: Task[]
  sort: ListSortTerm[]
  selectedIds: Set<number>
  onSortChange: (sort: ListSortTerm[]) => void
  onToggle: (taskId: number, selected: boolean) => void
  onTogglePage: (taskIds: number[], selected: boolean) => void
  onOpen: (taskId: number) => void
}

export function TaskListTable({
  rows,
  sort,
  selectedIds,
  onSortChange,
  onToggle,
  onTogglePage,
  onOpen,
}: TaskListTableProps) {
  const density = useUiStore((state) => state.density)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageIds = useMemo(() => rows.map((task) => task.id), [rows])
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length
  const somePageSelected = selectedOnPage > 0 && !allPageSelected
  const sorting = useMemo<SortingState>(
    () => sort.map((term) => ({ id: term.slice(1), desc: term.startsWith('-') })),
    [sort],
  )

  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        id: 'selection',
        size: 48,
        enableSorting: false,
        header: () => (
          <Checkbox
            aria-label="选择当前页全部任务"
            checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
            onCheckedChange={(checked) => onTogglePage(pageIds, checked === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`选择任务：${row.original.name}`}
            checked={selectedIds.has(row.original.id)}
            onCheckedChange={(checked) => onToggle(row.original.id, checked === true)}
          />
        ),
      },
      {
        // OpenProject 式工作包表格：编号独立成列（v3-classic-ui-openproject-views）
        id: 'id',
        header: 'ID',
        size: 72,
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={`打开任务 #${row.original.id}`}
            className="font-mono text-xs text-primary-600 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            onClick={() => onOpen(row.original.id)}
          >
            #{row.original.id}
          </button>
        ),
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: '任务',
        size: 240,
        cell: ({ row }) => (
          <button
            type="button"
            className="block min-w-0 max-w-full text-left focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            onClick={() => onOpen(row.original.id)}
          >
            <span className="block truncate text-gray-800 hover:text-primary-600 hover:underline">
              {row.original.name}
            </span>
          </button>
        ),
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: '优先级',
        size: 80,
        cell: ({ row }) => (
          <Badge variant={PRIORITY_VARIANTS[row.original.priority]}>
            {PRIORITY_LABELS[row.original.priority]}
          </Badge>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: '状态',
        size: 104,
        cell: ({ row }) => <TaskStatusPill status={row.original.status} />,
      },
      {
        id: 'assignee',
        accessorFn: (task) => task.assignee?.fullName || task.assignee?.email,
        header: '负责人',
        size: 160,
        cell: ({ row }) => {
          const task = row.original
          const isAgent = isAgentAssignee(task.assigneeType)
          return (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 truncate text-sm',
                isAgent ? 'text-ai' : 'text-gray-600',
              )}
              aria-label={isAgent ? `AI 负责人：${task.agentAssignee?.name || 'AI'}` : undefined}
            >
              {isAgent ? <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              {isAgent
                ? task.agentAssignee?.name || 'AI'
                : task.assignee?.fullName || task.assignee?.email || '未分配'}
            </span>
          )
        },
      },
      {
        id: 'progressPercent',
        accessorKey: 'progressPercent',
        header: '进度',
        size: 130,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Progress
              className="h-1.5 min-w-16"
              value={row.original.progressPercent}
              aria-label={`${row.original.name} 进度 ${row.original.progressPercent}%`}
            />
            <span className="w-9 text-right text-xs tabular-nums text-gray-500">
              {row.original.progressPercent}%
            </span>
          </div>
        ),
      },
      {
        id: 'endDate',
        accessorKey: 'endDate',
        header: '计划截止',
        size: 124,
        cell: ({ row }) => {
          const overdue = isOverdue(row.original)
          return (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm tabular-nums',
                overdue ? 'font-medium text-danger' : 'text-gray-600',
              )}
            >
              {overdue ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : null}
              {formatDate(row.original.endDate)}
              {overdue ? <span className="sr-only">（逾期）</span> : null}
            </span>
          )
        },
      },
      {
        id: 'estimatedHours',
        accessorKey: 'estimatedHours',
        header: '工时',
        size: 110,
        cell: ({ row }) => (
          <span
            className="text-sm tabular-nums text-gray-600"
            aria-label={`实际 ${formatHours(row.original.actualHours)}，预计 ${formatHours(row.original.estimatedHours)}`}
          >
            {formatHours(row.original.actualHours)} / {formatHours(row.original.estimatedHours)}
          </span>
        ),
      },
    ],
    [allPageSelected, onOpen, onToggle, onTogglePage, pageIds, selectedIds, somePageSelected],
  )

  const table = useLegacyTable({
    data: rows,
    columns,
    state: { sorting },
    manualSorting: true,
    enableMultiSort: true,
    maxMultiSortColCount: 3,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      onSortChange(
        next.slice(0, 3).map(({ id, desc }) => `${desc ? '-' : '+'}${id}` as ListSortTerm),
      )
    },
  })
  const tableRows = table.getRowModel().rows
  // OpenProject 式紧凑行：舒适 40 / 紧凑 32
  const rowHeight = density === 'compact' ? 32 : 40
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    initialRect: { width: 1180, height: 480 },
  })
  const measuredRows = rowVirtualizer.getVirtualItems()
  const virtualRows = measuredRows.length
    ? measuredRows
    : tableRows
        .slice(0, Math.ceil(480 / rowHeight) + 12)
        .map((_, index) => ({ index, start: index * rowHeight }))
  // 「任务」列吃掉剩余宽度（OpenProject 式主题列），其余列定宽；表格最小总宽 1068px（各列宽之和）。
  const template = table
    .getVisibleLeafColumns()
    .map((column) =>
      column.id === 'name' ? `minmax(${column.getSize()}px, 1fr)` : `${column.getSize()}px`,
    )
    .join(' ')

  return (
    <div
      ref={scrollRef}
      className="max-h-[min(64vh,720px)] overflow-auto [scrollbar-color:var(--color-gray-300)_transparent]"
      role="table"
      aria-label="项目任务列表"
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length}
    >
      <div
        className="sticky top-0 z-10 min-w-[1068px] border-b border-border-strong bg-surface"
        role="rowgroup"
      >
        {table.getHeaderGroups().map((headerGroup) => (
          <div
            key={headerGroup.id}
            className="grid h-9 items-center"
            style={{ gridTemplateColumns: template }}
            role="row"
            aria-rowindex={1}
          >
            {headerGroup.headers.map((header) => {
              const sorted = header.column.getIsSorted()
              return (
                <div
                  key={header.id}
                  className="flex h-full min-w-0 items-center border-r border-border px-2 text-left text-xs font-semibold text-gray-700 last:border-r-0"
                  role="columnheader"
                  aria-sort={
                    sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                  }
                >
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      className="inline-flex min-h-8 items-center gap-1 rounded px-1 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                      onClick={header.column.getToggleSortingHandler()}
                      title="点击排序；按住 Shift 可进行多字段排序"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      ) : sorted === 'desc' ? (
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                      )}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div
        className="relative min-w-[1068px]"
        style={{ height: `${rowVirtualizer.getTotalSize() || tableRows.length * rowHeight}px` }}
        role="rowgroup"
      >
        {virtualRows.map((virtualRow) => {
          const row = tableRows[virtualRow.index]!
          return (
            <div
              key={row.id}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className={cn(
                'absolute left-0 top-0 grid w-full items-center border-b border-border bg-gray-0 hover:bg-primary-50/60',
                selectedIds.has(row.original.id) && 'bg-primary-50',
              )}
              style={{
                gridTemplateColumns: template,
                minHeight: rowHeight,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              role="row"
              aria-rowindex={virtualRow.index + 2}
              data-task-id={row.original.id}
            >
              {row.getVisibleCells().map((cell) => (
                <div
                  key={cell.id}
                  className="flex h-full min-w-0 items-center border-r border-border/60 px-2 py-1 text-sm last:border-r-0"
                  role="cell"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString('zh-CN') : '未设置'
}

function formatHours(value: number | null) {
  return value === null ? '—' : `${value}h`
}

function isOverdue(task: Task) {
  if (!task.endDate || task.status === 'completed' || task.status === 'cancelled') return false
  const today = new Date()
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return task.endDate < localDate
}
