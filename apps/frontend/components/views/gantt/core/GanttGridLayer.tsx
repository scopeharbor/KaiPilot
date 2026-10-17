'use client'

import { memo } from 'react'
import { buildTimeTicks, dayToX, isWeekend, type GanttScale } from '@/lib/gantt/geometry'

interface GanttGridLayerProps {
  scale: GanttScale
  range: { startDay: number; endDay: number }
  width: number
  height: number
  scrollLeft: number
  viewportWidth: number
  /** 今日的天偏移（由容器注入，便于测试；null=不画今日线）。 */
  todayDay: number | null
}

const BUFFER_PX = 240

/**
 * 静态网格层（task 3.2）：竖向刻度网格线 + 非工作日底纹（日粒度）+ 今日线。
 * 落在 scroll body 内随原生滚动平移；仅渲染可见横向窗口 + 缓冲的图元。零硬编码色值。
 *
 * `memo`：仅在 scale/range/尺寸/横向窗口变化时重绘，垂直滚动不触发（宽度不变、窗口 x 不变）。
 */
export const GanttGridLayer = memo(function GanttGridLayer({
  scale,
  range,
  width,
  height,
  scrollLeft,
  viewportWidth,
  todayDay,
}: GanttGridLayerProps) {
  const min = scrollLeft - BUFFER_PX
  const max = scrollLeft + (viewportWidth || width) + BUFFER_PX
  const ticks = buildTimeTicks(scale, range).filter((t) => t.x >= min && t.x <= max)

  // 周末底纹仅在日粒度绘制（周及以上过密、无意义）。
  const weekendRects: { x: number; w: number }[] = []
  if (scale.granularity === 'day') {
    const startDay = Math.max(range.startDay, Math.floor(min / scale.pxPerDay))
    const endDay = Math.min(range.endDay, Math.ceil(max / scale.pxPerDay))
    for (let day = startDay; day <= endDay; day++) {
      if (isWeekend(scale, day)) {
        weekendRects.push({ x: dayToX(scale, day), w: scale.pxPerDay })
      }
    }
  }

  const todayX = todayDay !== null ? dayToX(scale, todayDay) : null
  const todayVisible = todayX !== null && todayX >= min && todayX <= max

  return (
    <svg
      width={width}
      height={height}
      className="absolute inset-0 block"
      role="presentation"
      aria-hidden
    >
      {weekendRects.map((r) => (
        <rect
          key={r.x}
          x={r.x}
          y={0}
          width={r.w}
          height={height}
          fill="var(--gray-100)"
          opacity={0.6}
        />
      ))}
      {ticks.map((t) => (
        <line
          key={t.day}
          x1={t.x}
          y1={0}
          x2={t.x}
          y2={height}
          stroke={t.major ? 'var(--border-strong)' : 'var(--border)'}
          strokeWidth={1}
          opacity={t.major ? 0.9 : 0.5}
        />
      ))}
      {todayVisible ? (
        <line
          x1={todayX!}
          y1={0}
          x2={todayX!}
          y2={height}
          stroke="var(--danger)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      ) : null}
    </svg>
  )
})
