'use client'

/**
 * 时间主轴全域刻度档组件
 * (v3-ui-next-batch3-global-convergence W3 任务 3.3 / spec「时间主轴跨项目全域刻度档架构与分层着色规范」).
 *
 * 核心规范：
 * 1. 贯穿式水平时间主轴，纯高密度 DOM + CSS 发丝线渲染，零 3D / WebGL / Canvas（RL-14、RL-15）；
 * 2. 经典三区语义：
 *    - 过去分区：今天锚点左侧，暗调低对比度实线；
 *    - 今天锚点（Today Indicator）：垂直贯穿的天青色电光指示线（--nx-space-cyan）与日期微标；
 *    - 未来分区：今天锚点右侧，发丝虚线结构前瞻；
 * 3. 刻度尺度缩放：按周（week）、按月（month）、按季（quarter）三档平滑切换；
 * 4. 跨项目分层泳道：每条泳道高 36px~40px，发丝线分隔，左侧项目色彩微标 + 名称 + 进度，
 *    右侧主轴排布 45° 旋转棱形里程碑与任务胶囊；
 * 5. 精确档（precise）与无障碍：[data-immersion="precise"] 下移除所有发光与光晕，
 *    虚线退化为 1px 纯平实线；prefers-reduced-motion 停用平滑过渡。
 */

import * as React from 'react'
import { Layers } from 'lucide-react'
import { useQuery, QueryClientContext } from '@tanstack/react-query'
import type { Milestone } from '@/lib/api/milestones'
import type { Task } from '@/lib/api/tasks'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useMotionPreference } from '@/hooks/use-motion-preference'
import {
  GLOBAL_TIMELINE_QUERY_KEY,
  composeGlobalTimelineSeries,
  daysBetween,
  fetchGlobalTimelineData,
  todayDateKey,
  type GlobalTimelineScale,
  type GlobalTimelineSeriesTree,
} from '@/lib/next/global-timeline-composer'
import { cn } from '@/lib/utils'
import { GlobalTimelineHoverCard } from './GlobalTimelineHoverCard'

export interface GlobalTimelineBarProps {
  /** 外部传入预先合成的数据树（可选；未传则内部执行并发合成查询） */
  seriesTree?: GlobalTimelineSeriesTree
  /** 初始刻度档位，默认 'month' */
  initialScale?: GlobalTimelineScale
  /** 外部注入系统「今天」（YYYY-MM-DD，测试确定性） */
  today?: string
  /** 自定义穿透跳转行为 */
  onNavigate?: (url: string) => void
  className?: string
}

interface GlobalTimelineBarViewProps {
  activeTree: GlobalTimelineSeriesTree
  scale: GlobalTimelineScale
  setScale: (scale: GlobalTimelineScale) => void
  isLoading?: boolean
  onNavigate?: (url: string) => void
  className?: string
}

