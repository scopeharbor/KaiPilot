'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildGanttModelFromSeed } from '@/lib/gantt/model-from-m0'
import {
  FrameSampler,
  InteractiveTimer,
  readDeviceProfile,
  readPeakMemoryMb,
  type FrameStats,
} from '@/lib/gantt-m0/measure'
import { createGanttViewStore } from '@/stores/gantt-store'
import type { GanttEntry } from '@/lib/gantt/types'
import { GanttView } from '@/components/views/gantt/GanttView'
import { cn } from '@/lib/utils'

/**
 * T018 dev 性能 harness（task 1.5）。复用确定性数据集（`lib/gantt/model-from-m0` → M0 dataset，
 * CI 性能回归基线）与测量夹具（`lib/gantt-m0/measure`），在完整图元下采集首屏/滚动帧率，
 * 供 Group 7 在真实 Chrome + DevTools 降速下的最差帧复测使用。
 *
 * 独立 store（`createGanttViewStore`），与应用级甘特互不干扰。
 */
export function GanttT018Harness() {
  const [seed, setSeed] = useState(1)
  const store = useMemo(() => createGanttViewStore({ entry: 'standard' }), [])
  const entry = store((s) => s.entry)
  const setEntry = store((s) => s.setEntry)
  const [permissionMode, setPermissionMode] = useState<'readonly' | 'editable'>('readonly')

  const model = useMemo(() => buildGanttModelFromSeed(seed), [seed])

  const [firstInteractiveMs, setFirstInteractiveMs] = useState<number | null>(null)
  const [scrollStats, setScrollStats] = useState<FrameStats | null>(null)
  const [sampling, setSampling] = useState(false)
  const [autoRunning, setAutoRunning] = useState(false)
  /** 手填的 DevTools CPU 降速档位（复测报告用）。 */
  const [throttleLabel, setThrottleLabel] = useState<'none' | '4x' | '6x'>('4x')
  // 设备/内存读数依赖浏览器 API，SSR 与客户端不一致——挂载后再渲染，避免水合文本不匹配。
  const [mounted, setMounted] = useState(false)
  const samplerRef = useRef<FrameSampler | null>(null)
  const autoRafRef = useRef(0)
  const timerRef = useRef(new InteractiveTimer())

  useEffect(() => setMounted(true), [])
  useEffect(
    () => () => {
      if (autoRafRef.current) cancelAnimationFrame(autoRafRef.current)
    },
    [],
  )

  // 首屏可交互：数据就绪→首帧后标记（近似）。
  useEffect(() => {
    const timer = timerRef.current
    timer.markDataReady()
    const raf = requestAnimationFrame(() => {
      timer.markInteractive()
      setFirstInteractiveMs(timer.elapsedMs)
    })
    return () => cancelAnimationFrame(raf)
  }, [model])

  function toggleSampling() {
    if (sampling) {
      const stats = samplerRef.current?.stop() ?? null
      setScrollStats(stats)
      setSampling(false)
    } else {
      setScrollStats(null)
      samplerRef.current = new FrameSampler()
      samplerRef.current.start()
      setSampling(true)
    }
  }

  /**
   * 一键自动滚动采样（复测复现用）：找到甘特滚动容器，三角波往返滚动 ~4s，
   * 期间 `FrameSampler` 采帧。手动复测流程＝在 DevTools 设 4×/6× 降速 → 点本按钮 → 读最差帧。
   * 垂直滚动是 M0 认定瓶颈轴（改变可见行 → 触发依赖可见性重算 + Canvas 重绘）。
   */
  function runAutoScrollSample() {
    const el = document.querySelector<HTMLElement>('[data-gantt-scroll]')
    if (!el) {
      window.alert('未找到甘特滚动容器（[data-gantt-scroll]）')
      return
    }
    const max = el.scrollHeight - el.clientHeight
    if (max <= 0) {
      window.alert('内容高度不足以滚动')
      return
    }
    setScrollStats(null)
    setAutoRunning(true)
    el.scrollTop = 0
    const sampler = new FrameSampler()
    samplerRef.current = sampler
    sampler.start()
    // 恒定真实速度：~24px/帧（≈1200px/s 的连续刷滚），低于 LOD 阈值→muted 线每帧都画，
    // 是对「裁剪+Canvas」的诚实最坏压力；到底/到顶折返，持续 DURATION。
    const PX_PER_FRAME = 24
    const DURATION = 5000
    const start = performance.now()
    let pos = 0
    let dir = 1
    const step = (now: number) => {
      pos += dir * PX_PER_FRAME
      if (pos >= max) {
        pos = max
        dir = -1
      } else if (pos <= 0) {
        pos = 0
        dir = 1
      }
      el.scrollTop = pos
      if (now - start < DURATION) {
        autoRafRef.current = requestAnimationFrame(step)
      } else {
        setScrollStats(sampler.stop())
        setAutoRunning(false)
      }
    }
    autoRafRef.current = requestAnimationFrame(step)
  }

  const device = mounted ? readDeviceProfile(throttleLabel) : null

  async function copyReport() {
    if (!scrollStats) return
    const line =
      `T018 完整图元复测 | 降速=${throttleLabel} | seed=${seed} | 入口=${entry} | ` +
      `首屏=${firstInteractiveMs ?? '—'}ms | 中位=${scrollStats.medianFps}fps ` +
      `p5=${scrollStats.p5Fps}fps 最差=${scrollStats.worstFps}fps ` +
      `jank=${scrollStats.jankFrames}/${scrollStats.frameCount} | ` +
      `${device?.cores ?? '—'}核 峰值=${readPeakMemoryMb() ?? '—'}MB`
    try {
      await navigator.clipboard.writeText(line)
      window.alert('已复制横向数据')
    } catch {
      window.alert(line)
    }
  }

  return (
    <div className="flex h-screen flex-col gap-3 bg-background p-4">
      <header className="shrink-0">
        <h1 className="text-lg font-semibold text-heading">甘特 T018 性能 harness</h1>
        <p className="text-xs text-muted">
          确定性 1000 任务 · 完整图元 · 复用 M0 CI 基线夹具。真实降速复测见 Group 7。
        </p>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-1">
          seed
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
            className="w-20 rounded-[var(--radius-sm)] border border-border bg-gray-0 px-2 py-1"
          />
        </label>
        <div className="inline-flex overflow-hidden rounded-[var(--radius-md)] border border-border">
          {(['standard', 'simplified'] as GanttEntry[]).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEntry(e)}
              className={cn(
                'px-3 py-1',
                entry === e ? 'bg-primary-500 text-gray-0' : 'bg-gray-0 hover:bg-gray-50',
              )}
            >
              {e === 'standard' ? '标准入口' : '简化入口'}
            </button>
          ))}
        </div>
        <div
          className="inline-flex overflow-hidden rounded-[var(--radius-md)] border border-border"
          role="group"
          aria-label="甘特权限模式"
        >
          {(['readonly', 'editable'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPermissionMode(mode)}
              className={cn(
                'px-3 py-1',
                permissionMode === mode
                  ? 'bg-primary-500 text-gray-0'
                  : 'bg-gray-0 hover:bg-gray-50',
              )}
              aria-pressed={permissionMode === mode}
            >
              {mode === 'readonly' ? '只读用户' : '编辑用户'}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1 text-xs text-muted">
          降速档
          <select
            value={throttleLabel}
            onChange={(e) => setThrottleLabel(e.target.value as 'none' | '4x' | '6x')}
            className="rounded-[var(--radius-sm)] border border-border bg-gray-0 px-1.5 py-1 text-sm text-foreground"
          >
            <option value="none">无</option>
            <option value="4x">4×</option>
            <option value="6x">6×</option>
          </select>
        </label>
        <button
          type="button"
          onClick={runAutoScrollSample}
          disabled={autoRunning || sampling}
          className={cn(
            'rounded-[var(--radius-md)] px-3 py-1',
            autoRunning
              ? 'bg-primary-200 text-primary-800'
              : 'bg-primary-500 text-gray-0 hover:bg-primary-600 disabled:opacity-50',
          )}
        >
          {autoRunning ? '自动滚动采样中…' : '一键自动滚动采样'}
        </button>
        <button
          type="button"
          onClick={toggleSampling}
          disabled={autoRunning}
          className={cn(
            'rounded-[var(--radius-md)] px-3 py-1',
            sampling
              ? 'bg-danger text-gray-0'
              : 'bg-gray-100 hover:bg-gray-200 disabled:opacity-50',
          )}
        >
          {sampling ? '停止手动采样并汇总' : '手动滚动采样'}
        </button>
        <button
          type="button"
          onClick={copyReport}
          disabled={!scrollStats}
          className="rounded-[var(--radius-md)] bg-gray-100 px-3 py-1 hover:bg-gray-200 disabled:opacity-50"
        >
          复制横向数据
        </button>
        <span className="text-xs text-muted">
          首屏 {firstInteractiveMs ?? '—'}ms
          {scrollStats
            ? ` · 中位 ${scrollStats.medianFps}fps · p5 ${scrollStats.p5Fps}fps · 最差 ${scrollStats.worstFps}fps · jank ${scrollStats.jankFrames}/${scrollStats.frameCount}`
            : ''}
          {mounted ? ` · ${device?.cores ?? '—'}核 · 峰值 ${readPeakMemoryMb() ?? '—'}MB` : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <GanttView
          model={model}
          store={store}
          editable={permissionMode === 'editable'}
          dependencyEditable={permissionMode === 'editable'}
          onScheduleDraft={() => undefined}
          onDependencyDraft={() => undefined}
          onProgressDraft={() => undefined}
          onMilestoneDraft={() => undefined}
        />
      </div>
    </div>
  )
}
