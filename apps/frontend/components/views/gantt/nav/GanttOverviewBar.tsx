'use client'

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { GanttModel } from '@/lib/gantt/types'

export interface BaselineDeviationSummary {
  early: number
  late: number
  unchanged: number
  added: number
  deleted: number
}

interface GanttOverviewBarProps {
  model: GanttModel
  /** 当前可见时间窗（天偏移）。 */
  visibleDayRange: { startDay: number; endDay: number }
  baselineSummary?: BaselineDeviationSummary
  /** 拖动/点击概览条时把该天置于视口中心（只改视口，design D5）。 */
  onNavigateToDay: (day: number) => void
}

const BUCKETS = 60
const VIEWBOX_W = 1000
const VIEWBOX_H = 40

/**
 * 甘特概览条 / mini-map（task 4.4 / design D5）。只读展示：任务密度、关键路径范围、当前视口窗、
 * 基线偏差摘要。点击或拖动**只改变视口**（`onNavigateToDay`），禁止产生任何 preview / 排程 / 依赖写入。
 */
export function GanttOverviewBar({
  model,
  visibleDayRange,
  baselineSummary,
  onNavigateToDay,
}: GanttOverviewBarProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
  const { startDay, endDay } = model.timeRange
  const span = Math.max(1, endDay - startDay)

  const dayToUnit = (day: number) => ((day - startDay) / span) * VIEWBOX_W

  // 任务密度直方图：按 startDay 分桶计数（含里程碑外的叶子任务与阶段）。
  const density = useMemo(() => {
    const buckets = new Array(BUCKETS).fill(0)
    for (const task of model.tasks) {
      const idx = Math.min(
        BUCKETS - 1,
        Math.max(0, Math.floor(((task.startDay - startDay) / span) * BUCKETS)),
      )
      buckets[idx] += 1
    }
    const max = Math.max(1, ...buckets)
    return buckets.map((count) => count / max)
  }, [model.tasks, span, startDay])

  const critical = useMemo(() => {
    const tasks = model.tasks.filter((t) => t.isCritical || t.isOnLongestPath)
    if (tasks.length === 0) return null
    let lo = Infinity
    let hi = -Infinity
    for (const t of tasks) {
      lo = Math.min(lo, t.startDay)
      hi = Math.max(hi, t.startDay + Math.max(0, t.durationDays))
    }
    return { lo, hi }
  }, [model.tasks])

  const bucketW = VIEWBOX_W / BUCKETS

  const clientXToDay = (clientX: number): number => {
    const el = svgRef.current
    if (!el) return startDay
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(startDay + ratio * span)
  }

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
    onNavigateToDay(clientXToDay(event.clientX))
  }
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    onNavigateToDay(clientXToDay(event.clientX))
  }
  const endDrag = () => setDragging(false)
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const current = Math.round((visibleDayRange.startDay + visibleDayRange.endDay) / 2)
    const step = event.shiftKey ? 14 : 7
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      onNavigateToDay(
        Math.max(startDay, Math.min(endDay, current + (event.key === 'ArrowRight' ? step : -step))),
      )
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      onNavigateToDay(startDay)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      onNavigateToDay(endDay)
    }
  }

  const viewLeft = dayToUnit(visibleDayRange.startDay)
  const viewRight = dayToUnit(visibleDayRange.endDay)
  const viewWidth = Math.max(4, viewRight - viewLeft)

  const deviationLabel = baselineSummary
    ? `基线：提前 ${baselineSummary.early} · 滞后 ${baselineSummary.late}`
    : null

  return (
    <div className="flex items-center gap-2 border-t border-border bg-gray-50 px-3 py-1.5">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="none"
        className="h-9 flex-1 cursor-pointer rounded-[var(--radius-sm)] border border-border bg-gray-0"
        role="slider"
        aria-label="甘特时间概览，拖动改变可见范围"
        aria-valuemin={startDay}
        aria-valuemax={endDay}
        aria-valuenow={Math.round((visibleDayRange.startDay + visibleDayRange.endDay) / 2)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        {/* 关键路径范围带 */}
        {critical ? (
          <rect
            x={dayToUnit(critical.lo)}
            y={0}
            width={Math.max(2, dayToUnit(critical.hi) - dayToUnit(critical.lo))}
            height={VIEWBOX_H}
            fill="var(--danger)"
            opacity={0.08}
            data-gantt-overview-critical
          />
        ) : null}
        {/* 任务密度直方图 */}
        {density.map((h, i) =>
          h > 0 ? (
            <rect
              key={i}
              x={i * bucketW + 0.5}
              y={VIEWBOX_H * (1 - h)}
              width={bucketW - 1}
              height={VIEWBOX_H * h}
              fill="var(--primary-400)"
              opacity={0.55}
            />
          ) : null,
        )}
        {/* 当前视口窗 */}
        <rect
          x={viewLeft}
          y={1}
          width={viewWidth}
          height={VIEWBOX_H - 2}
          fill="var(--primary-500)"
          opacity={0.14}
          stroke="var(--primary-500)"
          strokeWidth={1.5}
          data-gantt-overview-viewport
        />
      </svg>
      {deviationLabel ? (
        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted">{deviationLabel}</span>
      ) : null}
    </div>
  )
}

export default GanttOverviewBar
