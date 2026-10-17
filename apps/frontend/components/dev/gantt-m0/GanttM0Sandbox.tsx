'use client'

/**
 * gantt-performance-poc / M0 —— 沙箱容器（抛弃型 UI）。
 *
 * 挂控制面板（种子 / 方案 A·B·C / 日·周粒度 / 关键路径高亮 / CPU 降速档位）、
 * @tanstack/react-virtual 行虚拟化、交互探针（滚动 / 拖拽 / 关键路径高亮）与测量编排。
 * 首屏时间、滚动帧率、longtask、日→周重排程、峰值内存汇总到结果面板并可复制 JSON，
 * 供人工在 DevTools CPU 降速档位下逐方案实测、汇入 M0 报告。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AxisBottom } from '@visx/axis'
import { scaleTime } from '@visx/scale'
import { useVirtualizer } from '@tanstack/react-virtual'
import { buildGanttM0Dataset, summarizeDataset } from '@/lib/gantt-m0/dataset'
import { m0SpecToModel } from '@/lib/gantt/model-from-m0'
import type { GanttSpec } from '@/lib/gantt-m0/types'
import { chartWidth, dayToDate, type Granularity, ROW_HEIGHT } from '@/lib/gantt-m0/layout'
import {
  FrameSampler,
  InteractiveTimer,
  meetsM0Gate,
  observeLongTasks,
  readDeviceProfile,
  readPeakMemoryMb,
  type RenderRunResult,
} from '@/lib/gantt-m0/measure'
import { GanttSvgChart } from './GanttSvgChart'
import { GanttCanvasChart } from './GanttCanvasChart'
import { GanttCanvasOptChart } from './GanttCanvasOptChart'

type Approach = 'svg' | 'canvas' | 'canvas-opt'

const VIEWPORT_H = 560
const DEFAULT_SEED = 20260705

const nextPaint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/** 匀速把滚动容器从顶滚到底，用于滚动帧率采样。 */
function programmaticScroll(el: HTMLElement, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const maxTop = el.scrollHeight - el.clientHeight
    if (maxTop <= 0) {
      resolve()
      return
    }
    const start = performance.now()
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / durationMs)
      // 设 scrollTop 本身即原生触发 scroll 事件；不再手动 dispatch，避免每帧双份事件污染对比。
      el.scrollTop = maxTop * t
      if (t < 1) requestAnimationFrame(step)
      else resolve()
    }
    requestAnimationFrame(step)
  })
}

/** Clipboard API 不可用或被拒时的兜底：临时 textarea + execCommand，并把 JSON 落控制台便于人工抄取。 */
function fallbackCopy(text: string, onDone: (ok: boolean) => void) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    // execCommand 即便返回 true 也可能空写，再 console 输出兜底便于人工抄取。
    console.info('[gantt-m0] 结果 JSON：\n', text)
    onDone(ok)
  } catch {
    console.info('[gantt-m0] 结果 JSON（兜底失败，请从此处复制）：\n', text)
    onDone(false)
  }
}