function GlobalTimelineBarView({
  activeTree,
  scale,
  setScale,
  isLoading,
  onNavigate,
  className,
}: GlobalTimelineBarViewProps) {
  const tier = useImmersionTier()
  const isPrecise = tier === 'precise'
  const reducedMotion = useMotionPreference()

  const { lanes, todayPercent, totalDays, minDate, maxDate, ticks, todayDate } = activeTree
  // 刻度文字去重并保持间距：月刻度每半月一个刻度，同一个「2026-07」出现两次、挤成一串看不清（实测）。
  // 刻度线全部保留，文字只标不重复、且与上一个文字相距至少 8% 的刻度；避开「今天」标签附近。
  const labeledTicks = React.useMemo(() => {
    const keep = new Set<string>()
    let lastPercent = -Infinity
    let lastLabel: string | null = null
    for (const tick of ticks) {
      if (tick.label === lastLabel) continue
      if (tick.percent - lastPercent < 8) continue
      if (Math.abs(tick.percent - todayPercent) < 6) continue
      keep.add(tick.date)
      lastPercent = tick.percent
      lastLabel = tick.label
    }
    return keep
  }, [ticks, todayPercent])
  const systemToday = todayDate

  // 计算节点在时间轴上的水平百分比
  const computePercent = React.useCallback(
    (dateStr: string) => {
      if (totalDays <= 0) return 0
      const offset = daysBetween(minDate, dateStr)
      return Math.max(0, Math.min(100, (offset / totalDays) * 100))
    },
    [minDate, totalDays],
  )

  return (
    <section
      data-global-timeline-bar
      data-immersion={tier}
      data-scale={scale}
      aria-label="跨项目全域时间主轴"
      className={cn(
        'w-full overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]',
        className,
      )}
    >
      {/* 顶层工具栏：标题、度量微标与周/月/季缩放器 */}
      <div
        data-timeline-header
        className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-4 py-2.5 bg-[var(--nx-workspace-surface)]"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--nx-workspace-bg)] border border-[var(--nx-border-hairline)] text-[var(--nx-space-cyan)]">
            <Layers className="h-3 w-3" />
          </span>
          <h3 className="text-xs font-semibold tracking-tight text-[var(--nx-text-primary)]">
            全域交付时间主轴
          </h3>
          <span data-timeline-range className="font-mono text-[10px] text-[var(--nx-text-muted)]">
            {minDate} ~ {maxDate}
          </span>
        </div>

        {/* 刻度缩放切换 */}
        <div
          data-scale-selector
          role="group"
          aria-label="时间刻度缩放"
          className="flex items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-0.5"
        >
          {(['week', 'month', 'quarter'] as const).map((s) => {
            const labels = { week: '周', month: '月', quarter: '季' }
            const active = scale === s
            return (
              <button
                key={s}
                type="button"
                data-scale-button={s}
                aria-pressed={active}
                onClick={() => setScale(s)}
                className={cn(
                  'rounded px-2.5 py-0.5 text-[10px] font-medium transition-colors',
                  active
                    ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-space-cyan)] shadow-sm font-semibold'
                    : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
                )}
              >
                {labels[s]}
              </button>
            )
          })}
        </div>
      </div>

      {/* 主轴画板：表头标尺与三区划分 */}
      <div className="relative w-full overflow-x-auto select-none">
        <div className="min-w-[760px]">
          {/* 时间标尺刻度行 */}
          <div className="flex items-center border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]/80 text-[10px]">
            {/* 左侧项目信息栏占位 */}
            <div className="w-56 shrink-0 border-r border-[var(--nx-border-hairline)] px-3 py-1.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
              项目泳道 ({lanes.length})
            </div>

            {/* 右侧贯穿时间主轴标尺 */}
            <div data-timeline-axis-header className="relative flex-1 h-8 overflow-hidden">
              {/* 三区底色：过去区段 */}
              <div
                data-timeline-past
                className="absolute inset-y-0 left-0 bg-[var(--nx-text-muted)]/20"
                style={{ width: `${todayPercent}%` }}
              />

              {/* 三区底色：未来区段 */}
              <div
                data-timeline-future
                className={cn(
                  'absolute inset-y-0 right-0 border-t',
                  isPrecise
                    ? 'border-[var(--nx-border-hairline)]'
                    : 'border-dashed border-[var(--nx-border-hairline)]',
                )}
                style={{ width: `${100 - todayPercent}%` }}
              />

              {/* 刻度刻印与文本标签 */}
              <div data-timeline-ticks className="absolute inset-0 pointer-events-none">
                {ticks.map((tick) => (
                  <div
                    key={tick.date}
                    data-timeline-tick
                    className="absolute top-0 bottom-0 flex flex-col justify-between"
                    style={{ left: `${tick.percent}%` }}
                  >
                    <span className="font-mono text-[9px] text-[var(--nx-text-muted)] -translate-x-1/2 pt-1">
                      {labeledTicks.has(tick.date) ? tick.label : null}
                    </span>
                    <span className="h-1.5 w-px bg-[var(--nx-border-hairline)]" />
                  </div>
                ))}
              </div>

              {/* 今天垂直锚点指示线与标签 */}
              <div
                data-timeline-today-indicator
                className="absolute inset-y-0 z-30 pointer-events-none"
                style={{ left: `${todayPercent}%` }}
              >
                <span
                  data-timeline-today-line
                  className={cn(
                    'mx-auto block h-full w-px bg-[var(--nx-space-cyan)]',
                    !isPrecise && 'shadow-[0_0_8px_var(--nx-space-cyan)]',
                  )}
                />
                <span
                  data-timeline-today-label
                  className={cn(
                    'absolute top-1 -translate-x-1/2 whitespace-nowrap rounded px-1 text-[9px] font-mono font-medium',
                    isPrecise
                      ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)] border border-[var(--nx-border-hairline)]'
                      : 'bg-[var(--nx-space-cyan)]/20 text-[var(--nx-space-cyan)] border border-[var(--nx-space-cyan)]/40',
                  )}
                >
                  {systemToday} 今天
                </span>
              </div>
            </div>
          </div>

          {/* 纵向多项目发丝线泳道列表 */}
          <div data-timeline-lanes className="relative divide-y divide-[var(--nx-border-hairline)]">
            {isLoading && !activeTree.lanes.length ? (
              <div
                data-timeline-loading
                className="flex items-center justify-center py-10 text-xs text-[var(--nx-text-muted)]"
              >
                正在拉取跨项目排程序列...
              </div>
            ) : null}

            {lanes.length === 0 && !isLoading ? (
              <div
                data-timeline-empty
                className="py-12 text-center text-xs text-[var(--nx-text-muted)]"
              >
                暂无活跃项目排程数据
              </div>
            ) : null}

            {lanes.map((lane) => (
              <div
                key={lane.projectId}
                data-timeline-lane
                data-project-id={lane.projectId}
                className="relative flex items-center h-10 hover:bg-[var(--nx-workspace-surface)]/40 transition-colors"
              >
                {/* 泳道左侧：色彩微标 + 项目名 + 进度 */}
                <div
                  data-lane-header
                  className="flex w-56 shrink-0 items-center justify-between border-r border-[var(--nx-border-hairline)] px-3 py-1 text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      data-lane-color-dot
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: lane.colorToken }}
                    />
                    <span
                      data-lane-name
                      className="truncate font-medium text-[var(--nx-text-primary)]"
                    >
                      {lane.projectName}
                    </span>
                  </div>
                  <span
                    data-lane-progress
                    className="font-mono text-[10px] text-[var(--nx-text-muted)] shrink-0 ml-1"
                  >
                    {lane.progressPercent}%
                  </span>
                </div>

                {/* 泳道右侧：时间轨迹排布区 */}
                <div
                  data-lane-track
                  className="relative flex-1 h-full flex items-center overflow-visible"
                >
                  {/* 背景发丝基准线 */}
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-[var(--nx-border-hairline)] pointer-events-none" />

                  {/* 垂直贯穿的今天指示对齐发丝 */}
                  <div
                    data-lane-today-marker
                    className={cn(
                      'pointer-events-none absolute inset-y-0 w-px bg-[var(--nx-space-cyan)]/50 z-10',
                      !isPrecise && 'shadow-[0_0_4px_var(--nx-space-cyan)]',
                    )}
                    style={{ left: `${todayPercent}%` }}
                  />

                  {/* 节点层：关键任务条与 45° 旋转棱形里程碑 */}
                  <div className="absolute inset-0 flex items-center">
                    {/* 任务胶囊条 */}
                    {lane.tasks.map((taskNode) => {
                      const startPercent = taskNode.startDate
                        ? computePercent(taskNode.startDate)
                        : computePercent(taskNode.date)
                      const endPercent = taskNode.endDate
                        ? computePercent(taskNode.endDate)
                        : computePercent(taskNode.date)
                      const left = Math.min(startPercent, endPercent)
                      const width = Math.max(1.8, Math.abs(endPercent - startPercent))

                      return (
                        <div
                          key={taskNode.id}
                          className="absolute -translate-y-1/2 top-1/2 z-20"
                          style={{ left: `${left}%`, width: `${width}%` }}
                        >
                          <GlobalTimelineHoverCard node={taskNode} onNavigate={onNavigate}>
                            <span
                              data-timeline-node="task"
                              data-task-status={taskNode.status}
                              data-node-id={taskNode.id}
                              style={{
                                backgroundColor: `var(${taskNode.statusTone})`,
                              }}
                              className={cn(
                                'block h-2 w-full rounded-sm opacity-90 transition-transform hover:scale-y-125 hover:opacity-100',
                                !isPrecise &&
                                  !reducedMotion &&
                                  'hover:shadow-[0_0_6px_var(--nx-space-cyan)]',
                              )}
                            />
                          </GlobalTimelineHoverCard>
                        </div>
                      )
                    })}

                    {/* 45° 旋转棱形里程碑 */}
                    {lane.milestones.map((mNode) => {
                      const posPercent = computePercent(mNode.date)

                      // 状态着色
                      let statusClasses =
                        'border border-[var(--nx-text-secondary)] bg-[var(--nx-workspace-surface)]'
                      if (mNode.status === 'at_risk') {
                        statusClasses =
                          'border border-[var(--nx-status-warning)] bg-[var(--nx-status-warning)]'
                      } else if (mNode.status === 'achieved') {
                        statusClasses =
                          'border border-[var(--nx-status-success)] bg-[var(--nx-status-success)]'
                      } else if (mNode.status === 'missed' || mNode.isOverdue) {
                        statusClasses =
                          'border border-[var(--nx-status-danger)] bg-[var(--nx-status-danger)]'
                      } else if (mNode.status === 'not_started') {
                        statusClasses =
                          'border border-[var(--nx-text-muted)] bg-[var(--nx-workspace-surface)]'
                      }

                      return (
                        <div
                          key={mNode.id}
                          className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2 z-20"
                          style={{ left: `${posPercent}%` }}
                        >
                          <GlobalTimelineHoverCard node={mNode} onNavigate={onNavigate}>
                            <span
                              data-timeline-node="milestone"
                              data-milestone-status={mNode.status}
                              data-node-id={mNode.id}
                              className={cn(
                                'block h-3 w-3 rotate-45 transition-transform hover:scale-125',
                                statusClasses,
                                !isPrecise &&
                                  !reducedMotion &&
                                  'hover:shadow-[0_0_8px_var(--nx-space-cyan)]',
                              )}
                            />
                          </GlobalTimelineHoverCard>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function GlobalTimelineBarLive(props: GlobalTimelineBarProps) {
  const [scale, setScale] = React.useState<GlobalTimelineScale>(props.initialScale ?? 'month')
  const systemToday = React.useMemo(() => props.today ?? todayDateKey(), [props.today])

  const { data: fetchedTree, isLoading } = useQuery({
    queryKey: [...GLOBAL_TIMELINE_QUERY_KEY, scale, systemToday],
    queryFn: () => fetchGlobalTimelineData({ scale, today: systemToday }),
    enabled: !props.seriesTree,
    staleTime: 60_000,
  })

  const activeTree: GlobalTimelineSeriesTree = React.useMemo(() => {
    if (props.seriesTree) {
      if (props.seriesTree.scale === scale) {
        return props.seriesTree
      }
      const pMap = props.seriesTree.lanes.reduce<Record<number, Milestone[]>>((acc, l) => {
        acc[l.projectId] = l.milestones.map((m) => m.rawMilestone!).filter(Boolean)
        return acc
      }, {})
      const tMap = props.seriesTree.lanes.reduce<Record<number, Task[]>>((acc, l) => {
        acc[l.projectId] = l.tasks.map((t) => t.rawTask!).filter(Boolean)
        return acc
      }, {})
      return composeGlobalTimelineSeries({
        projects: props.seriesTree.lanes.map((l) => l.project),
        milestonesMap: pMap,
        tasksMap: tMap,
        today: systemToday,
        scale,
      })
    }
    return (
      fetchedTree ?? {
        lanes: [],
        allNodes: [],
        minDate: systemToday,
        maxDate: systemToday,
        todayDate: systemToday,
        scale,
        totalDays: 1,
        todayPercent: 50,
        ticks: [],
      }
    )
  }, [props.seriesTree, fetchedTree, scale, systemToday])

  return (
    <GlobalTimelineBarView
      activeTree={activeTree}
      scale={scale}
      setScale={setScale}
      isLoading={isLoading}
      onNavigate={props.onNavigate}
      className={props.className}
    />
  )
}

function GlobalTimelineBarStatic(
  props: GlobalTimelineBarProps & { seriesTree: GlobalTimelineSeriesTree },
) {
  const [scale, setScale] = React.useState<GlobalTimelineScale>(
    props.initialScale ?? props.seriesTree.scale,
  )
  const systemToday = React.useMemo(() => props.today ?? todayDateKey(), [props.today])

  const activeTree: GlobalTimelineSeriesTree = React.useMemo(() => {
    if (props.seriesTree.scale === scale) {
      return props.seriesTree
    }
    const pMap = props.seriesTree.lanes.reduce<Record<number, Milestone[]>>((acc, l) => {
      acc[l.projectId] = l.milestones.map((m) => m.rawMilestone!).filter(Boolean)
      return acc
    }, {})
    const tMap = props.seriesTree.lanes.reduce<Record<number, Task[]>>((acc, l) => {
      acc[l.projectId] = l.tasks.map((t) => t.rawTask!).filter(Boolean)
      return acc
    }, {})
    return composeGlobalTimelineSeries({
      projects: props.seriesTree.lanes.map((l) => l.project),
      milestonesMap: pMap,
      tasksMap: tMap,
      today: systemToday,
      scale,
    })
  }, [props.seriesTree, scale, systemToday])

  return (
    <GlobalTimelineBarView
      activeTree={activeTree}
      scale={scale}
      setScale={setScale}
      onNavigate={props.onNavigate}
      className={props.className}
    />
  )
}

export function GlobalTimelineBar(props: GlobalTimelineBarProps) {
  const hasQueryClient = React.useContext(QueryClientContext) !== undefined
  if (props.seriesTree) {
    return <GlobalTimelineBarStatic {...props} seriesTree={props.seriesTree} />
  }
  if (!hasQueryClient) {
    return null
  }
  return <GlobalTimelineBarLive {...props} />
}

export default GlobalTimelineBar
