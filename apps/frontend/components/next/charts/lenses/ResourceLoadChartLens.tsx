/**
 * 资源负荷直方图与趋势表镜头（v3-ui-next-chart-gallery W2 · tasks 2.1/2.2）。
 *
 * 数据：`GET /projects/:id/resources/load`（resourcesApi.load，只读 GET，RL-01）。
 * - Trend：近 30 天滑动窗口堆叠柱状直方图，正常分配（--nx-chart-1）与超负荷
 *   （--nx-status-danger 红堆叠）双段构成，100% 额定容量警戒基准线 markLine，
 *   暗黑控制台 Tooltip（日期/分配/容量/利用率/超负荷量）；
 * - Team：团队成员水平堆叠条形（正常/超额/未利用容量构成）+ 精确数字矩阵
 *   （总容量/总分配/平均利用率/状态徽章）。
 *
 * 纯只读：视图切换仅触发带 view 参数的 GET 查询；无任何写入口（RL-01/RL-06）。
 * 精确档（precise）ECharts animation 关闭，数据即时定格（spec 降级）。
 */
'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Users } from 'lucide-react'
import { resourcesApi, resourceKeys } from '@/lib/api/resources'
import type { ResourceLoadResult, TrendResult } from '@/lib/api/resources'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useEChartsInstance, type EChartsCoreOption } from '@/lib/next/charts/use-echarts-instance'
import { cn } from '@/lib/utils'
import {
  buildTeamRows,
  buildTrendBarModel,
  createDefaultLoadWindow,
  dateLabelInterval,
  formatHours,
  formatTrendTooltipHtml,
  NX_HEADROOM_COLOR,
  NX_NORMAL_COLOR,
  NX_OVERLOAD_COLOR,
  resourceRoleLabel,
  type TeamMemberRow,
} from '@/lib/next/charts/resource-load-adapter'
import { ChartLensEmptyState, ChartLensErrorState, ChartLensSkeleton } from './lens-state-cards'

export interface ResourceLoadChartLensProps {
  projectId: number
}

type LoadView = 'trend' | 'team'

const VIEW_TABS: ReadonlyArray<{ id: LoadView; label: string }> = [
  { id: 'trend', label: '时序趋势 (Trend)' },
  { id: 'team', label: '团队成员 (Team)' },
]

function isTrendResult(result: ResourceLoadResult | TrendResult): result is TrendResult {
  return Array.isArray((result as TrendResult).days)
}

const TOOLTIP_SHELL = {
  backgroundColor: 'rgba(10, 11, 13, 0.96)',
  borderColor: 'rgba(255, 255, 255, 0.08)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#cbd5e1', fontSize: 12 },
  extraCssText: 'border-radius:6px;box-shadow:none;',
} as const

