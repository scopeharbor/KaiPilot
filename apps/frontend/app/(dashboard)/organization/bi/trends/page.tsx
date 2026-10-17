'use client'

import { useState, useMemo } from 'react'
import { useBiTrendAnalysis, type BiTrendAnalysisApiParams } from '@/hooks/use-bi-trend-analysis'
import { usePermissions } from '@/hooks/use-permissions'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { BiTrendChart } from '@/components/bi-trend/BiTrendChart'
import { BiTrendAnomalyList } from '@/components/bi-trend/BiTrendAnomalyList'
import { BiTrendExplanationDrawer } from '@/components/bi-trend/BiTrendExplanationDrawer'
import { BiTrendFilterBar } from '@/components/bi-trend/BiTrendFilterBar'
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  EyeOff,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  BiTrendSeries,
  BiTrendMetricKey,
  BiTrendWindow,
  BiTrendGrain,
  BiTrendDimensionKey,
  BiTrendCompareMode,
} from '@aiproj/types'
import {
  BI_TREND_METRIC_KEYS,
  BI_TREND_WINDOWS,
  BI_TREND_GRAINS,
  BI_TREND_METRIC_KEY_VALUES,
  BI_TREND_DIRECTION_LABELS,
} from '@aiproj/types'

// ─── 方向图标映射 ──────────────────────────────────────────────────────────────

const DIRECTION_ICONS: Record<string, React.ReactNode> = {
  up: <TrendingUp className="h-4 w-4 text-red-500" />,
  down: <TrendingDown className="h-4 w-4 text-green-500" />,
  flat: <Minus className="h-4 w-4 text-gray-400" />,
  unknown: <AlertCircle className="h-4 w-4 text-gray-400" />,
}