export function GanttM0Sandbox() {
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [approach, setApproach] = useState<Approach>('svg')
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [criticalOn, setCriticalOn] = useState(false)
  const [cpuThrottle, setCpuThrottle] = useState('4x')
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [viewport, setViewport] = useState({ w: 960, h: VIEWPORT_H })
  const [result, setResult] = useState<RenderRunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [drag, setDrag] = useState<{ id: number; dx: number } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')

  const scrollRef = useRef<HTMLDivElement>(null)
  const axisGroupRef = useRef<SVGGElement | null>(null)

  const spec: GanttSpec = useMemo(() => buildGanttM0Dataset(seed), [seed])
  const summary = useMemo(() => summarizeDataset(spec), [spec])
  const spanDays = spec.timeRange.endDay
  const width = chartWidth(spanDays, granularity)
  const totalHeight = spec.tasks.length * ROW_HEIGHT
  const timeScale = useMemo(
    () => scaleTime({ domain: [dayToDate(0), dayToDate(spanDays)], range: [0, width] }),
    [spanDays, width],
  )

  // 关键路径高亮：由真实 CPM 计算（复用 m0SpecToModel 回填，与生产同一算法核——T021 task 4.2/6.2）。
  const criticalIds = useMemo(() => {
    const set = new Set<number>()
    if (criticalOn) {
      const model = m0SpecToModel(spec)
      for (const task of model.tasks) if (task.isCritical) set.add(task.id)
    }
    return set
  }, [criticalOn, spec])

  const rowVirtualizer = useVirtualizer({
    count: spec.tasks.length,
    // 优化模式不订阅滚动元素：由 GanttCanvasOptChart 的 rAF 直接读 scrollTop，滚动零 React 重渲染。
    getScrollElement: () => (approach === 'canvas-opt' ? null : scrollRef.current),
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })
  const virtualItems = rowVirtualizer.getVirtualItems()
  const visibleStartRow = virtualItems.length ? virtualItems[0]!.index : 0
  const visibleEndRow = virtualItems.length
    ? virtualItems[virtualItems.length - 1]!.index
    : Math.min(spec.tasks.length - 1, Math.ceil(viewport.h / ROW_HEIGHT))

  // 视口尺寸测量（pinned chart 需要像素尺寸）。
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setViewport({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (approach === 'canvas-opt') return // 命令式模式：滚动不进 React
      const el = e.currentTarget
      setScroll({ top: el.scrollTop, left: el.scrollLeft })
    },
    [approach],
  )

  // 拖拽探针：命中可视行的任务条，横向位移 ghost（桩，不落库、不重算排程）。
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const contentY = e.clientY - rect.top + el.scrollTop
      const row = Math.floor(contentY / ROW_HEIGHT)
      const task = spec.tasks[row]
      if (task && !task.isMilestone) {
        setDrag({ id: task.id, dx: 0 })
        el.setPointerCapture?.(e.pointerId)
      }
    },
    [spec],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag) return
      setDrag((d) => (d ? { ...d, dx: d.dx + e.movementX } : d))
    },
    [drag],
  )
  const onPointerUp = useCallback(() => setDrag(null), [])

  const runMeasurement = useCallback(async () => {
    const el = scrollRef.current
    if (!el || running) return
    setRunning(true)
    setResult(null)
    try {
      // 1) 首次可交互：数据就绪 → 首帧可响应。
      const timer = new InteractiveTimer()
      el.scrollTop = 0
      timer.markDataReady()
      await nextPaint()
      timer.markInteractive()

      // 2) 滚动帧率采样。
      const sampler = new FrameSampler()
      const stopLong = observeLongTasks()
      sampler.start()
      await programmaticScroll(el, 1500)
      const scrollStats = sampler.stop()
      const longTasks = stopLong()

      // 3) 日→周重排程耗时。
      const relayoutStart = performance.now()
      setGranularity((g) => (g === 'day' ? 'week' : 'day'))
      await nextPaint()
      const relayoutDayToWeekMs = Math.round((performance.now() - relayoutStart) * 100) / 100

      setResult({
        approach,
        firstInteractiveMs: timer.elapsedMs,
        scroll: scrollStats,
        longTasks,
        relayoutDayToWeekMs,
        peakMemoryMb: readPeakMemoryMb(),
      })
    } finally {
      setRunning(false)
    }
  }, [approach, running])

  const passes = result ? meetsM0Gate(result) : null
  const device = readDeviceProfile(cpuThrottle)

  const chartProps = {
    spec,
    granularity,
    visibleStartRow,
    visibleEndRow,
    criticalIds,
    viewportWidth: viewport.w,
    viewportHeight: viewport.h,
    scrollLeft: scroll.left,
    scrollTop: scroll.top,
  }

  return (
    <div className="flex flex-col gap-4 p-4 text-sm text-foreground">
      <header className="flex flex-wrap items-end gap-4">
        <h1 className="text-lg font-semibold">甘特图 M0 性能沙箱</h1>
        <span className="text-placeholder">
          /dev/gantt-m0 · 抛弃型 POC · 判定以 DevTools CPU 降速档位为准
        </span>
      </header>

      {/* 控制面板 */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-background p-3">
        <label className="flex items-center gap-2">
          种子
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
            className="w-28 rounded border border-border bg-transparent px-2 py-1"
          />
        </label>
        <fieldset className="flex items-center gap-2">
          方案
          {(['svg', 'canvas', 'canvas-opt'] as const).map((a) => (
            <label key={a} className="flex items-center gap-1">
              <input
                type="radio"
                name="approach"
                checked={approach === a}
                onChange={() => setApproach(a)}
              />
              {a === 'svg' ? '纯 SVG' : a === 'canvas' ? 'SVG+Canvas' : 'Canvas 全绘（优化）'}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          onClick={() => setGranularity((g) => (g === 'day' ? 'week' : 'day'))}
          className="rounded border border-border px-2 py-1"
        >
          粒度：{granularity === 'day' ? '日' : '周'}
        </button>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={criticalOn}
            onChange={(e) => setCriticalOn(e.target.checked)}
          />
          关键路径高亮（真实 CPM）
        </label>
        <label className="flex items-center gap-2">
          CPU 降速
          <input
            value={cpuThrottle}
            onChange={(e) => setCpuThrottle(e.target.value)}
            className="w-20 rounded border border-border bg-transparent px-2 py-1"
          />
        </label>
        <button
          type="button"
          onClick={runMeasurement}
          disabled={running}
          className="rounded bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-50"
        >
          {running ? '测量中…' : '开始测量'}
        </button>
      </div>

      {/* 数据集速览 */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-border bg-background p-3">
        <span>任务 {summary.taskCount}</span>
        <span>依赖 {summary.dependencyCount}</span>
        <span>里程碑 {summary.milestoneCount}</span>
        <span>最大层级 {summary.maxDepth}</span>
        <span>跨度 {summary.spanDays} 天</span>
        <span className="text-placeholder">
          依赖 FS{summary.dependencyTypeCounts.FS}/SS{summary.dependencyTypeCounts.SS}/FF
          {summary.dependencyTypeCounts.FF}/SF{summary.dependencyTypeCounts.SF}
        </span>
      </div>

      {/* 结果面板 */}
      {result && (
        <div className="rounded-xl border border-border bg-background p-3">
          <div className="mb-2 flex items-center gap-3">
            <strong>结果（{result.approach}）</strong>
            <span
              className={
                passes
                  ? 'rounded bg-green-100 px-2 text-green-800'
                  : 'rounded bg-red-100 px-2 text-red-800'
              }
            >
              {passes ? '达标' : '不达标'}（判定含义：首屏 ≤3s 且滚动最差帧 ≥55fps）
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 md:grid-cols-3">
            <span>首次可交互 {result.firstInteractiveMs ?? '—'} ms</span>
            <span>滚动中位 {result.scroll.medianFps} fps</span>
            <span>滚动 p5 {result.scroll.p5Fps} fps</span>
            <span>
              滚动最差帧 {result.scroll.worstFps} fps（{result.scroll.worstFrameMs}ms）
            </span>
            <span>
              jank 帧 {result.scroll.jankFrames}/{result.scroll.frameCount}
            </span>
            <span>longtask {result.longTasks}</span>
            <span>日↔周重排 {result.relayoutDayToWeekMs ?? '—'} ms</span>
            <span>峰值内存 {result.peakMemoryMb ?? '—'} MB</span>
          </div>
          <div className="mt-2 text-placeholder">
            设备：{device.cores ?? '?'} 核 / {device.deviceMemoryGb ?? '?'}GB / CPU 降速{' '}
            {device.cpuThrottle} · {device.userAgent}
          </div>
          <button
            type="button"
            onClick={() => {
              const text = JSON.stringify({ device, summary, result }, null, 2)
              const onDone = (ok: boolean) => setCopyState(ok ? 'ok' : 'fail')
              // 优先走 Clipboard API（安全上下文 / 真实 Chrome 即满足）。
              if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard
                  .writeText(text)
                  .then(() => onDone(true))
                  .catch(() => fallbackCopy(text, onDone))
                return
              }
              fallbackCopy(text, onDone)
            }}
            className="mt-2 rounded border border-border px-2 py-1"
          >
            复制结果 JSON
          </button>
          {copyState !== 'idle' && (
            <span
              className={
                copyState === 'ok'
                  ? 'ml-2 rounded bg-green-100 px-2 text-green-800'
                  : 'ml-2 rounded bg-red-100 px-2 text-red-800'
              }
            >
              {copyState === 'ok' ? '已复制 ✓' : '复制失败 ✗（见控制台 JSON）'}
            </span>
          )}
        </div>
      )}

      {/* 时间轴 */}
      <div style={{ width: '100%', overflow: 'hidden', height: 34 }}>
        <svg width={viewport.w} height={34}>
          <g ref={axisGroupRef} transform={`translate(${-scroll.left},0)`}>
            <AxisBottom
              scale={timeScale}
              top={1}
              numTicks={granularity === 'day' ? 12 : 8}
              tickLabelProps={() => ({ fontSize: 10, fill: 'currentColor' })}
            />
          </g>
        </svg>
      </div>

      {/* 甘特滚动区 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative overflow-auto rounded-xl border border-border bg-background"
        style={{ height: VIEWPORT_H }}
      >
        {/* 撑开滚动条的 sizer */}
        <div style={{ width, height: totalHeight, position: 'relative' }} />
        {approach === 'svg' && <GanttSvgChart {...chartProps} />}
        {approach === 'canvas' && <GanttCanvasChart {...chartProps} />}
        {approach === 'canvas-opt' && (
          <GanttCanvasOptChart
            spec={spec}
            granularity={granularity}
            criticalIds={criticalIds}
            viewportWidth={viewport.w}
            viewportHeight={viewport.h}
            scrollElRef={scrollRef}
            axisGroupRef={axisGroupRef}
          />
        )}
        {drag && (
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
            拖拽任务 #{drag.id} Δ{Math.round(drag.dx)}px（桩：不落库）
          </div>
        )}
      </div>
    </div>
  )
}
