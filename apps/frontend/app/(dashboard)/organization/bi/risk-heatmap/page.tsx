'use client'

import { useState, useMemo } from 'react'
import { useBiRiskHeatmap, type BiRiskHeatmapApiParams } from '@/hooks/use-bi-risk-heatmap'
import { usePermissions } from '@/hooks/use-permissions'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { EmptyState } from '@/components/ui/EmptyState'
import { BiRiskHeatmapFilterBar } from '@/components/bi-risk-heatmap/BiRiskHeatmapFilterBar'
import { BiRiskHeatmapGrid } from '@/components/bi-risk-heatmap/BiRiskHeatmapGrid'
import { BiRiskHeatmapTopList } from '@/components/bi-risk-heatmap/BiRiskHeatmapTopList'
import { BiRiskHeatmapDrawer } from '@/components/bi-risk-heatmap/BiRiskHeatmapDrawer'
import { AlertCircle, AlertTriangle, BarChart3, EyeOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  BiRiskHeatmapCell,
  BiRiskHeatmapMetricKey,
  BiRiskHeatmapWindow,
  BiRiskHeatmapDimensionKey,
  BiRiskHeatmapCompareMode,
} from '@aiproj/types'
import {
  BI_RISK_HEATMAP_METRIC_KEYS,
  BI_RISK_HEATMAP_DEFAULT_WINDOW,
  BI_RISK_HEATMAP_DEFAULT_ROW_DIMENSION,
  BI_RISK_HEATMAP_DEFAULT_COLUMN_DIMENSION,
} from '@aiproj/types'

// ─── 中文标签映射 ────────────────────────────────────────────────────────────

const METRIC_LABELS: Record<string, string> = {
  [BI_RISK_HEATMAP_METRIC_KEYS.RISK_EXPOSURE_SCORE]: '风险暴露评分',
  [BI_RISK_HEATMAP_METRIC_KEYS.RISK_COUNT]: '风险数量',
  [BI_RISK_HEATMAP_METRIC_KEYS.HIGH_RISK_RATIO]: '高风险占比',
  [BI_RISK_HEATMAP_METRIC_KEYS.OVERDUE_RISK_RATIO]: '逾期风险占比',
  [BI_RISK_HEATMAP_METRIC_KEYS.RISK_DELTA]: '风险变化量',
  [BI_RISK_HEATMAP_METRIC_KEYS.TRAFFIC_LIGHT_RISK_RATIO]: '交通灯风险比',
}

const DIMENSION_LABELS: Record<string, string> = {
  project: '项目',
  portfolio_group: '组合分组',
  risk_category: '风险类别',
  risk_level: '风险等级',
  risk_status: '风险状态',
  assignee: '负责人',
  time_bucket: '时间桶',
  department: '部门',
}

/**
 * BI 风险热力图工作台（v3-bi-risk-heatmap §4.3–4.8）。
 *
 * 路由：`/organization/bi/risk-heatmap`
 * 首屏：筛选条 + 热力图网格 + Top 风险单元 + 解释抽屉。
 * 面向 PMO 分析师、项目总监与专业 PM 的扫描/对比/下钻工作台。
 */
