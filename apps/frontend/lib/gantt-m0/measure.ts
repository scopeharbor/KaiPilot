/**
 * gantt-performance-poc / M0 —— 测量夹具（留存资产）。
 *
 * 门禁口径（见 `specs/gantt-m0-baseline/spec.md`「最差帧口径」需求）：
 * - 首次可交互 = `performance.now()` 从「数据就绪」到「可响应」；
 * - 滚动帧率报告**中位数 / p5 / 最差帧**，不只报告平均；
 * - 附 longtask 计数、日→周重排程耗时、峰值内存作为选型旁证。
 *
 * 统计部分是纯函数（可单测）；采样/观测部分是薄浏览器封装。M0 归档后本文件保留，
 * 供 T018 复用为 CI 性能回归门禁。
 */

/** 一帧 16.7ms ≈ 60fps 预算；超出即计为 jank 帧。 */
export const FRAME_BUDGET_MS = 1000 / 60

export interface FrameStats {
  frameCount: number
  medianFrameMs: number
  /** 慢帧：95 百分位帧时长（越大越差）。 */
  p95FrameMs: number
  worstFrameMs: number
  medianFps: number
  /** 5 百分位 FPS = 1000 / p95FrameMs。 */
  p5Fps: number
  worstFps: number
  /** 超出 16.7ms 预算的帧数。 */
  jankFrames: number
}

/** 线性插值分位数；输入需为升序数组。 */
export function quantile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return 0
  if (sortedAsc.length === 1) return sortedAsc[0]!
  const pos = (sortedAsc.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sortedAsc[lo]!
  const frac = pos - lo
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac
}

function toFps(frameMs: number): number {
  return frameMs > 0 ? Math.round((1000 / frameMs) * 10) / 10 : 0
}

/**
 * 由逐帧时长（ms）汇总帧率统计。以**最差帧**是否接近 60fps 作为流畅性判据，
 * 平均值会掩盖卡顿，故不作为门禁指标。
 */
export function summarizeFrames(frameDurationsMs: readonly number[]): FrameStats {
  const frames = [...frameDurationsMs].filter((d) => d > 0).sort((a, b) => a - b)
  if (frames.length === 0) {
    return {
      frameCount: 0,
      medianFrameMs: 0,
      p95FrameMs: 0,
      worstFrameMs: 0,
      medianFps: 0,
      p5Fps: 0,
      worstFps: 0,
      jankFrames: 0,
    }
  }
  const medianFrameMs = quantile(frames, 0.5)
  const p95FrameMs = quantile(frames, 0.95)
  const worstFrameMs = frames[frames.length - 1]!
  return {
    frameCount: frames.length,
    medianFrameMs: Math.round(medianFrameMs * 100) / 100,
    p95FrameMs: Math.round(p95FrameMs * 100) / 100,
    worstFrameMs: Math.round(worstFrameMs * 100) / 100,
    medianFps: toFps(medianFrameMs),
    p5Fps: toFps(p95FrameMs),
    worstFps: toFps(worstFrameMs),
    jankFrames: frames.filter((d) => d > FRAME_BUDGET_MS).length,
  }
}

/**
 * 首次可交互计时：`markDataReady()` 记录数据就绪时刻，`markInteractive()` 记录可响应时刻，
 * 差值即门禁口径的「数据就绪 → 首次可交互」耗时（ms）。
 */
export class InteractiveTimer {
  private dataReadyAt: number | null = null
  private interactiveAt: number | null = null

  markDataReady(now = performance.now()): void {
    this.dataReadyAt = now
    this.interactiveAt = null
  }

  markInteractive(now = performance.now()): void {
    if (this.dataReadyAt !== null && this.interactiveAt === null) {
      this.interactiveAt = now
    }
  }

  /** 已就绪 → 可交互耗时（ms），未完成计时返回 null。 */
  get elapsedMs(): number | null {
    if (this.dataReadyAt === null || this.interactiveAt === null) return null
    return Math.round((this.interactiveAt - this.dataReadyAt) * 100) / 100
  }
}

/**
 * rAF 逐帧采样器：`start()` 后按帧记录相邻帧间隔，`stop()` 返回汇总统计。
 * 仅在浏览器环境有效（依赖 requestAnimationFrame）。
 */
export class FrameSampler {
  private frames: number[] = []
  private last = 0
  private rafId = 0
  private running = false

  start(): void {
    if (this.running || typeof requestAnimationFrame === 'undefined') return
    this.frames = []
    this.last = performance.now()
    this.running = true
    const tick = (): void => {
      if (!this.running) return
      const now = performance.now()
      this.frames.push(now - this.last)
      this.last = now
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): FrameStats {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    // 丢弃首帧（start→首个 rAF 的间隔含调度噪音）。
    return summarizeFrames(this.frames.slice(1))
  }
}

/** longtask 计数观测（>50ms 主线程任务）；返回 stop 函数取回计数。 */
export function observeLongTasks(): () => number {
  let count = 0
  if (typeof PerformanceObserver === 'undefined') return () => 0
  let observer: PerformanceObserver | null = null
  try {
    observer = new PerformanceObserver((list) => {
      count += list.getEntries().length
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    return () => 0
  }
  return () => {
    observer?.disconnect()
    return count
  }
}

export interface DeviceProfile {
  userAgent: string
  platform: string
  /** 逻辑核心数（navigator.hardwareConcurrency）。 */
  cores: number | null
  /** 设备内存 GB（navigator.deviceMemory，仅 Chromium）。 */
  deviceMemoryGb: number | null
  /** 手工填写的 DevTools CPU 降速档位（如 "4x" / "6x" / "none"）。 */
  cpuThrottle: string
}

/** 读取设备档位元数据；`cpuThrottle` 由使用者手工填入。 */
export function readDeviceProfile(cpuThrottle = 'unspecified'): DeviceProfile {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  return {
    userAgent: nav?.userAgent ?? 'unknown',
    platform: (nav as { platform?: string } | null)?.platform ?? 'unknown',
    cores: nav?.hardwareConcurrency ?? null,
    deviceMemoryGb: (nav as { deviceMemory?: number } | null)?.deviceMemory ?? null,
    cpuThrottle,
  }
}

/** 峰值内存（MB），仅 Chromium 的 performance.memory 可用。 */
export function readPeakMemoryMb(): number | null {
  const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return mem ? Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10 : null
}

/** 单个渲染方案的一次测量结果，供 M0 报告横向对照。 */
export interface RenderRunResult {
  approach: 'svg' | 'canvas' | 'canvas-opt' | 'frappe'
  firstInteractiveMs: number | null
  scroll: FrameStats
  longTasks: number
  relayoutDayToWeekMs: number | null
  peakMemoryMb: number | null
}

/** 判定单次运行是否达标：首次可交互 ≤3s 且滚动最差帧接近 60fps。 */
export function meetsM0Gate(
  run: Pick<RenderRunResult, 'firstInteractiveMs' | 'scroll'>,
  opts: { interactiveBudgetMs?: number; worstFpsFloor?: number } = {},
): boolean {
  const interactiveBudgetMs = opts.interactiveBudgetMs ?? 3000
  const worstFpsFloor = opts.worstFpsFloor ?? 55
  return (
    run.firstInteractiveMs !== null &&
    run.firstInteractiveMs <= interactiveBudgetMs &&
    run.scroll.worstFps >= worstFpsFloor
  )
}