/** Trend 堆叠柱状 + 100% 容量警戒线 option（纯映射，测试直接断言）。 */
function buildTrendOption(
  model: ReturnType<typeof buildTrendBarModel>,
  animation: boolean,
): EChartsCoreOption {
  const markLine =
    model.capacityMarkValue === null
      ? undefined
      : {
          symbol: 'none' as const,
          silent: true,
          label: {
            show: true,
            formatter: '100% 容量警戒',
            color: NX_OVERLOAD_COLOR,
            fontSize: 10,
            position: 'insideEndTop' as const,
          },
          lineStyle: { color: NX_OVERLOAD_COLOR, type: 'dashed' as const, width: 1 },
          data: [{ yAxis: model.capacityMarkValue }],
        }
  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params]
        const first = list[0] as { dataIndex?: number } | undefined
        if (!first || first.dataIndex === undefined) return ''
        const day = model.days[Number(first.dataIndex)]
        return day ? formatTrendTooltipHtml(day) : ''
      },
    },
    legend: {
      data: ['正常分配工时', '超负荷工时'],
      top: 0,
      right: 8,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: { left: 8, right: 12, top: 28, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: model.categories,
      axisLabel: {
        color: '#7a8ba1',
        fontSize: 10,
        interval: dateLabelInterval(model.categories.length),
        hideOverlap: true,
      },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '工时 (h)',
      nameTextStyle: { color: '#7a8ba1', fontSize: 10, padding: [0, 0, 4, 0] },
      axisLabel: { color: '#7a8ba1', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    series: [
      {
        name: '正常分配工时',
        type: 'bar' as const,
        stack: 'load-hours',
        barMaxWidth: 18,
        emphasis: { focus: 'series' as const },
        itemStyle: { color: NX_NORMAL_COLOR },
        data: model.days.map((day) => day.normalHours),
      },
      {
        name: '超负荷工时',
        type: 'bar' as const,
        stack: 'load-hours',
        barMaxWidth: 18,
        emphasis: { focus: 'series' as const },
        itemStyle: { color: NX_OVERLOAD_COLOR },
        data: model.days.map((day) => day.overloadHours),
        markLine,
      },
    ],
  }
}

/** Team 水平堆叠条形 option（正常/超额/未利用容量构成）。 */
function buildTeamChartOption(rows: TeamMemberRow[], animation: boolean): EChartsCoreOption {
  return {
    animation,
    tooltip: {
      ...TOOLTIP_SHELL,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const list = Array.isArray(params) ? params : [params]
        const first = list[0] as { dataIndex?: number } | undefined
        if (!first || first.dataIndex === undefined) return ''
        const row = rows[Number(first.dataIndex)]
        if (!row) return ''
        const overloadedMark = row.overloaded ? ' · ⚠ 平均利用率超 100%' : ''
        return [
          `<div style="color:#f1f5f9;font-weight:600;margin-bottom:4px">${row.resourceName}${overloadedMark}</div>`,
          `<div>窗口额定容量：<b style="color:#f1f5f9">${formatHours(row.totalCapacityHours)}</b> h</div>`,
          `<div>窗口分配工时：<b style="color:#f1f5f9">${formatHours(row.totalAllocatedHours)}</b> h</div>`,
          `<div>平均利用率：<b style="color:${row.overloaded ? NX_OVERLOAD_COLOR : '#f1f5f9'}">${formatHours(row.utilizationPercent)}%</b></div>`,
        ].join('')
      },
    },
    legend: {
      data: ['正常分配工时', '超负荷工时', '未利用容量'],
      top: 0,
      right: 8,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: '#94a3b8', fontSize: 11 },
    },
    grid: { left: 8, right: 30, top: 28, bottom: 0, containLabel: true },
    xAxis: {
      type: 'value',
      name: '工时 (h)',
      nameTextStyle: { color: '#7a8ba1', fontSize: 10 },
      axisLabel: { color: '#7a8ba1', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((row) => row.resourceName),
      axisLabel: { color: '#e2e8f0', fontSize: 11, width: 108, overflow: 'truncate' },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
      axisTick: { show: false },
    },
    series: [
      {
        name: '正常分配工时',
        type: 'bar' as const,
        stack: 'team-load',
        barMaxWidth: 12,
        itemStyle: { color: NX_NORMAL_COLOR },
        data: rows.map((row) => Math.min(row.totalAllocatedHours, row.totalCapacityHours)),
      },
      {
        name: '超负荷工时',
        type: 'bar' as const,
        stack: 'team-load',
        barMaxWidth: 12,
        itemStyle: { color: NX_OVERLOAD_COLOR },
        data: rows.map((row) => Math.max(0, row.totalAllocatedHours - row.totalCapacityHours)),
      },
      {
        name: '未利用容量',
        type: 'bar' as const,
        stack: 'team-load',
        barMaxWidth: 12,
        itemStyle: { color: NX_HEADROOM_COLOR },
        data: rows.map((row) => Math.max(0, row.totalCapacityHours - row.totalAllocatedHours)),
      },
    ],
  }
}

