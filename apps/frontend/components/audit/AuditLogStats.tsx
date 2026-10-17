'use client'

import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { useQuery } from '@tanstack/react-query'
import { auditLogKeys, auditLogsApi } from '@/lib/api/audit-logs'

interface Props {
  dateFrom?: string
  dateTo?: string
}

const STATS_TIMEOUT_MS = 800

class AuditStatsTimeoutError extends Error {
  constructor() {
    super('审计统计请求超时')
    this.name = 'AuditStatsTimeoutError'
  }
}

function statsWithTimeout(dateFrom?: string, dateTo?: string) {
  return Promise.race([
    auditLogsApi.stats(dateFrom, dateTo),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new AuditStatsTimeoutError()), STATS_TIMEOUT_MS),
    ),
  ])
}

export function AuditLogStats({ dateFrom, dateTo }: Props) {
  const query = useQuery({
    queryKey: auditLogKeys.stats(dateFrom, dateTo),
    queryFn: () => statsWithTimeout(dateFrom, dateTo),
    staleTime: 60_000,
    retry: false,
  })

  if (query.isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} variant="outlined" className="animate-pulse">
            <CardHeader>
              <CardTitle className="h-4 bg-gray-200 rounded w-20" />
            </CardHeader>
            <CardContent className="h-8 bg-gray-100 rounded" />
          </Card>
        ))}
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">统计加载失败</span>
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            重试
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} variant="outlined">
              <CardHeader>
                <CardTitle className="text-sm">
                  {i === 0 ? '按操作' : i === 1 ? '按级别' : '按日期'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-gray-400">无数据</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!query.data) return null

  const { byAction, bySeverity, byDay } = query.data

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-sm">按操作</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm">
            {Object.entries(byAction).map(([key, count]) => (
              <div key={key} className="flex justify-between">
                <span className="text-gray-600">{key}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
            {Object.keys(byAction).length === 0 && <span className="text-gray-400">无数据</span>}
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-sm">按级别</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm">
            {Object.entries(bySeverity).map(([key, count]) => (
              <div key={key} className="flex justify-between">
                <span className="text-gray-600">{key}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
            {Object.keys(bySeverity).length === 0 && <span className="text-gray-400">无数据</span>}
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-sm">按日期</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm max-h-40 overflow-y-auto">
            {byDay.slice(0, 14).map(({ date, count }) => (
              <div key={date} className="flex justify-between">
                <span className="text-gray-600">{date}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
            {byDay.length === 0 && <span className="text-gray-400">无数据</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
