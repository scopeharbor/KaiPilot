'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StoreApi, UseBoundStore } from 'zustand'
import { dateToDay, DEFAULT_LEFT_COLUMN_WIDTH, TIME_AXIS_HEIGHT } from '@/lib/gantt/geometry'
import { getEntryPreset } from '@/lib/gantt/entry-presets'
import {
  buildBarBoxes,
  buildDepEndpoints,
  buildRowIndex,
  DependencyIndex,
} from '@/lib/gantt/dependency-index'
import type {
  GanttEntry,
  GanttGranularity,
  GanttModel,
  GanttScheduleDraft,
} from '@/lib/gantt/types'
import {
  availableModes,
  resolveMode,
  type GanttDependencyDraft,
  type GanttInteractionMode,
  type GanttMilestoneDateDraft,
  type GanttProgressDraft,
} from '@/lib/gantt/interaction-types'
import { useGanttViewport } from '@/hooks/use-gantt-viewport'
import { useGanttStore, type GanttViewState } from '@/stores/gantt-store'
import { cn } from '@/lib/utils'
import { GanttTimeAxis } from './GanttTimeAxis'
import { GanttGridLayer } from './GanttGridLayer'
import { GanttBarsLayer } from './GanttBarsLayer'
import { GanttLeftColumn } from './GanttLeftColumn'
import { GanttDependencyLayer } from '../dependency/GanttDependencyLayer'
import { GanttNavControls } from '../nav/GanttNavControls'
import { GanttOverviewBar, type BaselineDeviationSummary } from '../nav/GanttOverviewBar'

const DEP_PX_BUFFER = 240

type GanttStoreHook = UseBoundStore<StoreApi<GanttViewState>>

export interface GanttChartProps {
  model: GanttModel
  /** 注入独立 store（dev harness 用）；默认应用级单例。 */
  store?: GanttStoreHook
  /** 今日天偏移覆盖（测试用）；默认由真实时间计算。 */
  todayDayOverride?: number | null
  className?: string
  editable?: boolean
  dependencyEditable?: boolean
  onScheduleDraft?: (draft: GanttScheduleDraft) => void
  onDependencyDraft?: (draft: GanttDependencyDraft) => void
  onMilestoneDraft?: (draft: GanttMilestoneDateDraft) => void
  onProgressDraft?: (draft: GanttProgressDraft) => void
  onTaskSelect?: (taskId: number) => void
  /** 工具栏右侧额外操作区（里程碑管理、基线、导出等由页面注入，保持渲染核无数据耦合）。 */
  toolbarExtra?: ReactNode
  /** 概览条基线偏差摘要（页面派生注入）；缺省时概览条不显示基线文字。 */
  baselineSummary?: BaselineDeviationSummary
}

const GRANULARITIES: { value: GanttGranularity; label: string }[] = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'quarter', label: '季' },
]

const ENTRIES: { value: GanttEntry; label: string }[] = [
  { value: 'standard', label: '标准' },
  { value: 'simplified', label: '简化' },
]

const MODE_LABELS: Record<GanttInteractionMode, string> = {
  select: '选择',
  schedule: '改期',
  dependency: '依赖',
  progress: '进度',
  baselineInspect: '基线',
}

/**
 * 甘特渲染核编排（T018）。分层脏重绘（design D2）：静态网格层、任务条层各自 `memo`，
 * 由版本化数据（scale/窗口/模型）判定失效；滚动经原生滚动 + rAF 节流状态更新驱动窗口重算。
 * 冻结左栏与时间轴表头按滚动量平移。双入口由 preset 决定可见性（design D6）。
 *
 * 依赖线层、悬停/拖拽层为后续 change（Group 4/6）挂载点，此处预留合成位。
 */
