'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { flexRender, type SortingState } from '@tanstack/react-table'
import {
  getCoreRowModel,
  useLegacyTable,
  type LegacyColumnDef as ColumnDef,
  type LegacyRow,
} from '@tanstack/react-table/legacy'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Checkbox } from '@/components/ui/Checkbox'
import { Progress } from '@/components/ui/Progress'
import type {
  ListGroupField,
  ListSortTerm,
  TaskListGroupSummary,
  TaskListSums,
} from '@/lib/api/list-view'
import type { Task, TaskPriority, TaskStatus } from '@/lib/api/tasks'
import { TASK_STATUS_LABELS, TASK_STATUS_TRANSITIONS } from '@/lib/task-status'
import { TaskStatusPill } from '@/components/views/tasks/TaskStatusPill'
import { InlineDateCell, InlineSelectCell } from '@/components/views/list/TaskListInlineEdit'
import type { TaskTableColumnId } from '@/stores/task-table-store'
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

const PRIORITY_ORDER: readonly TaskPriority[] = ['highest', 'high', 'medium', 'low', 'lowest']

/** 行内编辑提交的字段（v3-classic-ui-openproject-table）。 */
export type TaskInlinePatch =
  | { status: TaskStatus }
  | { priority: TaskPriority }
  | { endDate: string }
  | { assigneeId: number | null }

export interface TaskListInlineEditing {
  canUpdate: boolean
  canAssign: boolean
  /** 可指派的项目成员 [userId, 显示名]。 */
  members: ReadonlyArray<readonly [number, string]>
  pendingTaskIds: ReadonlySet<number>
  onEdit: (task: Task, patch: TaskInlinePatch) => void
}

export interface TaskListTableProps {
  rows: Task[]
  sort: ListSortTerm[]
  selectedIds: Set<number>
  onSortChange: (sort: ListSortTerm[]) => void
  onToggle: (taskId: number, selected: boolean) => void
  onTogglePage: (taskIds: number[], selected: boolean) => void
  onOpen: (taskId: number) => void
  /** 显示的可选列（固定列：选择框、ID、任务）；缺省显示全部默认列。 */
  columns?: readonly TaskTableColumnId[]
  groupBy?: ListGroupField | null
  /** 服务端返回的整份结果每组汇总。 */
  groups?: TaskListGroupSummary[]
  /** 服务端返回的整份结果合计；有值时表格底部显示合计行。 */
  sums?: TaskListSums
  /** 负责人分组名（userId → 显示名）。 */
  memberNames?: ReadonlyMap<number, string>
  editing?: TaskListInlineEditing
}

type TableItem =
  | {
      kind: 'group'
      key: string
      label: string
      summary: TaskListGroupSummary | undefined
      collapsed: boolean
    }
  | { kind: 'task'; row: LegacyRow<Task> }

const DEFAULT_COLUMNS: readonly TaskTableColumnId[] = [
  'priority',
  'status',
  'assignee',
  'progressPercent',
  'endDate',
  'estimatedHours',
]

