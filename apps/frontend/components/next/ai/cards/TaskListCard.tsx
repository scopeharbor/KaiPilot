'use client'

import { CalendarDays } from 'lucide-react'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * 任务列表结构化卡片（v3-ui-next-ai-colleague spec「结构化查询结果卡片渲染」）。
 *
 * - 消费只读工具 `list_project_tasks` 的输出：任务标题、六色状态圆标（双通道：
 *   色彩 + 中文标签）、优先级标签（色 + 中文）、责任人与截止日期；
 * - 附带数量截断元数据（「展示前 N 项，共 M 项」），超长列表不阻塞时间线；
 * - 条目悬停可交互，点击经 `onOpenTask` 联动主工作面查看详情（可选接线）；
 * - 所有字段经防御收敛，未知状态/优先级绝不抛错（防崩溃红线）。
 */

/** 六态任务状态中文回显（与 TASK_STATUS_LABELS 对齐，双通道色彩 + 文案）。 */
export const TASK_STATUS_LABELS: Record<string, string> = {
  not_started: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '阻塞',
  on_hold: '暂停',
  cancelled: '已取消',
}

/** 六色状态圆标（冷色调适配，全部消费 --nx-* 令牌）。 */
const TASK_STATUS_DOT: Record<string, string> = {
  not_started: 'bg-[var(--nx-text-muted)]',
  in_progress: 'bg-[var(--nx-space-cyan)]',
  completed: 'bg-[var(--nx-status-success)]',
  blocked: 'bg-[var(--nx-status-danger)]',
  on_hold: 'bg-[var(--nx-status-warning)]',
  cancelled: 'bg-[var(--nx-text-secondary)]',
}

/** 优先级双通道标签（兼容后端 low/medium/high/urgent 与前端 lowest/highest 枚举）。 */
export const TASK_PRIORITY_LABELS: Record<string, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
  urgent: '紧急',
}

const TASK_PRIORITY_TONE: Record<string, string> = {
  lowest: 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
  low: 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
  medium: 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
  high: 'border-[var(--nx-status-warning)]/60 text-[var(--nx-status-warning)]',
  highest: 'border-[var(--nx-status-danger)]/60 text-[var(--nx-status-danger)]',
  urgent: 'border-[var(--nx-status-danger)]/60 text-[var(--nx-status-danger)]',
}

/** 日期短标签（MM-DD，确定性输出，避免 locale/ICU 差异）。 */
function shortDay(date: string | null | undefined): string | null {
  return date ? date.slice(5) : null
}

function toFinite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** `list_project_tasks` 有界任务条目（字段名与后端 BoundedTaskItem 对齐，容忍缺省）。 */
export interface TaskListCardItem {
  id: number
  name: string
  status?: string
  priority?: string
  startDate?: string | null
  endDate?: string | null
  /** 责任人名称/缩写（后端列表条目暂无此字段时回退为「未分配」）。 */
  assigneeName?: string | null
  assigneeId?: number | null
}

export interface TaskListCardData {
  items: TaskListCardItem[]
  meta?: { total: number; page: number; perPage: number; totalPages: number }
}

export interface TaskListCardProps {
  data: TaskListCardData
  /** 命中工具名（v1 恒为规则直连，默认诚实标注 list_project_tasks）。 */
  toolName?: string
  /** 点击任务条目回调（上层可接线主工作面高亮/详情抽屉）。 */
  onOpenTask?: (taskId: number) => void
}

export function TaskListCard({
  data,
  toolName = 'list_project_tasks',
  onOpenTask,
}: TaskListCardProps) {
  const items = Array.isArray(data.items) ? data.items : []
  const total = toFinite(data.meta?.total, items.length)
  const shown = items.length

  return (
    <article
      data-card="task-list"
      className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--nx-text-primary)]">任务清单</span>
        <RuleMatchBadge toolName={toolName} />
      </div>

      {shown === 0 ? (
        <p data-task-list-empty className="px-3 py-4 text-xs text-[var(--nx-text-muted)]">
          当前没有符合条件的任务
        </p>
      ) : (
        <ul className="divide-y divide-[var(--nx-border-hairline)]">
          {items.map((item) => {
            const id = toFinite(item.id, 0)
            const title =
              typeof item.name === 'string' && item.name.trim() !== ''
                ? item.name
                : `任务 #${id || '未知'}`
            const status = typeof item.status === 'string' ? item.status : ''
            const statusLabel = TASK_STATUS_LABELS[status] ?? status
            const priority = typeof item.priority === 'string' ? item.priority : ''
            const priorityLabel = TASK_PRIORITY_LABELS[priority] ?? priority

            const endDay = shortDay(typeof item.endDate === 'string' ? item.endDate : null)
            const startDay = shortDay(typeof item.startDate === 'string' ? item.startDate : null)
            const dateLabel =
              startDay && endDay ? `${startDay} – ${endDay}` : (startDay ?? endDay ?? '未设定日期')

            const assigneeName =
              typeof item.assigneeName === 'string' && item.assigneeName.trim() !== ''
                ? item.assigneeName
                : typeof item.assigneeId === 'number' && Number.isFinite(item.assigneeId)
                  ? `成员 #${item.assigneeId}`
                  : '未分配'

            const row = (
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span
                    data-task-status-dot
                    aria-hidden
                    title={statusLabel || '状态未知'}
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${TASK_STATUS_DOT[status] ?? 'bg-[var(--nx-text-muted)]'}`}
                  />
                  <span
                    data-task-name
                    className="min-w-0 flex-1 truncate text-xs text-[var(--nx-text-primary)]"
                  >
                    {title}
                  </span>
                  {statusLabel ? (
                    <span
                      data-task-status
                      className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1 py-0.5 text-[10px] leading-none text-[var(--nx-text-secondary)]"
                    >
                      {statusLabel}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-none text-[var(--nx-text-muted)]">
                  {priorityLabel ? (
                    <span
                      data-task-priority
                      className={`rounded-sm border px-1 py-0.5 leading-none ${TASK_PRIORITY_TONE[priority] ?? 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]'}`}
                    >
                      {priorityLabel}
                    </span>
                  ) : null}
                  <span data-task-assignee className="max-w-28 truncate">
                    {assigneeName}
                  </span>
                  <span data-task-due className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" aria-hidden />
                    {dateLabel}
                  </span>
                </div>
              </div>
            )

            return (
              <li key={String(id)} className="group relative px-3 py-2">
                {onOpenTask && id > 0 ? (
                  <button
                    type="button"
                    data-task-item
                    data-task-id={id}
                    onClick={() => onOpenTask(id)}
                    className="absolute inset-0 z-0 cursor-pointer rounded-md border border-transparent bg-transparent text-left transition-colors group-hover:border-[var(--nx-border-focus)] group-hover:bg-[var(--nx-bg-0)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
                    aria-label={`查看任务：${title}`}
                  />
                ) : null}
                <div className="relative z-10 pointer-events-none select-none">{row}</div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="border-t border-[var(--nx-border-hairline)] px-3 py-1.5 text-[10px] text-[var(--nx-text-muted)]">
        <span data-task-list-truncate>
          展示前 {shown} 项，共 {total} 项
        </span>
      </div>
    </article>
  )
}

export default TaskListCard