export function ResourceLoadChartLens({ projectId }: ResourceLoadChartLensProps) {
  const tier = useImmersionTier()
  const animation = tier !== 'precise'
  const [view, setView] = useState<LoadView>('trend')
  const window = useMemo(() => createDefaultLoadWindow(), [])

  const trendRef = useRef<HTMLDivElement | null>(null)
  const teamChartRef = useRef<HTMLDivElement | null>(null)

  const trendQuery = useQuery({
    queryKey: resourceKeys.load(projectId, {
      from: window.from,
      to: window.to,
      view: 'trend' as const,
    }),
    queryFn: () =>
      resourcesApi.load(projectId, { from: window.from, to: window.to, view: 'trend' }),
    enabled: projectId > 0 && view === 'trend',
    retry: false,
    staleTime: 30_000,
  })
  const teamQuery = useQuery({
    queryKey: resourceKeys.load(projectId, {
      from: window.from,
      to: window.to,
      view: 'team' as const,
    }),
    queryFn: () => resourcesApi.load(projectId, { from: window.from, to: window.to, view: 'team' }),
    enabled: projectId > 0 && view === 'team',
    retry: false,
    staleTime: 30_000,
  })

  const trendData = trendQuery.data
  const teamData = teamQuery.data

  const trendModel = useMemo(
    () => (trendData && isTrendResult(trendData) ? buildTrendBarModel(trendData.days) : null),
    [trendData],
  )
  const teamRows = useMemo(
    () => (teamData && !isTrendResult(teamData) ? buildTeamRows(teamData.resources) : []),
    [teamData],
  )

  const trendOption = useMemo(
    () =>
      trendModel && trendModel.categories.length > 0 && trendModel.capacityMarkValue !== null
        ? buildTrendOption(trendModel, animation)
        : null,
    [trendModel, animation],
  )
  const teamOption = useMemo(
    () => (teamRows.length > 0 ? buildTeamChartOption(teamRows, animation) : null),
    [teamRows, animation],
  )

  useEChartsInstance({
    containerRef: trendRef,
    option: view === 'trend' ? trendOption : null,
    animation,
  })
  useEChartsInstance({
    containerRef: teamChartRef,
    option: view === 'team' ? teamOption : null,
    animation,
  })

  const hasTrendData = trendData !== undefined && isTrendResult(trendData)
  const hasTeamData = teamData !== undefined && !isTrendResult(teamData)
  const trendIsEmpty =
    hasTrendData &&
    trendData !== undefined &&
    (trendData.days.length === 0 || trendData.totalResources === 0)
  const teamIsEmpty = hasTeamData && teamData !== undefined && teamData.resources.length === 0

  const teamSummary = useMemo(() => {
    if (teamData === undefined || isTrendResult(teamData)) return null
    return {
      memberCount: teamData.resources.length,
      averageUtilizationPercent: teamData.teamAverageUtilizationPercent,
      overloadedCount: teamRows.filter((row) => row.overloaded).length,
    }
  }, [teamData, teamRows])

  return (
    <div data-chart-lens-root="resource-load" className="flex min-h-[420px] flex-col gap-3">
      {/* 视图切换 + 窗口徽标（视图 Tab 由镜头自持，ChartLensToolbar 不做横向扩展） */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="资源负荷视图切换"
          data-lens-view-tabs
          className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-0.5"
        >
          {VIEW_TABS.map((tab) => {
            const active = view === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-lens-view-tab={tab.id}
                onClick={() => setView(tab.id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                  active
                    ? 'bg-[var(--nx-accent)]/10 text-[var(--nx-text-primary)]'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {tab.id === 'trend' ? (
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Users className="h-3.5 w-3.5" aria-hidden />
                )}
                {tab.label}
              </button>
            )
          })}
        </div>
        <span data-lens-window-label className="font-mono text-[11px] text-[var(--nx-text-muted)]">
          {window.from} ~ {window.to} · 30 天滑动窗口
        </span>
      </div>

      {/* Trend 面板 */}
      {view === 'trend' &&
        (trendQuery.isLoading && !hasTrendData ? (
          <ChartLensSkeleton label="正在加载资源负荷趋势数据" />
        ) : trendQuery.isError && !hasTrendData ? (
          <ChartLensErrorState
            ariaLabel="资源负荷趋势加载失败"
            title="趋势数据加载失败"
            onRetry={() => void trendQuery.refetch()}
          />
        ) : hasTrendData ? (
          <div
            data-resource-load-panel="trend"
            className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
          >
            {trendIsEmpty || trendOption === null ? (
              <ChartLensEmptyState
                icon={BarChart3}
                title="当前项目暂无资源负荷数据"
                description="项目尚未登记活跃资源或尚未产生排期分配；请先在项目空间分配成员工时后回来看趋势。"
                ariaLabel="资源负荷趋势数据为空"
              />
            ) : (
              <div
                ref={trendRef}
                data-resource-load-chart="trend"
                role="img"
                aria-label="资源负荷时序趋势直方图"
                className="h-[340px] w-full"
              />
            )}
          </div>
        ) : null)}

      {/* Team 面板 */}
      {view === 'team' &&
        (teamQuery.isLoading && !hasTeamData ? (
          <ChartLensSkeleton label="正在加载团队成员负荷数据" chartHeight={300} />
        ) : teamQuery.isError && !hasTeamData ? (
          <ChartLensErrorState
            ariaLabel="团队成员负荷加载失败"
            title="成员负荷数据加载失败"
            onRetry={() => void teamQuery.refetch()}
          />
        ) : hasTeamData ? (
          <div
            data-resource-load-panel="team"
            className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
          >
            {teamIsEmpty || teamSummary === null ? (
              <ChartLensEmptyState
                icon={Users}
                title="当前项目暂无团队成员负荷数据"
                description="项目尚未登记在册成员或成员尚无任何排期分配；登记资源并分配工时后此处将呈现负荷矩阵。"
                ariaLabel="团队成员负荷数据为空"
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[var(--nx-text-secondary)]">
                    成员{' '}
                    <b className="font-mono text-[var(--nx-text-primary)]">
                      {teamSummary.memberCount}
                    </b>{' '}
                    人
                  </span>
                  <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[var(--nx-text-secondary)]">
                    团队平均利用率{' '}
                    <b
                      className={cn(
                        'font-mono',
                        teamSummary.averageUtilizationPercent > 100
                          ? 'text-[var(--nx-status-danger)]'
                          : 'text-[var(--nx-text-primary)]',
                      )}
                    >
                      {formatHours(teamSummary.averageUtilizationPercent)}%
                    </b>
                  </span>
                  <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-[var(--nx-text-secondary)]">
                    超负荷成员{' '}
                    <b className="font-mono text-[var(--nx-status-danger)]">
                      {teamSummary.overloadedCount}
                    </b>{' '}
                    人
                  </span>
                </div>
                {teamOption === null ? (
                  <ChartLensEmptyState
                    icon={Users}
                    title="当前项目暂无团队成员负荷数据"
                    description="项目尚未登记在册成员或成员尚无任何排期分配；登记资源并分配工时后此处将呈现负荷矩阵。"
                    ariaLabel="团队成员负荷数据为空"
                  />
                ) : (
                  <>
                    <div
                      ref={teamChartRef}
                      data-resource-load-chart="team"
                      role="img"
                      aria-label="团队成员负荷条形图"
                      className="h-[280px] w-full"
                    />
                    <TeamLoadTable rows={teamRows} />
                  </>
                )}
              </>
            )}
          </div>
        ) : null)}
    </div>
  )
}

/** Team 精确数字矩阵（只读表格）。 */
function TeamLoadTable({ rows }: { rows: TeamMemberRow[] }) {
  return (
    <div
      data-resource-load-team-table
      className="overflow-auto rounded-md border border-[var(--nx-border-hairline)]"
    >
      <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
        <thead>
          <tr className="bg-[var(--nx-workspace-surface)] text-[var(--nx-text-muted)]">
            <th className="px-3 py-2 font-medium">成员</th>
            <th className="px-3 py-2 font-medium">角色</th>
            <th className="px-3 py-2 text-right font-medium">日容量</th>
            <th className="px-3 py-2 text-right font-medium">窗口额定容量</th>
            <th className="px-3 py-2 text-right font-medium">窗口分配工时</th>
            <th className="px-3 py-2 text-right font-medium">平均利用率</th>
            <th className="px-3 py-2 text-center font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.resourceId}
              data-member-row={row.resourceId}
              className="border-t border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]"
            >
              <td className="px-3 py-2 text-[var(--nx-text-primary)]">{row.resourceName}</td>
              <td className="px-3 py-2">{resourceRoleLabel(row.role)}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatHours(row.dailyCapacityHours)} h
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatHours(row.totalCapacityHours)} h
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatHours(row.totalAllocatedHours)} h
              </td>
              <td
                className={cn(
                  'px-3 py-2 text-right font-mono',
                  row.overloaded
                    ? 'text-[var(--nx-status-danger)]'
                    : row.idle
                      ? 'text-[var(--nx-text-muted)]'
                      : 'text-[var(--nx-text-primary)]',
                )}
              >
                {formatHours(row.utilizationPercent)}%
              </td>
              <td className="px-3 py-2 text-center">
                {row.overloaded ? (
                  <span
                    className="inline-flex rounded border px-1.5 py-0.5 text-[10px]"
                    style={{
                      color: 'var(--nx-status-danger)',
                      borderColor: 'rgba(239, 68, 68, 0.4)',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    }}
                  >
                    超负荷
                  </span>
                ) : row.idle ? (
                  <span className="inline-flex rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                    未分配
                  </span>
                ) : (
                  <span className="inline-flex rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                    正常
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ResourceLoadChartLens
