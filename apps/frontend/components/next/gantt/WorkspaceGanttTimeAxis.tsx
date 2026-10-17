/**
 * 新轨甘特镜头（v3-ui-next-gantt-lens W1 tasks 1.3）—— Layer 0 多粒度时间刻度标尺。
 *
 * 日（单元格 40px）/ 周（80px）/ 月（≈120px）三档粒度由 `stores/gantt-store.ts` 的
 * `granularity` 状态驱动（外层 WorkspaceGanttChart 消费后传入）；标尺消费
 * `--nx-workspace-bg` 冷黑曜石背景与 `--nx-border-hairline` 1px 发丝线（design D18 方案 A）。
 * 表头通过 `position: sticky; top: 0` 常驻，横向随视口滚动位移同步，纵向不随滚动滚出。
 * 刻度只实例化视口窗口内的 tick（±8px 缓冲），活动 DOM 严格受控。
 */

'use client'

import { memo } from 'react'
import { cn } from '@/lib/utils'
import {
  NX_TIME_AXIS_HEIGHT,
  buildNextTicks,
  nxChartWidth,
  type NextAxisTick,
  type NextGanttScale,
} from '@/lib/gantt/next-gantt-adapter'

export interface WorkspaceGanttTimeAxisProps {
  scale: NextGanttScale
  timeRange: { startDay: number; endDay: number }
  scrollLeft: number
  viewportWidth: number
  className?: string
}

/** 表头底边发丝线 y 坐标（SVG 内绝对）。 */
const AXIS_BOTTOM = NX_TIME_AXIS_HEIGHT - 0.5

function TickLine({ isMajor, x }: { isMajor: boolean; x: number }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={isMajor ? 0 : NX_TIME_AXIS_HEIGHT - 20}
      y2={AXIS_BOTTOM}
      stroke="var(--nx-border-hairline)"
      strokeWidth={1}
    />
  )
}

function TickLabel({ tick, y, fill }: { tick: NextAxisTick; y: number; fill?: string }) {
  return (
    <text x={tick.x + 5} y={y} fontSize={11} fill={fill ?? 'var(--nx-text-secondary)'}>
      {tick.label}
    </text>
  )
}

export const WorkspaceGanttTimeAxis = memo(function WorkspaceGanttTimeAxis({
  scale,
  timeRange,
  scrollLeft,
  viewportWidth,
  className,
}: WorkspaceGanttTimeAxisProps) {
  const width = nxChartWidth(scale)
  const windowStart = Math.max(timeRange.startDay, Math.floor(scrollLeft / scale.pxPerDay) - 2)
  const windowEnd = Math.min(
    timeRange.endDay,
    Math.ceil((scrollLeft + viewportWidth) / scale.pxPerDay) + 2,
  )
  const { major, minor } = buildNextTicks(scale, { startDay: windowStart, endDay: windowEnd })
  const inWindow = (x: number): boolean =>
    x >= scrollLeft - 8 && x <= scrollLeft + viewportWidth + 8
  const visibleMajor = major.filter((t) => inWindow(t.x))
  const visibleMinor = minor.filter((t) => inWindow(t.x))

  return (
    <div
      className={cn(
        'nx-gantt-axis z-20 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]',
        className,
      )}
      data-gantt-time-axis
      style={{ width, position: 'sticky', top: 0 }}
    >
      <svg
        width={width}
        height={NX_TIME_AXIS_HEIGHT}
        role="img"
        aria-label="甘特时间刻度标尺"
        data-gantt-axis-svg
      >
        {visibleMajor.map((tick) => (
          <g key={`major-${tick.day}`} data-gantt-axis-tick data-gantt-tick-band="major">
            <TickLine isMajor x={tick.x} />
            <TickLabel tick={tick} y={16} fill="var(--nx-text-primary)" />
          </g>
        ))}
        {visibleMinor.map((tick) => (
          <g key={`minor-${tick.day}`} data-gantt-axis-tick data-gantt-tick-band="minor">
            <TickLine isMajor={false} x={tick.x} />
            <TickLabel
              tick={tick}
              y={35}
              fill={tick.weekend ? 'var(--nx-status-danger)' : undefined}
            />
          </g>
        ))}
        {/* 表头底边 1px 发丝线 */}
        <line
          x1={0}
          x2={width}
          y1={AXIS_BOTTOM}
          y2={AXIS_BOTTOM}
          stroke="var(--nx-border-hairline)"
          strokeWidth={1}
        />
      </svg>
    </div>
  )
})
