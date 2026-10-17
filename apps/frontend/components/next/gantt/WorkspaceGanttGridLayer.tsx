/**
 * 新轨甘特镜头（v3-ui-next-gantt-lens W1 tasks 1.4）—— Layer 1 发丝网格与今天指示线。
 *
 * 垂直 1px 发丝线网格按粒度对齐单元格边界（日=每日、周=每 7 天、月=每 30 天，
 * 线数受控 ≤ 50）；非工作日以 `--nx-workspace-surface` 纯色阴影块标定（仅日/周粒度，
 * 月粒度天宽 4px 时隐去以免噪声）；今天指示线（`WorkspaceGanttTodayLine`）垂直贯穿
 * 画板，消费 `--nx-workspace-blue` 核心线 + `--nx-space-cyan` 发光底，顶部标定「今天」。
 */

'use client'

import { memo } from 'react'
import {
  gridStepDays,
  isWeekendDay,
  nxDayToX,
  type DayRange,
  type NextGanttScale,
} from '@/lib/gantt/next-gantt-adapter'

export interface WorkspaceGanttGridLayerProps {
  scale: NextGanttScale
  chartHeight: number
  visibleDays: DayRange
  /** 距 epoch 天偏移；null=不渲染今天线。 */
  todayDay?: number | null
  todayLabel?: string
}

/** 非工作日阴影块仅在单日像素宽 ≥ 8 的粒度下渲染（日/周），避免月粒度下细碎噪点。 */
const WEEKEND_SHADE_MIN_PX_PER_DAY = 8

/** 垂直贯穿画板的今天指示线（design Layer 1）：发光底 + 核心线 + 顶部徽标。 */
export interface WorkspaceGanttTodayLineProps {
  x: number
  chartHeight: number
  label?: string
}

export const WorkspaceGanttTodayLine = memo(function WorkspaceGanttTodayLine({
  x,
  chartHeight,
  label,
}: WorkspaceGanttTodayLineProps) {
  return (
    <g data-gantt-today-line-group>
      <line
        x1={x}
        x2={x}
        y1={0}
        y2={chartHeight}
        stroke="var(--nx-space-cyan)"
        strokeWidth={5}
        opacity={0.18}
        data-gantt-today-glow
      />
      <line
        x1={x}
        x2={x}
        y1={0}
        y2={chartHeight}
        stroke="var(--nx-workspace-blue)"
        strokeWidth={1.5}
        data-gantt-element
        data-gantt-today-line
      />
      <g data-gantt-today-badge transform={`translate(${x - 21}, 2)`}>
        <rect width={42} height={18} rx={2} fill="var(--nx-workspace-blue)" />
        <text
          x={21}
          y={13}
          textAnchor="middle"
          fontSize={11}
          fill="var(--nx-space-bg)"
          data-gantt-today-label
        >
          今天
        </text>
        {label ? <title>{label}</title> : null}
      </g>
    </g>
  )
})

export const WorkspaceGanttGridLayer = memo(function WorkspaceGanttGridLayer({
  scale,
  chartHeight,
  visibleDays,
  todayDay,
  todayLabel,
}: WorkspaceGanttGridLayerProps) {
  const startDay = Math.max(0, visibleDays.startDay)
  const step = gridStepDays(scale.granularity)
  const gridLines: number[] = []
  for (let day = startDay; day <= visibleDays.endDay; day += step) gridLines.push(day)

  const weekendShades: number[] =
    scale.pxPerDay >= WEEKEND_SHADE_MIN_PX_PER_DAY
      ? Array.from(
          { length: Math.max(0, visibleDays.endDay - startDay + 1) },
          (_, i) => startDay + i,
        ).filter((day) => isWeekendDay(scale, day))
      : []

  const showToday =
    todayDay != null && todayDay >= visibleDays.startDay - 1 && todayDay <= visibleDays.endDay + 1

  return (
    <g data-gantt-grid-layer>
      {weekendShades.map((day) => (
        <rect
          key={`wk-${day}`}
          x={nxDayToX(scale, day)}
          y={0}
          width={scale.pxPerDay}
          height={chartHeight}
          fill="var(--nx-workspace-surface)"
          opacity={0.45}
          data-gantt-element
          data-gantt-weekend-shade
        />
      ))}
      {gridLines.map((day) => (
        <line
          key={`grid-${day}`}
          x1={nxDayToX(scale, day)}
          x2={nxDayToX(scale, day)}
          y1={0}
          y2={chartHeight}
          stroke="var(--nx-border-hairline)"
          strokeWidth={1}
          data-gantt-element
          data-gantt-grid-line
        />
      ))}
      {showToday && todayDay != null ? (
        <WorkspaceGanttTodayLine
          x={nxDayToX(scale, todayDay)}
          chartHeight={chartHeight}
          label={todayLabel}
        />
      ) : null}
    </g>
  )
})
