'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { CalendarPlus } from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import PermissionGuard from '@/components/PermissionGuard'
import { CalendarView } from '@/components/views/calendar/CalendarView'
import { parseCalendarState } from '@/lib/calendar-state'

export default function ProjectCalendarPage() {
  const projectId = Number(useParams().id)
  return (
    <PermissionGuard
      require="task:view"
      fallback={<Alert className="my-8">你没有查看项目日历的权限。</Alert>}
    >
      <CalendarPage projectId={projectId} />
    </PermissionGuard>
  )
}

function CalendarPage({ projectId }: { projectId: number }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const filters = parseCalendarState(searchParams)

  const updateFilters = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch }
    const params = new URLSearchParams()
    if (next.view !== 'month') params.set('view', next.view)
    if (next.anchorDate) params.set('anchorDate', next.anchorDate)
    if (next.mode) params.set('mode', next.mode)
    if (next.search) params.set('search', next.search)
    if (next.status) params.set('status', next.status)
    if (next.priority) params.set('priority', next.priority)
    if (next.assigneeId) params.set('assigneeId', next.assigneeId)
    if (next.itemTypes) params.set('itemTypes', next.itemTypes)
    if (next.page && next.page !== 1) params.set('page', String(next.page))
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/integrations?category=calendar">
            <CalendarPlus className="h-4 w-4" />
            绑定日历
          </Link>
        </Button>
      </div>
      <CalendarView projectId={projectId} filters={filters} onFiltersChange={updateFilters} />
    </div>
  )
}
