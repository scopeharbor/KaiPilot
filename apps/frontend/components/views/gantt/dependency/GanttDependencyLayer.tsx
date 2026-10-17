'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { DEPENDENCY_TOKEN, resolveDependencyTokens } from '@/lib/gantt/palette'
import type { DepEndpoints, DependencyIndex } from '@/lib/gantt/dependency-index'
import {
  badgeKey,
  computeDependencyVisibility,
  type DependencyStyle,
  type DrawnDependency,
} from '@/lib/gantt/dependency-visibility'
import type {
  DependencyDefaultVisibility,
  GanttRenderDependency,
  GanttRenderTask,
} from '@/lib/gantt/types'

interface GanttDependencyLayerProps {
  deps: GanttRenderDependency[]
  tasks: GanttRenderTask[]
  /** 端点几何缓存（GanttChart 按 scale/模型 memo）。 */
  endpoints: Map<number, DepEndpoints>
  index: DependencyIndex
  rowHeight: number
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  viewportHeight: number
  visibleRows: Set<number>
  rowRange: { minRow: number; maxRow: number }
  pxRange: { minX: number; maxX: number }
  dependencyDefault: DependencyDefaultVisibility
  alwaysShowCriticalPath: boolean
  showProblemChain: boolean
  problemTaskIds: Set<number>
  hoveredTaskId: number | null
  selectedTaskId: number | null
  showAllDependencies: boolean
  expandedBadges: Set<string>
  onToggleBadge: (key: string) => void
  /** 定位越界依赖端点任务（task 4.3）：只移视口，不改依赖数据。 */
  onLocateTask?: (taskId: number) => void
}

const STYLE_WIDTH: Record<DependencyStyle, number> = {
  muted: 1,
  critical: 2,
  problem: 2,
  highlight: 2,
}
const STYLE_ALPHA: Record<DependencyStyle, number> = {
  muted: 0.32,
  critical: 0.95,
  problem: 0.9,
  highlight: 1,
}
/** 快速滚动阈值（px/帧）：超过则只保留关键路径/悬停链（LOD 抽稀，4.8）。 */
const FAST_SCROLL_PX = 60

function strokeFor(style: DependencyStyle, tokens: Record<string, string>): string {
  const token =
    style === 'highlight'
      ? DEPENDENCY_TOKEN.highlight
      : style === 'critical'
        ? DEPENDENCY_TOKEN.critical
        : style === 'problem'
          ? DEPENDENCY_TOKEN.problem
          : DEPENDENCY_TOKEN.muted
  return tokens[token] || '#94a3b8'
}

/**
 * 依赖线 Canvas 混合层（design D4 / task 4.1）。视口尺寸的 canvas 覆盖层，按 -scroll 平移绘制
 * 经可见性引擎裁剪后的连线子集（贝塞尔 + 箭头），令牌色随主题解析。越界依赖聚合为可点击边缘徽标
 * （DOM，4.6）；快速滚动时 LOD 抽稀非关键连线（4.8）。保留隐藏 ARIA 列表维持可及性。
 * 几何滚动平移复用缓存，不逐帧重算路径（4.7）。canvas 本身 pointer-events-none，不挡任务条命中。
 */
