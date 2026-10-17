'use client'

import { useState, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useOrganizationId } from '@/hooks/use-organization-id'
import {
  useForecastSummary,
  useForecastDemandCurves,
  useForecastGapAnalysis,
  useForecastProjectDrivers,
  useForecastSkillDrivers,
  useForecastTrendBaseline,
  useForecastAiAdvisory,
} from '@/hooks/use-resource-demand-forecasting'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { AlertCircle, AlertTriangle, BarChart3, EyeOff, Users, Zap, Brain } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ResourceDemandForecastQuery,
  ForecastConfidenceBand,
  ForecastWarningCode,
  ForecastGranularity,
  ForecastMethod,
  ForecastSortKey,
} from '@aiproj/types'
import {
  FORECAST_GRANULARITIES,
  FORECAST_CONFIDENCE_BANDS,
  FORECAST_METHODS,
  FORECAST_SORT_KEYS,
} from '@aiproj/types'

/**
 * URL query 是外部输入，直接 as 成字面量联合会把脏值原样发给后端。
 * 这里按常量表校验，取不到合法值就返回 undefined（等价于「不指定」）。
 */
function narrowToEnumValue<T extends string>(
  enumObject: Record<string, T>,
  raw: string | null,
): T | undefined {
  if (raw === null) return undefined
  return (Object.values(enumObject) as string[]).includes(raw) ? (raw as T) : undefined
}

// ── 中文标签 ────────────────────────────────────────────────────────────────

const GRANULARITY_LABELS: Record<string, string> = {
  day: '日',
  week: '周',
  month: '月',
}

const CONFIDENCE_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  unknown: '未知',
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-orange-100 text-orange-700',
  unknown: 'bg-gray-100 text-gray-600',
}

const WARNING_LABELS: Record<string, string> = {
  INSUFFICIENT_HISTORY: '历史数据不足',
  STALE_SOURCE: '源数据过期',
  PARTIAL_VISIBILITY: '部分可见',
  CACHE_DEGRADED: '缓存降级',
  AI_UNAVAILABLE: 'AI 不可用',
  FEATURE_DISABLED: '功能已禁用',
  DIMENSION_REDACTED: '维度已脱敏',
  LOW_CONFIDENCE: '低置信度',
  EXCEEDS_MAX_WINDOW: '超出窗口上限',
  NO_PROJECTS_VISIBLE: '无可视项目',
}

const GAP_TYPE_LABELS: Record<string, string> = {
  shortage: '短缺',
  surplus: '盈余',
  volatility: '波动',
  insufficient_history: '历史不足',
  stale_source: '源过期',
  low_confidence: '低置信度',
}

// ── 格式化 ──────────────────────────────────────────────────────────────────

function formatHours(h: number): string {
  return `${h}h`
}

function formatPercent(p: number): string {
  return `${(p * 100).toFixed(0)}%`
}

function formatDateRange(start: string, end: string): string {
  return `${start} ~ ${end}`
}

function formatDate(d: string): string {
  return d
}

// ── 子组件：KPI 卡片 ──────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  unit?: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}) {
  return (
    <Card className={cn('flex items-center gap-3 p-4', color)}>
      <Icon className="h-8 w-8 opacity-70" />
      <div>
        <div className="text-2xl font-bold">
          {value}
          {unit && <span className="text-sm font-normal ml-1 opacity-70">{unit}</span>}
        </div>
        <div className="text-sm opacity-70">{label}</div>
      </div>
    </Card>
  )
}

// ── 子组件：置信度徽章 ────────────────────────────────────────────────────

function ConfidenceBadge({ band }: { band: ForecastConfidenceBand }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        CONFIDENCE_COLORS[band],
      )}
    >
      {CONFIDENCE_LABELS[band]}
    </span>
  )
}

// ── 子组件：告警徽章 ──────────────────────────────────────────────────────

function WarningBadge({ code }: { code: ForecastWarningCode }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
      <AlertTriangle className="h-3 w-3" />
      {WARNING_LABELS[code] ?? code}
    </span>
  )
}

