'use client'

import { useMemo, type ChangeEvent } from 'react'
import { cn } from '@/lib/utils'

/**
 * PeriodRangeSelector —— 周期范围选择器。
 *
 * 提供快速选项：「本周」「上周」「本月」「上月」，自动计算 ISO 周/月边界。
 * 支持手动日期输入回退。
 */

export interface PeriodRange {
  fromDate: string
  toDate: string
}

type QuickOption = 'this-week' | 'last-week' | 'this-month' | 'last-month'

const QUICK_OPTIONS: { value: QuickOption; label: string }[] = [
  { value: 'this-week', label: '本周' },
  { value: 'last-week', label: '上周' },
  { value: 'this-month', label: '本月' },
  { value: 'last-month', label: '上月' },
]

function getWeekBoundary(date: Date, offset: number): { from: Date; to: Date } {
  const target = new Date(date)
  target.setDate(target.getDate() + offset * 7)
  const day = target.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(target)
  monday.setDate(target.getDate() + diffToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { from: monday, to: sunday }
}

function getMonthBoundary(date: Date, offset: number): { from: Date; to: Date } {
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1)
  const nextMonth = new Date(target.getFullYear(), target.getMonth() + 1, 1)
  const lastDay = new Date(nextMonth.getTime() - 86400000)
  return { from: target, to: lastDay }
}

function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function computeRange(option: QuickOption): PeriodRange {
  const now = new Date()
  switch (option) {
    case 'this-week': {
      const { from, to } = getWeekBoundary(now, 0)
      return { fromDate: toDateString(from), toDate: toDateString(to) }
    }
    case 'last-week': {
      const { from, to } = getWeekBoundary(now, -1)
      return { fromDate: toDateString(from), toDate: toDateString(to) }
    }
    case 'this-month': {
      const { from, to } = getMonthBoundary(now, 0)
      return { fromDate: toDateString(from), toDate: toDateString(to) }
    }
    case 'last-month': {
      const { from, to } = getMonthBoundary(now, -1)
      return { fromDate: toDateString(from), toDate: toDateString(to) }
    }
  }
}

function isSameRange(a: PeriodRange, b: PeriodRange): boolean {
  return a.fromDate === b.fromDate && a.toDate === b.toDate
}

function matchQuickOption(range: PeriodRange): QuickOption | null {
  for (const opt of QUICK_OPTIONS) {
    if (isSameRange(range, computeRange(opt.value))) return opt.value
  }
  return null
}

export interface PeriodRangeSelectorProps {
  value: PeriodRange
  onChange: (range: PeriodRange) => void
  disabled?: boolean
}

export function PeriodRangeSelector({
  value,
  onChange,
  disabled = false,
}: PeriodRangeSelectorProps) {
  const activeOption = useMemo(() => matchQuickOption(value), [value])

  return (
    <div className="space-y-3">
      {/* 快速选项 */}
      <div className="flex flex-wrap gap-2">
        {QUICK_OPTIONS.map((opt) => {
          const isActive = activeOption === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(computeRange(opt.value))}
              className={cn(
                'rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm transition-colors',
                isActive
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-border bg-white text-gray-600 hover:border-primary-300 hover:text-gray-800',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* 手动日期输入 */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <input
            type="date"
            value={value.fromDate}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, fromDate: e.target.value })
            }
            disabled={disabled}
            aria-label="起始日期"
            className={cn(
              'flex h-9 w-full rounded-[var(--radius-sm)] border border-border bg-gray-0 px-3 py-1 text-sm text-gray-800',
              'transition-[border-color,box-shadow] duration-150',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
        </div>
        <span className="text-sm text-gray-500">至</span>
        <div className="flex-1">
          <input
            type="date"
            value={value.toDate}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChange({ ...value, toDate: e.target.value })
            }
            disabled={disabled}
            aria-label="结束日期"
            className={cn(
              'flex h-9 w-full rounded-[var(--radius-sm)] border border-border bg-gray-0 px-3 py-1 text-sm text-gray-800',
              'transition-[border-color,box-shadow] duration-150',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />
        </div>
      </div>
    </div>
  )
}
