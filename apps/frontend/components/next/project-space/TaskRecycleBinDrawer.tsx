'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, Loader2, Search, X } from 'lucide-react'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/Sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { useAuthStore } from '@/stores/auth-store'
import {
  taskKeys,
  tasksApi,
  type RecycleBinTask,
  type TaskBatchResult,
  type TaskStatus,
} from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'

export interface TaskRecycleBinDrawerProps {
  projectId: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: React.ReactNode
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  on_hold: '已暂停',
  cancelled: '已取消',
}

/**
 * 任务回收站内敛管理抽屉（v3-ui-next-batch1-strategy-launch-tasks W4 · 4.5）。
 *
 * - 在单项目空间内侧滑展开，替代跳出空间的独立回收站页；
 * - 消费 tasksApi.listRecycleBin 展示已软删除任务底册；
 * - 表格展示任务名称、删除时间、删除前状态；
 * - 提供单项与批量勾选恢复（tasksApi.batchRestore）；
 * - 提供彻底删除二次确认对话框；
 * - 恢复或删除成功统一触发 invalidateTaskQueries 集中失效网。
 */
export function TaskRecycleBinDrawer({
  projectId,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: TaskRecycleBinDrawerProps) {
  const queryClient = useQueryClient()
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canDelete = hasPermission('task:delete')

  const [internalOpen, setInternalOpen] = React.useState(false)
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) {
        setInternalOpen(next)
      }
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange],
  )

  const [search, setSearch] = React.useState('')
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set())
  const [confirmPurgeOpen, setConfirmPurgeOpen] = React.useState(false)
  const [actionResult, setActionResult] = React.useState<string | null>(null)

  const filters = React.useMemo(
    () => ({
      search: search.trim() || undefined,
      sort: '-deletedAt' as const,
      perPage: 50,
    }),
    [search],
  )

  const {
    data: paginatedData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: taskKeys.recycleBin(projectId, filters),
    queryFn: () => tasksApi.listRecycleBin(projectId, filters),
    enabled: Boolean(isOpen && projectId > 0),
  })

  const rows: RecycleBinTask[] = paginatedData?.data ?? []

  // 批量恢复 Mutation
  const restoreMutation = useMutation({
    mutationFn: (ids: number[]) => tasksApi.batchRestore(projectId, ids),
    onSuccess: async (result: TaskBatchResult) => {
      setSelectedIds(new Set())
      setActionResult(`成功恢复 ${result.successCount} 项任务`)
      await queryClient.invalidateQueries({ queryKey: taskKeys.recycleBins(projectId) })
      await invalidateTaskQueries(queryClient, projectId)
    },
  })

  // 彻底删除 Mutation
  const purgeMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        await tasksApi.delete(projectId, id)
      }
    },
    onSuccess: async () => {
      const count = selectedIds.size > 0 ? selectedIds.size : rows.length
      setSelectedIds(new Set())
      setConfirmPurgeOpen(false)
      setActionResult(`已彻底删除 ${count} 项任务`)
      await queryClient.invalidateQueries({ queryKey: taskKeys.recycleBins(projectId) })
      await invalidateTaskQueries(queryClient, projectId)
    },
  })

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(rows.map((r) => r.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleToggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  const someSelected = rows.some((r) => selectedIds.has(r.id)) && !allSelected

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)} className="inline-block cursor-pointer">
          {trigger}
        </span>
      ) : null}

      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent
          hideClose
          data-next-track
          data-task-recycle-bin-drawer
          data-testid="task-recycle-bin-drawer"
          className="w-full max-w-xl overflow-y-auto border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6 text-[var(--nx-text-primary)]"
        >
          {/* 抽屉头部 */}
          <div className="flex items-center justify-between pb-3 border-b border-[var(--nx-border-hairline)]">
            <div className="flex items-center gap-2">
              <ArchiveRestore className="h-5 w-5 text-[var(--nx-accent)]" />
              <SheetTitle
                data-recycle-bin-title
                data-testid="recycle-bin-title"
                className="text-base font-semibold text-[var(--nx-text-primary)]"
              >
                任务回收站
              </SheetTitle>
            </div>
            <SheetClose
              data-recycle-bin-close
              data-testid="recycle-bin-close"
              className="rounded p-1 text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">关闭回收站抽屉</span>
            </SheetClose>
          </div>
          <SheetDescription className="text-xs text-[var(--nx-text-muted)] mt-1">
            显示已软删除的任务。支持批量勾选恢复及彻底删除。
          </SheetDescription>

          {/* 提示与状态通知 */}
          {actionResult ? (
            <div
              data-recycle-bin-alert
              data-testid="recycle-bin-alert"
              className="mt-3 flex items-center justify-between rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs text-[var(--nx-status-success)]"
            >
              <span>✓ {actionResult}</span>
              <button
                type="button"
                onClick={() => setActionResult(null)}
                className="text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
              >
                ×
              </button>
            </div>
          ) : null}

          {/* 搜索与批量操作工具条 */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-text-muted)]" />
              <input
                data-recycle-bin-search
                data-testid="recycle-bin-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索已删除任务..."
                className="w-full h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] pl-8 pr-3 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-recycle-bin-batch-restore
                data-testid="recycle-bin-batch-restore"
                disabled={!canDelete || selectedIds.size === 0 || restoreMutation.isPending}
                onClick={() => restoreMutation.mutate([...selectedIds])}
                className="inline-flex h-8 items-center justify-center rounded border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {restoreMutation.isPending ? '恢复中...' : `批量恢复 (${selectedIds.size})`}
              </button>
              <button
                type="button"
                data-recycle-bin-permanent-delete-trigger
                data-testid="recycle-bin-permanent-delete-trigger"
                disabled={!canDelete || rows.length === 0 || purgeMutation.isPending}
                onClick={() => setConfirmPurgeOpen(true)}
                className="inline-flex h-8 items-center justify-center rounded border border-[var(--nx-status-danger)] bg-[var(--nx-bg-0)] px-3 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                彻底删除
              </button>
            </div>
          </div>

          {/* 任务列表表格 */}
          <div className="mt-4 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] overflow-hidden">
            {isLoading ? (
              <div
                data-recycle-bin-loading
                className="py-12 flex flex-col items-center justify-center gap-2 text-[var(--nx-text-muted)]"
              >
                <Loader2 className="h-5 w-5 animate-spin text-[var(--nx-accent)]" />
                <span className="text-xs">正在载入回收站...</span>
              </div>
            ) : isError ? (
              <div role="alert" className="py-8 text-center text-xs text-[var(--nx-status-danger)]">
                加载回收站失败，请稍后重试。
              </div>
            ) : rows.length === 0 ? (
              <div
                data-recycle-bin-empty
                className="py-12 text-center text-xs text-[var(--nx-text-muted)]"
              >
                {search ? '没有匹配的已删除任务' : '回收站为空'}
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] text-[var(--nx-text-secondary)]">
                    <th className="w-10 px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        data-recycle-bin-select-all
                        data-testid="recycle-bin-select-all"
                        aria-label="全选已删除任务"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected
                        }}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="rounded border-[var(--nx-border-hairline)] accent-[var(--nx-accent)]"
                      />
                    </th>
                    <th className="px-3 py-2.5 font-medium">任务</th>
                    <th className="px-3 py-2.5 font-medium">原状态</th>
                    <th className="px-3 py-2.5 font-medium">删除时间</th>
                    <th className="px-3 py-2.5 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--nx-border-hairline)]">
                  {rows.map((task) => {
                    const isSelected = selectedIds.has(task.id)
                    return (
                      <tr
                        key={task.id}
                        data-recycle-bin-task-item
                        className="hover:bg-[var(--nx-workspace-surface)] transition-colors"
                      >
                        <td className="w-10 px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            data-recycle-bin-select-task={task.id}
                            data-testid={`recycle-bin-select-task-${task.id}`}
                            aria-label={`选择任务 ${task.name}`}
                            checked={isSelected}
                            onChange={() => handleToggleRow(task.id)}
                            className="rounded border-[var(--nx-border-hairline)] accent-[var(--nx-accent)]"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-[var(--nx-text-primary)]">
                            {task.name}
                          </div>
                          <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                            #{task.id}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[var(--nx-text-secondary)]">
                          {STATUS_LABELS[task.status] ?? task.status}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--nx-text-muted)] whitespace-nowrap">
                          {task.deletedAt ? new Date(task.deletedAt).toLocaleString('zh-CN') : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            data-recycle-bin-restore-single={task.id}
                            data-testid={`recycle-bin-restore-single-${task.id}`}
                            disabled={!canDelete || restoreMutation.isPending}
                            onClick={() => restoreMutation.mutate([task.id])}
                            className="text-xs text-[var(--nx-accent)] hover:underline disabled:opacity-50 disabled:no-underline cursor-pointer"
                          >
                            恢复
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* 彻底删除二次确认弹窗 */}
      <Dialog open={confirmPurgeOpen} onOpenChange={setConfirmPurgeOpen}>
        <DialogContent
          data-next-track
          data-recycle-bin-permanent-delete-dialog
          data-testid="recycle-bin-permanent-delete-dialog"
          className="border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]"
        >
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-[var(--nx-text-primary)]">
              确认彻底删除？
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--nx-text-muted)]">
              {selectedIds.size > 0
                ? `将彻底删除选中的 ${selectedIds.size} 项任务。彻底删除后将无法通过回收站找回，此操作不可撤销。`
                : '将彻底删除回收站中的全部任务。彻底删除后将无法通过回收站找回，此操作不可撤销。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center justify-end gap-2 pt-4">
            <button
              type="button"
              data-recycle-bin-confirm-cancel
              data-testid="recycle-bin-confirm-cancel"
              onClick={() => setConfirmPurgeOpen(false)}
              className="inline-flex h-8 items-center justify-center rounded border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              data-recycle-bin-confirm-delete
              data-testid="recycle-bin-confirm-delete"
              disabled={purgeMutation.isPending}
              onClick={() => {
                const ids = selectedIds.size > 0 ? [...selectedIds] : rows.map((r) => r.id)
                purgeMutation.mutate(ids)
              }}
              className="inline-flex h-8 items-center justify-center rounded bg-[var(--nx-status-danger)] px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {purgeMutation.isPending ? '删除中...' : '确认彻底删除'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
