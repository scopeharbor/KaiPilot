'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { normalizePersonalCalendar, type PersonalLeave } from '@aiproj/types'
import { cn } from '@/lib/utils'
import { myCalendarApi, myCalendarKeys } from '@/lib/api/my-calendar'
import { toast } from '@/components/ui/Toast'

/**
 * 我的工作日历（日历第 3 批）：休假区间 + 个人工作日。跨项目生效——
 * 日历快速新建会避开你不上班的日子，「我的日历」会把它们标出来。只影响你自己。
 */
const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
]

let draftSeq = 0

function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function PersonalWorkingCalendarEditor() {
  const queryClient = useQueryClient()
  const { data, isPending, isError } = useQuery({
    queryKey: myCalendarKeys.workingCalendar(),
    queryFn: () => myCalendarApi.getWorkingCalendar(),
  })
  const [leaves, setLeaves] = React.useState<PersonalLeave[]>([])
  const [workdays, setWorkdays] = React.useState<number[] | null>(null)
  const sourceKey = JSON.stringify(data ?? null)
  React.useEffect(() => {
    if (!data) return
    setLeaves(data.leaves)
    setWorkdays(data.workdays)
    // 只在服务端值变化时重置
  }, [sourceKey])

  const mutation = useMutation({
    mutationFn: () =>
      myCalendarApi.updateWorkingCalendar(normalizePersonalCalendar({ workdays, leaves })),
    onSuccess: (saved) => {
      queryClient.setQueryData(myCalendarKeys.workingCalendar(), saved)
      void queryClient.invalidateQueries({ queryKey: myCalendarKeys.all })
      toast({
        variant: 'success',
        title: '我的工作日历已保存',
        description: `${saved.leaves.length} 段休假${saved.workdays ? ' · 已设个人工作日' : ''}`,
      })
    },
    onError: (error) =>
      toast({
        variant: 'error',
        title: '保存失败',
        description: (error as { message?: string }).message ?? '请检查日期后重试',
      }),
  })

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-xs text-[var(--nx-text-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        正在读取我的工作日历…
      </p>
    )
  }
  if (isError) {
    return <p className="text-xs text-[var(--nx-status-danger)]">我的工作日历读取失败。</p>
  }

  const invalid = leaves.some((leave) => !leave.startDate || !leave.endDate)
  const dirty =
    JSON.stringify(normalizePersonalCalendar({ workdays, leaves })) !==
    JSON.stringify(normalizePersonalCalendar(data))

  const editLeave = (id: string, patch: Partial<PersonalLeave>) =>
    setLeaves((list) => list.map((leave) => (leave.id === id ? { ...leave, ...patch } : leave)))

  return (
    <div data-personal-working-calendar className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs text-[var(--nx-text-secondary)]">休假 / 请假</p>
        {leaves.length === 0 ? (
          <p className="text-xs text-[var(--nx-text-muted)]">还没有休假。</p>
        ) : (
          <ul className="space-y-1.5">
            {leaves.map((leave) => (
              <li
                key={leave.id}
                data-personal-leave
                className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-2 py-1.5 text-xs"
              >
                <input
                  type="date"
                  aria-label="休假开始"
                  value={leave.startDate}
                  onChange={(event) => editLeave(leave.id, { startDate: event.target.value })}
                  className="bg-transparent text-[var(--nx-text-primary)] outline-none"
                />
                <span className="text-[var(--nx-text-muted)]">至</span>
                <input
                  type="date"
                  aria-label="休假结束"
                  value={leave.endDate}
                  min={leave.startDate}
                  onChange={(event) => editLeave(leave.id, { endDate: event.target.value })}
                  className="bg-transparent text-[var(--nx-text-primary)] outline-none"
                />
                <input
                  aria-label="休假说明"
                  placeholder="说明（可不填）"
                  value={leave.note ?? ''}
                  maxLength={100}
                  onChange={(event) => editLeave(leave.id, { note: event.target.value || null })}
                  className="min-w-[8rem] flex-1 bg-transparent text-[var(--nx-text-primary)] outline-none placeholder:text-[var(--nx-text-muted)]"
                />
                <button
                  type="button"
                  aria-label="删除这段休假"
                  onClick={() => setLeaves((list) => list.filter((item) => item.id !== leave.id))}
                  className="rounded p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-status-danger)]"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          data-personal-leave-add
          onClick={() => {
            const day = todayISO()
            setLeaves((list) => [
              ...list,
              { id: `new-${++draftSeq}`, startDate: day, endDate: day, note: null },
            ])
          }}
          className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--nx-border-hairline)] px-2 py-1 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-space-cyan)] hover:text-[var(--nx-space-cyan)]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          加一段休假
        </button>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-[var(--nx-text-secondary)]">
          个人工作日
          <span className="ml-1 text-[var(--nx-text-muted)]">
            （不设就跟随项目工作日历；兼职或固定休息日才需要设）
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="个人工作日">
          {WEEKDAYS.map((day) => {
            const on = workdays?.includes(day.value) ?? false
            return (
              <button
                key={day.value}
                type="button"
                aria-pressed={on}
                data-personal-workday={day.value}
                onClick={() =>
                  setWorkdays((list) => {
                    const current = list ?? []
                    const next = on
                      ? current.filter((value) => value !== day.value)
                      : [...current, day.value]
                    return next.length > 0 ? next : null
                  })
                }
                className={cn(
                  'h-11 w-11 rounded-full border text-xs transition-colors',
                  on
                    ? 'border-[var(--nx-space-cyan)] bg-[var(--nx-space-cyan)]/15 text-[var(--nx-space-cyan)]'
                    : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
                )}
              >
                {day.label}
              </button>
            )
          })}
          {workdays ? (
            <button
              type="button"
              onClick={() => setWorkdays(null)}
              className="ml-1 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
            >
              改回跟随项目
            </button>
          ) : (
            <span className="ml-1 text-xs text-[var(--nx-text-muted)]">现在：跟随项目</span>
          )}
        </div>
      </div>

      <button
        type="button"
        data-personal-calendar-save
        disabled={!dirty || invalid || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--nx-accent)] px-3 text-xs font-medium text-[var(--nx-bg-0)] disabled:opacity-40"
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        {mutation.isPending ? '保存中…' : '保存我的工作日历'}
      </button>
    </div>
  )
}

export default PersonalWorkingCalendarEditor