// ── 主页面组件 ────────────────────────────────────────────────────────────

export default function ResourceDemandForecastingPage() {
  const searchParams = useSearchParams()

  const [selectedTab, setSelectedTab] = useState<'curves' | 'gaps' | 'drivers'>('curves')
  const [aiAdvisoryEnabled, setAiAdvisoryEnabled] = useState(false)

  const query: Partial<ResourceDemandForecastQuery> = useMemo(
    () => ({
      startDate: searchParams.get('startDate') ?? new Date().toISOString().slice(0, 10),
      endDate:
        searchParams.get('endDate') ??
        new Date(Date.now() + 12 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      granularity:
        narrowToEnumValue<ForecastGranularity>(
          FORECAST_GRANULARITIES,
          searchParams.get('granularity'),
        ) ?? 'week',
      projectIds: searchParams.get('projectIds')?.split(',').filter(Boolean),
      roles: searchParams.get('roles')?.split(',').filter(Boolean),
      skills: searchParams.get('skills')?.split(',').filter(Boolean),
      departments: searchParams.get('departments')?.split(',').filter(Boolean),
      loadStatuses: searchParams
        .get('loadStatuses')
        ?.split(',')
        .filter(Boolean) as ResourceDemandForecastQuery['loadStatuses'],
      confidenceThreshold: narrowToEnumValue<ForecastConfidenceBand>(
        FORECAST_CONFIDENCE_BANDS,
        searchParams.get('confidenceThreshold'),
      ),
      method: narrowToEnumValue<ForecastMethod>(FORECAST_METHODS, searchParams.get('method')),
      topN: searchParams.get('topN') ? Number(searchParams.get('topN')) : undefined,
      sort: narrowToEnumValue<ForecastSortKey>(FORECAST_SORT_KEYS, searchParams.get('sort')),
      sortDir: searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc',
      page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
      perPage: searchParams.get('perPage') ? Number(searchParams.get('perPage')) : 50,
    }),
    [searchParams],
  )

  const orgId = useOrganizationId() ?? 0

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useForecastSummary(orgId, query)

  const {
    data: demandCurves,
    isLoading: curvesLoading,
    isError: curvesError,
  } = useForecastDemandCurves(orgId, query)

  const {
    data: gapAnalysis,
    isLoading: gapsLoading,
    isError: gapsError,
  } = useForecastGapAnalysis(orgId, query)

  const { data: projectDrivers, isLoading: projectDriversLoading } = useForecastProjectDrivers(
    orgId,
    query,
  )

  const { data: skillDrivers, isLoading: skillDriversLoading } = useForecastSkillDrivers(
    orgId,
    query,
  )

  useForecastTrendBaseline(orgId, query)

  const {
    data: aiAdvisory,
    isLoading: aiAdvisoryLoading,
    isError: aiAdvisoryError,
  } = useForecastAiAdvisory(orgId, aiAdvisoryEnabled)

  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-64">
        <EmptyState
          icon={EyeOff}
          title="请选择组织"
          description="需要组织上下文才能查看资源需求预测"
        />
      </div>
    )
  }

  const isLoading = summaryLoading || curvesLoading || gapsLoading
  const hasError = summaryError || curvesError || gapsError

  return (
    <div className="space-y-6 p-6">
      {/* 导航面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/organization" className="hover:text-foreground">
          组织
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">资源需求预测</span>
      </div>

      {/* 页头 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">资源需求预测</h1>
          <p className="text-muted-foreground mt-1">
            基于项目计划和任务资源需求，预测未来资源供需趋势
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiAdvisoryEnabled((v) => !v)}
            disabled={aiAdvisoryLoading}
          >
            <Brain className="h-4 w-4 mr-2" />
            {aiAdvisoryEnabled ? 'AI 分析中...' : 'AI 咨询'}
          </Button>
        </div>
      </div>

      {/* AI Advisory 结果 */}
      {aiAdvisory && !aiAdvisoryError && (
        <Alert className="bg-blue-50 border-blue-200">
          <Brain className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            <div className="font-medium mb-1">AI 咨询建议（仅供参考）</div>
            <div className="text-sm whitespace-pre-wrap">{aiAdvisory.narrative}</div>
            {aiAdvisory.suggestedActions.length > 0 && (
              <ul className="list-disc list-inside mt-2 text-sm">
                {aiAdvisory.suggestedActions.map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2">
              <ConfidenceBadge band={aiAdvisory.confidence} />
              {aiAdvisory.model && (
                <span className="text-xs text-blue-500">模型: {aiAdvisory.model}</span>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {aiAdvisoryError && (
        <Alert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>AI 咨询服务暂不可用，预测数据仍正常显示</AlertDescription>
        </Alert>
      )}

      {/* 错误状态 */}
      {hasError && (
        <Alert variant="danger">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            预测数据加载失败，请检查网络连接后重试。
            <Button variant="link" size="sm" onClick={() => refetchSummary()} className="ml-2">
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* 加载状态 */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-6 w-24 mt-2" />
                <Skeleton className="h-4 w-16 mt-1" />
              </Card>
            ))}
          </div>
          <Card className="p-6">
            <Skeleton className="h-64 w-full" />
          </Card>
        </div>
      )}

      {/* 数据加载成功 */}
      {!isLoading && !hasError && summary && (
        <>
          {/* KPI 摘要 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard
              label="预测总需求"
              value={formatHours(summary.metrics.forecast_total_demand_hours)}
              unit="h"
              icon={BarChart3}
              color="bg-blue-50"
            />
            <KpiCard
              label="当前分配"
              value={formatHours(summary.metrics.forecast_total_allocated_hours)}
              unit="h"
              icon={Users}
              color="bg-emerald-50"
            />
            <KpiCard
              label="可用容量"
              value={formatHours(summary.metrics.forecast_total_available_hours)}
              unit="h"
              icon={Zap}
              color="bg-purple-50"
            />
            <KpiCard
              label="预测缺口"
              value={formatHours(Math.abs(summary.metrics.forecast_projected_gap_hours))}
              unit="h"
              icon={AlertTriangle}
              color={
                summary.metrics.forecast_projected_gap_hours > 0 ? 'bg-red-50' : 'bg-emerald-50'
              }
            />
          </div>

          {/* 窗口信息 */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span>窗口：{formatDateRange(summary.window.startDate, summary.window.endDate)}</span>
            <span>粒度：{GRANULARITY_LABELS[summary.window.granularity]}</span>
            <span>桶数：{summary.window.bucketCount}</span>
            <ConfidenceBadge band={summary.overallConfidence} />
            {summary.warnings.map((w) => (
              <WarningBadge key={w} code={w} />
            ))}
            <span>可见项目：{formatPercent(summary.projectCoverage)}</span>
            <span>可见资源：{formatPercent(summary.resourceCoverage)}</span>
          </div>

          {/* 标签切换 */}
          <div className="flex gap-2 border-b">
            {(
              [
                ['curves', '需求曲线'],
                ['gaps', '缺口分析'],
                ['drivers', '驱动因素'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSelectedTab(key)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                  selectedTab === key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 需求曲线 */}
          {selectedTab === 'curves' && demandCurves && (
            <div className="space-y-4">
              {/* 角色需求 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">角色需求曲线</CardTitle>
                </CardHeader>
                <CardContent>
                  {demandCurves.roleBuckets.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      暂无可见角色的需求数据
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="py-2 font-medium">角色</th>
                            <th className="py-2 font-medium text-right">预测需求</th>
                            <th className="py-2 font-medium text-right">当前分配</th>
                            <th className="py-2 font-medium text-right">可用</th>
                            <th className="py-2 font-medium text-right">剩余</th>
                            <th className="py-2 font-medium text-right">缺口</th>
                            <th className="py-2 font-medium">置信度</th>
                          </tr>
                        </thead>
                        <tbody>
                          {demandCurves.roleBuckets.map((bucket, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2">
                                {bucket.role}
                                {bucket.roleRedaction && (
                                  <EyeOff className="inline h-3 w-3 ml-1 text-muted-foreground" />
                                )}
                              </td>
                              <td className="py-2 text-right">
                                {formatHours(bucket.forecastDemand)}
                              </td>
                              <td className="py-2 text-right">
                                {formatHours(bucket.actualAllocation)}
                              </td>
                              <td className="py-2 text-right">{formatHours(bucket.available)}</td>
                              <td className="py-2 text-right">{formatHours(bucket.remaining)}</td>
                              <td
                                className={cn(
                                  'py-2 text-right font-medium',
                                  bucket.gap > 0 ? 'text-red-600' : 'text-emerald-600',
                                )}
                              >
                                {bucket.gap > 0 ? '+' : ''}
                                {formatHours(bucket.gap)}
                              </td>
                              <td className="py-2">
                                <ConfidenceBadge band={bucket.confidence} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 技能需求 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">技能需求曲线</CardTitle>
                </CardHeader>
                <CardContent>
                  {demandCurves.skillBuckets.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      暂无可见技能的需求数据
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="py-2 font-medium">技能</th>
                            <th className="py-2 font-medium text-right">预测需求</th>
                            <th className="py-2 font-medium text-right">当前分配</th>
                            <th className="py-2 font-medium text-right">可用</th>
                            <th className="py-2 font-medium text-right">剩余</th>
                            <th className="py-2 font-medium text-right">缺口</th>
                            <th className="py-2 font-medium">置信度</th>
                          </tr>
                        </thead>
                        <tbody>
                          {demandCurves.skillBuckets.map((bucket, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2">
                                {bucket.originalLabel ?? bucket.skill}
                                {bucket.skillRedaction && (
                                  <EyeOff className="inline h-3 w-3 ml-1 text-muted-foreground" />
                                )}
                              </td>
                              <td className="py-2 text-right">
                                {formatHours(bucket.forecastDemand)}
                              </td>
                              <td className="py-2 text-right">
                                {formatHours(bucket.actualAllocation)}
                              </td>
                              <td className="py-2 text-right">{formatHours(bucket.available)}</td>
                              <td className="py-2 text-right">{formatHours(bucket.remaining)}</td>
                              <td
                                className={cn(
                                  'py-2 text-right font-medium',
                                  bucket.gap > 0 ? 'text-red-600' : 'text-emerald-600',
                                )}
                              >
                                {bucket.gap > 0 ? '+' : ''}
                                {formatHours(bucket.gap)}
                              </td>
                              <td className="py-2">
                                <ConfidenceBadge band={bucket.confidence} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* 缺口分析 */}
          {selectedTab === 'gaps' && gapAnalysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  缺口分析
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    短缺 {formatHours(gapAnalysis.totalShortage)} · 盈余{' '}
                    {formatHours(gapAnalysis.totalSurplus)} · 净缺口{' '}
                    {formatHours(gapAnalysis.netGap)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {gapAnalysis.gaps.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    当前预测窗口内未发现明显的资源缺口
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="py-2 font-medium">类型</th>
                          <th className="py-2 font-medium">描述</th>
                          <th className="py-2 font-medium text-right">缺口</th>
                          <th className="py-2 font-medium">角色/技能</th>
                          <th className="py-2 font-medium">时间段</th>
                          <th className="py-2 font-medium">置信度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gapAnalysis.gaps.map((gap, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2">
                              <span
                                className={cn(
                                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                                  gap.direction === 'shortage'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-emerald-100 text-emerald-700',
                                )}
                              >
                                {GAP_TYPE_LABELS[gap.gapType] ?? gap.gapType}
                              </span>
                            </td>
                            <td className="py-2">{gap.description}</td>
                            <td
                              className={cn(
                                'py-2 text-right font-medium',
                                gap.direction === 'shortage' ? 'text-red-600' : 'text-emerald-600',
                              )}
                            >
                              {gap.direction === 'shortage' ? '-' : '+'}
                              {formatHours(gap.gapHours)}
                            </td>
                            <td className="py-2">
                              {gap.role && <span>{gap.role}</span>}
                              {gap.skill && (
                                <span className="ml-1 text-muted-foreground">{gap.skill}</span>
                              )}
                            </td>
                            <td className="py-2 text-muted-foreground">
                              {gap.bucketStart && formatDate(gap.bucketStart)}
                            </td>
                            <td className="py-2">
                              <ConfidenceBadge band={gap.confidence} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 驱动因素 */}
          {selectedTab === 'drivers' && (
            <div className="space-y-4">
              {/* 项目驱动 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    项目驱动因素
                    {projectDrivers && (
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        共 {projectDrivers.meta.total} 项
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {projectDriversLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : !projectDrivers || projectDrivers.data.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      暂无可见项目驱动数据
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="py-2 font-medium">项目</th>
                            <th className="py-2 font-medium text-right">总需求</th>
                            <th className="py-2 font-medium text-right">已分配</th>
                            <th className="py-2 font-medium text-right">占比</th>
                            <th className="py-2 font-medium text-right">峰值缺口</th>
                            <th className="py-2 font-medium">置信度</th>
                          </tr>
                        </thead>
                        <tbody>
                          {projectDrivers.data.map((driver, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2">
                                {driver.projectName ?? `项目 #${driver.projectId}`}
                                {driver.redaction && (
                                  <EyeOff className="inline h-3 w-3 ml-1 text-muted-foreground" />
                                )}
                              </td>
                              <td className="py-2 text-right">{formatHours(driver.totalDemand)}</td>
                              <td className="py-2 text-right">
                                {formatHours(driver.totalAllocated)}
                              </td>
                              <td className="py-2 text-right">
                                {formatPercent(driver.demandShare)}
                              </td>
                              <td
                                className={cn(
                                  'py-2 text-right font-medium',
                                  driver.peakGap > 0 ? 'text-red-600' : 'text-emerald-600',
                                )}
                              >
                                {formatHours(driver.peakGap)}
                              </td>
                              <td className="py-2">
                                <ConfidenceBadge band={driver.confidence} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 技能驱动 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    技能驱动因素
                    {skillDrivers && (
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        共 {skillDrivers.meta.total} 项
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {skillDriversLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : !skillDrivers || skillDrivers.data.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      暂无可见技能驱动数据
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="py-2 font-medium">技能</th>
                            <th className="py-2 font-medium text-right">总需求</th>
                            <th className="py-2 font-medium text-right">占比</th>
                            <th className="py-2 font-medium text-right">已覆盖</th>
                            <th className="py-2 font-medium text-right">缺口</th>
                            <th className="py-2 font-medium text-right">覆盖项目</th>
                            <th className="py-2 font-medium">置信度</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skillDrivers.data.map((driver, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-2">
                                {driver.originalLabel ?? driver.skill}
                                {driver.redaction && (
                                  <EyeOff className="inline h-3 w-3 ml-1 text-muted-foreground" />
                                )}
                              </td>
                              <td className="py-2 text-right">{formatHours(driver.totalDemand)}</td>
                              <td className="py-2 text-right">
                                {formatPercent(driver.demandShare)}
                              </td>
                              <td className="py-2 text-right">
                                {formatHours(driver.coveredHours)}
                              </td>
                              <td
                                className={cn(
                                  'py-2 text-right font-medium',
                                  driver.gapHours > 0 ? 'text-red-600' : 'text-emerald-600',
                                )}
                              >
                                {formatHours(driver.gapHours)}
                              </td>
                              <td className="py-2 text-right">{driver.projectCount}</td>
                              <td className="py-2">
                                <ConfidenceBadge band={driver.confidence} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
