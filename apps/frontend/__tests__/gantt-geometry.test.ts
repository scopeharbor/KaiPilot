import { describe, expect, it } from 'vitest'
import {
  buildTimeTicks,
  CHART_EPOCH_MS,
  createScale,
  dateToDay,
  dayToDate,
  dayToX,
  dependencyEndpoints,
  dependencyPath,
  DEFAULT_PX_PER_DAY,
  durationToWidth,
  isWeekend,
  rowCenterY,
  rowIndexAtY,
  xToDay,
} from '@/lib/gantt/geometry'
import { GANTT_ENTRY_PRESETS, getEntryPreset } from '@/lib/gantt/entry-presets'
import { STATUS_TOKEN, statusVar, svgVar } from '@/lib/gantt/palette'
import type { TaskStatus } from '@/lib/api/tasks'

describe('gantt geometry —— 坐标换算（承自 M0 layout，扩四粒度）', () => {
  it('createScale 按粒度取默认像素密度、可覆盖', () => {
    const day = createScale('day')
    expect(day.pxPerDay).toBe(DEFAULT_PX_PER_DAY.day)
    expect(day.epochMs).toBe(CHART_EPOCH_MS)
    const q = createScale('quarter', { pxPerDay: 2, rowHeight: 26 })
    expect(q.pxPerDay).toBe(2)
    expect(q.rowHeight).toBe(26)
  })

  it('dayToX / xToDay 互逆', () => {
    const s = createScale('day')
    expect(xToDay(s, dayToX(s, 42))).toBeCloseTo(42)
  })

  it('durationToWidth：里程碑归零、叶子任务保底 3px', () => {
    const s = createScale('day')
    expect(durationToWidth(s, 0)).toBe(0)
    expect(durationToWidth(s, 0.01)).toBe(3) // < 3px 时保底
    expect(durationToWidth(s, 5)).toBe(5 * s.pxPerDay)
  })

  it('行换算：rowCenterY 居中、rowIndexAtY 反解', () => {
    const s = createScale('day', { rowHeight: 30 })
    expect(rowCenterY(s, 2)).toBe(2 * 30 + 15)
    expect(rowIndexAtY(s, 65)).toBe(2)
  })

  it('dayToDate / dateToDay 互逆（整数天）', () => {
    const s = createScale('day')
    const d = dayToDate(s, 100)
    expect(dateToDay(s, d.getTime())).toBe(100)
  })
})

describe('gantt geometry —— 依赖锚点按 fs/ss/ff/sf 精确化', () => {
  const s = createScale('day', { rowHeight: 20 })
  const pred = { x: 100, width: 40, rowIndex: 0 } // 头100 尾140
  const succ = { x: 300, width: 30, rowIndex: 2 } // 头300 尾330

  it('fs：前置尾 → 后置头', () => {
    const e = dependencyEndpoints(s, pred, succ, 'fs')
    expect(e.x1).toBe(140)
    expect(e.x2).toBe(300)
    expect(e.y1).toBe(rowCenterY(s, 0))
    expect(e.y2).toBe(rowCenterY(s, 2))
  })

  it('ss：前置头 → 后置头', () => {
    const e = dependencyEndpoints(s, pred, succ, 'ss')
    expect(e.x1).toBe(100)
    expect(e.x2).toBe(300)
  })

  it('ff：前置尾 → 后置尾', () => {
    const e = dependencyEndpoints(s, pred, succ, 'ff')
    expect(e.x1).toBe(140)
    expect(e.x2).toBe(330)
  })

  it('sf：前置头 → 后置尾', () => {
    const e = dependencyEndpoints(s, pred, succ, 'sf')
    expect(e.x1).toBe(100)
    expect(e.x2).toBe(330)
  })

  it('未知类型回退 fs', () => {
    const e = dependencyEndpoints(s, pred, succ, 'xx')
    expect(e.x1).toBe(140)
    expect(e.x2).toBe(300)
  })

  it('dependencyPath 生成三次贝塞尔、最小弧度 24', () => {
    const path = dependencyPath({ x1: 0, y1: 0, x2: 10, y2: 0 })
    expect(path.startsWith('M0,0 C')).toBe(true)
    expect(path).toContain('24,0') // |dx|=10*.5=5 < 24 → 取 24
  })
})

describe('gantt geometry —— 时间轴刻度四粒度', () => {
  const range = { startDay: 0, endDay: 180 }

  it('日粒度：等距天步长、月首为主刻度', () => {
    const s = createScale('day')
    const ticks = buildTimeTicks(s, range)
    expect(ticks.length).toBe(181)
    expect(ticks[0]!.day).toBe(0)
    expect(ticks.some((t) => t.major)).toBe(true)
  })

  it('周粒度：7 天步长', () => {
    const s = createScale('week')
    const ticks = buildTimeTicks(s, range)
    expect(ticks[1]!.day - ticks[0]!.day).toBe(7)
  })

  it('月粒度：对齐自然月、首月标年', () => {
    const s = createScale('month')
    const ticks = buildTimeTicks(s, range)
    expect(ticks.length).toBeGreaterThanOrEqual(6)
    expect(ticks[0]!.label).toContain('年')
    expect(ticks[0]!.major).toBe(true)
  })

  it('季粒度：Q 标签、季首主刻度', () => {
    const s = createScale('quarter')
    const ticks = buildTimeTicks(s, { startDay: 0, endDay: 365 })
    expect(ticks[0]!.label).toMatch(/Q[1-4]/)
    expect(ticks[0]!.major).toBe(true)
  })

  it('isWeekend 判周六日', () => {
    const s = createScale('day')
    // epoch 2026-01-01 为周四；+2=周六、+3=周日。
    expect(isWeekend(s, 0)).toBe(false)
    expect(isWeekend(s, 2)).toBe(true)
    expect(isWeekend(s, 3)).toBe(true)
  })
})

describe('gantt palette / entry presets', () => {
  it('六状态均有语义色令牌', () => {
    const statuses: TaskStatus[] = [
      'not_started',
      'in_progress',
      'completed',
      'blocked',
      'on_hold',
      'cancelled',
    ]
    for (const s of statuses) {
      expect(STATUS_TOKEN[s].startsWith('--')).toBe(true)
    }
    expect(svgVar('--success')).toBe('var(--success)')
    expect(statusVar('completed')).toBe('var(--success)')
  })

  it('双入口：简化隐藏常规连线/WBS 编号、加头像；两入口均常显关键路径', () => {
    const std = getEntryPreset('standard')
    const simp = getEntryPreset('simplified')
    expect(std.dependencyDefault).toBe('muted')
    expect(simp.dependencyDefault).toBe('hidden')
    expect(std.showWbsCode).toBe(true)
    expect(simp.showWbsCode).toBe(false)
    expect(simp.showAssigneeAvatar).toBe(true)
    // Q2×Q6 交叉修正：两入口都常显关键路径。
    expect(std.alwaysShowCriticalPath).toBe(true)
    expect(simp.alwaysShowCriticalPath).toBe(true)
    expect(std.offerShowAllDependencies).toBe(true)
    expect(simp.offerShowAllDependencies).toBe(false)
    // preset 表覆盖两入口。
    expect(Object.keys(GANTT_ENTRY_PRESETS)).toEqual(['standard', 'simplified'])
  })
})
