'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, Check, RotateCcw } from 'lucide-react'
import {
  CALENDAR_SYSTEM_IDS,
  CALENDAR_SYSTEM_LABELS,
  isPrimaryCalendarSystem,
  primaryCalendarOf,
  type CalendarSystemId,
} from '@aiproj/types'
import { cn } from '@/lib/utils'
import { annotationsFor, primaryDayLabel, primaryMonthAt } from '@/lib/calendar-systems'

/**
 * 曆法有序多选：勾选要显示的曆法，用 ↑↓ 调顺序；第一个可当主曆的（公历 / 农历 / 藏历 / 回历）
 * 决定月格与格子大数字，其余作为副曆标注。右侧即时预览今天在这组设定下的样子。
 */
export interface CalendarSystemsEditorProps {
  /** 当前值（null = 未设定，继承上层；编辑器以 inherited 作为起点展示）。 */
  value: readonly CalendarSystemId[] | null
  /** 继承到的生效值（value 为 null 时的展示与起点）。 */
  inherited: readonly CalendarSystemId[]
  disabled?: boolean
  saving?: boolean
  /** 保存这一层（null = 清除，改为继承上层）。 */
  onSave: (systems: CalendarSystemId[] | null) => void
  /** 「清除（继承）」按钮的说明，如「改为继承项目设定」。 */
  inheritLabel: string
  today?: string
}

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function CalendarSystemsEditor({
  value,
  inherited,
  disabled = false,
  saving = false,
  onSave,
  inheritLabel,
  today,
}: CalendarSystemsEditorProps) {
  const [selected, setSelected] = React.useState<CalendarSystemId[]>(() => [
    ...(value ?? inherited),
  ])
  const sourceKey = (value ?? inherited).join(',')
  React.useEffect(() => {
    setSelected([...(value ?? inherited)])
    // 只在外部值变化时重置
  }, [sourceKey])

  const dirty = selected.join(',') !== (value ?? inherited).join(',') || value === null
  const unselected = CALENDAR_SYSTEM_IDS.filter((id) => !selected.includes(id))
  const primary = primaryCalendarOf(selected)
  const date = today ?? todayISO()

  const toggle = (id: CalendarSystemId) =>
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))
  const move = (index: number, delta: number) =>
    setSelected((list) => {
      const next = [...list]
      const target = index + delta
      if (target < 0 || target >= next.length) return list
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })

  const month = primaryMonthAt(primary, date)
  const preview = annotationsFor(
    date,
    selected.filter((id) => id !== primary),
  )

  return (
    <div data-calendar-systems-editor className="grid gap-4 md:grid-cols-[1fr_220px]">
      <div className="space-y-3">
        <ol aria-label="已选曆法（顺序即显示顺序）" className="space-y-1">
          {selected.map((id, index) => {
            const isPrimary = id === primary
            return (
              <li
                key={id}
                data-calendar-system={id}
                data-primary={isPrimary ? 'true' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm',
                  isPrimary
                    ? 'border-[var(--nx-space-cyan)]/60 bg-[var(--nx-space-cyan)]/5'
                    : 'border-[var(--nx-border-hairline)]',
                )}
              >
                <span className="w-5 text-right font-mono text-xs text-[var(--nx-text-muted)]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--nx-text-primary)]">
                  {CALENDAR_SYSTEM_LABELS[id]}
                </span>
                {isPrimary ? (
                  <span className="rounded-sm bg-[var(--nx-space-cyan)]/15 px-1.5 text-[11px] text-[var(--nx-space-cyan)]">
                    主曆
                  </span>
                ) : !isPrimaryCalendarSystem(id) ? (
                  <span className="text-[11px] text-[var(--nx-text-muted)]">标注</span>
                ) : (
                  <span className="text-[11px] text-[var(--nx-text-muted)]">副曆</span>
                )}
                <button
                  type="button"
                  aria-label={`上移 ${CALENDAR_SYSTEM_LABELS[id]}`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  className="rounded p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`下移 ${CALENDAR_SYSTEM_LABELS[id]}`}
                  disabled={disabled || index === selected.length - 1}
                  onClick={() => move(index, 1)}
                  className="rounded p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`取消 ${CALENDAR_SYSTEM_LABELS[id]}`}
                  disabled={disabled}
                  onClick={() => toggle(id)}
                  className="rounded px-1 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-status-danger)] disabled:opacity-30"
                >
                  移除
                </button>
              </li>
            )
          })}
        </ol>

        {unselected.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs text-[var(--nx-text-muted)]">点选加入（加到最后）：</p>
            <div className="flex flex-wrap gap-1.5">
              {unselected.map((id) => (
                <button
                  key={id}
                  type="button"
                  data-calendar-system-add={id}
                  disabled={disabled}
                  onClick={() => toggle(id)}
                  className="rounded-full border border-[var(--nx-border-hairline)] px-2.5 py-1 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-space-cyan)] hover:text-[var(--nx-space-cyan)] disabled:opacity-40"
                >
                  + {CALENDAR_SYSTEM_LABELS[id]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className="text-xs leading-relaxed text-[var(--nx-text-muted)]">
          排在最前面、能排月份的曆法（公历 / 农历 / 藏历 /
          回历）是主曆：决定一个月有哪些天与格子里的大数字；
          其余按顺序显示在格子角落。只影响日历显示，任务日期与排期不变。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-calendar-systems-save
            disabled={disabled || saving || selected.length === 0 || !dirty}
            onClick={() => onSave(selected)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--nx-accent)] px-3 text-xs font-medium text-[var(--nx-bg-0)] disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            {saving ? '保存中…' : '保存'}
          </button>
          {value !== null ? (
            <button
              type="button"
              data-calendar-systems-inherit
              disabled={disabled || saving}
              onClick={() => onSave(null)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {inheritLabel}
            </button>
          ) : null}
        </div>
      </div>

      <aside
        data-calendar-systems-preview
        className="h-fit rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
      >
        <p className="text-[11px] text-[var(--nx-text-muted)]">今天的样子</p>
        <p className="mt-1 truncate text-sm font-medium text-[var(--nx-text-primary)]">
          {month.title}
        </p>
        <div className="mt-2 flex items-start justify-between gap-2 rounded border border-[var(--nx-border-hairline)] p-2">
          <div className="flex min-w-0 flex-col gap-1">
            {preview.length === 0 ? (
              <span className="text-[11px] text-[var(--nx-text-muted)]">（今天没有标注）</span>
            ) : (
              preview.map((item) => (
                <span
                  key={item.system}
                  className="truncate text-[11px] text-[var(--nx-text-secondary)]"
                >
                  {item.short}
                </span>
              ))
            )}
          </div>
          <span className="text-xl font-semibold text-[var(--nx-space-cyan)]">
            {primaryDayLabel(primary, date)}
          </span>
        </div>
      </aside>
    </div>
  )
}

export default CalendarSystemsEditor
