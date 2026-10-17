'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { tasksApi } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { toast } from '@/components/ui/Toast'

/** 建立后可撤销的秒数。 */
export const UNDO_SECONDS = 5

export interface CreatedTaskRef {
  id: number
  name: string
  projectId: number
}

/**
 * 快速新建后的撤销条：倒数 5 秒，点「撤销」删除刚建的任务（删除同样走正式接口并记审计）。
 */
export function CalendarUndoBar({
  tasks,
  onDone,
}: {
  tasks: CreatedTaskRef[]
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [remaining, setRemaining] = useState(UNDO_SECONDS)

  useEffect(() => {
    if (remaining <= 0) {
      onDone()
      return
    }
    const timer = window.setTimeout(() => setRemaining((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [remaining, onDone])

  const undo = async () => {
    onDone()
    const results = await Promise.allSettled(
      tasks.map((task) => tasksApi.delete(task.projectId, task.id)),
    )
    for (const projectId of new Set(tasks.map((task) => task.projectId))) {
      void invalidateTaskQueries(queryClient, projectId)
    }
    const failed = results.filter((result) => result.status === 'rejected').length
    toast(
      failed > 0
        ? {
            variant: 'error',
            title: '撤销没有完全成功',
            description: `${failed} 项没能删除，请到任务里手动删除`,
          }
        : { variant: 'info', title: `已撤销 ${tasks.length} 项新建任务` },
    )
  }

  return (
    <div
      data-calendar-undo
      role="status"
      className="absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-1.5 text-xs text-[var(--nx-text-secondary)] shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
    >
      <span>
        已建立「{tasks[0]?.name}」{tasks.length > 1 ? ` 等 ${tasks.length} 项` : ''}
      </span>
      <button
        type="button"
        data-calendar-undo-button
        onClick={() => void undo()}
        className="flex items-center gap-1 font-medium text-[var(--nx-space-cyan)]"
      >
        <Undo2 className="h-3.5 w-3.5" aria-hidden />
        撤销（{remaining}）
      </button>
    </div>
  )
}

export default CalendarUndoBar
