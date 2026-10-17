import { describe, expect, it } from 'vitest'
import { createScale } from '@/lib/gantt/geometry'
import {
  buildBarBoxes,
  buildDepEndpoints,
  buildRowIndex,
  DependencyIndex,
} from '@/lib/gantt/dependency-index'
import {
  badgeKey,
  computeDependencyVisibility,
  type VisibilityInput,
} from '@/lib/gantt/dependency-visibility'
import type { GanttRenderDependency, GanttRenderTask } from '@/lib/gantt/types'

const scale = createScale('day', { rowHeight: 20 })

/** 6 行任务，均 startDay 0、工期 5（条盒 x=0..140），行号＝数组序。 */
const tasks: GanttRenderTask[] = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  name: `T${i}`,
  wbsCode: String(i),
  depth: 0,
  parentId: null,
  kind: 'task',
  startDay: 0,
  durationDays: 5,
  progress: 0,
  status: 'not_started',
}))

function dep(
  id: number,
  predecessorId: number,
  successorId: number,
  isCritical = false,
): GanttRenderDependency {
  return { id, predecessorId, successorId, type: 'fs', lagDays: 0, isCritical }
}

const deps: GanttRenderDependency[] = [
  dep(0, 0, 1), // 两端可见
  dep(1, 0, 5, true), // 关键路径，一端（行5）离屏
  dep(2, 4, 5), // 两端离屏
  dep(3, 2, 5), // 默认 muted，出向离屏 → trail 徽标
  dep(4, 5, 2), // 默认 muted，入向离屏 → lead 徽标
]

const rowIndexByTask = buildRowIndex(tasks)
const boxes = buildBarBoxes(scale, tasks)
const endpoints = buildDepEndpoints(scale, deps, boxes)
const index = new DependencyIndex(deps, rowIndexByTask)

function baseInput(overrides: Partial<VisibilityInput> = {}): VisibilityInput {
  return {
    deps,
    endpoints,
    index,
    visibleRows: new Set([0, 1, 2, 3]),
    rowRange: { minRow: 0, maxRow: 3 },
    pxRange: { minX: -100, maxX: 1000 },
    dependencyDefault: 'muted',
    alwaysShowCriticalPath: true,
    hoveredTaskId: null,
    selectedTaskId: null,
    showAllDependencies: false,
    ...overrides,
  }
}

describe('依赖端点空间索引（4.2）', () => {
  it('只返回与可见行相交的依赖，两端全离屏者排除', () => {
    const hits = index.incidentToRange(0, 3)
    expect(hits.has(0)).toBe(true) // 行0/1
    expect(hits.has(1)).toBe(true) // 行0
    expect(hits.has(3)).toBe(true) // 行2
    expect(hits.has(4)).toBe(true) // 行2
    expect(hits.has(2)).toBe(false) // 行4/5，均离屏
  })
})

describe('可见性分类（4.3/4.4/4.5/4.6/4.9）', () => {
  it('标准入口默认：两端可见画 muted、关键路径常显、越界聚合为徽标、两端离屏跳过', () => {
    const { lines, badges } = computeDependencyVisibility(baseInput())
    const byId = new Map(lines.map((l) => [l.id, l]))
    expect(byId.get(0)?.style).toBe('muted') // 两端可见
    expect(byId.get(1)?.style).toBe('critical') // 关键路径，clipped
    expect(byId.get(1)?.clipped).toBe(true)
    expect(byId.has(2)).toBe(false) // 两端离屏跳过
    // d3/d4 越界聚合，不作为连线。
    expect(byId.has(3)).toBe(false)
    expect(byId.has(4)).toBe(false)
    const keys = badges.map((b) => badgeKey(b.rowIndex, b.side)).sort()
    expect(keys).toEqual(['2:lead', '2:trail'])
    expect(badges.find((b) => b.side === 'trail')?.depIds).toContain(3)
    expect(badges.find((b) => b.side === 'lead')?.depIds).toContain(4)
  })

  it('悬停某任务：仅其依赖链高亮，其余保持默认', () => {
    const { lines } = computeDependencyVisibility(baseInput({ hoveredTaskId: 1 }))
    const byId = new Map(lines.map((l) => [l.id, l]))
    expect(byId.get(0)?.style).toBe('highlight') // 0→1 命中悬停链
    expect(byId.get(1)?.style).toBe('critical') // 未命中悬停链，保持关键路径色
  })

  it('简化入口：默认零常规连线，但关键路径仍常显（Q2×Q6 交叉修正）', () => {
    const { lines, badges } = computeDependencyVisibility(
      baseInput({ dependencyDefault: 'hidden' }),
    )
    const ids = lines.map((l) => l.id)
    expect(ids).toEqual([1]) // 只剩关键路径
    expect(lines[0]?.style).toBe('critical')
    expect(badges).toHaveLength(0) // 常规连线连徽标都不出
  })

  it('简化入口悬停：显示该任务依赖链', () => {
    const { lines } = computeDependencyVisibility(
      baseInput({ dependencyDefault: 'hidden', hoveredTaskId: 1 }),
    )
    const byId = new Map(lines.map((l) => [l.id, l]))
    expect(byId.get(0)?.style).toBe('highlight') // 悬停链显现
  })

  it('问题链常显：端点落在问题任务的依赖以 problem 样式常显（含简化入口）', () => {
    const { lines } = computeDependencyVisibility(
      baseInput({
        dependencyDefault: 'hidden', // 简化入口默认隐藏常规连线
        showProblemChain: true,
        problemTaskIds: new Set([1]), // 任务1 受阻
      }),
    )
    const byId = new Map(lines.map((l) => [l.id, l]))
    expect(byId.get(0)?.style).toBe('problem') // 0→1 触及问题任务，隐藏默认下仍常显
    expect(byId.get(1)?.style).toBe('critical') // 关键路径优先级高于问题链
  })

  it('显示全部依赖：绕过聚合，越界连线改为绘制到边界', () => {
    const { lines, badges } = computeDependencyVisibility(baseInput({ showAllDependencies: true }))
    const ids = lines.map((l) => l.id).sort()
    expect(ids).toEqual([0, 1, 3, 4]) // d2 仍因两端离屏被裁
    expect(badges).toHaveLength(0)
    expect(lines.find((l) => l.id === 3)?.clipped).toBe(true)
  })

  it('展开徽标：被折叠依赖重新绘制（裁剪是隐藏非删除，4.9）', () => {
    const expanded = new Set([badgeKey(2, 'trail')])
    const { lines, badges } = computeDependencyVisibility(baseInput({ expandedBadges: expanded }))
    expect(lines.find((l) => l.id === 3)).toBeTruthy() // d3 展开为连线
    // 仅 trail 展开，lead 仍是徽标。
    expect(badges.map((b) => b.side)).toEqual(['lead'])
  })
})