const DIRECTION_BADGE_CLASS: Record<string, string> = {
  up: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400',
  down: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400',
  flat: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  unknown: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

// ─── 指标中文标签映射 ─────────────────────────────────────────────────────────

const METRIC_LABELS: Record<string, string> = {
  [BI_TREND_METRIC_KEYS.PROJECT_PROGRESS]: '项目进度',
  [BI_TREND_METRIC_KEYS.SCHEDULE_DELAY_PRESSURE]: '延期压力',
  [BI_TREND_METRIC_KEYS.RISK_PRESSURE]: '风险压力',
  [BI_TREND_METRIC_KEYS.RESOURCE_PRESSURE]: '资源压力',
  [BI_TREND_METRIC_KEYS.FORECAST_DEMAND_PRESSURE]: '预测需求压力',
  [BI_TREND_METRIC_KEYS.OKR_PROGRESS]: 'OKR 进展',
}

/**
 * BI 趋势分析工作台（v3-bi-trend-analysis §4.3–4.8）。
 *
 * 路由：`/organization/bi/trends`
 * 首屏：筛选条 + 趋势卡片网格 + 异常/洞察列表 + 解释抽屉。
 * 面向 PMO 分析师、项目总监与专业 PM 的扫描/对比/下钻工作台。
 */
export default function BiTrendAnalysisWorkbench() {
  const { canAny } = usePermissions()
  const hasAccess = canAny(['org:view', 'portfolio:view'])
  const orgId = useCurrentOrganizationId()

  // ── 查询参数状态 ──
  const [metricKeys, setMetricKeys] = useState<BiTrendMetricKey[]>(
    BI_TREND_METRIC_KEY_VALUES as unknown as BiTrendMetricKey[],
  )
  const [window, setWindow] = useState<BiTrendWindow>(BI_TREND_WINDOWS.LAST_12_WEEKS)
  const [grain, setGrain] = useState<BiTrendGrain>(BI_TREND_GRAINS.WEEK)
  const [dimensions, setDimensions] = useState<BiTrendDimensionKey[]>([])
  const [compareWith, setCompareWith] = useState<BiTrendCompareMode>('previous_period')
  const [includeAnomalies, setIncludeAnomalies] = useState(true)
  const [includeForecast, setIncludeForecast] = useState(false)

  // ── 下钻状态 ──
  const [selectedSeries, setSelectedSeries] = useState<BiTrendSeries | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const params: BiTrendAnalysisApiParams = useMemo(
    () => ({
      organizationId: orgId ?? 0,
      metricKeys: metricKeys as string[],
      window,
      grain,
      dimensions: dimensions as string[],
      compareWith,
      includeAnomalies,
      includeForecast,
      perPage: 20,
    }),
    [orgId, metricKeys, window, grain, dimensions, compareWith, includeAnomalies, includeForecast],
  )

  const {
    data: seriesList,
    meta,
    warnings,
    isLoading,
    isError,
    error,
    isRestricted,
    isEmpty,
    isDegraded,
    refetch,
  } = useBiTrendAnalysis(params)

  // ── 无权限 ──
  if (!hasAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有 BI 趋势分析访问权限。</AlertDescription>
        </Alert>
      </div>
    )
  }

  // ── 无组织上下文 ──
  if (!orgId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="warning" className="max-w-md">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>请先切换到组织视图。</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* 页头 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">BI 趋势分析</h1>
          <p className="text-sm text-muted-foreground">
            组织指标趋势、异常与可解释洞察
            {/* calculatedAt 在 meta 里是可选字段：降级响应可能不带它，缺失时不显示时间 */}
            {meta?.calculatedAt && ` · 更新于 ${new Date(meta.calculatedAt).toLocaleString()}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {/* 筛选条 */}
      <BiTrendFilterBar
        metricKeys={metricKeys}
        onMetricKeysChange={(keys) => setMetricKeys(keys as BiTrendMetricKey[])}
        window={window}
        onWindowChange={(w) => setWindow(w as BiTrendWindow)}
        grain={grain}
        onGrainChange={(g) => setGrain(g as BiTrendGrain)}
        dimensions={dimensions}
        onDimensionsChange={(d) => setDimensions(d as BiTrendDimensionKey[])}
        compareWith={compareWith}
        onCompareWithChange={(c) => setCompareWith(c as BiTrendCompareMode)}
        includeAnomalies={includeAnomalies}
        onIncludeAnomaliesChange={setIncludeAnomalies}
        includeForecast={includeForecast}
        onIncludeForecastChange={setIncludeForecast}
      />

      {/* 全局 warning */}
      {warnings.length > 0 && (
        <Alert variant="warning" className="text-sm">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {warnings.map((w, i) => (
              <span key={i}>
                {w.message}
                {i < warnings.length - 1 ? '；' : ''}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* 降级状态 */}
      {isDegraded && (
        <Alert variant="warning" className="text-sm">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            部分数据不完整——趋势方向与异常仅供参考，建议结合来源页面验证。
          </AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-48 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <Alert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载趋势数据失败：{error?.message ?? '未知错误'}</AlertDescription>
        </Alert>
      )}

      {/* Restricted */}
      {isRestricted && (
        <EmptyState
          icon={EyeOff}
          title="权限受限"
          description="您当前角色无法查看所选指标的趋势数据。请联系管理员获取相应权限。"
        />
      )}

      {/* Empty */}
      {isEmpty && !isLoading && !isRestricted && (
        <EmptyState
          icon={BarChart3}
          title="暂无趋势数据"
          description="所选指标在当前时间窗口内无可用数据。请尝试调整时间窗口或指标选择。"
        />
      )}

      {/* 趋势卡片网格 */}
      {!isLoading && !isError && seriesList.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {seriesList.map((series) => (
            <Card
              key={series.metricKey}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => {
                setSelectedSeries(series)
                setDrawerOpen(true)
              }}
              role="button"
              tabIndex={0}
              aria-label={`查看${METRIC_LABELS[series.metricKey] ?? series.metricKey}趋势详情`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSelectedSeries(series)
                  setDrawerOpen(true)
                }
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">
                    {METRIC_LABELS[series.metricKey] ?? series.metricKey}
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className={cn('text-xs', DIRECTION_BADGE_CLASS[series.direction])}
                  >
                    {DIRECTION_ICONS[series.direction]}
                    <span className="ml-1">
                      {BI_TREND_DIRECTION_LABELS[series.direction] ?? series.direction}
                    </span>
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  样本数 {series.sampleCount}
                  {series.freshness.state !== 'fresh' &&
                    ` · ${series.freshness.state === 'stale' ? '数据可能陈旧' : '来源未知'}`}
                </p>
              </CardHeader>
              <CardContent>
                <BiTrendChart
                  series={series}
                  height={160}
                  showAnomalies={includeAnomalies}
                  showForecast={includeForecast}
                />
                {/* Warning 摘要 */}
                {series.warnings.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {series.warnings.slice(0, 2).map((w, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] text-yellow-600">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        {w.code}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 异常点列表 */}
      {includeAnomalies && !isLoading && !isError && seriesList.length > 0 && (
        <BiTrendAnomalyList
          seriesList={seriesList}
          metricLabels={METRIC_LABELS}
          onSelectSeries={(series) => {
            setSelectedSeries(series)
            setDrawerOpen(true)
          }}
        />
      )}

      {/* 解释抽屉 */}
      <BiTrendExplanationDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        series={selectedSeries}
        metricLabels={METRIC_LABELS}
        queryShape={meta?.queryShape}
      />
    </div>
  )
}
