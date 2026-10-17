'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { AuditLogDetailDrawer } from './AuditLogDetailDrawer'
import { AuditLogFilters } from './AuditLogFilters'
import { AuditLogStats } from './AuditLogStats'
import { AuditLogTable } from './AuditLogTable'
import {
  auditLogKeys,
  auditLogsApi,
  type AuditLogEntry,
  type AuditLogFilters as Filters,
} from '@/lib/api/audit-logs'

interface Props {
  scope: 'global' | 'org'
}

function parseFilters(searchParams: URLSearchParams): Filters {
  const filters: Filters = {}
  const actorId = searchParams.get('actorId')
  if (actorId) filters.actorId = Number(actorId)
  const action = searchParams.getAll('action')
  if (action.length > 0) filters.action = action as Filters['action']
  const entityType = searchParams.get('entityType')
  if (entityType) filters.entityType = entityType
  const entityId = searchParams.get('entityId')
  if (entityId) filters.entityId = Number(entityId)
  const severity = searchParams.getAll('severity')
  if (severity.length > 0) filters.severity = severity as Filters['severity']
  const dateFrom = searchParams.get('dateFrom')
  if (dateFrom) filters.dateFrom = dateFrom
  const dateTo = searchParams.get('dateTo')
  if (dateTo) filters.dateTo = dateTo
  const requestId = searchParams.get('requestId')
  if (requestId) filters.requestId = requestId
  const event = searchParams.get('event')
  if (event) filters.event = event
  return filters
}

export function AuditLogPageContent({ scope }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [detailEntry, setDetailEntry] = useState<AuditLogEntry | null>(null)

  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  const list = useQuery({
    queryKey: auditLogKeys.list(filters),
    queryFn: () => auditLogsApi.list(filters),
  })

  const meta = list.data?.meta
  const hasMore = meta ? meta.page < meta.totalPages : false

  const handleFilterChange = useCallback(
    (newFilters: Filters) => {
      const params = new URLSearchParams()
      Object.entries(newFilters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(key, v))
        } else if (value !== undefined && value !== '') {
          params.set(key, String(value))
        }
      })
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router],
  )

  const handleLoadMore = useCallback(() => {
    const nextPage = (meta?.page ?? 1) + 1
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(nextPage))
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [meta?.page, router, searchParams])

  return (
    <div className="space-y-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-800 text-balance">
          {scope === 'global' ? '审计日志（全局）' : '审计日志'}
        </h1>
        <p className="text-sm text-gray-500">
          {scope === 'global' ? '查看跨所有组织的审计日志' : '查看本组织的审计日志'}
        </p>
      </header>

      <AuditLogStats dateFrom={filters.dateFrom} dateTo={filters.dateTo} />

      <AuditLogFilters filters={filters} onChange={handleFilterChange} />

      <AuditLogTable
        data={list.data?.data}
        isLoading={list.isLoading}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        isLoadingMore={list.isFetching}
        onRowClick={setDetailEntry}
      />

      <AuditLogDetailDrawer
        entry={detailEntry}
        open={!!detailEntry}
        onClose={() => setDetailEntry(null)}
      />
    </div>
  )
}
