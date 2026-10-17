'use client'

/**
 * 日历各视图（月 / 周 / 日 / 当日侧栏）共用的条目外观：状态色、标签、点击属性与副曆标注。
 */
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { cn } from '@/lib/utils'
import type { CalendarItem } from '@/lib/calendar-types'
import { TASK_STATUS_LABELS } from '@/lib/task-status'
import type { CalendarAnnotation, CalendarAnnotationTone } from '@/lib/calendar-systems'
import type { DayMeta } from '@/components/views/calendar/CalendarDayMeta'

/** 副曆标注色调 → 新轨令牌。 */
export const ANNOTATION_TONE: Record<CalendarAnnotationTone, string> = {
  normal: 'text-[var(--nx-text-secondary)]',
  muted: 'text-[var(--nx-text-muted)]',
  festival: 'text-[var(--nx-space-cyan)]',
  term: 'text-[var(--nx-space-cyan)]',
  off: 'rounded-sm bg-[var(--nx-status-danger)]/15 px-0.5 font-medium text-[var(--nx-status-danger)]',
  work: 'rounded-sm bg-[var(--nx-bg-1)] px-0.5 font-medium text-[var(--nx-text-secondary)]',
}

/** 格子里最多直接显示的副曆标注数（其余在 title 里）。 */
export const MAX_VISIBLE_ANNOTATIONS = 2

/** 副曆标注（按设定顺序）+ 封网角标；法定「休 / 班」始终显示为小徽标。 */
export function NxDayAnnotations({
  annotations,
  meta,
}: {
  annotations: readonly CalendarAnnotation[]
  meta: DayMeta
}) {
  const holiday = annotations.find((item) => item.system === 'holiday')
  const texts = annotations.filter((item) => item.system !== 'holiday')
  const visible = texts.slice(0, MAX_VISIBLE_ANNOTATIONS)
  const fullText = annotations.map((item) => item.full).join(' · ')
  return (
    <span
      data-calendar-day-meta
      title={fullText || undefined}
      className="flex min-w-0 items-center gap-1"
    >
      {visible.map((item, index) => (
        <span
          key={item.system}
          data-calendar-annotation={item.system}
          {...(index === 0 ? { 'data-calendar-lunar': '' } : {})}
          className={cn('truncate text-[11px] leading-none', ANNOTATION_TONE[item.tone])}
        >
          {item.short}
        </span>
      ))}
      {holiday ? (
        <span
          data-calendar-statutory={holiday.tone === 'off' ? 'off' : 'work'}
          title={holiday.full}
          aria-label={holiday.full}
          className={cn('shrink-0 text-[11px] leading-none', ANNOTATION_TONE[holiday.tone])}
        >
          {holiday.short}
        </span>
      ) : null}
      {meta.freeze ? (
        <span
          data-calendar-freeze
          title={`${meta.freeze.label}（${meta.freeze.start} ~ ${meta.freeze.end}），期间不安排生产变更`}
          aria-label={`${meta.freeze.label}，期间不安排生产变更`}
          className="shrink-0 rounded-sm bg-[var(--nx-status-warning)]/15 px-0.5 text-[11px] font-medium leading-none text-[var(--nx-status-warning)]"
        >
          封网
        </span>
      ) : null}
    </span>
  )
}

/** 任务项的点击/键盘属性（里程碑或无回调时为空）。 */
export function taskItemProps(item: CalendarItem, onOpenTask?: (taskId: number) => void) {
  if (item.kind !== 'task' || !onOpenTask) return {}
  const open = () => onOpenTask(item.sourceId)
  return {
    role: 'button' as const,
    tabIndex: 0,
    title: item.name,
    'data-task-id': item.sourceId,
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation()
      open()
    },
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    },
  }
}

