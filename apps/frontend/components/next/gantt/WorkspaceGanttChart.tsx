/**
 * 新轨甘特镜头（v3-ui-next-gantt-lens W1 tasks 1.7）—— SVG 核心画板与双向视口裁剪引擎。
 *
 * 通过 `@visx/group` 编排 Layer 0–4 图层堆叠（网格/今天线 → 依赖线 → 任务条/里程碑），
 * 集成纵向虚拟行裁剪（ROW_BUFFER=4）与横向时间窗口裁剪（DAY_BUFFER=4），结合
 * `DependencyIndex` 空间相交索引过滤视口外依赖线，常驻活动图元 ≤ 200。
 *
 * 交互（tasks 1.7）：日/周/月粒度切换（消费 `stores/gantt-store.ts` 的 `granularity` 状态，
 * 测试/独立场景可注入 `store` 实例）、`showCriticalPath` / `showAllDependencies` 开关、
 * 「定位到今天」一键聚焦（视口水平滚动居中）、滚动视口裁剪与悬停/选中联动。
 *
 * 数据红线：本组件零写入、零网络请求——只读浏览态；What-if 沙盒由上层 Lens 组装。
 * 性能：滚动只改 viewport 状态并重算裁剪窗口，几何缓存（行/条盒/端点/索引）随模型
 * 与刻度重建，不随滚动重建（design D9）。
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Group } from '@visx/group'
import type { StoreApi, UseBoundStore } from 'zustand'
import { cn } from '@/lib/utils'
import { useMotionPreference } from '@/hooks/use-motion-preference'
import { resolveScrollBehavior } from '@/lib/next/motion/scroll-behavior'
import { useGanttStore, type GanttViewState } from '@/stores/gantt-store'
import {
  NEXT_STATUS_HAIRLINE_TOKEN,
  NX_GRANULARITY_LABEL,
  NX_TIME_AXIS_HEIGHT,
  nxRowTop,
  buildNextGanttModel,
  buildNextTimeScale,
  buildRowIndex,
  dayOf,
  nxChartHeight,
  nxChartWidth,
  nxDayToX,
  visibleDayRange,
  visibleRowRange,
  type NextGanttModel,
  type NextGanttScale,
  type NextGanttViewport,
  type NextGranularity,
} from '@/lib/gantt/next-gantt-adapter'
import { WorkspaceGanttTimeAxis } from './WorkspaceGanttTimeAxis'
import { WorkspaceGanttGridLayer } from './WorkspaceGanttGridLayer'
import { WorkspaceGanttDependencyLayer } from './WorkspaceGanttDependencyLayer'
import { WorkspaceGanttBarsLayer } from './WorkspaceGanttBarsLayer'
import type { GanttModel, GanttRenderTask } from '@/lib/gantt/types'
import { computeDrivingChain, EMPTY_DRIVING_CHAIN } from '@/lib/gantt/driving-chain'
import type { GanttDragHandleProps, GanttDragGhost } from '@/hooks/use-gantt-drag-interaction'

export interface WorkspaceGanttChartProps {
  model: GanttModel
  rowHeight?: number
  /** 初始视口尺寸（jsdom/无布局环境回退值；真实浏览器由 ResizeObserver 实测覆盖）。 */
  initialViewport?: { width: number; height: number }
  /** 甘特视图 store 实例（测试注入独立实例；缺省应用级单例 useGanttStore）。 */
  store?: UseBoundStore<StoreApi<GanttViewState>>
  /** 系统当前日期（ms）；缺省 Date.now()。 */
  todayMs?: number
  className?: string
  /** 首屏渲染完成回调（W4 性能预算断言消费）。 */
  onRenderComplete?: (metric: { durationMs: number; activeElements: number }) => void
  /** 可选：拖拽手柄与幽灵条（W2/W4 拖拽集成）。 */
  getMoveHandleProps?: (task: GanttRenderTask) => GanttDragHandleProps
  getResizeHandleProps?: (task: GanttRenderTask) => GanttDragHandleProps
  getMilestoneHandleProps?: (task: GanttRenderTask) => GanttDragHandleProps
  ghost?: GanttDragGhost | null
  /** 打开任务详情：点左侧任务名 / 双击任务条（里程碑除外）。 */
  onOpenTask?: (taskId: number) => void
  /** 聚焦任务（?focusTask=）：首次就绪时滚到该任务并选中，代替默认定位。 */
  focusTaskId?: number | null
}

const DEFAULT_VIEWPORT = { width: 1200, height: 800 }

/** 旧轨 quarter 粒度在新轨画板按 month 处理（新轨仅日/周/月三档）。 */
function toNextGranularity(g: GanttViewState['granularity']): NextGranularity {
  return g === 'quarter' ? 'month' : g
}

