'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { readTaskSteps, stepToggleUpdate } from '@/lib/next/task-steps'
import { cn } from '@/lib/utils'

export interface TaskStepChecklistProps {
  projectId: number
  task: Task
  canEdit: boolean
  /** 勾选后的本地结果（进度 / 状态），详情表单据此同步，避免「保存修改」用旧值覆盖。 */
  onLocalChange?: (task: Task) => void
}

/**
 * 任务详情里的执行步骤清单（2026-09-29）：逐项打勾。
 *
 * - 勾选立即生效（界面先变），保存在后台按顺序进行（远端库一次保存要几秒，不让人干等）；
 * - 进度按勾选比例自动更新；第一次打勾转「进行中」，最后一步勾上转「已完成」，
 *   已完成的任务取消任一步退回「进行中」（2026-09-29 用户要求：状态跟着勾选走）；
 * - 没有编辑权限时只读显示。
 */
export function TaskStepChecklist({
  projectId,
  task,
  canEdit,
  onLocalChange,
}: TaskStepChecklistProps) {
  const queryClient = useQueryClient()
  // 本地镜像：连续勾选时每一次都基于上一次的结果计算，而不是等服务端刷新
  const [local, setLocal] = React.useState<Task>(task)
  const [saving, setSaving] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const queue = React.useRef<Promise<unknown>>(Promise.resolve())

  const savingRef = React.useRef(0)
  savingRef.current = saving
  React.useEffect(() => {
    // 服务端推来新数据（刷新后）且没有未完成的保存时，以服务端为准；
    // 只在数据真的变了时同步，保存刚结束时不回退成旧数据（否则勾选会闪回去）
    if (savingRef.current === 0) setLocal(task)
  }, [task])

  const state = readTaskSteps(local)
  if (state.steps.length === 0) return null
  const doneCount = state.done.filter(Boolean).length
  const allDone = doneCount === state.steps.length
  const progress = Math.round((doneCount / state.steps.length) * 100)

  const toggle = (index: number) => {
    if (!canEdit) return
    const { input, allDone: finished } = stepToggleUpdate(local, index)
    // 待处理的任务一次勾完（如只有一步）：状态机要先开工再完成，补一次「已完成」
    const finishAfterStart = finished && input.status === 'in_progress'
    const next: Task = {
      ...local,
      customFields: input.customFields ?? local.customFields,
      description: input.description ?? local.description,
      progressPercent: input.progressPercent ?? local.progressPercent,
      status: finishAfterStart ? 'completed' : (input.status ?? local.status),
    }
    setLocal(next)
    onLocalChange?.(next)
    setError(null)
    setSaving((count) => count + 1)
    queue.current = queue.current
      .then(async () => {
        await tasksApi.update(projectId, task.id, input)
        if (finishAfterStart) await tasksApi.update(projectId, task.id, { status: 'completed' })
      })
      .catch((failure: unknown) => {
        setError((failure as { message?: string } | null)?.message ?? '保存勾选失败，请刷新后重试')
      })
      .finally(() => {
        setSaving((count) => {
          const left = count - 1
          if (left === 0) void invalidateTaskQueries(queryClient, projectId)
          return left
        })
      })
  }

  return (
    <section
      data-task-step-checklist
      aria-label="执行步骤"
      className="space-y-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--nx-text-secondary)]">
          执行步骤 · {doneCount}/{state.steps.length}
        </h4>
        <span className="flex items-center gap-1 text-[11px] text-[var(--nx-text-muted)]">
          {saving > 0 ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              保存中…
            </>
          ) : (
            `进度 ${progress}%`
          )}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--nx-border-hairline)]">
        <div
          className="h-full rounded-full bg-[var(--nx-accent)] transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
      {state.purpose ? (
        <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">{state.purpose}</p>
      ) : null}
      <ol className="space-y-1">
        {state.steps.map((step, index) => (
          <li key={`${index}-${step}`}>
            <label
              data-task-step={index}
              data-step-done={state.done[index] ? 'true' : 'false'}
              className={cn(
                'flex items-start gap-2 rounded px-1.5 py-1 text-xs leading-5',
                canEdit ? 'cursor-pointer hover:bg-[var(--nx-bg-1)]' : 'cursor-default',
              )}
            >
              <input
                type="checkbox"
                checked={state.done[index] ?? false}
                disabled={!canEdit}
                onChange={() => toggle(index)}
                aria-label={`第 ${index + 1} 步：${step}`}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--nx-accent)]"
              />
              <span
                className={cn(
                  'text-[var(--nx-text-primary)] transition-colors',
                  state.done[index] && 'text-[var(--nx-text-muted)] line-through',
                )}
              >
                {step}
              </span>
            </label>
          </li>
        ))}
      </ol>
      {state.doneCriteria.length > 0 ? (
        <details className="text-[11px] text-[var(--nx-text-secondary)]">
          <summary className="cursor-pointer">完成标准（{state.doneCriteria.length} 条）</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {state.doneCriteria.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {allDone && local.status === 'completed' ? (
        <p
          data-task-steps-all-done
          className="flex items-center gap-1 text-[11px] text-[var(--nx-status-success)]"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          步骤全部完成，任务已移到「已完成」；取消任一步会退回「进行中」
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[11px] text-[var(--nx-status-danger)]">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export default TaskStepChecklist
