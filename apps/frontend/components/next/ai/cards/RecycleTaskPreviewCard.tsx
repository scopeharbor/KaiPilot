'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { RuleMatchBadge } from './RuleMatchBadge'
import {
  taskKeys,
  tasksApi,
  type RecycleBinTask,
  type TaskBatchResult,
  type TaskStatus,
} from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'

export interface RecycleTaskPreviewCardProps {
  projectId: number
  search?: string
  taskId?: number
  tasks?: RecycleBinTask[]
  toolName?: string
  onRestored?: (taskIds: number[]) => void
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
 * AI 同事回收站自然语言找回待确认卡片（v3-ui-next-batch1-strategy-launch-tasks W4 · 4.7）。
 *
 * - 纯前端确定性正则意图匹配（rule_recycle_bin_search）后渲染；
 * - 顶部标注诚实规则匹配徽标（RuleMatchBadge）；
 * - 醒目标注琥珀色待确认徽章（⚡ 待确认恢复）；
 * - 展现从回收站查到的匹配任务详情（名称、ID、原状态、删除时间）；
 * - RL-01 铁律：绝对禁止 AI 自动调用恢复写接口，必须由用户显式点击「确认恢复」后方才发请求；
 * - 恢复成功后切换为绿色「已恢复」状态，并统一触发 invalidateTaskQueries 级联刷新。
 */
export function RecycleTaskPreviewCard({
  projectId,
  search,
  taskId,
  tasks: propTasks,
  toolName = 'recycle_bin_search',
  onRestored,
}: RecycleTaskPreviewCardProps) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = React.useState<'preview' | 'restoring' | 'restored' | 'error'>(
    'preview',
  )
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  // 若未直接传入 tasks，则调用 tasksApi.listRecycleBin 查回收站
  const {
    data: fetchedData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: taskKeys.recycleBin(projectId, { search: search || undefined }),
    queryFn: () => tasksApi.listRecycleBin(projectId, { search: search || undefined }),
    enabled: propTasks === undefined && Boolean(projectId > 0),
  })

  const tasks: RecycleBinTask[] = React.useMemo(() => {
    if (propTasks) return propTasks
    const list = fetchedData?.data ?? []
    if (taskId) {
      return list.filter((t) => t.id === taskId)
    }
    return list
  }, [propTasks, fetchedData, taskId])

  const restoreMutation = useMutation({
    mutationFn: (ids: number[]) => tasksApi.batchRestore(projectId, ids),
    onSuccess: async (_result: TaskBatchResult, variables: number[]) => {
      setPhase('restored')
      await invalidateTaskQueries(queryClient, projectId)
      onRestored?.(variables)
    },
    onError: (err: unknown) => {
      setPhase('error')
      setErrorMessage((err as { message?: string }).message ?? '恢复任务失败，请重试')
    },
  })

  const targetIds = tasks.map((t) => t.id)

  const handleConfirmRestore = async () => {
    if (targetIds.length === 0 || phase === 'restoring' || phase === 'restored') return
    setPhase('restoring')
    restoreMutation.mutate(targetIds)
  }

  return (
    <div
      data-recycle-task-preview-card
      data-status={phase}
      className="my-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-[var(--nx-text-primary)] shadow-sm"
    >
      {/* 顶部微标栏：规则直连微标 + 琥珀色待确认 / 绿色已恢复 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] pb-2.5">
        <RuleMatchBadge toolName={toolName} />

        {phase === 'restored' ? (
          <span
            data-status-badge="restored"
            className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-status-success)] bg-[var(--nx-bg-0)] px-2 py-0.5 font-mono text-[11px] text-[var(--nx-status-success)]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            已恢复至项目空间
          </span>
        ) : (
          <span
            data-status-badge="pending_confirmation"
            className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-status-warning)] bg-[var(--nx-bg-0)] px-2 py-0.5 font-mono text-[11px] text-[var(--nx-status-warning)]"
          >
            <Sparkles className="h-3.5 w-3.5" />⚡ 待确认恢复
          </span>
        )}
      </div>

      {/* 主体内容 */}
      <div className="mt-3 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-xs text-[var(--nx-text-muted)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-[var(--nx-accent)]" />
            正在检索回收站中的匹配任务...
          </div>
        ) : isError ? (
          <div className="py-4 text-center text-xs text-[var(--nx-status-danger)]">
            检索回收站失败，请稍后重试。
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-4 text-center text-xs text-[var(--nx-text-muted)]">
            回收站中未找到匹配的已删除任务。
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-[var(--nx-text-secondary)]">
              找到 {tasks.length} 项已删除的任务：
            </div>
            <ul className="divide-y divide-[var(--nx-border-hairline)] rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  data-recycle-preview-item
                  className="flex items-center justify-between gap-3 p-2.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-[var(--nx-text-primary)] truncate">
                        {task.name}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                        #{task.id}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--nx-text-muted)]">
                      <span>原状态: {STATUS_LABELS[task.status] ?? task.status}</span>
                      <span>·</span>
                      <span>
                        删除时间:{' '}
                        {task.deletedAt ? new Date(task.deletedAt).toLocaleString('zh-CN') : '-'}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 错误提示 */}
        {phase === 'error' && errorMessage ? (
          <div className="rounded border border-[var(--nx-status-danger)] bg-[var(--nx-bg-0)] p-2 text-xs text-[var(--nx-status-danger)]">
            {errorMessage}
          </div>
        ) : null}

        {/* 操作栏：严格人工点击确认（RL-01） */}
        {phase === 'restored' ? (
          <div className="rounded bg-[var(--nx-bg-0)] p-2 text-center text-xs text-[var(--nx-status-success)]">
            ✓ 任务已成功找回并恢复至项目空间
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              data-recycle-confirm-btn
              disabled={tasks.length === 0 || phase === 'restoring'}
              onClick={handleConfirmRestore}
              className="inline-flex h-8 items-center justify-center rounded border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {phase === 'restoring' ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  正在恢复...
                </>
              ) : (
                <>
                  <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                  确认恢复
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
