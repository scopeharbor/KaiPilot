'use client'

import { useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  RESOURCE_GAP_METRIC_LABELS,
  RESOURCE_GAP_SEVERITY_LABELS,
  type ResourceGapQuery,
  type ResourceGapDimension,
  type ResourceGapMetric,
  type ResourceGapSeverity,
} from '@aiproj/types'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import {
  useResourceGapSummary,
  useResourceGapByRole,
  useResourceGapBySkill,
  useResourceGapByTimebucket,
  useResourceGapByProject,
  useResourceGapByPortfolio,
} from '@/hooks/use-resource-gap-analysis'
import {
  GapExplanationCard,
  GapStatusBanner,
} from '@/components/views/resource-gap-explanation-card'

const DIMENSION_TABS: { key: ResourceGapDimension; label: string }[] = [
  { key: 'role', label: '角色' },
  { key: 'skill', label: '技能' },
  { key: 'timeBucket', label: '时间桶' },
  { key: 'project', label: '项目' },
  { key: 'portfolio', label: '组合' },
  { key: 'organization', label: '组织' },
]

/**
 * 组织资源缺口分析工作台（v3-resource-gap-analysis §8.2）。
 *
 * 功能：
 *   - 6 维透视 tab（role/skill/timeBucket/project/portfolio/organization）
 *   - 4 口径切换（allocated_vs_demand/available_vs_demand/skill_shortfall/forecast_gap）
 *   - 严重度筛选
 *   - 日期窗口 + topN + URL 状态可恢复
 *   - 缺口解释卡片 + 状态 UI（空态/权限受限/降级）
 *
 * 路由 `/organization/resource-gaps` 没有 :organizationId 参数（幽灵参数修复）：
 * 组织 ID 取自 auth store 的有效租户上下文；取不到时渲染引导并暂停查询。
 */
