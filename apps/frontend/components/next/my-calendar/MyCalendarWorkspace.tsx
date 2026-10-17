'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'
import { calendarDisplayApi, calendarDisplayKeys } from '@/lib/api/calendar-display'
import { useMyCalendarSchedule } from '@/hooks/use-my-calendar'
import type { CalendarItem } from '@/lib/calendar-types'
import { WorkspaceCalendarLens } from '@/components/next/lenses/WorkspaceCalendarLens'

/**
 * 「我的日历」（日历第 3 批）：跨项目只看指派给我的任务，标出我的休假；
 * 曆法按「个人 > 组织 > 系统默认」生效；可直接在日历上新建（卡片里选项目）。
 * 点任务跳到所在项目的日历并打开详情。
 */
export function MyCalendarWorkspace() {
  const router = useRouter()
  const { data: display } = useQuery({
    queryKey: calendarDisplayKeys.detail(null),
    queryFn: () => calendarDisplayApi.get(null),
  })
  const openItem = React.useCallback(
    (item: CalendarItem) => {
      router.push(`/next/projects/${item.projectId}?lens=calendar&focusTask=${item.sourceId}`)
    },
    [router],
  )
  return (
    <div data-my-calendar className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--nx-text-primary)]">我的日历</h2>
          <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
            所有项目里指派给我的任务；标「休假」的是我不上班的日子。双击空白就能新建。
          </p>
        </div>
        <Link
          href="/next/settings/calendar"
          data-my-calendar-settings
          className="inline-flex items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] px-2.5 py-1 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-space-cyan)] hover:text-[var(--nx-space-cyan)]"
        >
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
          休假与曆法设置
        </Link>
      </header>
      <WorkspaceCalendarLens
        projectId={null}
        useSchedule={useMyCalendarSchedule}
        onOpenItem={openItem}
        calendarSystems={display?.systems}
      />
    </div>
  )
}

export default MyCalendarWorkspace