export function GanttDependencyLayer({
  deps,
  tasks,
  endpoints,
  index,
  rowHeight,
  scrollLeft,
  scrollTop,
  viewportWidth,
  viewportHeight,
  visibleRows,
  rowRange,
  pxRange,
  dependencyDefault,
  alwaysShowCriticalPath,
  showProblemChain,
  problemTaskIds,
  hoveredTaskId,
  selectedTaskId,
  showAllDependencies,
  expandedBadges,
  onToggleBadge,
  onLocateTask,
}: GanttDependencyLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme } = useTheme()
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const lastScrollRef = useRef({ left: 0, top: 0 })

  // 令牌解析：仅在主题切换时重解（避免每帧 getComputedStyle 触发 style 重算）。
  useEffect(() => {
    setTokens(resolveDependencyTokens())
  }, [resolvedTheme])

  const nameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const t of tasks) m.set(t.id, t.name)
    return m
  }, [tasks])

  const depById = useMemo(() => {
    const m = new Map<number, GanttRenderDependency>()
    for (const d of deps) m.set(d.id, d)
    return m
  }, [deps])

  const { lines, badges } = useMemo(
    () =>
      computeDependencyVisibility({
        deps,
        endpoints,
        index,
        visibleRows,
        rowRange,
        pxRange,
        dependencyDefault,
        alwaysShowCriticalPath,
        showProblemChain,
        problemTaskIds,
        hoveredTaskId,
        selectedTaskId,
        showAllDependencies,
        expandedBadges,
      }),
    [
      deps,
      endpoints,
      index,
      visibleRows,
      rowRange,
      pxRange,
      dependencyDefault,
      alwaysShowCriticalPath,
      showProblemChain,
      problemTaskIds,
      hoveredTaskId,
      selectedTaskId,
      showAllDependencies,
      expandedBadges,
    ],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || viewportWidth === 0 || viewportHeight === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
    canvas.width = Math.ceil(viewportWidth * dpr)
    canvas.height = Math.ceil(viewportHeight * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, viewportWidth, viewportHeight)

    // LOD：快速滚动只画关键路径/悬停链，停止后（scroll 状态稳定）恢复全量。
    const dx = Math.abs(scrollLeft - lastScrollRef.current.left)
    const dy = Math.abs(scrollTop - lastScrollRef.current.top)
    lastScrollRef.current = { left: scrollLeft, top: scrollTop }
    const fast = dx > FAST_SCROLL_PX || dy > FAST_SCROLL_PX
    const drawList: DrawnDependency[] = fast ? lines.filter((l) => l.style !== 'muted') : lines

    for (const line of drawList) {
      const x1 = line.x1 - scrollLeft
      const y1 = line.y1 - scrollTop
      const x2 = line.x2 - scrollLeft
      const y2 = line.y2 - scrollTop
      ctx.globalAlpha = STYLE_ALPHA[line.style]
      ctx.strokeStyle = strokeFor(line.style, tokens)
      ctx.fillStyle = ctx.strokeStyle
      ctx.lineWidth = STYLE_WIDTH[line.style]
      // 零分配直接绘制（公式与 `dependencyPath` 一致）：滚动帧每条线不再 new Path2D + 拼字符串，
      // 消除每帧数千次分配造成的 GC 尖峰。仅平移已缓存几何。
      const dx = Math.max(24, Math.abs(x2 - x1) * 0.5)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2)
      ctx.stroke()
      // 箭头（指向后置任务），非 muted 才画以免蛛网。
      if (line.style !== 'muted') {
        const a = 4
        ctx.beginPath()
        ctx.moveTo(x2, y2)
        ctx.lineTo(x2 - a, y2 - a)
        ctx.lineTo(x2 - a, y2 + a)
        ctx.closePath()
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }, [lines, tokens, scrollLeft, scrollTop, viewportWidth, viewportHeight])

  // 隐藏 ARIA 列表：仅在可见依赖集合变化时重建（垂直滚动帧间 `lines` 稳定→不逐帧重算），
  // 用 Map O(1) 查找替代 `deps.find`，消除每帧 O(lines×deps) 与元素分配。
  const ariaItems = useMemo(
    () =>
      lines.map((l) => {
        const dep = depById.get(l.id)
        if (!dep) return null
        return (
          <li key={l.id}>
            {nameById.get(dep.predecessorId) ?? dep.predecessorId} 依赖于{' '}
            {nameById.get(dep.successorId) ?? dep.successorId}
          </li>
        )
      }),
    [lines, depById, nameById],
  )

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden={false}>
      <canvas
        ref={canvasRef}
        style={{ width: viewportWidth, height: viewportHeight }}
        className="absolute left-0 top-0"
        aria-hidden
      />

      {/* 越界依赖聚合徽标（可点击就地展开/收起，4.6）；展开后可定位对端任务（4.3）。 */}
      {badges.map((b) => {
        const key = badgeKey(b.rowIndex, b.side)
        const left = b.anchorX - scrollLeft
        const top = b.anchorY - scrollTop - rowHeight / 2
        if (left < -20 || left > viewportWidth + 20) return null
        const expanded = expandedBadges.has(key)
        // lead=前置在屏外→定位源任务；trail=后置在屏外→定位目标任务。数据不变，只移视口。
        const firstDepId = b.depIds[0]
        const firstDep = firstDepId !== undefined ? depById.get(firstDepId) : undefined
        const locateTaskId = firstDep
          ? b.side === 'lead'
            ? firstDep.predecessorId
            : firstDep.successorId
          : null
        const locateTaskName = locateTaskId !== null ? nameById.get(locateTaskId) : undefined
        return (
          <span
            key={key}
            className="pointer-events-none absolute z-10 inline-flex items-center gap-1"
            style={{
              left: b.side === 'trail' ? left + 4 : left - 4,
              top,
              height: rowHeight,
              transform: b.side === 'lead' ? 'translateX(-100%)' : undefined,
            }}
          >
            <button
              type="button"
              onClick={() => onToggleBadge(key)}
              className="pointer-events-auto inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-1.5 text-[10px] font-medium leading-4 text-primary-700 shadow-[var(--shadow-xs)] hover:bg-primary-100"
              aria-expanded={expanded}
              aria-label={`${b.count} 条${b.side === 'lead' ? '前置' : '后置'}依赖在视口外，${
                expanded ? '收起' : '展开'
              }`}
            >
              {b.side === 'lead' ? `‹${b.count}` : `${b.count}›`}
            </button>
            {expanded && locateTaskId !== null && onLocateTask ? (
              <button
                type="button"
                onClick={() => onLocateTask(locateTaskId)}
                className="pointer-events-auto inline-flex items-center rounded-[var(--radius-sm)] border border-border bg-gray-0 px-1.5 text-[10px] leading-4 text-muted hover:bg-gray-50"
                aria-label={`定位${b.side === 'lead' ? '源任务' : '目标任务'}${
                  locateTaskName ? `「${locateTaskName}」` : ''
                }`}
              >
                定位
              </button>
            ) : null}
          </span>
        )
      })}

      {/* 隐藏 ARIA 层：把可见依赖以文本暴露给读屏（D4/4.1）。 */}
      <ul className="sr-only">{ariaItems}</ul>
    </div>
  )
}

export default GanttDependencyLayer