export function WorkspaceGanttChart({
  model,
  rowHeight,
  initialViewport = DEFAULT_VIEWPORT,
  store,
  todayMs,
  className,
  onRenderComplete,
  getMoveHandleProps,
  getResizeHandleProps,
  getMilestoneHandleProps,
  ghost,
  onOpenTask,
  focusTaskId = null,
}: WorkspaceGanttChartProps) {
  const useStore = store ?? useGanttStore
  const reducedMotion = useMotionPreference()
  const granularity = toNextGranularity(useStore((s) => s.granularity))
  const setGranularity = useStore((s) => s.setGranularity)
  const showAllDependencies = useStore((s) => s.showAllDependencies)
  const toggleShowAllDependencies = useStore((s) => s.toggleShowAllDependencies)
  const showCriticalPath = useStore((s) => s.showCriticalPath)
  const toggleShowCriticalPath = useStore((s) => s.toggleShowCriticalPath)
  const hoveredTaskId = useStore((s) => s.hoveredTaskId)
  const setHoveredTaskId = useStore((s) => s.setHoveredTaskId)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const setSelectedTaskId = useStore((s) => s.setSelectedTaskId)

  const today = useMemo(() => todayMs ?? Date.now(), [todayMs])
  const scale: NextGanttScale = useMemo(
    () => buildNextTimeScale(model, granularity, { rowHeight, todayMs: today }),
    [model, granularity, rowHeight, today],
  )

  const nextModel: NextGanttModel = useMemo(() => buildNextGanttModel(model), [model])
  // 「关键路径」开启时高亮驱动完工日的依赖主链（严格 CPM 在计划留空档时几乎标不出链）。
  const drivingChain = useMemo(
    () => (showCriticalPath ? computeDrivingChain(model) : EMPTY_DRIVING_CHAIN),
    [model, showCriticalPath],
  )
  const rowIndex = useMemo(() => buildRowIndex(model.tasks), [model])
  const rowCount = model.tasks.length
  const chartWidth = nxChartWidth(scale)
  const chartHeight = nxChartHeight(scale, rowCount)
  // 标尺窗口取「任务范围 ∪ 今天右延」的完整跨度（今天可能在任务终点之外）。
  const timeRange = { startDay: 0, endDay: Math.max(1, scale.spanDays) }

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<SVGSVGElement | null>(null)
  const [viewport, setViewport] = useState<NextGanttViewport>({
    width: initialViewport.width,
    height: initialViewport.height,
    scrollLeft: 0,
    scrollTop: 0,
  })

  // 视口尺寸实测（ResizeObserver）；无布局环境回退 initialViewport。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setViewport((v) =>
          v.width === rect.width && v.height === rect.height
            ? v
            : { ...v, width: rect.width, height: rect.height },
        )
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    setViewport((v) =>
      el.scrollTop === v.scrollTop && el.scrollLeft === v.scrollLeft
        ? v
        : { ...v, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft },
    )
  }, [])

  const visibleRows = useMemo(
    () => visibleRowRange(viewport, scale, rowCount),
    [viewport, scale, rowCount],
  )
  const visibleDays = useMemo(() => visibleDayRange(viewport, scale), [viewport, scale])
  const todayDay = dayOf(model.epochMs, today)
  const todayIso = new Date(today).toISOString().slice(0, 10)

  const focusToday = useCallback(
    (instant = false) => {
      const el = scrollRef.current
      if (!el) return
      const target = Math.min(
        Math.max(0, nxDayToX(scale, todayDay) - viewport.width / 2),
        Math.max(0, chartWidth - viewport.width),
      )
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({
          left: target,
          behavior: instant ? 'auto' : resolveScrollBehavior(reducedMotion),
        })
      } else {
        el.scrollLeft = target
      }
    },
    [scale, todayDay, viewport.width, chartWidth, reducedMotion],
  )

  // 定位到某个任务：纵向滚到该行、横向让条出现在视口左侧，并选中它（驱动链断点提示用）
  const focusTask = useCallback(
    (taskId: number) => {
      const el = scrollRef.current
      const task = model.tasks.find((t) => t.id === taskId)
      const row = rowIndex.get(taskId)
      if (!el || !task || row === undefined) return
      const top = Math.max(0, nxRowTop(scale, row) - viewport.height / 3)
      const left = Math.max(0, nxDayToX(scale, task.startDay) - 120)
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({ top, left, behavior: resolveScrollBehavior(reducedMotion) })
      } else {
        el.scrollTop = top
        el.scrollLeft = left
      }
      setSelectedTaskId(taskId)
    },
    [model, rowIndex, scale, viewport.height, reducedMotion, setSelectedTaskId],
  )
  const chainBreak =
    showCriticalPath && drivingChain.breakTaskIds.length > 0
      ? (model.tasks.find((t) => t.id === drivingChain.breakTaskIds[0]) ?? null)
      : null

  // 聚焦任务：数据里出现该任务就滚过去（每个任务一次），并占用首次定位
  const autoFocusedRef = useRef(false)
  const focusedTaskRef = useRef<number | null>(null)
  useEffect(() => {
    if (!focusTaskId || focusedTaskRef.current === focusTaskId) return
    if (!rowIndex.has(focusTaskId)) return
    focusedTaskRef.current = focusTaskId
    autoFocusedRef.current = true
    focusTask(focusTaskId)
  }, [focusTaskId, rowIndex, focusTask])

  // 首次打开：今天落在项目周期内就定位到今天（进行中的工作一眼可见）；否则停在项目起点
  useEffect(() => {
    if (autoFocusedRef.current || rowCount === 0) return
    if (focusTaskId && rowIndex.has(focusTaskId)) return
    autoFocusedRef.current = true
    // 首次定位直接跳到位（不做滚动动画）：项目尚未到计划起点时定位到计划起点（前留 3 天），
    // 否则定位到今天——避免首屏只有「实际执行」细条、看不到计划条
    const planStartDay = model.tasks.reduce(
      (min, task) => (task.kind === 'milestone' ? min : Math.min(min, task.startDay)),
      Number.POSITIVE_INFINITY,
    )
    if (Number.isFinite(planStartDay) && todayDay < planStartDay) {
      const el = scrollRef.current
      if (el) el.scrollLeft = Math.max(0, nxDayToX(scale, planStartDay - 3))
    } else if (todayDay > 0 && todayDay < scale.spanDays) {
      focusToday(true)
    }
  }, [rowCount, todayDay, scale, focusToday, model.tasks, focusTaskId, rowIndex])

  // 首屏渲染完成度量（W4 性能预算断言；每挂载最多上报一次）。
  const mountAtRef = useRef(performance.now())
  const reportedRef = useRef(false)
  useEffect(() => {
    if (!onRenderComplete || reportedRef.current) return
    reportedRef.current = true
    const activeElements = canvasRef.current
      ? canvasRef.current.querySelectorAll('[data-gantt-element]').length
      : 0
    onRenderComplete({ durationMs: performance.now() - mountAtRef.current, activeElements })
  }, [onRenderComplete])

  return (
    <div
      data-gantt-chart
      className={cn(
        'nx-gantt-chart flex flex-col bg-[var(--nx-workspace-bg)] text-[var(--nx-text-primary)]',
        className,
      )}
    >
      {/* 画板工具栏：粒度切换 / 依赖与关键路径开关 / 定位到今天（tasks 1.3 / 1.7） */}
      <div
        className="flex shrink-0 items-center gap-1 border-b border-[var(--nx-border-hairline)] px-2 py-1.5"
        data-gantt-toolbar
      >
        {(Object.keys(NX_GRANULARITY_LABEL) as NextGranularity[]).map((g) => (
          <button
            key={g}
            type="button"
            data-gantt-granularity={g}
            aria-pressed={granularity === g}
            onClick={() => setGranularity(g)}
            className={cn(
              'rounded px-2 py-0.5 text-xs transition-colors',
              granularity === g
                ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]'
                : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
            )}
          >
            {NX_GRANULARITY_LABEL[g]}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-[var(--nx-border-hairline)]" aria-hidden />
        <button
          type="button"
          data-gantt-critical-toggle
          aria-pressed={showCriticalPath}
          title="高亮决定完工日的依赖主链（从最晚完成的任务沿前置依赖往回追）"
          onClick={toggleShowCriticalPath}
          className={cn(
            'shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-xs',
            showCriticalPath
              ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-space-cyan)]'
              : 'text-[var(--nx-text-muted)]',
          )}
        >
          关键路径
        </button>
        <button
          type="button"
          data-gantt-all-deps-toggle
          aria-pressed={showAllDependencies}
          onClick={toggleShowAllDependencies}
          className={cn(
            'shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-xs',
            showAllDependencies
              ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-space-cyan)]'
              : 'text-[var(--nx-text-muted)]',
          )}
        >
          全部依赖
        </button>
        <span className="mx-1 h-4 w-px bg-[var(--nx-border-hairline)]" aria-hidden />
        <button
          type="button"
          data-gantt-today-button
          onClick={() => focusToday()}
          className="shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
        >
          定位到今天
        </button>
        {chainBreak ? (
          <span
            data-gantt-chain-break
            className="ml-auto flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--nx-status-warning)]"
          >
            <span className="truncate">
              主链共 {drivingChain.taskIds.size} 个任务，追到「{chainBreak.name}
              」就断了：它没有前置依赖。补上依赖后主链才完整
            </span>
            <button
              type="button"
              data-gantt-chain-break-locate
              onClick={() => focusTask(chainBreak.id)}
              className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]"
            >
              定位
            </button>
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左侧任务名列：与画布纵向同步滚动（只渲染可见行），画布里的条再短也知道是哪个任务 */}
        <div
          data-gantt-name-pane
          aria-hidden
          className="relative hidden w-[220px] shrink-0 overflow-hidden border-r border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] sm:block"
        >
          <div
            className="absolute inset-x-0 top-0 z-10 flex items-end border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-3 pb-1.5 text-[11px] text-[var(--nx-text-muted)]"
            style={{ height: NX_TIME_AXIS_HEIGHT }}
          >
            任务（按计划开始）
          </div>
          <div
            className="absolute inset-x-0"
            style={{ top: NX_TIME_AXIS_HEIGHT - viewport.scrollTop, height: chartHeight }}
          >
            {model.tasks.slice(visibleRows.startRow, visibleRows.endRow + 1).map((task, offset) => {
              const index = visibleRows.startRow + offset
              return (
                <button
                  key={task.id}
                  type="button"
                  tabIndex={-1}
                  data-gantt-name-row
                  data-gantt-name-task-id={task.id}
                  onMouseEnter={() => setHoveredTaskId(task.id)}
                  onMouseLeave={() => setHoveredTaskId(null)}
                  onClick={() => {
                    setSelectedTaskId(task.id)
                    if (task.id > 0 && onOpenTask) onOpenTask(task.id)
                  }}
                  title={task.id > 0 && onOpenTask ? `${task.name}（打开任务详情）` : task.name}
                  className={cn(
                    'absolute inset-x-0 flex items-center gap-2 px-3 text-left text-xs',
                    hoveredTaskId === task.id || selectedTaskId === task.id
                      ? 'bg-[var(--nx-bg-2)] text-[var(--nx-text-primary)]'
                      : 'text-[var(--nx-text-secondary)]',
                  )}
                  style={{
                    top: nxRowTop(scale, index),
                    height: scale.rowHeight,
                    paddingLeft: 12 + task.depth * 12,
                  }}
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(${NEXT_STATUS_HAIRLINE_TOKEN[task.status]})` }}
                  />
                  <span className="min-w-0 flex-1 truncate">{task.name}</span>
                  {task.assignee?.initials ? (
                    <span className="shrink-0 text-[10px] text-[var(--nx-text-muted)]">
                      {task.assignee.initials}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        {/* 滚动视口：表头 sticky 常驻，纵向滚动；画布随内容横向位移 */}
        <div
          ref={scrollRef}
          data-gantt-viewport
          onScroll={onScroll}
          className="relative overflow-auto"
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
        >
          <WorkspaceGanttTimeAxis
            scale={scale}
            timeRange={timeRange}
            scrollLeft={viewport.scrollLeft}
            viewportWidth={viewport.width}
          />
          <svg
            ref={canvasRef}
            width={chartWidth}
            height={chartHeight}
            data-gantt-canvas
            role="img"
            aria-label="甘特排程画板"
          >
            <Group data-gantt-layer="grid">
              <WorkspaceGanttGridLayer
                scale={scale}
                chartHeight={chartHeight}
                visibleDays={visibleDays}
                todayDay={todayDay}
                todayLabel={`${todayIso} 今天`}
              />
            </Group>
            <Group data-gantt-layer="dependencies">
              <WorkspaceGanttDependencyLayer
                model={model}
                scale={scale}
                visibleRows={visibleRows}
                visibleDays={visibleDays}
                showAllDependencies={showAllDependencies}
                showCriticalPath={showCriticalPath}
                focusedTaskId={hoveredTaskId ?? selectedTaskId}
                drivingDepIds={drivingChain.depIds}
              />
            </Group>
            <Group data-gantt-layer="bars">
              <WorkspaceGanttBarsLayer
                model={nextModel}
                scale={scale}
                rowIndex={rowIndex}
                visibleRows={visibleRows}
                visibleDays={visibleDays}
                hoveredTaskId={hoveredTaskId}
                selectedTaskId={selectedTaskId}
                onTaskHover={setHoveredTaskId}
                onTaskSelect={setSelectedTaskId}
                onTaskOpen={onOpenTask}
                getMoveHandleProps={getMoveHandleProps}
                getResizeHandleProps={getResizeHandleProps}
                getMilestoneHandleProps={getMilestoneHandleProps}
                ghost={ghost}
                chainTaskIds={drivingChain.taskIds}
                todayDay={todayDay}
              />
            </Group>
          </svg>
        </div>
      </div>
    </div>
  )
}
