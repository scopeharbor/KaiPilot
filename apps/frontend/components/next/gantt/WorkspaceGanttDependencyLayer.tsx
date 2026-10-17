/**
 * 新轨甘特镜头（v3-ui-next-gantt-lens W1 tasks 1.6）—— Layer 2 依赖连线与 CPM 高亮。
 *
 * FS/SS/FF/SF 四类正交折线（`orthogonalDependencyPath`，外层锚点伸出 + 折回），
 * 视口裁剪走 `DependencyIndex` 空间相交索引（行区间命中）+ 水平跨度 ∩ 可见像素窗
 * （±240px 缓冲，design D1.3）。显示策略（design D1.2 / tasks 1.6）：
 * - `showAllDependencies`=false（默认）：仅显关键路径依赖（受 `showCriticalPath` 控制）
 *   与焦点任务上下游链；
 * - 关键路径 / 焦点链消费 `--nx-space-cyan` 实线 + 发光底；普通依赖消费 `--nx-text-muted`
 *   （原用 `--nx-border-hairline`，浅色主题下仅 10% 不透明，打开「全部依赖」也几乎看不见）；
 *   全部连线在后继端带箭头，看得出方向；有焦点时非关联连线透明度降至 20%。
 */

'use client'

import { memo, useMemo } from 'react'
import {
  filterDepsByPxWindow,
  orthogonalDependencyPath,
  selectVisibleDepIds,
  visiblePxWindow,
  type DayRange,
  type NextGanttScale,
} from '@/lib/gantt/next-gantt-adapter'
import { buildNextGanttGeometry } from '@/lib/gantt/next-gantt-adapter'
import type { RowRange } from '@/lib/gantt/next-gantt-adapter'
import type { GanttModel } from '@/lib/gantt/types'

/** 普通依赖线颜色：需在浅/深色两套主题下都清晰可辨。 */
const DEP_NORMAL_STROKE = 'var(--nx-text-muted)'
const ARROW_NORMAL_ID = 'nx-gantt-dep-arrow'
const ARROW_ACCENT_ID = 'nx-gantt-dep-arrow-accent'

function DepArrow({ id, fill }: { id: string; fill: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 8 8"
      refX={7}
      refY={4}
      markerWidth={7}
      markerHeight={7}
      markerUnits="userSpaceOnUse"
      orient="auto"
    >
      <path d="M0,0 L8,4 L0,8 z" fill={fill} />
    </marker>
  )
}

export interface WorkspaceGanttDependencyLayerProps {
  model: GanttModel
  scale: NextGanttScale
  visibleRows: RowRange
  visibleDays: DayRange
  showAllDependencies: boolean
  showCriticalPath: boolean
  /** 悬停或选中的任务 id（高亮其直接上下游链，其余淡化）。 */
  focusedTaskId?: number | null
  /** 驱动链上的依赖 id（与严格 CPM 关键依赖同样高亮，见 lib/gantt/driving-chain.ts）。 */
  drivingDepIds?: ReadonlySet<number>
}

export const WorkspaceGanttDependencyLayer = memo(function WorkspaceGanttDependencyLayer({
  model,
  scale,
  visibleRows,
  visibleDays,
  showAllDependencies,
  showCriticalPath,
  focusedTaskId,
  drivingDepIds,
}: WorkspaceGanttDependencyLayerProps) {
  // 几何缓存：仅模型/刻度变化时重建，滚动复用（design D9）。
  const geometry = useMemo(() => buildNextGanttGeometry(scale, model), [scale, model])

  const visible = useMemo(() => {
    const ids = selectVisibleDepIds(geometry.depIndex, visibleRows)
    return filterDepsByPxWindow(
      model.dependencies,
      ids,
      geometry.endpoints,
      visiblePxWindow(scale, visibleDays),
    )
  }, [model.dependencies, geometry, visibleRows, visibleDays, scale])

  const focus = focusedTaskId ?? null

  const shown = visible.filter((dep) => {
    if (focus != null && (dep.predecessorId === focus || dep.successorId === focus)) return true
    if ((dep.isCritical === true || drivingDepIds?.has(dep.id)) && showCriticalPath) return true
    return showAllDependencies
  })

  return (
    <g data-gantt-dependency-layer>
      <defs>
        <DepArrow id={ARROW_NORMAL_ID} fill={DEP_NORMAL_STROKE} />
        <DepArrow id={ARROW_ACCENT_ID} fill="var(--nx-space-cyan)" />
      </defs>
      {shown.map((dep) => {
        const ep = geometry.endpoints.get(dep.id)
        if (!ep) return null
        const isCritical =
          dep.isCritical === true || (showCriticalPath && drivingDepIds?.has(dep.id) === true)
        const isFocused =
          focus != null && (dep.predecessorId === focus || dep.successorId === focus)
        const isDimmed = focus != null && !isFocused && !isCritical
        const accent = isCritical || isFocused
        const stroke = accent ? 'var(--nx-space-cyan)' : DEP_NORMAL_STROKE
        const strokeWidth = accent ? 1.5 : 1.25
        const d = orthogonalDependencyPath(ep, dep.type)
        return (
          <g
            key={dep.id}
            data-gantt-element
            data-gantt-dep-line
            data-dep-id={dep.id}
            data-dep-type={dep.type}
            data-gantt-critical={isCritical || undefined}
            data-gantt-dep-focused={isFocused || undefined}
            opacity={isDimmed ? 0.2 : undefined}
          >
            {isCritical ? (
              <path
                d={d}
                fill="none"
                stroke="var(--nx-space-cyan)"
                strokeWidth={4}
                opacity={0.15}
                data-gantt-dep-glow
              />
            ) : null}
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeOpacity={accent ? undefined : 0.75}
              markerEnd={`url(#${accent ? ARROW_ACCENT_ID : ARROW_NORMAL_ID})`}
            />
            <title>
              {dep.type === 'fs'
                ? '完成-开始'
                : dep.type === 'ss'
                  ? '开始-开始'
                  : dep.type === 'ff'
                    ? '完成-完成'
                    : '开始-完成'}
              依赖 · #{dep.predecessorId} → #{dep.successorId}
            </title>
          </g>
        )
      })}
    </g>
  )
})
