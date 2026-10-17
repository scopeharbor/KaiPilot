'use client'

/**
 * gantt-performance-poc / M0 —— 方案 C：全命令式 Canvas 渲染器（优化版，抛弃型）。
 *
 * 针对裸测暴露的瓶颈——「每滚动帧 setState 触发 React 重渲染（含依赖线 SVG 重建）」——
 * 把任务条 / 进度 / 里程碑 / 四类依赖线 / 关键路径高亮**全部**画到单块 canvas，
 * 由一个 rAF 循环直接读取滚动容器的 `scrollTop/scrollLeft` 重绘：**滚动路径完全不经过 React**，
 * 也不订阅 react-virtual（容器在本模式下让 virtualizer 的 scrollElement 返回 null）。
 * 时间轴仍用 @visx（SVG），其横向偏移在同一 rAF 内命令式同步。
 *
 * 这是「自研方向内的优化」，用于测 @visx + 自研 Canvas 的公平上限，而非降级。
 */

import { memo, useEffect, useRef } from 'react'
import type { GanttSpec } from '@/lib/gantt-m0/types'
import {
  barWidth,
  barX,
  DEPENDENCY_COLOR,
  type Granularity,
  ROW_HEIGHT,
  rowCenterY,
  rowTop,
} from '@/lib/gantt-m0/layout'
import { STATUS_FILL } from './GanttSvgChart'

interface GanttCanvasOptChartProps {
  spec: GanttSpec
  granularity: Granularity
  criticalIds: Set<number>
  viewportWidth: number
  viewportHeight: number
  scrollElRef: React.RefObject<HTMLDivElement | null>
  axisGroupRef: React.RefObject<SVGGElement | null>
}

function GanttCanvasOptChartInner({
  spec,
  granularity,
  criticalIds,
  viewportWidth,
  viewportHeight,
  scrollElRef,
  axisGroupRef,
}: GanttCanvasOptChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 最近一次绘制的滚动位置；props 变更时置 dirty 强制重绘。
  const stateRef = useRef({ lastTop: -1, lastLeft: -1, dirty: true })

  // canvas 尺寸随视口变化设定（不放在每帧，避免每帧重分配清屏）。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    canvas.width = Math.ceil(viewportWidth * dpr)
    canvas.height = Math.ceil(viewportHeight * dpr)
    canvas.style.width = `${viewportWidth}px`
    canvas.style.height = `${viewportHeight}px`
    stateRef.current.dirty = true
  }, [viewportWidth, viewportHeight])

  // 数据/粒度/关键路径变更 → 强制下一帧重绘。
  useEffect(() => {
    stateRef.current.dirty = true
  }, [spec, granularity, criticalIds])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { tasks, dependencies } = spec
    let raf = 0

    const draw = (scrollTop: number, scrollLeft: number): void => {
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewportWidth, viewportHeight)
      ctx.save()
      ctx.translate(-scrollLeft, -scrollTop)

      const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4)
      const endRow = Math.min(
        tasks.length - 1,
        Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + 4,
      )

      // 依赖线（贝塞尔）：纵跨 [startRow,endRow] 与视口相交即画（含跨视口长连线）。
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.55
      for (const dep of dependencies) {
        const lo = dep.predecessorId < dep.successorId ? dep.predecessorId : dep.successorId
        const hi = dep.predecessorId < dep.successorId ? dep.successorId : dep.predecessorId
        if (lo > endRow || hi < startRow) continue
        const pred = tasks[dep.predecessorId]!
        const succ = tasks[dep.successorId]!
        const x1 = barX(pred.startDay, granularity) + barWidth(pred.durationDays, granularity)
        const y1 = rowCenterY(dep.predecessorId)
        const x2 = barX(succ.startDay, granularity)
        const y2 = rowCenterY(dep.successorId)
        const dx = Math.max(24, Math.abs(x2 - x1) * 0.5)
        ctx.strokeStyle = DEPENDENCY_COLOR[dep.type]!
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // 任务条 / 进度 / 里程碑 / 关键路径高亮。
      for (let row = startRow; row <= endRow; row++) {
        const task = tasks[row]
        if (!task) continue
        const x = barX(task.startDay, granularity)
        const isCritical = criticalIds.has(task.id)
        if (task.isMilestone) {
          const cy = rowCenterY(row)
          const s = 6
          ctx.fillStyle = isCritical ? '#dc2626' : '#0f172a'
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
        if (isCritical) {
          ctx.strokeStyle = '#dc2626'
          ctx.lineWidth = 2
          ctx.strokeRect(x, y, w, h)
        }
      }
      ctx.restore()
    }

    const loop = (): void => {
      const el = scrollElRef.current
      const s = stateRef.current
      if (el) {
        const st = el.scrollTop
        const sl = el.scrollLeft
        if (st !== s.lastTop || sl !== s.lastLeft || s.dirty) {
          draw(st, sl)
          if (sl !== s.lastLeft) {
            axisGroupRef.current?.setAttribute('transform', `translate(${-sl},0)`)
          }
          s.lastTop = st
          s.lastLeft = sl
          s.dirty = false
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [spec, granularity, criticalIds, viewportWidth, viewportHeight, scrollElRef, axisGroupRef])

  return (
    <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
  )
}

export const GanttCanvasOptChart = memo(GanttCanvasOptChartInner)