export function TaskListTable({
  rows,
  sort,
  selectedIds,
  onSortChange,
  onToggle,
  onTogglePage,
  onOpen,
  columns: visibleColumns = DEFAULT_COLUMNS,
  groupBy = null,
  groups,
  sums,
  memberNames,
  editing,
}: TaskListTableProps) {
  const density = useUiStore((state) => state.density)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const pageIds = useMemo(() => rows.map((task) => task.id), [rows])
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length
  const somePageSelected = selectedOnPage > 0 && !allPageSelected
  const sorting = useMemo<SortingState>(
    () => sort.map((term) => ({ id: term.slice(1), desc: term.startsWith('-') })),
    [sort],
  )

  const columns = useMemo<ColumnDef<Task>[]>(() => {
    const pending = (task: Task) => editing?.pendingTaskIds.has(task.id) ?? false
    const optional: Record<TaskTableColumnId, ColumnDef<Task>> = {
      priority: {
        id: 'priority',
        accessorKey: 'priority',
        header: '优先级',
        size: 88,
        cell: ({ row }) => {
          const task = row.original
          const display = (
            <Badge variant={PRIORITY_VARIANTS[task.priority]}>
              {PRIORITY_LABELS[task.priority]}
            </Badge>
          )
          if (!editing?.canUpdate) return display
          return (
            <InlineSelectCell
              field="优先级"
              value={task.priority}
              valueLabel={PRIORITY_LABELS[task.priority]}
              options={PRIORITY_ORDER.map((value) => [value, PRIORITY_LABELS[value]] as const)}
              display={display}
              pending={pending(task)}
              onCommit={(priority) => editing.onEdit(task, { priority })}
            />
          )
        },
      },
      status: {
        id: 'status',
        accessorKey: 'status',
        header: '状态',
        size: 112,
        cell: ({ row }) => {
          const task = row.original
          const display = <TaskStatusPill status={task.status} />
          if (!editing?.canUpdate) return display
          // 只列当前状态与它允许流转到的目标（与后端状态机一致，最终以后端校验为准）
          const targets: TaskStatus[] = [task.status, ...TASK_STATUS_TRANSITIONS[task.status]]
          return (
            <InlineSelectCell
              field="状态"
              value={task.status}
              valueLabel={TASK_STATUS_LABELS[task.status]}
              options={targets.map((value) => [value, TASK_STATUS_LABELS[value]] as const)}
              display={display}
              pending={pending(task)}
              onCommit={(status) => editing.onEdit(task, { status })}
            />
          )
        },
      },
      assignee: {
        id: 'assignee',
        accessorFn: (task) => task.assignee?.fullName || task.assignee?.email,
        header: '负责人',
        size: 160,
        cell: ({ row }) => {
          const task = row.original
          const isAgent = isAgentAssignee(task.assigneeType)
          const name = isAgent
            ? task.agentAssignee?.name || 'AI'
            : task.assignee?.fullName || task.assignee?.email || '未分配'
          const display = (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 truncate text-sm',
                isAgent ? 'text-ai' : 'text-gray-600',
              )}
              aria-label={isAgent ? `AI 负责人：${name}` : undefined}
            >
              {isAgent ? <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              {name}
            </span>
          )
          // AI 负责人不在这里改（需走 AI 指派流程）；人员负责人需 task:assign
          if (isAgent || !editing?.canAssign) return display
          const options: Array<readonly [string, string]> = [
            ['', '未分配'],
            ...editing.members.map(([id, label]) => [String(id), label] as const),
          ]
          if (task.assigneeId !== null && !editing.members.some(([id]) => id === task.assigneeId)) {
            options.push([String(task.assigneeId), name])
          }
          return (
            <InlineSelectCell
              field="负责人"
              value={task.assigneeId === null ? '' : String(task.assigneeId)}
              valueLabel={name}
              options={options}
              display={display}
              pending={pending(task)}
              onCommit={(value) =>
                editing.onEdit(task, { assigneeId: value === '' ? null : Number(value) })
              }
            />
          )
        },
      },
      startDate: {
        id: 'startDate',
        header: '开始日期',
        size: 112,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-gray-600">
            {formatDate(row.original.startDate)}
          </span>
        ),
      },
      progressPercent: {
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
      endDate: {
        id: 'endDate',
        accessorKey: 'endDate',
        header: '计划截止',
        size: 132,
        cell: ({ row }) => {
          const task = row.original
          const overdue = isOverdue(task)
          const display = (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm tabular-nums',
                overdue ? 'font-medium text-danger' : 'text-gray-600',
              )}
            >
              {overdue ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : null}
              {formatDate(task.endDate)}
              {overdue ? <span className="sr-only">（逾期）</span> : null}
            </span>
          )
          if (!editing?.canUpdate) return display
          return (
            <InlineDateCell
              field="计划截止"
              value={task.endDate}
              valueLabel={formatDate(task.endDate)}
              display={display}
              pending={pending(task)}
              onCommit={(endDate) => editing.onEdit(task, { endDate })}
            />
          )
        },
      },
      estimatedHours: {
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
    }

    return [
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
      ...visibleColumns.map((id) => optional[id]),
    ]
  }, [
    allPageSelected,
    editing,
    onOpen,
    onToggle,
    onTogglePage,
    pageIds,
    selectedIds,
    somePageSelected,
    visibleColumns,
  ])

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

  // 分组：服务端已按分组字段排序，同组行相邻；在组切换处插入组头，折叠的组只保留组头。
  const items = useMemo<TableItem[]>(() => {
    if (!groupBy) return tableRows.map((row) => ({ kind: 'task', row }))
    const result: TableItem[] = []
    let current: string | null = null
    for (const row of tableRows) {
      const key = groupKeyOf(row.original, groupBy)
      if (key !== current) {
        current = key
        result.push({
          kind: 'group',
          key,
          label: groupLabelOf(row.original, groupBy, memberNames),
          summary: groups?.find((summary) => String(summary.key) === key),
          collapsed: collapsed.has(`${groupBy}:${key}`),
        })
      }
      if (!collapsed.has(`${groupBy}:${key}`)) result.push({ kind: 'task', row })
    }
    return result
  }, [collapsed, groupBy, groups, memberNames, tableRows])

  function toggleGroup(key: string) {
    const id = `${groupBy}:${key}`
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // OpenProject 式紧凑行：舒适 40 / 紧凑 32
  const rowHeight = density === 'compact' ? 32 : 40
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    initialRect: { width: 1180, height: 480 },
  })
  const measuredRows = rowVirtualizer.getVirtualItems()
  const virtualRows = measuredRows.length
    ? measuredRows
    : items
        .slice(0, Math.ceil(480 / rowHeight) + 12)
        .map((_, index) => ({ index, start: index * rowHeight }))
  const leafColumns = table.getVisibleLeafColumns()
  // 「任务」列吃掉剩余宽度（OpenProject 式主题列），其余列定宽；表格最小总宽 = 各列宽之和。
  const template = leafColumns
    .map((column) =>
      column.id === 'name' ? `minmax(${column.getSize()}px, 1fr)` : `${column.getSize()}px`,
    )
    .join(' ')
  const minWidth = leafColumns.reduce((total, column) => total + column.getSize(), 0)
  const showSums = Boolean(sums)

  return (
    <div
      ref={scrollRef}
      className="max-h-[min(64vh,720px)] overflow-auto [scrollbar-color:var(--color-gray-300)_transparent]"
      role="table"
      aria-label="项目任务列表"
      aria-rowcount={items.length + 1 + (showSums ? 1 : 0)}
      aria-colcount={leafColumns.length}
    >
      <div
        className="sticky top-0 z-10 border-b border-border-strong bg-surface"
        style={{ minWidth }}
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
        className="relative"
        style={{
          minWidth,
          height: `${rowVirtualizer.getTotalSize() || items.length * rowHeight}px`,
        }}
        role="rowgroup"
      >
        {virtualRows.map((virtualRow) => {
          const item = items[virtualRow.index]!
          const position = {
            minHeight: rowHeight,
            transform: `translateY(${virtualRow.start}px)`,
          }
          if (item.kind === 'group') {
            return (
              <div
                key={`group-${item.key}`}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                data-task-group={item.key}
                className="absolute left-0 top-0 flex w-full items-center border-b border-border bg-gray-50"
                style={position}
                role="row"
                aria-rowindex={virtualRow.index + 2}
              >
                <div
                  className="flex min-w-0 items-center gap-2 px-2 py-1 text-sm"
                  role="cell"
                  aria-colspan={leafColumns.length}
                >
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    aria-expanded={!item.collapsed}
                    aria-label={`${item.collapsed ? '展开' : '折叠'}分组：${item.label}`}
                    onClick={() => toggleGroup(item.key)}
                  >
                    {item.collapsed ? (
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    ) : (
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                  <span className="font-semibold text-gray-800">{item.label}</span>
                  {item.summary ? (
                    <span className="rounded-full bg-gray-200 px-2 text-xs tabular-nums text-gray-700">
                      {item.summary.count} 项
                    </span>
                  ) : null}
                  {showSums && item.summary ? (
                    <span className="text-xs tabular-nums text-gray-500">
                      工时 {formatHours(item.summary.actualHours)} /{' '}
                      {formatHours(item.summary.estimatedHours)}
                    </span>
                  ) : null}
                </div>
              </div>
            )
          }
          const row = item.row
          return (
            <div
              key={row.id}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className={cn(
                'absolute left-0 top-0 grid w-full items-center border-b border-border bg-gray-0 hover:bg-primary-50/60',
                selectedIds.has(row.original.id) && 'bg-primary-50',
              )}
              style={{ ...position, gridTemplateColumns: template }}
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

      {sums ? (
        <div
          className="sticky bottom-0 z-10 border-t border-border-strong bg-surface"
          style={{ minWidth }}
          role="rowgroup"
          data-task-table-sums
        >
          <div
            className="grid h-9 items-center text-sm font-medium text-gray-700"
            style={{ gridTemplateColumns: template }}
            role="row"
            aria-rowindex={items.length + 2}
          >
            {leafColumns.map((column) => (
              <div
                key={column.id}
                className="flex h-full min-w-0 items-center border-r border-border/60 px-2 last:border-r-0"
                role="cell"
              >
                {sumCell(column.id, sums)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 合计行各列内容：任务列写合计项数，进度写平均值，工时写实际 / 预计合计。 */
function sumCell(columnId: string, sums: TaskListSums): ReactNode {
  if (columnId === 'name') return <span>合计 · {sums.count} 项</span>
  if (columnId === 'progressPercent') {
    return <span className="tabular-nums">平均 {sums.progressPercent}%</span>
  }
  if (columnId === 'estimatedHours') {
    return (
      <span
        className="tabular-nums"
        aria-label={`实际合计 ${formatHours(sums.actualHours)}，预计合计 ${formatHours(sums.estimatedHours)}`}
      >
        {formatHours(sums.actualHours)} / {formatHours(sums.estimatedHours)}
      </span>
    )
  }
  return null
}

function groupKeyOf(task: Task, groupBy: ListGroupField): string {
  if (groupBy === 'status') return task.status
  if (groupBy === 'priority') return task.priority
  return String(task.assigneeId)
}

function groupLabelOf(
  task: Task,
  groupBy: ListGroupField,
  memberNames?: ReadonlyMap<number, string>,
): string {
  if (groupBy === 'status') return TASK_STATUS_LABELS[task.status]
  if (groupBy === 'priority') return PRIORITY_LABELS[task.priority]
  if (task.assigneeId === null) return '未分配'
  return (
    memberNames?.get(task.assigneeId) ||
    task.assignee?.fullName ||
    task.assignee?.email ||
    `成员 #${task.assigneeId}`
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
