'use client'

import * as React from 'react'
import { GitBranch, Link2, Zap } from 'lucide-react'
import type {
  DraftDependencyType,
  ProjectDraftDependency,
  ProjectDraftGanttPreview,
  ProjectDraftTask,
} from '@aiproj/types'
import {
  buildTaskLookup,
  extractMarkedValue,
  formatDateSpan,
  formatDurationDays,
} from '@/lib/next/draft-review-helpers'

/** 依赖类型中文标签（RL-14 静态映射，禁止运行时注入）。 */
export const DEPENDENCY_TYPE_LABELS: Readonly<Record<DraftDependencyType, string>> = {
  FS: '完成-开始',
  SS: '开始-开始',
  FF: '完成-完成',
  SF: '开始-完成',
}

/**
 * 甘特排程预览只读检视（v3-ui-next-draft-review-panel tasks 1.5）。
 *
 * 顶部总览条（总工期、阶段数、关键路径任务数、主轴跨度）；任务排期表对
 * `criticalPathTaskIds` 中的任务挂战术冷蓝「关键路径」高亮徽章；依赖关系表
 * 列出前置/后置任务、FS/SS/FF/SF 类型与滞后天数。严格只读（RL-01、RL-06）。
 */
export interface NextDraftGanttSectionProps {
  preview: ProjectDraftGanttPreview
  dependencies: ProjectDraftDependency[]
  /** 任务列表（反查前置/后置任务名与关键路径任务展示用）；仅消费，不改写。 */
  tasks: ProjectDraftTask[]
}

export function NextDraftGanttSection({
  preview,
  dependencies,
  tasks,
}: NextDraftGanttSectionProps) {
  const taskLookup = React.useMemo(() => buildTaskLookup(tasks), [tasks])
  const criticalPathTaskIds = preview.criticalPathTaskIds
  const criticalSet = React.useMemo(
    () => new Set<string>(criticalPathTaskIds),
    [criticalPathTaskIds],
  )

  const totalDurationDays = extractMarkedValue(preview.totalDurationDays)
  const startDate = extractMarkedValue(preview.startDate)
  const endDate = extractMarkedValue(preview.endDate)

  const resolveTaskName = (taskId: string): string => {
    const task = taskLookup.get(taskId)
    return task !== undefined ? extractMarkedValue(task.name) : taskId
  }

  return (
    <section data-gantt-section aria-label="甘特预览" className="space-y-3 text-left">
      <div
        data-gantt-overview
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-2.5"
      >
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          <Zap className="h-3.5 w-3.5" aria-hidden />
          总工期
          <span
            data-gantt-total-duration
            className="font-mono text-xs font-medium text-[var(--nx-text-primary)]"
          >
            {formatDurationDays(totalDurationDays)}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          阶段数
          <span
            data-gantt-phase-count
            className="font-mono text-xs font-medium text-[var(--nx-text-primary)]"
          >
            {preview.phaseCount}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          关键路径任务
          <span
            data-gantt-critical-count
            className="font-mono text-xs font-medium text-[var(--nx-text-primary)]"
          >
            {criticalPathTaskIds.length} 项
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          主轴跨度
          <span data-gantt-span className="font-mono text-xs text-[var(--nx-text-primary)]">
            {formatDateSpan(startDate, endDate)}
          </span>
        </span>
      </div>

      <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
        <h4 className="border-b border-[var(--nx-border-hairline)] px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
          任务排期（关键路径高亮）
        </h4>
        {tasks.length > 0 ? (
          <ul className="divide-y divide-[var(--nx-border-hairline)]">
            {tasks.map((task) => {
              const taskId = task.id
              const isCritical = criticalSet.has(taskId)
              return (
                <li
                  key={taskId}
                  data-gantt-task
                  data-task-id={taskId}
                  className={`flex flex-wrap items-center gap-2 px-4 py-2 ${
                    isCritical ? 'bg-[var(--nx-status-warning)]/5' : ''
                  }`}
                >
                  <span
                    data-gantt-task-name
                    className="min-w-0 max-w-[240px] truncate text-xs text-[var(--nx-text-primary)]"
                  >
                    {extractMarkedValue(task.name)}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                    {formatDateSpan(
                      extractMarkedValue(task.startDate),
                      extractMarkedValue(task.endDate),
                    )}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                    {formatDurationDays(extractMarkedValue(task.durationDays))}
                  </span>
                  {isCritical ? (
                    <span
                      data-gantt-critical-badge
                      className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-workspace-blue)]/60 bg-[var(--nx-workspace-blue)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--nx-workspace-blue)]"
                    >
                      <Link2 className="h-3 w-3" aria-hidden />
                      关键路径
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-4 py-3 text-xs text-[var(--nx-text-muted)]">暂无排程任务</p>
        )}
      </div>

      <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
        <h4 className="border-b border-[var(--nx-border-hairline)] px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
          任务依赖关系
        </h4>
        {dependencies.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--nx-border-hairline)]">
                  {['前置任务', '后置任务', '依赖类型', '滞后天数'].map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dependencies.map((dependency, index) => {
                  const lagDays = extractMarkedValue(dependency.lagDays)
                  return (
                    <tr
                      // 旧草案里可能有重复的依赖 id（程序补依赖时曾撞号）：带上序号保证 key 唯一。
                      key={`${dependency.id}-${index}`}
                      data-gantt-dependency
                      data-dependency-id={dependency.id}
                      className="border-b border-[var(--nx-border-hairline)] last:border-b-0"
                    >
                      <td className="px-4 py-2 text-xs text-[var(--nx-text-secondary)]">
                        {resolveTaskName(dependency.predecessorId)}
                      </td>
                      <td className="px-4 py-2 text-xs text-[var(--nx-text-secondary)]">
                        {resolveTaskName(dependency.successorId)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          data-dependency-type
                          className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-accent)]"
                        >
                          <GitBranch className="h-3 w-3" aria-hidden />
                          {dependency.type} · {DEPENDENCY_TYPE_LABELS[dependency.type]}
                        </span>
                      </td>
                      <td
                        data-dependency-lag
                        className="px-4 py-2 font-mono text-[11px] text-[var(--nx-text-muted)]"
                      >
                        {lagDays === 0 ? '无滞后' : `${lagDays} 天`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-3 text-xs text-[var(--nx-text-muted)]">暂无任务依赖关系</p>
        )}
      </div>
    </section>
  )
}

export default NextDraftGanttSection
