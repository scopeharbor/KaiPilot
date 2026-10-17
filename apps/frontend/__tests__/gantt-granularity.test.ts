import { describe, expect, it } from 'vitest'
import { buildTimeTicks, chartHeight, createScale, dayToX, rowCenterY } from '@/lib/gantt/geometry'
import { buildGanttModelFromSeed } from '@/lib/gantt/model-from-m0'

describe('粒度切换只重排坐标、不改数据（task 3.6）', () => {
  it('切换粒度：刻度密度与坐标随 pxPerDay 变化，输入 range 不被修改', () => {
    const range = { startDay: 0, endDay: 90 }
    const frozen = JSON.stringify(range)
    const dayTicks = buildTimeTicks(createScale('day'), range)
    const monthTicks = buildTimeTicks(createScale('month'), range)
    // 日刻度显著多于月刻度（重排后密度不同）。
    expect(dayTicks.length).toBeGreaterThan(monthTicks.length)
    // 同一天在日粒度更靠右（pxPerDay 更大）。
    expect(dayToX(createScale('day'), 30)).toBeGreaterThan(dayToX(createScale('month'), 30))
    // 纯函数：输入未被修改。
    expect(JSON.stringify(range)).toBe(frozen)
  })

  it('切换粒度不改底层任务数据（模型深比较不变）', () => {
    const model = buildGanttModelFromSeed(3)
    const snapshot = JSON.stringify(model.tasks.slice(0, 50))
    // 对 4 档粒度分别取坐标（模拟切换），模型不应被触碰。
    for (const g of ['day', 'week', 'month', 'quarter'] as const) {
      const scale = createScale(g, { epochMs: model.epochMs })
      model.tasks.slice(0, 50).forEach((t) => dayToX(scale, t.startDay))
      buildTimeTicks(scale, model.timeRange)
    }
    expect(JSON.stringify(model.tasks.slice(0, 50))).toBe(snapshot)
  })
})

describe('密度改行高（task 3.7）', () => {
  it('紧凑行高 < 舒适行高，垂直坐标随之收紧', () => {
    const comfy = createScale('day', { rowHeight: 34 })
    const compact = createScale('day', { rowHeight: 26 })
    expect(rowCenterY(compact, 10)).toBeLessThan(rowCenterY(comfy, 10))
    expect(chartHeight(compact, 100)).toBeLessThan(chartHeight(comfy, 100))
  })
})
