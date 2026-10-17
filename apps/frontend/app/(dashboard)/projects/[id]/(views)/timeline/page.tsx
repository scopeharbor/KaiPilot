'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Alert } from '@/components/ui/Alert'
import PermissionGuard from '@/components/PermissionGuard'
import { TimelineView } from '@/components/views/timeline/TimelineView'
import type { TimelineFilters } from '@/lib/api/timeline'
import { parseTimelineState, serializeTimelineState } from '@/lib/timeline-state'

/** 项目记忆 Timeline 视图（v2-project-memory-timeline）。 */
export default function ProjectTimelinePage() {
  const projectId = Number(useParams().id)
  return (
    <PermissionGuard
      require="project:view"
      fallback={<Alert className="my-8">你没有查看项目时间线的权限。</Alert>}
    >
      <TimelinePage projectId={projectId} />
    </PermissionGuard>
  )
}

function TimelinePage({ projectId }: { projectId: number }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const filters = parseTimelineState(searchParams)

  const updateFilters = (patch: Partial<TimelineFilters>) => {
    const next = { ...filters, ...patch }
    const query = serializeTimelineState(next)
    router.replace(query ? `?${query}` : '?', { scroll: false })
  }

  const clearFilters = () => {
    router.replace('?', { scroll: false })
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <TimelineView
        projectId={projectId}
        filters={filters}
        onFiltersChange={updateFilters}
        onClearFilters={clearFilters}
      />
    </div>
  )
}
