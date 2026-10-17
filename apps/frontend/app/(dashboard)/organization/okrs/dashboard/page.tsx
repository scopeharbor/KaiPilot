'use client'

// OKR Dashboard 工作台首页（v3-okr-dashboard §5.3–5.4）。
//
// 路由：`/organization/okrs/dashboard`
// 只读页面：调用 GET /api/v1/organizations/:orgId/okrs/dashboard
// 首屏包含：
//   - 周期选择
//   - scope / owner / status 筛选（V1 只做 scope + status 两项，owner 后续接入）
//   - KPI 条
//   - progress / status 分布
//   - 关注项列表
//   - 对齐健康度
//   - 证据 / 数据源新鲜度
//   - Warning 列表
//   - Backflow 状态
//
// 权限：`okr:view`。未授权渲染 forbidden 空态；查询错误渲染重试按钮，不吞异常。

import { useMemo, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import { useOkrDashboardSummary } from '@/hooks/use-okr-dashboard'
import { useOkrCycles } from '@/hooks/use-okr'
import { usePermissions } from '@/hooks/use-permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { OKR_DASHBOARD_SECTION_VALUES } from '@aiproj/types'
import type { OkrDashboardQuery, OkrScope, OkrStatus } from '@aiproj/types'
import {
  OkrAlignmentHealthPanel,
  OkrAttentionTable,
  OkrBackflowStrip,
  OkrCycleHeader,
  OkrDistributionList,
  OkrEvidenceFreshness,
  OkrKpiStrip,
  OkrSourceFreshnessList,
  OkrStaleRail,
  OkrWarningList,
} from '@/components/okr/okr-dashboard-components'
import { deriveOkrDashboardUiStatus } from '@/lib/okr-dashboard-ui'

const SCOPE_OPTIONS: { label: string; value: OkrScope | 'all' }[] = [
  { label: '全部', value: 'all' },
  { label: '组织', value: 'organization' },
  { label: '团队', value: 'team' },
  { label: '项目', value: 'project' },
  { label: '个人', value: 'individual' },
]

const STATUS_OPTIONS: { label: string; value: OkrStatus | 'all' }[] = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'active' },
  { label: '已暂停', value: 'paused' },
  { label: '已完成', value: 'completed' },
]

export default function OkrDashboardPage() {
  const { can } = usePermissions()
  const canView = can('okr:view')
  const organizationId = useCurrentOrganizationId()

  const [selectedCycleId, setSelectedCycleId] = useState<number | undefined>()
  const [scope, setScope] = useState<OkrScope | 'all'>('all')
  const [status, setStatus] = useState<OkrStatus | 'all'>('all')

  const query: OkrDashboardQuery = useMemo(
    () => ({
      cycleId: selectedCycleId,
      scope: scope === 'all' ? undefined : scope,
      status: status === 'all' ? undefined : status,
      sections: [...OKR_DASHBOARD_SECTION_VALUES],
    }),
    [selectedCycleId, scope, status],
  )

  const { data: cyclesData, isLoading: cyclesLoading } = useOkrCycles(organizationId ?? 0, {})
  const {
    data: summary,
    isLoading,
    error,
    refetch,
  } = useOkrDashboardSummary({
    organizationId,
    query,
    enabled: canView && organizationId !== null,
  })

  const uiStatus = deriveOkrDashboardUiStatus({
    isLoading,
    error,
    summary,
    actorCanView: canView,
  })

  if (uiStatus === 'forbidden') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有 OKR Dashboard 访问权限，请联系管理员申请。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (uiStatus === 'error') {
    return (
      <div className="mx-auto max-w-6xl space-y-3 p-4 sm:p-6">
        <Alert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载 OKR Dashboard 失败，请稍后重试。</AlertDescription>
        </Alert>
        <Button variant="secondary" onClick={() => refetch()} data-testid="okr-dashboard-retry">
          <RefreshCw className="mr-1 h-4 w-4" /> 重试
        </Button>
      </div>
    )
  }

  const cycles = cyclesData?.data ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6" data-testid="okr-dashboard-page">
      {/* 顶栏：周期选择 + 筛选 */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="okr-cycle-picker">
            周期
          </label>
          <select
            id="okr-cycle-picker"
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={selectedCycleId ?? ''}
            onChange={(e) =>
              setSelectedCycleId(e.target.value ? Number(e.target.value) : undefined)
            }
            data-testid="okr-cycle-picker"
            disabled={cyclesLoading}
          >
            <option value="">当前活跃周期</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="okr-scope-picker">
            范围
          </label>
          <select
            id="okr-scope-picker"
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value as OkrScope | 'all')}
            data-testid="okr-scope-picker"
          >
            {SCOPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="okr-status-picker">
            状态
          </label>
          <select
            id="okr-status-picker"
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as OkrStatus | 'all')}
            data-testid="okr-status-picker"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cycle context */}
      <OkrCycleHeader cycle={summary?.cycleContext} />

      {/* Loading 骨架 */}
      {uiStatus === 'loading' && (
        <div className="space-y-4" data-testid="okr-dashboard-loading">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-40" />
        </div>
      )}

      {/* 空态 */}
      {uiStatus === 'empty' && (
        <EmptyState
          title="当前周期暂无 OKR"
          description="创建目标或切换周期以查看数据。"
          data-testid="okr-dashboard-empty"
        />
      )}

      {/* stale 提示 */}
      {uiStatus === 'stale' && <OkrStaleRail summary={summary} />}

      {/* KPI 条 */}
      {(uiStatus === 'ok' || uiStatus === 'stale') && (
        <>
          <OkrKpiStrip summary={summary} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <OkrDistributionList
              slices={summary?.progressDistribution ?? []}
              title="进度分布"
              testid="okr-progress-distribution"
            />
            <OkrDistributionList
              slices={summary?.statusDistribution ?? []}
              title="状态分布"
              testid="okr-status-distribution"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">关注项</CardTitle>
            </CardHeader>
            <CardContent>
              <OkrAttentionTable items={summary?.attention ?? []} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <OkrAlignmentHealthPanel health={summary?.alignmentHealth} />
            <OkrEvidenceFreshness evidence={summary?.evidenceFreshness} />
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">数据源新鲜度</CardTitle>
              </CardHeader>
              <CardContent>
                <OkrSourceFreshnessList summary={summary} />
              </CardContent>
            </Card>
          </div>

          <OkrBackflowStrip summary={summary} />
          <OkrWarningList warnings={summary?.warnings ?? []} />
        </>
      )}
    </div>
  )
}
