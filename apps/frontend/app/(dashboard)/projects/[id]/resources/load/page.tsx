'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import PermissionGuard from '@/components/PermissionGuard'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  resourceKeys,
  resourcesApi,
  type ResourceLoadItem,
  type TrendDay,
} from '@/lib/api/resources'

export default function ResourceLoadPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = Number(params.id)
  const view = searchParams.get('view') ?? 'team'

  const today = new Date().toISOString().slice(0, 10)
  const endDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

  const { data, isLoading, error } = useQuery({
    queryKey: resourceKeys.load(projectId, {
      from: today,
      to: endDate,
      view: view as 'team' | 'personal' | 'trend',
    }),
    queryFn: () =>
      resourcesApi.load(projectId, {
        from: today,
        to: endDate,
        view: view as 'team' | 'personal' | 'trend',
      }),
  })

  const setView = (v: string) => {
    router.push(`/projects/${projectId}/resources/load?view=${v}`)
  }

  return (
    <PermissionGuard
      require="resource:view"
      fallback={<div className="p-6 text-muted-foreground">无权查看</div>}
    >
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push(`/projects/${projectId}/resources`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">资源负载</h1>
          </div>
          <div className="flex gap-2" role="tablist" aria-label="负载视图切换">
            {[
              { key: 'team', label: '团队' },
              { key: 'trend', label: '趋势' },
            ].map((tab) => (
              <Button
                key={tab.key}
                variant={view === tab.key ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setView(tab.key)}
                role="tab"
                aria-selected={view === tab.key}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </div>

        {isLoading && <Skeleton className="h-64 w-full" />}
        {error && <Alert>加载失败</Alert>}

        {data && 'resources' in data && view === 'team' && (
          <TeamLoadView
            resources={data.resources}
            teamAvg={data.teamAverageUtilizationPercent}
            from={data.from}
            to={data.to}
          />
        )}

        {data && 'days' in data && view === 'trend' && (
          <TrendView
            days={data.days}
            from={data.from}
            to={data.to}
            totalResources={data.totalResources}
          />
        )}
      </div>
    </PermissionGuard>
  )
}

function TeamLoadView({
  resources,
  teamAvg,
  from,
  to,
}: {
  resources: ResourceLoadItem[]
  teamAvg: number
  from: string
  to: string
}) {
  const dates = resources[0]?.days.map((d) => d.date) ?? []

  const colorClass = (pct: number) => {
    if (pct > 100) return 'bg-red-400'
    if (pct > 80) return 'bg-yellow-400'
    if (pct > 0) return 'bg-green-300'
    return 'bg-gray-100'
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            团队负载
            <span className="ml-3 text-sm font-normal text-muted-foreground">
              {from} ~ {to}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-3">
            <span className="text-sm text-muted-foreground">团队平均利用率:</span>
            <span
              className={`text-xl font-bold ${teamAvg > 100 ? 'text-red-500' : teamAvg > 90 ? 'text-yellow-500' : teamAvg > 0 ? 'text-green-500' : 'text-gray-400'}`}
              aria-label={`团队平均利用率 ${teamAvg}%`}
            >
              {teamAvg}%
            </span>
            {teamAvg > 90 && (
              <span
                className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700"
                role="alert"
              >
                团队负载较高
              </span>
            )}
            {teamAvg === 0 && (
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">无分配</span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white py-1 pr-2 text-left text-xs font-medium text-muted-foreground">
                    资源
                  </th>
                  {dates.map((d) => (
                    <th key={d} className="w-6 py-1 text-center text-[10px] text-muted-foreground">
                      {d.slice(5)}
                    </th>
                  ))}
                  <th className="pl-2 text-right text-xs text-muted-foreground">总利用率</th>
                </tr>
              </thead>
              <tbody>
                {resources.slice(0, 20).map((r) => (
                  <tr key={r.resourceId}>
                    <td className="sticky left-0 max-w-[120px] truncate bg-white py-1 pr-2 text-xs font-medium">
                      {r.resourceName}
                    </td>
                    {r.days.map((d) => (
                      <td key={d.date} className="p-0.5">
                        <div
                          className={`h-4 w-full rounded ${colorClass(d.totalAllocatedPercent)}`}
                          title={`${r.resourceName} ${d.date}: ${d.totalAllocatedPercent}%`}
                        />
                      </td>
                    ))}
                    <td className="pl-2 text-right text-xs">
                      <span
                        className={`${r.overallUtilizationPercent > 100 ? 'text-red-500 font-bold' : ''}`}
                      >
                        {r.overallUtilizationPercent}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {resources.length > 20 && (
            <p className="mt-2 text-xs text-muted-foreground">仅显示前 20 名资源</p>
          )}

          <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-gray-100" /> 未分配
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-green-300" /> &le;80%
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-yellow-400" /> 80-100%
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-red-400" /> &gt;100%
            </span>
          </div>
        </CardContent>
      </Card>

      {resources.map((r) => {
        const alertType =
          r.overallUtilizationPercent > 100
            ? 'error'
            : r.overallUtilizationPercent > 80
              ? 'warning'
              : null
        if (!alertType) return null
        return (
          <Alert
            key={r.resourceId}
            className={
              alertType === 'error' ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'
            }
          >
            <span className="font-medium">{r.resourceName}</span>
            {r.overallUtilizationPercent > 100
              ? ' 综合利用率超过 100%，建议调整分配'
              : ' 综合利用率超过 80%，关注负载'}
          </Alert>
        )
      })}
    </div>
  )
}

function TrendView({
  days,
  from,
  to,
  totalResources,
}: {
  days: TrendDay[]
  from: string
  to: string
  totalResources: number
}) {
  const maxPct = Math.max(...days.map((d) => d.utilizationPercent), 1)
  const height = 120

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          负载趋势
          <span className="ml-3 text-sm font-normal text-muted-foreground">
            {from} ~ {to} ({totalResources} 人)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${days.length * 20} ${height + 30}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {days.map((d, i) => {
            const barH = (d.utilizationPercent / maxPct) * height
            const color =
              d.utilizationPercent > 100
                ? '#ef4444'
                : d.utilizationPercent > 80
                  ? '#eab308'
                  : '#22c55e'
            return (
              <g key={d.date}>
                <rect x={i * 20 + 2} y={height - barH} width={16} height={barH} fill={color} rx={2}>
                  <title>
                    {d.date}: {d.utilizationPercent}%
                  </title>
                </rect>
                {i % 5 === 0 && (
                  <text
                    x={i * 20 + 10}
                    y={height + 16}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize={9}
                  >
                    {d.date.slice(5)}
                  </text>
                )}
              </g>
            )
          })}
          <line x1={0} y1={height} x2={days.length * 20} y2={height} stroke="#e5e7eb" />
        </svg>

        {days.filter((d) => d.utilizationPercent > 100).length > 0 && (
          <Alert className="mt-3 border-red-200 bg-red-50">
            {days.filter((d) => d.utilizationPercent > 100).length} 天存在过载
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