export const FOCUS_RING = 'ring-1 ring-[var(--nx-space-cyan)]'
export const CLICKABLE =
  'cursor-pointer transition-colors hover:border-[var(--nx-space-cyan)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]'

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** 状态 → 信号色令牌映射（任务 6 态 + 里程碑 5 态），未知状态回退中性灰。 */
export const STATUS_TONE: Record<string, { dot: string; band: string }> = {
  not_started: {
    dot: 'bg-[var(--nx-text-secondary)]',
    band: 'border-[var(--nx-text-secondary)]/50 bg-[var(--nx-text-secondary)]/10',
  },
  in_progress: {
    dot: 'bg-[var(--nx-workspace-blue)]',
    band: 'border-[var(--nx-workspace-blue)]/60 bg-[var(--nx-workspace-blue)]/15',
  },
  completed: {
    dot: 'bg-[var(--nx-status-success)]',
    band: 'border-[var(--nx-status-success)]/60 bg-[var(--nx-status-success)]/15',
  },
  blocked: {
    dot: 'bg-[var(--nx-status-danger)]',
    band: 'border-[var(--nx-status-danger)]/60 bg-[var(--nx-status-danger)]/15',
  },
  on_hold: {
    dot: 'bg-[var(--nx-status-warning)]',
    band: 'border-[var(--nx-status-warning)]/60 bg-[var(--nx-status-warning)]/15',
  },
  cancelled: {
    dot: 'bg-[var(--nx-text-muted)]',
    band: 'border-[var(--nx-text-muted)]/50 bg-[var(--nx-text-muted)]/10',
  },
  planned: {
    dot: 'bg-[var(--nx-text-secondary)]',
    band: 'border-[var(--nx-text-secondary)]/50 bg-[var(--nx-text-secondary)]/10',
  },
  at_risk: {
    dot: 'bg-[var(--nx-status-warning)]',
    band: 'border-[var(--nx-status-warning)]/60 bg-[var(--nx-status-warning)]/15',
  },
  achieved: {
    dot: 'bg-[var(--nx-status-success)]',
    band: 'border-[var(--nx-status-success)]/60 bg-[var(--nx-status-success)]/15',
  },
  missed: {
    dot: 'bg-[var(--nx-status-danger)]',
    band: 'border-[var(--nx-status-danger)]/60 bg-[var(--nx-status-danger)]/15',
  },
}

const FALLBACK_TONE = STATUS_TONE.not_started!

/** 里程碑状态 → 45° 棱形微标着色（达成实心、其余发丝框 + 30% 填充）。 */
export const MILESTONE_DIAMOND_TONE: Record<string, string> = {
  planned: 'border-[var(--nx-text-secondary)] bg-[var(--nx-text-secondary)]/30',
  at_risk: 'border-[var(--nx-status-warning)] bg-[var(--nx-status-warning)]/30',
  achieved: 'border-[var(--nx-status-success)] bg-[var(--nx-status-success)]',
  missed: 'border-[var(--nx-status-danger)] bg-[var(--nx-status-danger)]/40',
  not_started: 'border-[var(--nx-text-secondary)] bg-[var(--nx-text-secondary)]/20',
}

export const MILESTONE_STATUS_LABELS: Record<string, string> = {
  planned: '计划中',
  at_risk: '有风险',
  achieved: '已达成',
  missed: '已逾期',
  not_started: '未开始',
}

export const PRIORITY_LABELS: Record<string, string> = {
  highest: '最高',
  high: '高',
  medium: '中',
  low: '低',
  lowest: '最低',
}

export function toneOf(status: string): { dot: string; band: string } {
  return STATUS_TONE[status] ?? FALLBACK_TONE
}

export function statusLabelOf(item: CalendarItem): string {
  if (item.kind === 'milestone') {
    return MILESTONE_STATUS_LABELS[item.status] ?? item.displayStatus ?? item.status
  }
  return (
    (TASK_STATUS_LABELS as Record<string, string>)[item.status] ?? item.displayStatus ?? item.status
  )
}

/** 单点日期或区间的人类可读文本。 */
export function dateSpanText(item: CalendarItem): string {
  const { start, end } = item.dateRange
  const s = start ?? '待定'
  const e = end ?? '待定'
  return s === e ? s : `${s} ~ ${e}`
}