export function GanttChart({
  model,
  store,
  todayDayOverride,
  className,
  editable = false,
  dependencyEditable = false,
  onScheduleDraft,
  onDependencyDraft,
  onMilestoneDraft,
  onProgressDraft,
  onTaskSelect,
  toolbarExtra,
  baselineSummary,
}: GanttChartProps) {
  const useStore = store ?? useGanttStore
  const granularity = useStore((s) => s.granularity)
  const setGranularity = useStore((s) => s.setGranularity)
  const entry = useStore((s) => s.entry)
  const setEntry = useStore((s) => s.setEntry)
  const hoveredTaskId = useStore((s) => s.hoveredTaskId)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)
  const toggleSelection = useStore((s) => s.toggleSelection)
  const focusTaskId = useStore((s) => s.focusTaskId)
  const setFocusTaskId = useStore((s) => s.setFocusTaskId)
  const setHoveredTaskId = useStore((s) => s.setHoveredTaskId)
  const setSelectedTaskId = useStore((s) => s.setSelectedTaskId)
  const showAllDependencies = useStore((s) => s.showAllDependencies)
  const toggleShowAllDependencies = useStore((s) => s.toggleShowAllDependencies)
  const showProblemChain = useStore((s) => s.showProblemChain)
  const toggleShowProblemChain = useStore((s) => s.toggleShowProblemChain)
  const navigationTarget = useStore((s) => s.navigationTarget)
  const clearNavigation = useStore((s) => s.clearNavigation)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)

  // 只读降级：无编辑权限时把可选模式收敛为查看类，并把当前模式回落到安全值（design D3 / task 5.1）。
  const modeOptions = availableModes(editable, dependencyEditable)
  const effectiveMode = resolveMode(mode, editable, dependencyEditable)

  const preset = getEntryPreset(entry)
  const scrollRef = useRef<HTMLDivElement>(null)
  const vp = useGanttViewport(model, granularity, scrollRef)

  const todayDay =
    todayDayOverride !== undefined ? todayDayOverride : dateToDay(vp.scale, Date.now())
  // 导航「今天」始终跳真实今天（todayDayOverride 可能被测试置 null 以隐藏今日线）。
  const navTodayDay = todayDay ?? dateToDay(vp.scale, Date.now())

  // 消费外部导航请求（store.navigationTarget，design D5）：解析为视口命令后清空，只移视口不改数据。
  const { scrollToDay, scrollToTask, scrollToRange } = vp
  useEffect(() => {
    if (!navigationTarget) return
    const criticalTasks = model.tasks.filter((t) => t.isCritical || t.isOnLongestPath)
    switch (navigationTarget.kind) {
      case 'today':
        scrollToDay(navTodayDay)
        break
      case 'project-start':
        scrollToDay(model.timeRange.startDay)
        break
      case 'project-end':
        scrollToDay(model.timeRange.endDay)
        break
      case 'task':
        scrollToTask(navigationTarget.taskId)
        break
      case 'day':
        scrollToDay(navigationTarget.day)
        break
      case 'range':
        scrollToRange(navigationTarget.startDay, navigationTarget.endDay)
        break
      case 'critical-start':
        if (criticalTasks.length)
          scrollToTask(criticalTasks.reduce((a, b) => (b.startDay < a.startDay ? b : a)).id)
        break
      case 'critical-end':
        if (criticalTasks.length)
          scrollToTask(
            criticalTasks.reduce((a, b) =>
              b.startDay + b.durationDays > a.startDay + a.durationDays ? b : a,
            ).id,
          )
        break
    }
    clearNavigation()
  }, [
    navigationTarget,
    model,
    navTodayDay,
    scrollToDay,
    scrollToTask,
    scrollToRange,
    clearNavigation,
  ])

  // 依赖线几何缓存与空间索引（4.7/4.2）：仅在 scale/模型/行序变化时重建，滚动复用。
  const rowIndexByTask = useMemo(() => buildRowIndex(model.tasks), [model.tasks])
  const barBoxes = useMemo(() => buildBarBoxes(vp.scale, model.tasks), [vp.scale, model.tasks])
  const depEndpoints = useMemo(
    () => buildDepEndpoints(vp.scale, model.dependencies, barBoxes),
    [vp.scale, model.dependencies, barBoxes],
  )
  const depIndex = useMemo(
    () => new DependencyIndex(model.dependencies, rowIndexByTask),
    [model.dependencies, rowIndexByTask],
  )
  // 问题任务集（受阻/逾期）：受阻取状态；逾期需基线（task 2.4 就绪后并入）。
  const problemTaskIds = useMemo(
    () => new Set(model.tasks.filter((t) => t.status === 'blocked').map((t) => t.id)),
    [model.tasks],
  )

  // 视口派生量（供依赖可见性引擎）：可见行集合、行区间、像素窗。
  const visibleRowSet = useMemo(() => new Set(vp.virtualRows.map((r) => r.index)), [vp.virtualRows])
  const rowRange = useMemo(() => {
    if (vp.virtualRows.length === 0) return { minRow: 0, maxRow: 0 }
    const idx = vp.virtualRows.map((r) => r.index)
    return { minRow: Math.min(...idx), maxRow: Math.max(...idx) }
  }, [vp.virtualRows])
  const pxRange = useMemo(
    () => ({
      minX: vp.scrollLeft - DEP_PX_BUFFER,
      maxX: vp.scrollLeft + (vp.viewportWidth || vp.chartWidth) + DEP_PX_BUFFER,
    }),
    [vp.scrollLeft, vp.viewportWidth, vp.chartWidth],
  )

  const [expandedBadges, setExpandedBadges] = useState<Set<string>>(() => new Set())
  const onToggleBadge = useCallback((key: string) => {
    setExpandedBadges((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  const selectTask = useCallback(
    (taskId: number, options?: { toggle?: boolean; range?: boolean }) => {
      if (options?.range && selectedTaskId !== null) {
        const from = model.tasks.findIndex((task) => task.id === selectedTaskId)
        const to = model.tasks.findIndex((task) => task.id === taskId)
        if (from >= 0 && to >= 0) {
          const [lo, hi] = from < to ? [from, to] : [to, from]
          setSelection(model.tasks.slice(lo, hi + 1).map((task) => task.id))
        }
      } else if (options?.toggle) {
        toggleSelection(taskId)
      } else {
        setSelection([taskId])
      }
      setSelectedTaskId(taskId)
      setFocusTaskId(taskId)
      onTaskSelect?.(taskId)
    },
    [
      model.tasks,
      onTaskSelect,
      selectedTaskId,
      setFocusTaskId,
      setSelectedTaskId,
      setSelection,
      toggleSelection,
    ],
  )

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-gray-0',
        className,
      )}
      data-gantt-entry={entry}
    >
      {/* 工具条：入口切换 + 粒度切换（数据不变、仅重排坐标/切可见性 preset）。 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="inline-flex overflow-hidden rounded-[var(--radius-md)] border border-border"
            role="group"
            aria-label="甘特入口"
          >
            {ENTRIES.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => setEntry(e.value)}
                className={cn(
                  'px-3 py-1 text-sm transition-colors',
                  entry === e.value
                    ? 'bg-primary-500 text-gray-0'
                    : 'bg-gray-0 text-foreground hover:bg-gray-50',
                )}
                aria-pressed={entry === e.value}
                aria-label={`切换到${e.label}甘特入口`}
              >
                {e.label}
              </button>
            ))}
          </div>
          <div
            className="inline-flex overflow-hidden rounded-[var(--radius-md)] border border-border"
            role="group"
            aria-label="交互模式"
          >
            {modeOptions.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'px-3 py-1 text-sm transition-colors',
                  effectiveMode === m
                    ? 'bg-primary-500 text-gray-0'
                    : 'bg-gray-0 text-foreground hover:bg-gray-50',
                )}
                aria-pressed={effectiveMode === m}
                aria-label={`切换到${MODE_LABELS[m]}模式`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <div
            className="inline-flex overflow-hidden rounded-[var(--radius-md)] border border-border"
            role="group"
            aria-label="时间粒度"
          >
            {GRANULARITIES.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setGranularity(g.value)}
                className={cn(
                  'px-3 py-1 text-sm transition-colors',
                  granularity === g.value
                    ? 'bg-primary-500 text-gray-0'
                    : 'bg-gray-0 text-foreground hover:bg-gray-50',
                )}
                aria-pressed={granularity === g.value}
                aria-label={`切换到${g.label}视图时间粒度`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <GanttNavControls
            model={model}
            todayDay={navTodayDay}
            selectedTaskId={selectedTaskId}
            onScrollToDay={vp.scrollToDay}
            onScrollToTask={vp.scrollToTask}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={toggleShowProblemChain}
            disabled={problemTaskIds.size === 0}
            title={problemTaskIds.size === 0 ? '当前无受阻或逾期任务' : undefined}
            className={cn(
              'rounded-[var(--radius-md)] border px-3 py-1 text-sm transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              showProblemChain
                ? 'border-warning bg-warning-bg text-warning'
                : 'border-border bg-gray-0 text-muted hover:bg-gray-50',
            )}
            aria-pressed={showProblemChain}
            aria-label={`${showProblemChain ? '隐藏' : '显示'}问题链叠加层`}
          >
            问题链
          </button>
          {preset.offerShowAllDependencies ? (
            <button
              type="button"
              onClick={toggleShowAllDependencies}
              disabled={model.dependencies.length === 0}
              title={model.dependencies.length === 0 ? '当前项目暂无任务依赖' : undefined}
              className={cn(
                'rounded-[var(--radius-md)] border px-3 py-1 text-sm transition-colors',
                'disabled:cursor-not-allowed disabled:opacity-50',
                showAllDependencies
                  ? 'border-primary-300 bg-primary-50 text-primary-700'
                  : 'border-border bg-gray-0 text-muted hover:bg-gray-50',
              )}
              aria-pressed={showAllDependencies}
              aria-label={`${showAllDependencies ? '隐藏' : '显示'}全部依赖叠加层`}
            >
              显示全部依赖
            </button>
          ) : null}
          {!editable && !dependencyEditable ? (
            <span
              className="rounded-[var(--radius-md)] border border-border bg-gray-50 px-2 py-1 text-xs text-muted"
              role="note"
            >
              只读模式：无编辑权限
            </span>
          ) : null}
          <span className="text-xs text-muted">
            {model.tasks.filter((task) => task.milestoneId === undefined).length} 任务 ·{' '}
            {model.dependencies.length} 依赖
          </span>
          {toolbarExtra}
        </div>
      </div>

      {/* 表头行：左上角占位 + 时间轴（随横向滚动平移）。 */}
      <div className="flex shrink-0 border-b border-border" style={{ height: TIME_AXIS_HEIGHT }}>
        <div
          className="shrink-0 border-r border-border bg-gray-50"
          style={{ width: DEFAULT_LEFT_COLUMN_WIDTH }}
        />
        <div className="relative flex-1 overflow-hidden bg-gray-50">
          <div style={{ transform: `translateX(${-vp.scrollLeft}px)`, willChange: 'transform' }}>
            <GanttTimeAxis
              scale={vp.scale}
              range={model.timeRange}
              width={vp.chartWidth}
              scrollLeft={vp.scrollLeft}
              viewportWidth={vp.viewportWidth}
            />
          </div>
        </div>
      </div>

      {/* 主体：冻结左栏（随纵向滚动平移）+ 双轴滚动图表体。 */}
      <div className="flex min-h-0 flex-1">
        <div
          className="shrink-0 overflow-hidden border-r border-border bg-gray-0"
          style={{ width: DEFAULT_LEFT_COLUMN_WIDTH }}
        >
          <div style={{ transform: `translateY(${-vp.scrollTop}px)`, willChange: 'transform' }}>
            <GanttLeftColumn
              tasks={model.tasks}
              visibleRows={vp.virtualRows}
              rowHeight={vp.rowHeight}
              totalHeight={vp.chartHeight}
              showWbsCode={preset.showWbsCode}
              showAssigneeAvatar={preset.showAssigneeAvatar}
              hoveredTaskId={hoveredTaskId}
              selectedTaskId={selectedTaskId}
              onHover={setHoveredTaskId}
              onSelect={selectTask}
            />
          </div>
        </div>

        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={vp.onScroll}
            data-gantt-scroll
            className="absolute inset-0 overflow-auto"
          >
            <div className="relative" style={{ width: vp.chartWidth, height: vp.chartHeight }}>
              <GanttGridLayer
                scale={vp.scale}
                range={model.timeRange}
                width={vp.chartWidth}
                height={vp.chartHeight}
                scrollLeft={vp.scrollLeft}
                viewportWidth={vp.viewportWidth}
                todayDay={todayDay}
              />
              <GanttBarsLayer
                scale={vp.scale}
                tasks={model.tasks}
                milestones={model.milestones}
                visibleRows={vp.virtualRows}
                visibleDayRange={vp.visibleDayRange}
                width={vp.chartWidth}
                height={vp.chartHeight}
                entry={entry}
                hoveredTaskId={hoveredTaskId}
                selectedTaskId={selectedTaskId}
                selectedTaskIds={selection}
                focusTaskId={focusTaskId}
                onHover={setHoveredTaskId}
                onSelect={selectTask}
                onFocusTask={setFocusTaskId}
                editable={editable}
                dependencyEditable={dependencyEditable}
                mode={effectiveMode}
                onScheduleDraft={onScheduleDraft}
                onDependencyDraft={onDependencyDraft}
                onMilestoneDraft={onMilestoneDraft}
                onProgressDraft={onProgressDraft}
              />
              {/* 悬停/选中高亮层、拖拽预览层挂载点（Group 6）。 */}
            </div>
          </div>
          {/* 依赖线 Canvas 混合层（视口尺寸覆盖层，随滚动平移；pointer-events-none 不挡任务条）。 */}
          <GanttDependencyLayer
            deps={model.dependencies}
            tasks={model.tasks}
            endpoints={depEndpoints}
            index={depIndex}
            rowHeight={vp.rowHeight}
            scrollLeft={vp.scrollLeft}
            scrollTop={vp.scrollTop}
            viewportWidth={vp.viewportWidth}
            viewportHeight={vp.viewportHeight}
            visibleRows={visibleRowSet}
            rowRange={rowRange}
            pxRange={pxRange}
            dependencyDefault={preset.dependencyDefault}
            alwaysShowCriticalPath={preset.alwaysShowCriticalPath}
            showProblemChain={showProblemChain}
            problemTaskIds={problemTaskIds}
            hoveredTaskId={hoveredTaskId}
            selectedTaskId={selectedTaskId}
            showAllDependencies={showAllDependencies}
            expandedBadges={expandedBadges}
            onToggleBadge={onToggleBadge}
            onLocateTask={vp.scrollToTask}
          />
        </div>
      </div>

      {/* 概览条 / mini-map（task 4.4）：只读密度 + 关键路径范围 + 当前视口 + 基线摘要，拖动只移视口。 */}
      <GanttOverviewBar
        model={model}
        visibleDayRange={vp.visibleDayRange}
        baselineSummary={baselineSummary}
        onNavigateToDay={vp.scrollToDay}
      />
    </div>
  )
}

export default GanttChart
