'use client'

import { useState } from 'react'
import type { GanttModel } from '@/lib/gantt/types'
import { TASK_STATUS_LABELS } from '@/lib/task-status'

/** Same schedule model as the chart; phone users edit through the shared detail form. */
export function MobileGanttSchedule({
  model,
  onOpenTask,
}: {
  model: GanttModel
  onOpenTask?: (id: number) => void
}) {
  const [search, setSearch] = useState('')
  const date = (day: number) => new Date(model.epochMs + day * 86400000).toISOString().slice(0, 10)
  const tasks = model.tasks.filter((task) =>
    task.name.toLowerCase().includes(search.trim().toLowerCase()),
  )
  return (
    <div data-mobile-gantt-schedule className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <label className="block text-sm text-[var(--nx-text-secondary)]">
        查找排程
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3"
        />
      </label>
      <p className="text-sm text-[var(--nx-text-muted)]">
        点击任务查看详情、调整起止日期。图形总览可横向滑动查看。
      </p>
      {tasks.length === 0 ? (
        <p role="status" className="py-8 text-center">
          没有匹配的排程
        </p>
      ) : null}
      {tasks.map((task) => (
        <article
          key={task.id}
          className="rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
        >
          <button
            type="button"
            disabled={task.id <= 0 || !onOpenTask}
            onClick={() => onOpenTask?.(task.id)}
            className="min-h-11 w-full break-words text-left text-base font-medium disabled:opacity-80"
          >
            {task.kind === 'milestone' ? '◆ ' : ''}
            {task.name}
          </button>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-[var(--nx-text-secondary)]">
            <span>{TASK_STATUS_LABELS[task.status]}</span>
            <span>{task.durationDays} 天</span>
            {task.isCritical ? (
              <span className="text-[var(--nx-status-danger)]">关键路径</span>
            ) : null}
          </div>
          <p className="mt-2 text-sm">
            {date(task.startDay)} → {date(task.startDay + Math.max(0, task.durationDays - 1))}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <progress
              aria-label={`${task.name}进度`}
              value={task.progress}
              max={1}
              className="h-2 min-w-0 flex-1 accent-[var(--nx-accent)]"
            />
            <span className="text-sm">{Math.round(task.progress * 100)}%</span>
          </div>
          {task.assignee ? (
            <p className="mt-2 text-sm text-[var(--nx-text-muted)]">负责人：{task.assignee.name}</p>
          ) : null}
        </article>
      ))}
    </div>
  )
}
