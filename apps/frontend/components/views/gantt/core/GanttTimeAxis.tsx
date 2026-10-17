'use client'

import { memo } from 'react'
import { buildTimeTicks, TIME_AXIS_HEIGHT, type GanttScale } from '@/lib/gantt/geometry'

interface GanttTimeAxisProps {
  scale: GanttScale
  range: { startDay: number; endDay: number }
  width: number
  /** 可见横向窗口，用于只渲染视口内刻度（+缓冲）。 */
  scrollLeft: number
  viewportWidth: number
}

const TICK_BUFFER_PX = 240

/**
 * 时间轴表头（静态层的一部分，task 3.2）。刻度由 `buildTimeTicks` 生成（日/周等距、月/季对齐自然边界），
 * 仅渲染落在可见横向窗口 + 缓冲内的刻度。颜色一律走令牌，主刻度加粗。
 */
export const GanttTimeAxis = memo(function GanttTimeAxis({
  scale,
  range,
  width,
  scrollLeft,
  viewportWidth,
}: GanttTimeAxisProps) {
  const ticks = buildTimeTicks(scale, range)
  const min = scrollLeft - TICK_BUFFER_PX
  const max = scrollLeft + (viewportWidth || width) + TICK_BUFFER_PX
  const visible = ticks.filter((t) => t.x >= min && t.x <= max)

  return (
    <svg width={width} height={TIME_AXIS_HEIGHT} className="block" role="presentation" aria-hidden>
      <line
        x1={0}
        y1={TIME_AXIS_HEIGHT - 0.5}
        x2={width}
        y2={TIME_AXIS_HEIGHT - 0.5}
        stroke="var(--border-strong)"
        strokeWidth={1}
      />
      {visible.map((t) => (
        <g key={t.day} transform={`translate(${t.x},0)`}>
          <line
            x1={0}
            y1={t.major ? 8 : TIME_AXIS_HEIGHT - 14}
            x2={0}
            y2={TIME_AXIS_HEIGHT}
            stroke={t.major ? 'var(--border-strong)' : 'var(--border)'}
            strokeWidth={1}
          />
          <text
            x={4}
            y={t.major ? 20 : TIME_AXIS_HEIGHT - 16}
            fontSize={11}
            className="select-none"
            fill={t.major ? 'var(--heading)' : 'var(--muted)'}
            fontWeight={t.major ? 600 : 400}
          >
            {t.label}
          </text>
        </g>
      ))}
    </svg>
  )
})
