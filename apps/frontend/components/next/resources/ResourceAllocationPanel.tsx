'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Link2, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import {
  allocationKeys,
  allocationsApi,
  type AllocationType,
  type ResourceAllocation,
} from '@/lib/api/resources'
import { tasksApi, taskKeys, type Task } from '@/lib/api/tasks'
import {
  ALLOCATION_TYPE_LABELS,
  allocationTypeLabel,
  formatAllocationRange,
} from '@/lib/next/resources/resource-workbench-adapter'

/**
 * 资源-任务分配明细面板（v3-ui-next-resource-team-domains W1 · tasks 1.7，
 * spec「资源任务分配明细与受控分配管理」）。
 *
 * - 按资源归集展示任务分配明细（GET /resources/:id/allocations）：任务编号、
 *   任务标题（经项目任务底册映射）、分配类型（assigned/allocated/reserved）、
 *   分配比例 % 与计划起止日期；
 * - 受控写操作（resource:manage 门禁，只读时新增/编辑/解除入口物理隐藏）：
 *   - 「分配任务」抽屉：选择项目内未完成任务 + 1%~100% 占比与生效日期
 *     （POST .../allocations）；
 *   - 行内编辑占比/日期（PATCH .../allocations/:allocationId）；
 *   - 解除分配两步确认（DELETE .../allocations/:allocationId），成功后容量恢复；
 * - 变更成功统一失效 allocationKeys.lists(projectId, resourceId) 并回调 onChanged
 *   （供资源底册/负荷缓存联动刷新）；纯展示零写入口（RL-01）。
 */

const TASK_LIST_PAGE = { perPage: 100 } as const

const OPEN_TASK_STATUSES: ReadonlySet<Task['status']> = new Set([
  'not_started',
  'in_progress',
  'blocked',
  'on_hold',
])

/** ApiError（非 Error 实例）与 Error 统一提取可读 message。 */
function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}

export interface ResourceAllocationPanelProps {
  projectId: number
  resourceId: number
  resourceName: string
  /** resource:manage 写权限（只读：新增/编辑/解除分配物理隐藏）。 */
  canManage: boolean
  /** 写操作成功后的外部刷新回调（如资源底册重查）。 */
  onChanged?: () => void
}

