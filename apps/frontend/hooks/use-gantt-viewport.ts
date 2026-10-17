'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from 'react'
import {
  chartHeight,
  chartWidth,
  createScale,
  dayToX,
  xToDay,
  type GanttScale,
} from '@/lib/gantt/geometry'
import type { GanttGranularity, GanttModel } from '@/lib/gantt/types'
import { useUiStore } from '@/stores/ui-store'

/** 密度 → 甘特行高（px）。与 `--row-h`（表格 52/36）正交：甘特行更紧凑但仍随密度降档。 */
const ROW_HEIGHT_BY_DENSITY = { comfortable: 34, compact: 26 } as const

/** 窗口上下各多渲染的缓冲行数。 */
const WINDOW_BUFFER_ROWS = 24
/** 移窗阈值：滚动超过锚点这么多行才重算窗口（＜缓冲，保证不露白）。 */
const SHIFT_THRESHOLD_ROWS = 12

export interface GanttViewport {
  scale: GanttScale
  rowHeight: number
  chartWidth: number
  chartHeight: number
  totalRows: number
  /** 当前窗口的可见行（含缓冲）：{ index, start }。**窗口间引用稳定**，令下游 memo 可跳过。 */
  virtualRows: { index: number; start: number }[]
  /** 当前横向滚动量（rAF 节流）。 */
  scrollLeft: number
  scrollTop: number
  /** 可见视口宽/高（用于时间窗裁剪）。 */
  viewportWidth: number
  viewportHeight: number
  /** 可见时间窗（天偏移），供依赖线/超长条裁剪；引用稳定（scrollLeft/宽度不变时）。 */
  visibleDayRange: { startDay: number; endDay: number }
  onScroll: (e: UIEvent<HTMLDivElement>) => void
  /** 命令式导航：横向滚动到某天并居中（design D5，只改视口）。 */
  scrollToDay: (day: number) => void
  /** 命令式导航：滚动到某任务所在行与其起始日并居中；未知任务为 no-op。 */
  scrollToTask: (taskId: number) => void
  /** 命令式导航：把一段时间窗尽量居中显示（超宽则对齐起点）。 */
  scrollToRange: (startDay: number, endDay: number) => void
}

/**
 * 甘特视口状态（design D8：脱离 React 渲染循环）。行虚拟化改为**阈值窗口**：只渲染窗口内的行
 * （含缓冲，spec 3.5），且窗口只在滚动越过阈值时重算——窗口间 `virtualRows` 引用稳定，使
 * `GanttBarsLayer`/`GanttLeftColumn` 在多数滚动帧 memo-skip、不逐帧重建 SVG 行（Group 6）。
 * 横向滚动量经 `requestAnimationFrame` 节流入态，供依赖 Canvas 层平移与横向裁剪。
 */