export default function BiRiskHeatmapWorkbench() {
  const { canAny } = usePermissions()
  const hasAccess = canAny(['org:view', 'portfolio:view'])
  const orgId = useCurrentOrganizationId()

  const [metricKey, setMetricKey] = useState<BiRiskHeatmapMetricKey>(
    BI_RISK_HEATMAP_METRIC_KEYS.RISK_EXPOSURE_SCORE,
  )
  const [window, setWindow] = useState<BiRiskHeatmapWindow>(BI_RISK_HEATMAP_DEFAULT_WINDOW)
  const [rowDimension, setRowDimension] = useState<BiRiskHeatmapDimensionKey>(
    BI_RISK_HEATMAP_DEFAULT_ROW_DIMENSION,
  )
  const [columnDimension, setColumnDimension] = useState<BiRiskHeatmapDimensionKey>(
    BI_RISK_HEATMAP_DEFAULT_COLUMN_DIMENSION,
  )
  const [compareWith, setCompareWith] = useState<BiRiskHeatmapCompareMode>('previous_period')
  const [page, setPage] = useState(1)

  const [selectedCell, setSelectedCell] = useState<BiRiskHeatmapCell | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const params: BiRiskHeatmapApiParams = useMemo(
    () => ({
      organizationId: orgId ?? 0,
      metricKey: metricKey as string,
      window,
      rowDimension,
      columnDimension,
      compareWith,
      page,
      perPage: 50,
    }),
    [orgId, metricKey, window, rowDimension, columnDimension, compareWith, page],
  )

  const {
    data: cells,
    meta,
    warnings,
    isLoading,
    isError,
    error,
    isRestricted,
    isEmpty,
    isDegraded,
    refetch,
  } = useBiRiskHeatmap(params)

  // ── 无权限 ──
  if (!hasAccess) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>您没有 BI 风险热力图访问权限。</AlertDescription>
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
          <h1 className="text-2xl font-semibold tracking-tight">BI 风险热力图</h1>
          <p className="text-sm text-muted-foreground">
            组织风险热力矩阵、集中度分析与安全下钻
            {meta && ` · 更新于 ${new Date(meta.calculatedAt).toLocaleString()}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {/* 筛选条 */}
      <BiRiskHeatmapFilterBar
        metricKey={metricKey}
        onMetricKeyChange={setMetricKey}
        window={window}
        onWindowChange={setWindow}
        rowDimension={rowDimension}
        onRowDimensionChange={setRowDimension}
        columnDimension={columnDimension}
        onColumnDimensionChange={setColumnDimension}
        compareWith={compareWith}
        onCompareWithChange={setCompareWith}
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
            部分数据不完整——热力分值仅供参考，建议结合来源页面验证。
          </AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <Alert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载热力图数据失败：{error?.message ?? '未知错误'}</AlertDescription>
        </Alert>
      )}

      {/* Restricted */}
      {isRestricted && (
        <EmptyState
          icon={EyeOff}
          title="权限受限"
          description="您当前角色无法查看所选指标的热力图数据。请联系管理员获取相应权限。"
        />
      )}

      {/* Empty */}
      {isEmpty && !isLoading && !isRestricted && (
        <EmptyState
          icon={BarChart3}
          title="暂无热力图数据"
          description="所选指标在当前时间窗口内无可用数据。请尝试调整时间窗口或指标选择。"
        />
      )}

      {/* 热力图网格 */}
      {!isLoading && !isError && cells.length > 0 && (
        <>
          <BiRiskHeatmapGrid
            cells={cells}
            metricKey={metricKey}
            metricLabels={METRIC_LABELS}
            dimensionLabels={DIMENSION_LABELS}
            rowDimension={rowDimension}
            columnDimension={columnDimension}
            onCellClick={(cell) => {
              setSelectedCell(cell)
              setDrawerOpen(true)
            }}
          />

          {/* 分页 */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                共 {meta.total} 个热力单元 · 第 {meta.page}/{meta.totalPages} 页
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}

          {/* Top 风险单元 */}
          <BiRiskHeatmapTopList
            cells={cells}
            metricLabels={METRIC_LABELS}
            dimensionLabels={DIMENSION_LABELS}
            columnDimension={columnDimension}
            onSelectCell={(cell) => {
              setSelectedCell(cell)
              setDrawerOpen(true)
            }}
          />
        </>
      )}

      {/* 解释抽屉 */}
      <BiRiskHeatmapDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        cell={selectedCell}
        metricLabels={METRIC_LABELS}
        dimensionLabels={DIMENSION_LABELS}
        queryShape={meta?.queryShape}
      />
    </div>
  )
}
