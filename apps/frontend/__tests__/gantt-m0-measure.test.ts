import { describe, expect, it } from 'vitest'
import { InteractiveTimer, meetsM0Gate, quantile, summarizeFrames } from '@/lib/gantt-m0/measure'

describe('quantile', () => {
  it('中位数与边界分位', () => {
    const asc = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    expect(quantile(asc, 0.5)).toBe(5)
    expect(quantile(asc, 0)).toBe(1)
    expect(quantile(asc, 1)).toBe(9)
  })

  it('线性插值', () => {
    expect(quantile([10, 20], 0.5)).toBe(15)
  })

  it('空数组返回 0', () => {
    expect(quantile([], 0.5)).toBe(0)
  })
})

describe('summarizeFrames —— 按最差帧口径', () => {
  it('给出中位数 / p5 / 最差帧三个分位而非仅平均', () => {
    // 90 帧 16.6ms（流畅）+ 9 帧 40ms（慢帧）+ 1 帧 100ms（严重卡顿）。
    const frames = [...Array(90).fill(16.6), ...Array(9).fill(40), 100]
    const stats = summarizeFrames(frames)
    expect(stats.frameCount).toBe(100)
    expect(stats.medianFrameMs).toBeCloseTo(16.6, 1)
    expect(stats.worstFrameMs).toBe(100)
    // 最差帧 FPS = 1000/100 = 10，远低于 60，暴露卡顿。
    expect(stats.worstFps).toBe(10)
    expect(stats.medianFps).toBeGreaterThan(55)
    // p5 FPS 由 p95 帧时长（≈40ms）换算，明显被慢帧拉低。
    expect(stats.p5Fps).toBeLessThan(stats.medianFps)
  })

  it('统计 jank 帧（超 16.7ms 预算）', () => {
    const stats = summarizeFrames([10, 12, 20, 33, 8])
    expect(stats.jankFrames).toBe(2) // 20 与 33 超预算
  })

  it('空输入返回全零', () => {
    const stats = summarizeFrames([])
    expect(stats.frameCount).toBe(0)
    expect(stats.worstFps).toBe(0)
  })
})

describe('InteractiveTimer —— 数据就绪起算口径', () => {
  it('elapsed 为 markInteractive 与 markDataReady 之差', () => {
    const timer = new InteractiveTimer()
    timer.markDataReady(1000)
    timer.markInteractive(3400)
    expect(timer.elapsedMs).toBe(2400)
  })

  it('未标记可交互前 elapsed 为 null', () => {
    const timer = new InteractiveTimer()
    timer.markDataReady(1000)
    expect(timer.elapsedMs).toBeNull()
  })

  it('可交互只取首次标记（后续 mark 不覆盖）', () => {
    const timer = new InteractiveTimer()
    timer.markDataReady(0)
    timer.markInteractive(500)
    timer.markInteractive(900)
    expect(timer.elapsedMs).toBe(500)
  })
})

describe('meetsM0Gate —— 首次可交互 ≤3s 且滚动最差帧接近 60fps', () => {
  const goodScroll = summarizeFrames([...Array(60).fill(16.6)])
  const jankyScroll = summarizeFrames([...Array(50).fill(16.6), 120, 90, 70])

  it('两项均达标 → 通过', () => {
    expect(meetsM0Gate({ firstInteractiveMs: 2200, scroll: goodScroll })).toBe(true)
  })

  it('首次可交互超 3s → 不通过', () => {
    expect(meetsM0Gate({ firstInteractiveMs: 3200, scroll: goodScroll })).toBe(false)
  })

  it('滚动最差帧过低 → 不通过', () => {
    expect(meetsM0Gate({ firstInteractiveMs: 1500, scroll: jankyScroll })).toBe(false)
  })

  it('首次可交互缺测 → 不通过', () => {
    expect(meetsM0Gate({ firstInteractiveMs: null, scroll: goodScroll })).toBe(false)
  })
})