export function useGanttViewport(
  model: GanttModel,
  granularity: GanttGranularity,
  scrollRef: RefObject<HTMLDivElement | null>,
): GanttViewport {
  const density = useUiStore((s) => s.density)
  const rowHeight = ROW_HEIGHT_BY_DENSITY[density]

  // scale 记忆化：仅在 粒度/行高/epoch 变化时新建，稳定下游几何缓存的 memo 依赖。
  const scale = useMemo(
    () => createScale(granularity, { rowHeight, epochMs: model.epochMs }),
    [granularity, rowHeight, model.epochMs],
  )
  const spanDays = model.timeRange.endDay - model.timeRange.startDay
  const totalRows = model.tasks.length
  const width = chartWidth(scale, spanDays)
  const height = chartHeight(scale, totalRows)

  // 横向滚动量 + 视口尺寸（rAF 节流）。scrollTop 不入此态——垂直滚动只驱动窗口阈值与 Canvas 平移。
  const [scroll, setScroll] = useState({ left: 0, top: 0, width: 0, height: 0 })
  // 窗口顶行索引，仅在越过阈值时更新（低频），使 virtualRows 引用在窗口间稳定。
  const [windowStart, setWindowStart] = useState(0)
  const rafRef = useRef(0)

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        setScroll({
          left: el.scrollLeft,
          top: el.scrollTop,
          width: el.clientWidth,
          height: el.clientHeight,
        })
        const firstVisible = Math.floor(el.scrollTop / rowHeight)
        const desiredStart = Math.max(0, firstVisible - WINDOW_BUFFER_ROWS)
        setWindowStart((prev) =>
          Math.abs(desiredStart - prev) >= SHIFT_THRESHOLD_ROWS ? desiredStart : prev,
        )
      })
    },
    [rowHeight],
  )

  // 初次挂载测量视口尺寸（无滚动事件时也需正确的 viewport）。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setScroll((s) => ({ ...s, width: el.clientWidth, height: el.clientHeight }))
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [scrollRef])

  // 窗口行数＝可见行 + 上下缓冲。viewportHeight 变化（resize）才重算。
  // 未测量视口时用保守默认高度（勿回落到全图高度，否则首帧挂满 1000 行）。
  const windowRows = useMemo(() => {
    const visibleCount = Math.ceil((scroll.height || 800) / rowHeight)
    return visibleCount + WINDOW_BUFFER_ROWS * 2
  }, [scroll.height, rowHeight])

  // virtualRows：窗口内行，引用仅随 windowStart/windowRows/总行/行高变化——垂直滚动帧间稳定。
  const virtualRows = useMemo(() => {
    const start = Math.min(windowStart, Math.max(0, totalRows - 1))
    const end = Math.min(totalRows, start + windowRows)
    const rows: { index: number; start: number }[] = []
    for (let i = start; i < end; i++) rows.push({ index: i, start: i * rowHeight })
    return rows
  }, [windowStart, windowRows, totalRows, rowHeight])

  // visibleDayRange：引用仅随 scale/scrollLeft/宽度变化——垂直滚动时稳定，令 bars memo 可跳过。
  const visibleDayRange = useMemo(
    () => ({
      startDay: Math.floor(xToDay(scale, scroll.left)),
      endDay: Math.ceil(xToDay(scale, scroll.left + (scroll.width || width))),
    }),
    [scale, scroll.left, scroll.width, width],
  )

  // 命令式导航（design D5）：直接改 scroll 元素位置，只移视口不动数据；onScroll 随后同步派生态。
  const scrollToDay = useCallback(
    (day: number) => {
      const el = scrollRef.current
      if (!el) return
      const target = dayToX(scale, day) - el.clientWidth / 2
      el.scrollLeft = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth))
    },
    [scale, scrollRef],
  )

  const scrollToRange = useCallback(
    (startDay: number, endDay: number) => {
      const el = scrollRef.current
      if (!el) return
      const startX = dayToX(scale, startDay)
      const endX = dayToX(scale, Math.max(startDay, endDay))
      const spanPx = endX - startX
      // 时间窗能放下则居中，放不下则对齐起点（左内边距）。
      const target = spanPx <= el.clientWidth ? startX - (el.clientWidth - spanPx) / 2 : startX - 24
      el.scrollLeft = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth))
    },
    [scale, scrollRef],
  )

  const scrollToTask = useCallback(
    (taskId: number) => {
      const el = scrollRef.current
      if (!el) return
      const index = model.tasks.findIndex((t) => t.id === taskId)
      const task = index >= 0 ? model.tasks[index] : undefined
      if (!task) return
      const targetTop = index * rowHeight - el.clientHeight / 2 + rowHeight / 2
      el.scrollTop = Math.max(0, Math.min(targetTop, el.scrollHeight - el.clientHeight))
      scrollToDay(task.startDay + Math.max(0, task.durationDays) / 2)
    },
    [model.tasks, rowHeight, scrollRef, scrollToDay],
  )

  return {
    scale,
    rowHeight,
    chartWidth: width,
    chartHeight: height,
    totalRows,
    virtualRows,
    scrollLeft: scroll.left,
    scrollTop: scroll.top,
    viewportWidth: scroll.width,
    viewportHeight: scroll.height,
    visibleDayRange,
    onScroll,
    scrollToDay,
    scrollToTask,
    scrollToRange,
  }
}
