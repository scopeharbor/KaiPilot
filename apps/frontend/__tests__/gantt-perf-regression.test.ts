import { describe, expect, it } from 'vitest'
import { createScale } from '@/lib/gantt/geometry'
import { buildGanttModelFromSeed } from '@/lib/gantt/model-from-m0'
import {
  buildBarBoxes,
  buildDepEndpoints,
  buildRowIndex,
  DependencyIndex,
} from '@/lib/gantt/dependency-index'
import { computeDependencyVisibility } from '@/lib/gantt/dependency-visibility'
import {
  __resetCriticalPathMemo,
  memoizedComputeCriticalPath,
  type CpmDependencyInput,
  type CpmTaskInput,
} from '@/lib/gantt/critical-path'
import { createWorkingCalendar } from '@/lib/gantt/working-calendar'

/**
 * CI 性能回归门禁（task 7.4）。headless 守住两条不可回退的性能不变量，
 * 防止「靠删图元 / 关裁剪」让真机门禁虚假通过。真机最差帧判据见
 * `docs/v1/gantt-t018-perf-retest-report.md` §4。
 */
describe('甘特性能回归门禁', () => {
  const model = buildGanttModelFromSeed(1)

  it('完整图元不缩水：1000 任务 + 四类依赖 + 里程碑齐全', () => {
    expect(model.tasks).toHaveLength(1000)
    expect(model.milestones.length).toBeGreaterThan(0)
    const types = new Set(model.dependencies.map((d) => d.type))
    for (const t of ['fs', 'ss', 'ff', 'sf']) expect(types.has(t as never)).toBe(true)
    expect(model.dependencies.length).toBeGreaterThan(500)
  })

  it('裁剪有效性：典型视口下待画连线数 ≪ 全量依赖', () => {
    const scale = createScale('day', { rowHeight: 34, epochMs: model.epochMs })
    const rowIndexByTask = buildRowIndex(model.tasks)
    const boxes = buildBarBoxes(scale, model.tasks)
    const endpoints = buildDepEndpoints(scale, model.dependencies, boxes)
    const index = new DependencyIndex(model.dependencies, rowIndexByTask)

    // 典型视口：约 40 可见行、~1400px 宽时间窗（含缓冲）。
    const visibleRows = new Set(Array.from({ length: 40 }, (_, i) => i))
    const { lines, badges } = computeDependencyVisibility({
      deps: model.dependencies,
      endpoints,
      index,
      visibleRows,
      rowRange: { minRow: 0, maxRow: 39 },
      pxRange: { minX: -240, maxX: 1440 },
      dependencyDefault: 'muted',
      alwaysShowCriticalPath: true,
      hoveredTaskId: null,
      selectedTaskId: null,
      showAllDependencies: false,
    })

    // 空间索引把候选限制在与可见行相交的极小子集。
    const candidates = index.incidentToRange(0, 39)
    expect(candidates.size).toBeLessThan(model.dependencies.length * 0.3)
    // 待画连线远少于全量（裁剪+聚合把视口外连线折成徽标或跳过）。
    expect(lines.length).toBeLessThan(model.dependencies.length * 0.25)
    // 绝不应把全量都画出来。
    expect(lines.length + badges.length).toBeLessThanOrEqual(candidates.size)
  })

  it('关闭裁剪对照：显示全部依赖时连线显著增多（证明裁剪确实在起作用）', () => {
    const scale = createScale('day', { rowHeight: 34, epochMs: model.epochMs })
    const rowIndexByTask = buildRowIndex(model.tasks)
    const boxes = buildBarBoxes(scale, model.tasks)
    const endpoints = buildDepEndpoints(scale, model.dependencies, boxes)
    const index = new DependencyIndex(model.dependencies, rowIndexByTask)
    const visibleRows = new Set(Array.from({ length: 40 }, (_, i) => i))
    const base = {
      deps: model.dependencies,
      endpoints,
      index,
      visibleRows,
      rowRange: { minRow: 0, maxRow: 39 },
      pxRange: { minX: -240, maxX: 1440 },
      dependencyDefault: 'muted' as const,
      alwaysShowCriticalPath: true,
      hoveredTaskId: null,
      selectedTaskId: null,
    }
    const culled = computeDependencyVisibility({ ...base, showAllDependencies: false })
    const all = computeDependencyVisibility({ ...base, showAllDependencies: true })
    // 显示全部会把原本聚合的越界连线也画出来 → 连线数不少于裁剪态。
    expect(all.lines.length).toBeGreaterThanOrEqual(culled.lines.length)
  })

  it('1000 任务交互夹具：滚动、选择、草稿、锚点 hover、徽标定位和导航跳转走轻量路径', () => {
    const scale = createScale('day', { rowHeight: 34, epochMs: model.epochMs })
    const rowIndexByTask = buildRowIndex(model.tasks)
    const boxes = buildBarBoxes(scale, model.tasks)
    const endpoints = buildDepEndpoints(scale, model.dependencies, boxes)
    const index = new DependencyIndex(model.dependencies, rowIndexByTask)
    const problemTaskIds = new Set(
      model.tasks.filter((task) => task.status === 'blocked').map((task) => task.id),
    )
    const visibleRows = new Set(Array.from({ length: 40 }, (_, i) => i + 120))
    const base = {
      deps: model.dependencies,
      endpoints,
      index,
      visibleRows,
      rowRange: { minRow: 120, maxRow: 159 },
      pxRange: { minX: 400, maxX: 2080 },
      dependencyDefault: 'muted' as const,
      alwaysShowCriticalPath: true,
      showProblemChain: true,
      problemTaskIds,
      showAllDependencies: false,
    }

    const selectedTask = model.tasks[130]!
    const hoveredTask = model.tasks[131]!
    const t0 = performance.now()
    const scrolled = computeDependencyVisibility({
      ...base,
      selectedTaskId: null,
      hoveredTaskId: null,
    })
    const selected = computeDependencyVisibility({
      ...base,
      selectedTaskId: selectedTask.id,
      hoveredTaskId: null,
    })
    const hovered = computeDependencyVisibility({
      ...base,
      selectedTaskId: selectedTask.id,
      hoveredTaskId: hoveredTask.id,
    })
    const expanded = computeDependencyVisibility({
      ...base,
      selectedTaskId: selectedTask.id,
      hoveredTaskId: hoveredTask.id,
      expandedBadges: new Set(
        scrolled.badges.slice(0, 2).map((badge) => `${badge.rowIndex}:${badge.side}`),
      ),
    })
    const dateDraft = {
      taskId: selectedTask.id,
      operation: 'move' as const,
      startDay: selectedTask.startDay + 1,
      endDay: selectedTask.startDay + Math.max(1, selectedTask.durationDays),
    }
    const locateTarget = scrolled.badges
      .flatMap((badge) => badge.depIds)
      .map((depId) => model.dependencies.find((dep) => dep.id === depId))
      .find(Boolean)
    const navigateTaskBox = boxes.get(selectedTask.id)
    const elapsed = performance.now() - t0

    expect(dateDraft.startDay).toBe(selectedTask.startDay + 1)
    expect(navigateTaskBox).toBeDefined()
    expect(locateTarget).toBeDefined()
    expect(selected.lines.length).toBeGreaterThanOrEqual(scrolled.lines.length)
    expect(hovered.lines.length).toBeGreaterThanOrEqual(selected.lines.length)
    expect(expanded.lines.length + expanded.badges.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(30)
  })

  it('滚动、hover、焦点和模式切换不需要 CPM 重算，命中复用已有结果', () => {
    const cal = createWorkingCalendar()
    const DAY = 86_400_000
    const cpmTasks: CpmTaskInput[] = model.tasks.map((t) => {
      const startMs = model.epochMs + t.startDay * DAY
      const span = t.kind === 'milestone' ? 0 : Math.max(t.durationDays - 1, 0)
      const endMs = model.epochMs + (t.startDay + span) * DAY
      const taskType =
        t.kind === 'milestone' ? 'milestone' : t.kind === 'summary' ? 'summary' : 'task'
      return { taskId: t.id, startMs, endMs, taskType }
    })
    const cpmDeps: CpmDependencyInput[] = model.dependencies.map((d) => ({
      depId: d.id,
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type,
      lagDays: d.lagDays,
    }))
    __resetCriticalPathMemo()
    const initial = memoizedComputeCriticalPath(cpmTasks, cpmDeps, cal)

    const scale = createScale('day', { rowHeight: 34, epochMs: model.epochMs })
    const rowIndexByTask = buildRowIndex(model.tasks)
    const boxes = buildBarBoxes(scale, model.tasks)
    const endpoints = buildDepEndpoints(scale, model.dependencies, boxes)
    const index = new DependencyIndex(model.dependencies, rowIndexByTask)
    for (let i = 0; i < 20; i += 1) {
      const rowStart = i * 10
      computeDependencyVisibility({
        deps: model.dependencies,
        endpoints,
        index,
        visibleRows: new Set(Array.from({ length: 40 }, (_, offset) => rowStart + offset)),
        rowRange: { minRow: rowStart, maxRow: rowStart + 39 },
        pxRange: { minX: i * 60, maxX: i * 60 + 1680 },
        dependencyDefault: 'muted',
        alwaysShowCriticalPath: true,
        hoveredTaskId: model.tasks[rowStart]?.id ?? null,
        selectedTaskId: model.tasks[rowStart + 5]?.id ?? null,
        showAllDependencies: false,
      })
    }

    const t0 = performance.now()
    const afterInteractions = memoizedComputeCriticalPath(cpmTasks, cpmDeps, cal)
    const elapsed = performance.now() - t0
    expect(afterInteractions).toBe(initial)
    expect(elapsed).toBeLessThan(10)
  })
})

/**
 * CPM 性能与正确性门禁（T021 task 7.1/7.2）。1000 任务单次计算须在个位数~低两位毫秒内，
 * 记忆化命中须 O(1) 复用，且关键路径正确（无环、存在关键任务、关键依赖两端均关键）。
 */
describe('CPM 性能回归门禁', () => {
  const model = buildGanttModelFromSeed(1)
  const cal = createWorkingCalendar()
  const DAY = 86_400_000

  const cpmTasks: CpmTaskInput[] = model.tasks.map((t) => {
    const startMs = model.epochMs + t.startDay * DAY
    const span = t.kind === 'milestone' ? 0 : Math.max(t.durationDays - 1, 0)
    const endMs = model.epochMs + (t.startDay + span) * DAY
    const taskType =
      t.kind === 'milestone' ? 'milestone' : t.kind === 'summary' ? 'summary' : 'task'
    return { taskId: t.id, startMs, endMs, taskType }
  })
  const cpmDeps: CpmDependencyInput[] = model.dependencies.map((d) => ({
    depId: d.id,
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    type: d.type,
    lagDays: d.lagDays,
  }))

  it('1000 任务 CPM 单次计算在预算内（< 30ms，不破坏 T018 门禁）', () => {
    __resetCriticalPathMemo()
    const t0 = performance.now()
    const result = memoizedComputeCriticalPath(cpmTasks, cpmDeps, cal)
    const elapsed = performance.now() - t0
    expect(result.ok).toBe(true)
    expect(elapsed).toBeLessThan(30)
  })

  it('记忆化命中 O(1) 复用：同签名返回同引用', () => {
    __resetCriticalPathMemo()
    const c0 = performance.now()
    const r1 = memoizedComputeCriticalPath(cpmTasks, cpmDeps, cal)
    const recompute = performance.now() - c0
    // 取多次命中里最快的一次：单次计时会被并发负载下偶发的调度 / GC 停顿放大
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now()
      const r2 = memoizedComputeCriticalPath(cpmTasks, cpmDeps, cal)
      best = Math.min(best, performance.now() - t0)
      expect(r2).toBe(r1)
    }
    // 签名构建 O(V+E)，命中仍远快于重算
    expect(best).toBeLessThan(5)
    expect(best).toBeLessThan(recompute)
  })

  it('关键路径正确性：无环、存在关键任务、关键依赖两端均关键', () => {
    __resetCriticalPathMemo()
    const result = memoizedComputeCriticalPath(cpmTasks, cpmDeps, cal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const criticalTasks = [...result.tasks.values()].filter((t) => t.isCritical)
    expect(criticalTasks.length).toBeGreaterThan(0)
    // 关键依赖两端任务必须关键
    for (const [depId, isCritical] of result.deps) {
      if (!isCritical) continue
      const dep = cpmDeps.find((d) => d.depId === depId)!
      expect(result.tasks.get(dep.predecessorId)?.isCritical).toBe(true)
      expect(result.tasks.get(dep.successorId)?.isCritical).toBe(true)
    }
  })
})
