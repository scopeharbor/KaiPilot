/**
 * gantt-performance-poc / M0 —— 方案 A：纯 SVG 渲染器（对照基线，抛弃型）。
 *
 * 任务条、进度填充、里程碑、四类依赖线全部用 SVG 元素。视口尺寸 SVG + 内层
 * `<g translate(-scroll)>` 实现「钉住视口 + 偏移」，可视行窗口由 @tanstack/react-virtual
 * 提供（container）。依赖线按可视 y 区间裁剪，但**不要求两端都可见**——只要连线纵跨区间
 * 与视口相交即渲染，避免用「两端可见」的取巧把依赖线的 SVG 成本藏掉（spec「完整图元前提」）。
 *
 * 与方案 B 的唯一差异：任务条是 SVG `<rect>`（此处）还是 Canvas 填充（GanttCanvasChart）；
 * 依赖线在两方案都保持 SVG，从而把「任务条渲染方式」隔离为唯一自变量。
 */

import { memo } from 'react'
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

export const STATUS_FILL: Record<string, string> = {
  not_started: '#94a3b8',
  in_progress: '#3b82f6',
  completed: '#22c55e',
  blocked: '#ef4444',
  on_hold: '#a855f7',
  cancelled: '#64748b',
}

export interface GanttChartProps {
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

/** 与视口相交的依赖线（含跨越视口的长连线）。 */
export function visibleDependencies(
  spec: GanttSpec,
  visibleStartRow: number,
  visibleEndRow: number,
) {
  return spec.dependencies.filter((dep) => {
    const lo = Math.min(dep.predecessorId, dep.successorId)
    const hi = Math.max(dep.predecessorId, dep.successorId)
    return lo <= visibleEndRow && hi >= visibleStartRow
  })
}

function GanttSvgChartInner({
  spec,
  granularity,
  visibleStartRow,
  visibleEndRow,
  criticalIds,
  viewportWidth,
  viewportHeight,
  scrollLeft,
  scrollTop,
}: GanttChartProps) {
  const { tasks } = spec
  const deps = visibleDependencies(spec, visibleStartRow, visibleEndRow)

  return (
    <svg
      width={viewportWidth}
      height={viewportHeight}
      className="gantt-m0-chart"
      shapeRendering="optimizeSpeed"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <g transform={`translate(${-scrollLeft},${-scrollTop})`}>
        <g>
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
        </g>
        <g>
          {tasks.slice(visibleStartRow, visibleEndRow + 1).map((task) => {
            const x = barX(task.startDay, granularity)
            const y = rowTop(task.id)
            const isCritical = criticalIds.has(task.id)
            if (task.isMilestone) {
              const cy = rowCenterY(task.id)
              const s = 6
              return (
                <path
                  key={task.id}
                  d={`M${x},${cy - s} L${x + s},${cy} L${x},${cy + s} L${x - s},${cy} Z`}
                  fill={isCritical ? '#dc2626' : '#0f172a'}
                />
              )
            }
            const w = barWidth(task.durationDays, granularity)
            return (
              <g key={task.id}>
                <rect
                  x={x}
                  y={y + 4}
                  width={w}
                  height={ROW_HEIGHT - 8}
                  rx={3}
                  fill={STATUS_FILL[task.status] ?? '#94a3b8'}
                  stroke={isCritical ? '#dc2626' : 'transparent'}
                  strokeWidth={isCritical ? 2 : 0}
                />
                {task.progress > 0 && (
                  <rect
                    x={x}
                    y={y + 4}
                    width={w * task.progress}
                    height={ROW_HEIGHT - 8}
                    rx={3}
                    fill="#0f172a"
                    opacity={0.28}
                  />
                )}
              </g>
            )
          })}
        </g>
      </g>
    </svg>
  )
}

export const GanttSvgChart = memo(GanttSvgChartInner)