export default function ResourceGapWorkbench() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL 状态恢复
  const [activeDimension, setActiveDimension] = useState<ResourceGapDimension>(
    (searchParams.get('dimension') as ResourceGapDimension) ?? 'skill',
  )
  const [activeMetric, setActiveMetric] = useState<ResourceGapMetric | null>(
    (searchParams.get('metric') as ResourceGapMetric) ?? null,
  )
  const [activeSeverity, setActiveSeverity] = useState<ResourceGapSeverity | null>(
    (searchParams.get('severity') as ResourceGapSeverity) ?? null,
  )
  const [topN, setTopN] = useState(Number(searchParams.get('topN')) || 10)
  const [timeBucketGranularity, setTimeBucketGranularity] = useState<'day' | 'iso_week' | 'month'>(
    (searchParams.get('granularity') as 'day' | 'iso_week' | 'month') ?? 'iso_week',
  )

  const query: ResourceGapQuery = {
    metrics: activeMetric ? [activeMetric] : undefined,
    severity: activeSeverity ?? undefined,
    topN,
    timeBucketGranularity,
  }

  // 摘要
  const summary = useResourceGapSummary(query)

  // 按维度查询
  const byRole = useResourceGapByRole(query)
  const bySkill = useResourceGapBySkill(query)
  const byTimebucket = useResourceGapByTimebucket(query)
  const byProject = useResourceGapByProject(query)
  const byPortfolio = useResourceGapByPortfolio(query)

  // organization 维度复用 summary，其 data 形状与其他维度不同，故取联合类型；
  // 下面消费处已用 `'gaps' in data` 做窄化。
  const dimensionData: Record<ResourceGapDimension, typeof bySkill | typeof summary> = {
    role: byRole,
    skill: bySkill,
    timeBucket: byTimebucket,
    project: byProject,
    portfolio: byPortfolio,
    organization: summary, // organization 维度复用 summary
  }

  const currentData = dimensionData[activeDimension]

  // URL 更新（保持状态可恢复）
  const updateUrl = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value)
        else params.delete(key)
      }
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const handleDimensionChange = (dim: ResourceGapDimension) => {
    setActiveDimension(dim)
    updateUrl({ dimension: dim })
  }

  const handleMetricChange = (metric: ResourceGapMetric | null) => {
    setActiveMetric(metric)
    updateUrl({ metric: metric ?? undefined })
  }

  const handleSeverityChange = (severity: ResourceGapSeverity | null) => {
    setActiveSeverity(severity)
    updateUrl({ severity: severity ?? undefined })
  }

  // ── Loading / Error / Empty States ──────────────────────────────────────

  if (organizationId === null) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">资源缺口分析</h1>
          <p className="text-sm text-muted-foreground mt-1">
            组织级需求-供给缺口多维透视，原因解释与决策建议
          </p>
        </div>
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          请先选择组织
        </div>
      </div>
    )
  }

  if (summary.isLoading) {
    return <GapStatusBanner status="loading" />
  }

  if (summary.isError) {
    return <GapStatusBanner status="error" />
  }

  if (summary.data && summary.data.totalGaps === 0) {
    return <GapStatusBanner status="empty" />
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">资源缺口分析</h1>
        <p className="text-sm text-muted-foreground mt-1">
          组织级需求-供给缺口多维透视，原因解释与决策建议
        </p>
      </div>

      {/* Summary Stats */}
      {summary.data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="总缺口数" value={summary.data.totalGaps} />
          <StatCard
            label="严重缺口"
            value={summary.data.severityDistribution.critical}
            intent="critical"
          />
          <StatCard label="总需求(h)" value={Math.round(summary.data.totalDemandHours)} />
          <StatCard
            label="总缺口(h)"
            value={Math.round(summary.data.totalGapHours)}
            intent="high"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {/* Dimension Tabs */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {DIMENSION_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleDimensionChange(tab.key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                activeDimension === tab.key
                  ? 'bg-background shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Metric Filter */}
        <select
          value={activeMetric ?? ''}
          onChange={(e) => handleMetricChange((e.target.value as ResourceGapMetric) || null)}
          className="rounded-md border px-3 py-1.5 text-sm bg-background"
          aria-label="口径筛选"
        >
          <option value="">全部口径</option>
          {Object.entries(RESOURCE_GAP_METRIC_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* Severity Filter */}
        <select
          value={activeSeverity ?? ''}
          onChange={(e) => handleSeverityChange((e.target.value as ResourceGapSeverity) || null)}
          className="rounded-md border px-3 py-1.5 text-sm bg-background"
          aria-label="严重度筛选"
        >
          <option value="">全部严重度</option>
          {Object.entries(RESOURCE_GAP_SEVERITY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* v11.4: TimeBucket 粒度选择器 */}
        <select
          value={timeBucketGranularity}
          onChange={(e) => {
            setTimeBucketGranularity(e.target.value as 'day' | 'iso_week' | 'month')
            updateUrl({ granularity: e.target.value })
          }}
          className="rounded-md border px-3 py-1.5 text-sm bg-background"
          aria-label="时间粒度"
        >
          <option value="day">按天</option>
          <option value="iso_week">按周</option>
          <option value="month">按月</option>
        </select>

        {/* TopN */}
        <select
          value={topN}
          onChange={(e) => setTopN(Number(e.target.value))}
          className="rounded-md border px-3 py-1.5 text-sm bg-background"
          aria-label="显示数量"
        >
          <option value={5}>Top 5</option>
          <option value={10}>Top 10</option>
          <option value={20}>Top 20</option>
          <option value={50}>Top 50</option>
        </select>
      </div>

      {/* Warnings */}
      {summary.data?.warnings && summary.data.warnings.length > 0 && (
        <div className="space-y-1">
          {summary.data.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs text-orange-600 dark:text-orange-400"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              {w.message}
            </div>
          ))}
        </div>
      )}

      {/* Gap Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* 各维度端点返回 { data: ResourceGapEntry[] }；organization 维度复用 summary，其 data 不是数组 */}
        {Array.isArray(currentData.data)
          ? currentData.data.map((gap) => (
              <GapExplanationCard
                key={gap.gapId}
                gap={gap}
                onViewExplanation={(gapId) => {
                  router.push(`/orgs/${organizationId}/resource-gaps/${gapId}`)
                }}
                onDrillDown={(gapId, capability) => {
                  router.push(`/orgs/${organizationId}/resource-gaps/${gapId}?source=${capability}`)
                }}
              />
            ))
          : summary.data?.topGaps?.map((gap) => (
              <GapExplanationCard
                key={gap.gapId}
                gap={gap}
                onViewExplanation={(gapId) => {
                  router.push(`/orgs/${organizationId}/resource-gaps/${gapId}`)
                }}
                onDrillDown={(gapId, capability) => {
                  router.push(`/orgs/${organizationId}/resource-gaps/${gapId}?source=${capability}`)
                }}
              />
            ))}
      </div>

      {/* Mobile: single column card list */}
      <div className="md:hidden space-y-3">
        {/* 各维度端点返回 { data: ResourceGapEntry[] }；organization 维度复用 summary，其 data 不是数组 */}
        {Array.isArray(currentData.data)
          ? currentData.data.map((gap) => <GapExplanationCard key={gap.gapId} gap={gap} />)
          : summary.data?.topGaps?.map((gap) => <GapExplanationCard key={gap.gapId} gap={gap} />)}
      </div>
    </div>
  )
}

/** 统计卡片子组件 */
function StatCard({
  label,
  value,
  intent,
}: {
  label: string
  value: number
  intent?: 'critical' | 'high' | 'normal'
}) {
  const color = {
    critical: 'text-red-600 dark:text-red-400',
    high: 'text-orange-600 dark:text-orange-400',
    normal: '',
  }[intent ?? 'normal']

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}