export function ResourceAllocationPanel({
  projectId,
  resourceId,
  resourceName,
  canManage,
  onChanged,
}: ResourceAllocationPanelProps) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [deletingAllocation, setDeletingAllocation] = React.useState<ResourceAllocation | null>(
    null,
  )

  const allocationsQuery = useQuery({
    queryKey: allocationKeys.lists(projectId, resourceId),
    queryFn: () => allocationsApi.list(projectId, resourceId, { perPage: 100 }),
  })
  const tasksQuery = useQuery({
    queryKey: taskKeys.list(projectId, TASK_LIST_PAGE),
    queryFn: () => tasksApi.list(projectId, TASK_LIST_PAGE),
    // 标题映射失败不阻断明细展示（仅回退为任务编号）。
    retry: 1,
  })

  const taskById = React.useMemo(() => {
    const map = new Map<number, Task>()
    for (const task of tasksQuery.data?.data ?? []) map.set(task.id, task)
    return map
  }, [tasksQuery.data])

  const refreshAllocations = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: allocationKeys.lists(projectId, resourceId) })
  }, [queryClient, projectId, resourceId])

  const refreshAfterWrite = React.useCallback(() => {
    refreshAllocations()
    onChanged?.()
  }, [refreshAllocations, onChanged])

  const removeAllocation = useMutation({
    mutationFn: (allocationId: number) =>
      allocationsApi.delete(projectId, resourceId, allocationId),
    onSuccess: () => {
      setDeletingAllocation(null)
      refreshAfterWrite()
    },
  })

  const allocations = allocationsQuery.data?.data ?? []
  const allocatedTaskIds = new Set(allocations.map((item) => item.taskId))
  const assignableTasks = (tasksQuery.data?.data ?? []).filter(
    (task) => OPEN_TASK_STATUSES.has(task.status) && !allocatedTaskIds.has(task.id),
  )

  return (
    <section
      data-resource-allocation-panel
      aria-label={`${resourceName} 的任务分配明细`}
      className="flex flex-col gap-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--nx-accent)]" aria-hidden />
          <h4 className="truncate text-[13px] font-medium text-[var(--nx-text-primary)]">
            {resourceName} · 任务分配明细
          </h4>
          <span
            data-alloc-count
            className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-px font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            {allocations.length} 项
          </span>
          {!canManage ? (
            <span
              data-alloc-readonly-note
              className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-px text-[10px] text-[var(--nx-text-muted)]"
            >
              只读
            </span>
          ) : null}
        </div>
        {canManage ? (
          <button
            type="button"
            data-alloc-add-open
            onClick={() => setAddOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <Plus className="h-3 w-3" aria-hidden />
            分配任务
          </button>
        ) : null}
      </header>

      {allocationsQuery.isPending ? (
        <div
          data-alloc-skeleton
          aria-busy="true"
          aria-label="正在加载任务分配明细"
          className="flex flex-col gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] p-2"
        >
          {[0, 1].map((line) => (
            <div key={line} className="flex h-9 items-center gap-3 px-2">
              <div className="h-3 w-14 animate-pulse rounded bg-[var(--nx-bg-1)]" />
              <div className="h-3 w-40 animate-pulse rounded bg-[var(--nx-bg-1)]" />
              <div className="h-3 w-10 animate-pulse rounded bg-[var(--nx-bg-1)]" />
              <div className="h-3 min-w-0 flex-1 animate-pulse rounded bg-[var(--nx-bg-1)]" />
            </div>
          ))}
        </div>
      ) : allocationsQuery.isError ? (
        <div
          data-alloc-error
          role="alert"
          aria-label="任务分配明细加载失败"
          className="flex items-center justify-between gap-3 rounded-sm border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-3 py-2"
        >
          <p className="text-[11px] text-[var(--nx-text-secondary)]">
            分配明细加载失败：
            {allocationsQuery.error instanceof Error ? allocationsQuery.error.message : '网络异常'}
          </p>
          <button
            type="button"
            data-alloc-retry
            onClick={() => void allocationsQuery.refetch()}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] px-1.5 text-[10px] text-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            重试
          </button>
        </div>
      ) : allocations.length === 0 ? (
        <div
          data-alloc-empty
          className="rounded-sm border border-[var(--nx-border-hairline)] px-3 py-5 text-center"
        >
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            该资源暂无任务分配{canManage ? '，点击「分配任务」挂接任务工时' : ''}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-[var(--nx-border-hairline)]">
          <table className="w-full min-w-[760px] border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">任务</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">任务标题</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">分配类型</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">占比</th>
                <th className="whitespace-nowrap px-2 py-1.5 font-medium">计划日期</th>
                <th className="w-24 px-2 py-1.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((allocation) => {
                const task = taskById.get(allocation.taskId)
                const editing = editingId === allocation.id
                return editing ? (
                  <AllocationEditRow
                    key={allocation.id}
                    projectId={projectId}
                    resourceId={resourceId}
                    allocation={allocation}
                    onSaved={() => {
                      setEditingId(null)
                      refreshAfterWrite()
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <tr
                    key={allocation.id}
                    data-alloc-row={allocation.id}
                    className="border-b border-[var(--nx-border-hairline)]/60 text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)]/40"
                  >
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span
                        data-alloc-task-id
                        className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-px font-mono text-[10px] text-[var(--nx-text-primary)]"
                      >
                        #{allocation.taskId}
                      </span>
                    </td>
                    <td
                      data-alloc-task-title
                      className="max-w-[220px] truncate px-2 py-1.5 text-[var(--nx-text-primary)]"
                      title={task?.name ?? `任务 #${allocation.taskId}`}
                    >
                      {task?.name ?? `任务 #${allocation.taskId}`}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span
                        data-alloc-type={allocation.allocationType}
                        className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-px text-[10px] text-[var(--nx-text-muted)]"
                      >
                        {allocationTypeLabel(allocation.allocationType)}
                      </span>
                    </td>
                    <td
                      data-alloc-percent
                      className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[var(--nx-text-primary)]"
                    >
                      {allocation.allocationPercent}%
                    </td>
                    <td
                      data-alloc-range
                      className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
                    >
                      {formatAllocationRange(allocation.startDate, allocation.endDate)}
                    </td>
                    <td className="px-2 py-1.5">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            data-alloc-edit-open={allocation.id}
                            aria-label={`编辑任务 #${allocation.taskId} 的分配`}
                            onClick={() => {
                              setEditingId(allocation.id)
                              setAddOpen(false)
                            }}
                            className="inline-flex h-6 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                          >
                            <Pencil className="h-3 w-3" aria-hidden />
                            编辑
                          </button>
                          <button
                            type="button"
                            data-alloc-delete-open={allocation.id}
                            aria-label={`解除任务 #${allocation.taskId} 的分配`}
                            onClick={() => setDeletingAllocation(allocation)}
                            className="inline-flex h-6 items-center gap-1 rounded-sm border border-transparent px-1.5 text-[10px] text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-status-danger)]/50 hover:text-[var(--nx-status-danger)]"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden />
                            解除
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增分配抽屉 */}
      {addOpen && canManage ? (
        <AllocationCreateDrawer
          projectId={projectId}
          resourceId={resourceId}
          resourceName={resourceName}
          tasks={assignableTasks}
          defaultType="assigned"
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false)
            refreshAfterWrite()
          }}
        />
      ) : null}

      {/* 解除分配两步确认 */}
      {deletingAllocation ? (
        <div data-alloc-delete-dialog-overlay className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭解除分配弹窗"
            tabIndex={-1}
            onClick={() => setDeletingAllocation(null)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认解除任务分配"
            data-alloc-delete-dialog
            className="absolute left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                确认解除任务分配
              </h3>
            </header>
            <div className="px-5 py-4">
              <p className="text-[13px] text-[var(--nx-text-secondary)]">
                将解除任务{' '}
                <b className="text-[var(--nx-text-primary)]">
                  {taskById.get(deletingAllocation.taskId)?.name ??
                    `任务 #${deletingAllocation.taskId}`}
                  <span className="font-mono text-[var(--nx-text-muted)]">
                    {' '}
                    #{deletingAllocation.taskId}
                  </span>
                </b>{' '}
                对「{resourceName}」的 {deletingAllocation.allocationPercent}% 工时占用，
                解除后该资源可用容量即刻恢复。
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <button
                type="button"
                data-alloc-delete-cancel
                onClick={() => setDeletingAllocation(null)}
                disabled={removeAllocation.isPending}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-alloc-delete-ok
                disabled={removeAllocation.isPending}
                onClick={() => removeAllocation.mutate(deletingAllocation.id)}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.12)] px-4 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)] hover:text-white disabled:opacity-50"
              >
                {removeAllocation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                )}
                确认解除
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** 行内编辑（占比 / 起止日期），PATCH 落库。 */
function AllocationEditRow({
  projectId,
  resourceId,
  allocation,
  onSaved,
  onCancel,
}: {
  projectId: number
  resourceId: number
  allocation: ResourceAllocation
  onSaved: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [percent, setPercent] = React.useState(String(allocation.allocationPercent))
  const [startDate, setStartDate] = React.useState(allocation.startDate ?? '')
  const [endDate, setEndDate] = React.useState(allocation.endDate ?? '')
  const [fieldError, setFieldError] = React.useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: () =>
      allocationsApi.update(projectId, resourceId, allocation.id, {
        allocationPercent: Number(percent),
        startDate: startDate === '' ? undefined : startDate,
        endDate: endDate === '' ? undefined : endDate,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: allocationKeys.lists(projectId, resourceId) })
      onSaved()
    },
    onError: (error) => {
      setFieldError(errorText(error, '更新分配失败，请重试'))
    },
  })

  const numericPercent = Number(percent)
  const valid = Number.isFinite(numericPercent) && numericPercent >= 1 && numericPercent <= 100

  const inputClass =
    'h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] font-mono text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)]'
  return (
    <tr
      data-alloc-edit-row={allocation.id}
      className="border-b border-[var(--nx-border-focus)]/40 bg-[var(--nx-bg-1)]/40"
    >
      <td className="whitespace-nowrap px-2 py-1.5">
        <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-px font-mono text-[10px] text-[var(--nx-text-primary)]">
          #{allocation.taskId}
        </span>
      </td>
      <td colSpan={4} className="px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
            占比
            <input
              type="number"
              min={1}
              max={100}
              data-alloc-edit-percent
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              aria-label="分配占比百分比"
              className={`${inputClass} w-16`}
            />
            %
          </label>
          <label className="flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
            起
            <input
              type="date"
              data-alloc-edit-start
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              aria-label="生效开始日期"
              className={`${inputClass} w-32`}
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-[var(--nx-text-muted)]">
            止
            <input
              type="date"
              data-alloc-edit-end
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              aria-label="生效结束日期"
              className={`${inputClass} w-32`}
            />
          </label>
          {fieldError ? (
            <span
              role="alert"
              data-alloc-edit-error
              className="text-[10px] text-[var(--nx-status-danger)]"
            >
              {fieldError}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            data-alloc-edit-cancel
            onClick={onCancel}
            disabled={updateMutation.isPending}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 text-[10px] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            <X className="h-3 w-3" aria-hidden />
            取消
          </button>
          <button
            type="button"
            data-alloc-edit-save
            disabled={!valid || updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-1.5 text-[10px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Pencil className="h-3 w-3" aria-hidden />
            )}
            保存
          </button>
        </div>
      </td>
    </tr>
  )
}

/** 「分配任务」受控抽屉。 */
function AllocationCreateDrawer({
  projectId,
  resourceId,
  resourceName,
  tasks,
  defaultType,
  onClose,
  onSaved,
}: {
  projectId: number
  resourceId: number
  resourceName: string
  tasks: Task[]
  defaultType: AllocationType
  onClose: () => void
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const [taskId, setTaskId] = React.useState<number | ''>('')
  const [allocationType, setAllocationType] = React.useState<AllocationType>(defaultType)
  const [percent, setPercent] = React.useState('50')
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = React.useState(today)
  const [endDate, setEndDate] = React.useState(today)
  const [fieldError, setFieldError] = React.useState<string | null>(null)

  // Esc 关闭
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const createMutation = useMutation({
    mutationFn: () =>
      allocationsApi.create(projectId, resourceId, {
        taskId: Number(taskId),
        allocationType,
        allocationPercent: Number(percent),
        startDate: startDate === '' ? undefined : startDate,
        endDate: endDate === '' ? undefined : endDate,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: allocationKeys.lists(projectId, resourceId) })
      onSaved()
    },
    onError: (error) => {
      setFieldError(errorText(error, '分配失败，请稍后重试'))
    },
  })

  const numericPercent = Number(percent)
  const percentValid =
    Number.isFinite(numericPercent) && numericPercent >= 1 && numericPercent <= 100
  const canSubmit = taskId !== '' && percentValid && !createMutation.isPending && tasks.length > 0

  const fieldClass =
    'h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
  const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'

  return (
    <div data-alloc-create-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-alloc-create-scrim
        aria-label="关闭分配任务抽屉"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`为 ${resourceName} 分配任务`}
        data-alloc-create-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Link2 className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                为「{resourceName}」分配任务
              </h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                POST /projects/{projectId}/resources/{resourceId}/allocations
              </p>
            </div>
          </div>
          <button
            type="button"
            data-alloc-create-close
            aria-label="关闭分配任务抽屉"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {fieldError ? (
            <p
              role="alert"
              aria-label="分配任务失败"
              data-alloc-create-error
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {fieldError}
            </p>
          ) : null}

          {tasks.length === 0 ? (
            <p
              data-alloc-create-no-tasks
              className="rounded-sm border border-[var(--nx-status-warning)]/50 bg-[rgba(245,158,11,0.08)] px-2.5 py-2 text-[11px] text-[var(--nx-status-warning)]"
            >
              项目内暂无未完成任务可分配（或全部任务已挂接至该资源）。
            </p>
          ) : null}

          <div>
            <label htmlFor="alloc-create-task" className={labelClass}>
              目标任务 <span className="text-[var(--nx-status-danger)]">*</span>
            </label>
            <select
              id="alloc-create-task"
              data-alloc-create-task
              value={taskId}
              onChange={(event) => setTaskId(Number(event.target.value))}
              className={fieldClass}
            >
              <option value="">请选择未完成任务…</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  #{task.id} {task.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="alloc-create-type" className={labelClass}>
                分配类型
              </label>
              <select
                id="alloc-create-type"
                data-alloc-create-type
                value={allocationType}
                onChange={(event) => setAllocationType(event.target.value as AllocationType)}
                className={fieldClass}
              >
                {Object.entries(ALLOCATION_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="alloc-create-percent" className={labelClass}>
                分配占比 %（1~100）<span className="text-[var(--nx-status-danger)]">*</span>
              </label>
              <input
                id="alloc-create-percent"
                type="number"
                min={1}
                max={100}
                data-alloc-create-percent
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
                className={fieldClass}
              />
              {!percentValid ? (
                <p
                  data-alloc-create-percent-error
                  className="mt-1 text-[10px] text-[var(--nx-status-danger)]"
                >
                  分配占比需在 1% ~ 100% 之间
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="alloc-create-start" className={labelClass}>
                生效开始日期
              </label>
              <input
                id="alloc-create-start"
                type="date"
                data-alloc-create-start
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="alloc-create-end" className={labelClass}>
                生效结束日期
              </label>
              <input
                id="alloc-create-end"
                type="date"
                data-alloc-create-end
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className={fieldClass}
              />
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
            <CalendarRange className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            分配比例按所选日期窗口内的日额定工时折算占用，超 100% 将在负荷面板呈现过载警戒。
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            data-alloc-create-cancel
            onClick={onClose}
            disabled={createMutation.isPending}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-alloc-create-submit
            disabled={!canSubmit}
            onClick={() => createMutation.mutate()}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden />
            )}
            确认分配
          </button>
        </footer>
      </aside>
    </div>
  )
}

export default ResourceAllocationPanel
