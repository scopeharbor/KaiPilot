'use client'

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Search, SlidersHorizontal } from 'lucide-react'
import PermissionGuard from '@/components/PermissionGuard'
import { TaskCard } from '@/components/views/tasks/TaskCard'
import { TaskDetailDrawer } from '@/components/views/tasks/TaskDetailDrawer'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { usePermissions } from '@/hooks/use-permissions'
import { projectKeys, projectMembersApi } from '@/lib/api/projects'
import { useKanbanColumns } from '@/hooks/use-kanban'
import {
  KANBAN_COLUMNS,
  columnForStatus,
  kanbanApi,
  type KanbanColumn,
  type MoveKanbanTaskInput,
} from '@/lib/api/kanban'
import {
  tasksApi,
  type PaginatedTasks,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { canTransition, TASK_STATUS_LABELS } from '@/lib/task-status'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'

type Board = Record<KanbanColumn, Task[]>
type Pages = Record<KanbanColumn, number>

const EMPTY_BOARD: Board = { pending: [], in_progress: [], completed: [], other: [] }
const INITIAL_PAGES: Pages = { pending: 1, in_progress: 1, completed: 1, other: 1 }

export default function ProjectKanbanPage() {
  const projectId = Number(useParams().id)
  return (
    <PermissionGuard
      require="task:view"
      fallback={<Alert className="my-8">你没有查看项目看板的权限。</Alert>}
    >
      <KanbanBoard projectId={projectId} />
    </PermissionGuard>
  )
}

function KanbanBoard({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const currentUserId = useAuthStore((state) => state.user?.id)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  const [priority, setPriority] = useState<TaskPriority | ''>('')
  const [assigneeId, setAssigneeId] = useState<number | ''>('')
  const [pages, setPages] = useState<Pages>(INITIAL_PAGES)
  const [board, setBoard] = useState<Board>(EMPTY_BOARD)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [otherMove, setOtherMove] = useState<{
    task: Task
    beforeTaskId?: number
    afterTaskId?: number
  } | null>(null)

  const filters = useMemo(
    () => ({
      search: deferredSearch || undefined,
      priority: priority || undefined,
      assigneeId: assigneeId || undefined,
      perPage: 25,
    }),
    [assigneeId, deferredSearch, priority],
  )
  const columnQueries = useKanbanColumns(projectId, filters, pages)
  const members = useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => projectMembersApi.list(projectId),
  })

  const queryDataSignature = columnQueries
    .map((query) =>
      query.data?.data.map((task) => `${task.id}:${task.status}:${task.kanbanRank}`).join(','),
    )
    .join('|')
  useEffect(() => {
    // 逐列合并：任一列数据就绪即渲染该列，未就绪列保留上一次值——
    // 避免「某列慢/失败拖累全部列不出卡」（列头计数先出、卡片不出）的首屏空窗。
    setBoard((prev) => ({
      pending: columnQueries[0]?.data?.data ?? prev.pending,
      in_progress: columnQueries[1]?.data?.data ?? prev.in_progress,
      completed: columnQueries[2]?.data?.data ?? prev.completed,
      other: columnQueries[3]?.data?.data ?? prev.other,
    }))
    // The signature tracks server rows without replacing optimistic state on every render.
  }, [queryDataSignature])

  const moveMutation = useMutation({
    mutationFn: (variables: { input: MoveKanbanTaskInput; snapshot: Board }) =>
      kanbanApi.move(projectId, variables.input),
    onSuccess: async () => {
      setMoveError(null)
      await invalidateTaskQueries(queryClient, projectId)
    },
    onError: (error, variables) => {
      setBoard(variables.snapshot)
      setMoveError((error as { message?: string }).message ?? '任务移动失败，已恢复原位置。')
    },
  })
  const createMutation = useMutation({
    mutationFn: (input: { name: string; status: TaskStatus }) => tasksApi.create(projectId, input),
    onSuccess: async () => invalidateTaskQueries(queryClient, projectId),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const canMove = (task: Task) =>
    !moveMutation.isPending &&
    (can('task:update') || (can('task:update:self') && task.assigneeId === currentUserId))

  function resetPages() {
    setPages(INITIAL_PAGES)
  }

  function executeMove(
    task: Task,
    targetColumn: KanbanColumn,
    targetStatus: TaskStatus,
    anchors: { beforeTaskId?: number; afterTaskId?: number } = {},
  ) {
    if (moveMutation.isPending) return
    if (!canTransition(task.status, targetStatus)) {
      setMoveError(
        `不能从“${TASK_STATUS_LABELS[task.status]}”直接移动到“${TASK_STATUS_LABELS[targetStatus]}”。`,
      )
      return
    }
    const snapshot = cloneBoard(board)
    const next = cloneBoard(board)
    const sourceColumn = columnForStatus(task.status)
    next[sourceColumn] = next[sourceColumn].filter((item) => item.id !== task.id)
    const optimistic = { ...task, status: targetStatus }
    const targetRows = next[targetColumn]
    const afterIndex = anchors.afterTaskId
      ? targetRows.findIndex((item) => item.id === anchors.afterTaskId)
      : -1
    if (afterIndex >= 0) targetRows.splice(afterIndex, 0, optimistic)
    else targetRows.push(optimistic)
    setBoard(next)
    moveMutation.mutate({
      input: { taskId: task.id, targetColumn, targetStatus, ...anchors },
      snapshot,
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const task = event.active.data.current?.task as Task | undefined
    if (!task || !event.over) return
    const targetColumn = (event.over.data.current?.column ??
      String(event.over.id).replace('column-', '')) as KanbanColumn
    if (!KANBAN_COLUMNS.some((column) => column.id === targetColumn)) return

    const targetRows = board[targetColumn].filter((item) => item.id !== task.id)
    const overTask =
      event.over.data.current?.type === 'task' ? (event.over.data.current.task as Task) : undefined
    const afterIndex = overTask ? targetRows.findIndex((item) => item.id === overTask.id) : -1
    const anchors =
      afterIndex >= 0
        ? {
            beforeTaskId: targetRows[afterIndex - 1]?.id,
            afterTaskId: targetRows[afterIndex]?.id,
          }
        : { beforeTaskId: targetRows.at(-1)?.id }

    if (targetColumn === 'other' && columnForStatus(task.status) !== 'other') {
      setOtherMove({ task, ...anchors })
      return
    }
    const targetStatus =
      targetColumn === 'other'
        ? task.status
        : KANBAN_COLUMNS.find((column) => column.id === targetColumn)!.statuses[0]!
    executeMove(task, targetColumn, targetStatus, anchors)
  }

  const anyLoading = columnQueries.some((query) => query.isLoading)
  const allEmpty = !anyLoading && Object.values(board).every((rows) => rows.length === 0)
  const hasFilters = Boolean(search || priority || assigneeId)

  return (
    <div className="space-y-5 pb-12 pt-2">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary-600">
            日常执行
          </p>
          <h2 className="text-2xl font-semibold text-gray-800 text-balance">任务看板</h2>
          <p className="max-w-2xl text-sm text-gray-500">
            四列只是六种任务状态的清晰投影；拖动会经过原有状态机、权限与审计。
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block sm:w-64">
            <span className="sr-only">搜索任务</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
            <Input
              value={search}
              className="pl-9"
              placeholder="搜索名称或说明"
              onChange={(event) => {
                setSearch(event.target.value)
                resetPages()
              }}
            />
          </label>
          <FilterSelect
            label="优先级"
            value={priority}
            onChange={(value) => {
              setPriority(value as TaskPriority | '')
              resetPages()
            }}
            options={[
              ['', '全部优先级'],
              ['highest', '最高'],
              ['high', '高'],
              ['medium', '中'],
              ['low', '低'],
              ['lowest', '最低'],
            ]}
          />
          <FilterSelect
            label="负责人"
            value={assigneeId}
            onChange={(value) => {
              setAssigneeId(value ? Number(value) : '')
              resetPages()
            }}
            options={[
              ['', '全部负责人'],
              ...(members.data ?? []).map(
                (member) =>
                  [
                    String(member.userId),
                    member.user?.fullName || member.user?.email || `成员 #${member.userId}`,
                  ] as [string, string],
              ),
            ]}
          />
        </div>
      </header>

      {moveError ? (
        <Alert variant="danger" title="无法移动任务">
          {moveError}
        </Alert>
      ) : null}
      {otherMove ? (
        <Alert variant="warning" title="请选择“其他”列中的真实状态">
          <div className="mt-2 flex flex-wrap gap-2">
            {(['blocked', 'on_hold', 'cancelled'] as const).map((status) => (
              <Button
                key={status}
                size="sm"
                variant="secondary"
                disabled={!canTransition(otherMove.task.status, status)}
                onClick={() => {
                  executeMove(otherMove.task, 'other', status, otherMove)
                  setOtherMove(null)
                }}
              >
                {status === 'blocked' ? '阻塞' : status === 'on_hold' ? '暂停' : '已取消'}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setOtherMove(null)}>
              取消
            </Button>
          </div>
        </Alert>
      ) : null}

      {allEmpty ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border bg-gray-50 px-6 py-12 text-center">
          <SlidersHorizontal className="mx-auto h-8 w-8 text-gray-400" aria-hidden />
          <h3 className="mt-3 font-medium text-gray-800">
            {hasFilters ? '没有符合筛选条件的任务' : '还没有任务'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {hasFilters ? '清除筛选后再试一次。' : '可直接在任意列底部快速创建第一项任务。'}
          </p>
          {hasFilters ? (
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => {
                setSearch('')
                setPriority('')
                setAssigneeId('')
                resetPages()
              }}
            >
              清除筛选
            </Button>
          ) : null}
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event: DragStartEvent) =>
          setActiveTask((event.active.data.current?.task as Task | undefined) ?? null)
        }
        onDragCancel={() => setActiveTask(null)}
        onDragEnd={handleDragEnd}
      >
        <div
          className={cn(
            'flex min-h-[520px] gap-4 overflow-x-auto pb-4',
            '[scrollbar-color:var(--color-gray-300)_transparent]',
          )}
          aria-label="任务看板"
        >
          {KANBAN_COLUMNS.map((column, index) => {
            const result = columnQueries[index]
            return (
              <KanbanLane
                key={column.id}
                column={column}
                rows={board[column.id]}
                query={result?.data}
                loading={result?.isLoading ?? true}
                error={result?.isError ?? false}
                page={pages[column.id]}
                canCreate={can('task:create')}
                createPending={createMutation.isPending}
                canMove={canMove}
                onOpen={setSelectedTaskId}
                onMove={(task, targetColumn, targetStatus) =>
                  executeMove(
                    task,
                    targetColumn,
                    targetStatus ??
                      KANBAN_COLUMNS.find((item) => item.id === targetColumn)!.statuses[0]!,
                  )
                }
                onPage={(page) => setPages((current) => ({ ...current, [column.id]: page }))}
                onCreate={(name, status) => createMutation.mutate({ name, status })}
              />
            )
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="w-[280px] rotate-1">
              <TaskCard task={activeTask} disabled />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskDetailDrawer
        projectId={projectId}
        taskId={selectedTaskId}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null)
        }}
      />
    </div>
  )
}

function KanbanLane({
  column,
  rows,
  query,
  loading,
  error,
  page,
  canCreate,
  createPending,
  canMove,
  onOpen,
  onMove,
  onPage,
  onCreate,
}: {
  column: (typeof KANBAN_COLUMNS)[number]
  rows: Task[]
  query?: PaginatedTasks
  loading: boolean
  error: boolean
  page: number
  canCreate: boolean
  createPending: boolean
  canMove: (task: Task) => boolean
  onOpen: (taskId: number) => void
  onMove: (task: Task, column: KanbanColumn, targetStatus?: TaskStatus) => void
  onPage: (page: number) => void
  onCreate: (name: string, status: TaskStatus) => void
}) {
  const droppable = useDroppable({
    id: `column-${column.id}`,
    data: { type: 'column', column: column.id },
  })

  return (
    <section
      ref={droppable.setNodeRef}
      className={cn(
        'flex w-[min(82vw,300px)] shrink-0 flex-col rounded-[var(--radius-lg)] border border-border bg-gray-50/80',
        'md:w-[300px]',
        'motion-reduce:transition-none',
        droppable.isOver && 'border-primary-300 bg-primary-50/50',
      )}
      aria-labelledby={`kanban-${column.id}`}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 id={`kanban-${column.id}`} className="font-medium text-gray-800">
          {column.label}
        </h3>
        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
          {query?.meta.total ?? rows.length}
        </span>
      </div>
      <SortableContext
        items={rows.map((task) => `task-${task.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="min-h-36 flex-1 space-y-3 p-3">
          {loading
            ? Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-32 w-full" />
              ))
            : null}
          {error ? (
            <p className="rounded-[var(--radius-md)] bg-danger-bg p-3 text-sm text-danger">
              本列加载失败
            </p>
          ) : null}
          {!loading && !error && rows.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-border px-3 py-8 text-center text-sm text-gray-500">
              可将任务拖到这里
            </div>
          ) : null}
          {rows.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              disabled={!canMove(task)}
              onOpen={onOpen}
              onMove={onMove}
            />
          ))}
        </div>
      </SortableContext>
      {query && query.meta.totalPages > 1 ? (
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={page <= 1}
            onClick={() => onPage(Math.max(1, page - 1))}
            aria-label={`${column.label}上一页`}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-gray-500">
            {query.meta.page} / {query.meta.totalPages}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            disabled={page >= query.meta.totalPages}
            onClick={() => onPage(page + 1)}
            aria-label={`${column.label}下一页`}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
      {canCreate ? (
        <QuickCreate column={column.id} pending={createPending} onCreate={onCreate} />
      ) : null}
    </section>
  )
}

function QuickCreate({
  column,
  pending,
  onCreate,
}: {
  column: KanbanColumn
  pending: boolean
  onCreate: (name: string, status: TaskStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [otherStatus, setOtherStatus] = useState<TaskStatus>('blocked')
  if (!open) {
    return (
      <Button className="m-3 mt-0 justify-start" variant="ghost" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        快速创建
      </Button>
    )
  }
  return (
    <form
      className="space-y-2 border-t border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        const status =
          column === 'other'
            ? otherStatus
            : KANBAN_COLUMNS.find((item) => item.id === column)!.statuses[0]!
        onCreate(trimmed, status)
        setName('')
        setOpen(false)
      }}
    >
      <Input
        autoFocus
        value={name}
        maxLength={255}
        placeholder="任务名称"
        onChange={(event) => setName(event.target.value)}
      />
      {column === 'other' ? (
        <FilterSelect
          label="状态"
          value={otherStatus}
          onChange={(value) => setOtherStatus(value as TaskStatus)}
          options={[
            ['blocked', '阻塞'],
            ['on_hold', '暂停'],
            ['cancelled', '已取消'],
          ]}
        />
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={!name.trim()}>
          创建
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </form>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  options: Array<readonly [string, string]>
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        className="h-9 rounded-[var(--radius-md)] border border-border bg-gray-0 px-3 text-sm text-gray-700 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function cloneBoard(board: Board): Board {
  return {
    pending: [...board.pending],
    in_progress: [...board.in_progress],
    completed: [...board.completed],
    other: [...board.other],
  }
}
