'use client'

/**
 * gantt-performance-poc / M0 —— 方案 B：SVG+Canvas 混合渲染器（ADR-008 假设，抛弃型）。
 *
 * 任务条 / 进度 / 里程碑走 `<canvas>` 批量绘制（避免 1000 行下的 SVG 节点开销）；
 * 依赖线与交互覆盖层（关键路径高亮）保留 SVG，叠在 canvas 之上（task 5.2）。
 * 与方案 A 共享同一数据与布局层，唯一自变量是任务条渲染方式。
 *
 * canvas 尺寸固定为视口大小（totalHeight 达 26000px，整幅 canvas 会超显存），
 * 通过 `ctx.translate(-scroll)` 只绘制可视窗口，随滚动重绘。
 */

import { memo, useEffect, useRef } from 'react'
import type { GanttSpec } from '@/lib/gantt-m0/types'
import {
  barWidth,
  barX,
  dependencyPath,
  DEPENDENCY_COLOR,
  type Granularity,
  ROW_HEIGHT,
  rowCenterY,
  rowTop,
} from '@/lib/gantt-m0/layout'
import { STATUS_FILL, visibleDependencies } from './GanttSvgChart'

interface GanttCanvasChartProps {
  spec: GanttSpec
  granularity: Granularity
  visibleStartRow: number
  visibleEndRow: number
  criticalIds: Set<number>
  viewportWidth: number
  viewportHeight: number
  scrollLeft: number
  scrollTop: number
}

function GanttCanvasChartInner({
  spec,
  granularity,
  visibleStartRow,
  visibleEndRow,
  criticalIds,
  viewportWidth,
  viewportHeight,
  scrollLeft,
  scrollTop,
}: GanttCanvasChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { tasks } = spec

  // 任务条 / 进度 / 里程碑：Canvas 批量绘制，随可视窗口与滚动重绘。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    canvas.width = Math.ceil(viewportWidth * dpr)
    canvas.height = Math.ceil(viewportHeight * dpr)
    canvas.style.width = `${viewportWidth}px`
    canvas.style.height = `${viewportHeight}px`

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, viewportWidth, viewportHeight)
    ctx.save()
    ctx.translate(-scrollLeft, -scrollTop)

    for (let row = visibleStartRow; row <= visibleEndRow; row++) {
      const task = tasks[row]
      if (!task) continue
      const x = barX(task.startDay, granularity)
      if (task.isMilestone) {
        const cy = rowCenterY(row)
        const s = 6
        ctx.fillStyle = '#0f172a'
        ctx.beginPath()
        ctx.moveTo(x, cy - s)
        ctx.lineTo(x + s, cy)
        ctx.lineTo(x, cy + s)
        ctx.lineTo(x - s, cy)
        ctx.closePath()
        ctx.fill()
        continue
      }
      const y = rowTop(row) + 4
      const w = barWidth(task.durationDays, granularity)
      const h = ROW_HEIGHT - 8
      ctx.fillStyle = STATUS_FILL[task.status] ?? '#94a3b8'
      ctx.fillRect(x, y, w, h)
      if (task.progress > 0) {
        ctx.fillStyle = 'rgba(15,23,42,0.28)'
        ctx.fillRect(x, y, w * task.progress, h)
      }
    }
    ctx.restore()
  }, [
    tasks,
    granularity,
    visibleStartRow,
    visibleEndRow,
    viewportWidth,
    viewportHeight,
    scrollLeft,
    scrollTop,
  ])

  const deps = visibleDependencies(spec, visibleStartRow, visibleEndRow)

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
      {/* 依赖线 + 关键路径高亮：保留 SVG 覆盖层（task 5.2）。 */}
      <svg
        width={viewportWidth}
        height={viewportHeight}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        shapeRendering="optimizeSpeed"
      >
        <g transform={`translate(${-scrollLeft},${-scrollTop})`}>
          {deps.map((dep) => {
            const pred = tasks[dep.predecessorId]!
            const succ = tasks[dep.successorId]!
            const x1 = barX(pred.startDay, granularity) + barWidth(pred.durationDays, granularity)
            const y1 = rowCenterY(dep.predecessorId)
            const x2 = barX(succ.startDay, granularity)
            const y2 = rowCenterY(dep.successorId)
            return (
              <path
                key={dep.id}
                d={dependencyPath(x1, y1, x2, y2)}
                fill="none"
                stroke={DEPENDENCY_COLOR[dep.type]}
                strokeWidth={1}
                opacity={0.55}
              />
            )
          })}
          {tasks
            .slice(visibleStartRow, visibleEndRow + 1)
            .map((task) =>
              criticalIds.has(task.id) && !task.isMilestone ? (
                <rect
                  key={task.id}
                  x={barX(task.startDay, granularity)}
                  y={rowTop(task.id) + 4}
                  width={barWidth(task.durationDays, granularity)}
                  height={ROW_HEIGHT - 8}
                  rx={3}
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth={2}
                />
              ) : null,
            )}
        </g>
      </svg>
    </div>
  )
}

export const GanttCanvasChart = memo(GanttCanvasChartInner)
