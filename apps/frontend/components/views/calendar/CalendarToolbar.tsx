'use client'

import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import type { CalendarView as CalendarViewType } from '@/lib/api/calendar'
import { DateTime } from 'luxon'

interface CalendarToolbarProps {
  view: CalendarViewType
  anchorDate: string
  search?: string
  status?: string
  priority?: string
  assigneeId?: string
  onViewChange: (view: CalendarViewType) => void
  onToday: () => void
  onPrev: () => void
  onNext: () => void
  onSearchChange: (search: string) => void
  onStatusChange: (status: string) => void
  onPriorityChange: (priority: string) => void
  onAssigneeChange: (assigneeId: string) => void
}

const VIEW_LABELS: Record<CalendarViewType, string> = {
  month: '月',
  week: '周',
  day: '日',
}

const STATUS_OPTIONS = [
  { value: 'not_started', label: '未开始' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'blocked', label: '已阻塞' },
  { value: 'on_hold', label: '已挂起' },
  { value: 'cancelled', label: '已取消' },
]

const PRIORITY_OPTIONS = [
  { value: 'lowest', label: '最低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'highest', label: '最高' },
]

function formatAnchorDate(view: CalendarViewType, anchorDate: string): string {
  const dt = DateTime.fromISO(anchorDate)
  if (view === 'month') return dt.toFormat('yyyy年 M月')
  if (view === 'week') {
    const start = dt.startOf('week')
    const end = dt.endOf('week')
    return `${start.toFormat('M/d')} - ${end.toFormat('M/d')}`
  }
  return dt.toFormat('yyyy年 M月 d日')
}

export function CalendarToolbar({
  view,
  anchorDate,
  search,
  status,
  priority,
  onViewChange,
  onToday,
  onPrev,
  onNext,
  onSearchChange,
  onStatusChange,
  onPriorityChange,
}: CalendarToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-[var(--density-gap)]">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={onPrev}
          aria-label="前一个"
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onToday}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          今天
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onNext}
          aria-label="后一个"
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-sm font-medium">{formatAnchorDate(view, anchorDate)}</span>
      </div>

      <div className="flex items-center gap-1 ml-auto">
        {(['month', 'week', 'day'] as CalendarViewType[]).map((v) => (
          <Button
            key={v}
            variant={v === view ? 'primary' : 'outline'}
            size="sm"
            onClick={() => onViewChange(v)}
            aria-pressed={v === view}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {VIEW_LABELS[v]}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 w-full mt-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索任务…"
            defaultValue={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
            aria-label="搜索日历任务"
          />
        </div>
        <Select value={status ?? ''} onValueChange={onStatusChange}>
          <SelectTrigger className="w-[120px]" aria-label="按状态筛选">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priority ?? ''} onValueChange={onPriorityChange}>
          <SelectTrigger className="w-[100px]" aria-label="按优先级筛选">
            <SelectValue placeholder="优先级" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部</SelectItem>
            {PRIORITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
