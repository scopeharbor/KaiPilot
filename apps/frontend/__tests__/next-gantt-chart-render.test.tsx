/**
 * v3-ui-next-gantt-lens tasks 1.8 —— 甘特画板渲染与视口裁剪测试。
 *
 * 覆盖（tasks 1.3–1.8 + design D10 jsdom 模式）：
 * - 日/周/月三档刻度渲染（主/次两级标尺、周末标定）；
 * - 今天指示线对齐（x = 天偏移 × pxPerDay）与「定位到今天」聚焦（scrollTo 目标）；
 * - 任务条：状态发丝边框、进度填充、优先级微标、名称/负责人缩写；里程碑 45° 菱形锚点；
 * - 四类依赖正交折线 d 路径精确断言、CPM 关键路径 --nx-space-cyan 高亮与
 *   showAllDependencies/showCriticalPath 开关显隐、焦点悬停上下游链高亮与无关线淡化；
 * - 滚动触发双向视口裁剪（ROW_BUFFER=4 / DAY_BUFFER=4）剔除视口外图元，
 *   常驻活动图元 `[data-gantt-element]` ≤ 200 断言。
 *
 * 数据源为确定性 fixture（buildGanttModelFromApi 纯函数），组件消费独立
 * `createGanttViewStore()` 实例（不触碰应用级单例与 localStorage，恪守 RL-08）。
 */
import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceGanttChart } from '@/components/next/gantt/WorkspaceGanttChart'
import { buildGanttModelFromApi } from '@/lib/gantt/model-from-api'
import type { TaskDependency, DependencyType } from '@/lib/api/dependencies'
import type { Milestone } from '@/lib/api/milestones'
import type { Task } from '@/lib/api/tasks'
import { createGanttViewStore } from '@/stores/gantt-store'
import type { GanttModel } from '@/lib/gantt/types'

const EPOCH_ISO = '2026-09-07' // 周一
const EPOCH_MS = Date.parse(`${EPOCH_ISO}T00:00:00Z`)
const MS_DAY = 86_400_000

const iso = (dayOffset: number): string =>
  new Date(EPOCH_MS + dayOffset * MS_DAY).toISOString().slice(0, 10)

function taskOf(overrides: Partial<Task> & { id: number }): Task {
  return {
    id: overrides.id,
    projectId: 7,
    name: overrides.name ?? `任务${overrides.id}`,
    description: null,
    status: overrides.status ?? 'not_started',
    priority: overrides.priority ?? 'medium',
    taskType: overrides.taskType ?? 'task',
    startDate: overrides.startDate ?? iso(0),
    endDate: overrides.endDate ?? iso(4),
    actualStartDate: null,
    actualEndDate: null,
    durationDays: overrides.durationDays ?? 5,
    estimatedHours: null,
    actualHours: null,
    progressPercent: overrides.progressPercent ?? 0,
    assigneeId: overrides.assigneeId ?? null,
    assignee: overrides.assignee,
    reviewerId: null,
    parentTaskId: overrides.parentTaskId ?? null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
  }
}

function depOf(
  overrides: { id: number; predecessorId: number; successorId: number } & Partial<{
    type: DependencyType
    lagDays: number
  }>,
): TaskDependency {
  return {
    id: overrides.id,
    predecessorId: overrides.predecessorId,
    successorId: overrides.successorId,
    type: overrides.type ?? 'fs',
    lagDays: overrides.lagDays ?? 0,
    predecessor: {
      id: overrides.predecessorId,
      name: `任务${overrides.predecessorId}`,
      status: 'not_started',
      startDate: null,
      endDate: null,
    },
    successor: {
      id: overrides.successorId,
      name: `任务${overrides.successorId}`,
      status: 'not_started',
      startDate: null,
      endDate: null,
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
  }
}

/**
 * 确定性 fixture（60 任务 + 4 类依赖 + 3 链关键路径 + 1 真实里程碑）：
 * - 关键链：任务 41/42/43（行 40/41/42）依次 startDay 0/5/10、工期 5 天，
 *   日期恰为 09-07/09-14/09-21（周一）起，是全表最晚完成链 → CPM 三任务均 critical；
 * - 其余任务 startDay = (i×7)%12、工期 2 天（endDay ≤ 13 < 关键链终点 14）。
 */
function buildFixtureModel(): { model: GanttModel; tasks: Task[] } {
  const tasks: Task[] = []
  for (let i = 0; i < 60; i++) {
    const id = i + 1
    const isChain = i === 40 || i === 41 || i === 42
    const startDay = isChain ? (i - 40) * 5 : (i * 7) % 12
    const durationDays = isChain ? 5 : 2
    tasks.push(
      taskOf({
        id,
        name: `任务${id}`,
        startDate: iso(startDay),
        endDate: iso(startDay + durationDays - 1),
        durationDays,
        status: i === 0 ? 'in_progress' : 'not_started',
        priority: i === 0 ? 'high' : 'medium',
        progressPercent: i === 0 ? 60 : 0,
        assigneeId: i === 0 ? 1 : null,
        assignee:
          i === 0
            ? { id: 1, fullName: '张三', email: 'zs@example.com', initials: 'ZS' }
            : undefined,
      }),
    )
  }
  const deps: TaskDependency[] = [
    depOf({ id: 1, predecessorId: 1, successorId: 2, type: 'fs' }),
    depOf({ id: 2, predecessorId: 11, successorId: 12, type: 'ss' }),
    depOf({ id: 3, predecessorId: 21, successorId: 22, type: 'ff' }),
    depOf({ id: 4, predecessorId: 31, successorId: 32, type: 'sf' }),
    depOf({ id: 5, predecessorId: 41, successorId: 42, type: 'fs' }),
    depOf({ id: 6, predecessorId: 42, successorId: 43, type: 'fs' }),
  ]
  const milestones: Milestone[] = [
    {
      id: 1,
      projectId: 7,
      name: '里程碑 M1',
      description: null,
      status: 'planned',
      storedStatus: 'planned',
      plannedDate: iso(14),
      autoCalculated: false,
      displayOrder: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: null,
    },
  ]
  const model = buildGanttModelFromApi(tasks, deps, null, milestones)
  // 本套件断言渲染几何（行号 = 任务 id − 1、里程碑行在末尾），显式固定为输入顺序；
  // 「按计划开始排序」的行序规则由 model-from-api 的 orderRowsByStart 单测覆盖。
  const inputOrder = new Map(tasks.map((task, index) => [task.id, index]))
  model.tasks.sort(
    (a, b) => (inputOrder.get(a.id) ?? 1e9 - a.id) - (inputOrder.get(b.id) ?? 1e9 - b.id),
  )
  return { model, tasks }
}

function renderChart(overrides?: {
  todayMs?: number
  store?: ReturnType<typeof createGanttViewStore>
  props?: Partial<Parameters<typeof WorkspaceGanttChart>[0]>
}) {
  const { model } = buildFixtureModel()
  const store = overrides?.store ?? createGanttViewStore()
  const onRenderComplete = vi.fn()
  const utils = render(
    <WorkspaceGanttChart
      model={model}
      store={store}
      todayMs={overrides?.todayMs ?? EPOCH_MS + 40 * MS_DAY}
      initialViewport={{ width: 1200, height: 800 }}
      onRenderComplete={onRenderComplete}
      {...overrides?.props}
    />,
  )
  const viewport = utils.container.querySelector('[data-gantt-viewport]') as HTMLElement
  const canvas = utils.container.querySelector('[data-gantt-canvas]') as SVGElement
  return { ...utils, store, viewport, canvas, onRenderComplete, model }
}

function scrollTo(viewport: HTMLElement, scrollTop: number, scrollLeft = 0) {
  viewport.scrollTop = scrollTop
  viewport.scrollLeft = scrollLeft
  fireEvent.scroll(viewport)
}

function barsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-gantt-bar]')) as HTMLElement[]
}

function depsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-gantt-dep-line]')) as HTMLElement[]
}

describe('WorkspaceGanttChart（tasks 1.3–1.8）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('日刻度渲染：两级标尺、月界主刻度、01 次刻度与发丝底边', () => {
    const { container } = renderChart()
    expect(container.querySelector('[data-gantt-time-axis]')).not.toBeNull()
    const major = container.querySelectorAll('[data-gantt-tick-band="major"]')
    const minor = container.querySelectorAll('[data-gantt-tick-band="minor"]')
    expect(major.length).toBeGreaterThan(0)
    expect(minor.length).toBeGreaterThanOrEqual(30)
    // 任务从 2026-09-07 开始（day 0），视口内首个月界主刻度为 10 月 1 日。
    expect(major[0]!.textContent).toBe('2026年10月')
    expect(minor[0]!.querySelector('text')?.textContent).toBe('07')
    const axisSvg = container.querySelector('[data-gantt-axis-svg]')!
    // spanDays = max(任务终点 15, 今天 40 + 7) = 47 → 47×40 + 48。
    expect(axisSvg.getAttribute('width')).toBe('1928')
    // 工具栏粒度按钮（默认日）。
    const dayBtn = container.querySelector('[data-gantt-granularity="day"]')!
    expect(dayBtn.getAttribute('aria-pressed')).toBe('true')
  })

  test('今天指示线对齐：x = 天偏移 × 40px，含发光底与「今天」徽标', () => {
    const { container, viewport, model } = renderChart({ todayMs: EPOCH_MS + 5 * MS_DAY })
    expect(model.epochMs).toBe(EPOCH_MS)
    const line = container.querySelector('[data-gantt-today-line]')!
    expect(line.getAttribute('x1')).toBe('200')
    expect(line.getAttribute('x2')).toBe('200')
    expect(container.querySelector('[data-gantt-today-glow]')).not.toBeNull()
    expect(container.querySelector('[data-gantt-today-label]')?.textContent).toBe('今天')
    expect(viewport.querySelector('[data-gantt-today-badge] title')?.textContent).toContain(
      '2026-09-12',
    )
  })

  test('今天线视口外不实例化；滚动后进入视口', () => {
    const { container, viewport } = renderChart() // today = day 40
    expect(container.querySelector('[data-gantt-today-line]')).toBeNull()
    scrollTo(viewport, 0, 600) // 可见天窗口 11..49 → 今天（40）进入
    const line = container.querySelector('[data-gantt-today-line]')!
    expect(line.getAttribute('x1')).toBe('1600')
  })

  test('任务条：状态发丝边框、进度填充、优先级微标与负责人缩写', () => {
    const { container } = renderChart()
    const bar = container.querySelector('[data-task-id="1"] [data-gantt-bar]')!
    expect(bar.getAttribute('x')).toBe('0')
    expect(bar.getAttribute('width')).toBe('80') // 2×40（与依赖锚点几何一致）
    expect(bar.getAttribute('stroke')).toBe('var(--nx-space-cyan)') // in_progress
    const progress = container.querySelector('[data-task-id="1"] [data-gantt-bar-progress]')!
    expect(parseFloat(progress.getAttribute('width')!)).toBeCloseTo(46.8, 1) // (80−2)×0.6
    const badge = container.querySelector('[data-task-id="1"] [data-gantt-priority-badge]')!
    expect(badge.getAttribute('fill')).toBe('var(--nx-chart-7)') // high
    const name = container.querySelector('[data-task-id="1"] [data-gantt-bar-name]')!
    expect(name.textContent).toBe('任务1 · ZS')
    // 宽条名称渲染在条内（x > 条左缘）。
    expect(parseFloat(name.getAttribute('x')!)).toBeGreaterThan(0)
  })

  test('只读浏览态：悬停更新 hoveredTaskId、选中更新 selectedTaskId（零网络）', () => {
    const { container, store } = renderChart()
    const bar = container.querySelector('[data-task-id="1"] [data-gantt-bar]')!
    fireEvent.mouseOver(bar)
    expect(store.getState().hoveredTaskId).toBe(1)
    fireEvent.mouseLeave(bar)
    expect(store.getState().hoveredTaskId).toBeNull()
    fireEvent.click(bar)
    expect(store.getState().selectedTaskId).toBe(1)
  })

  test('里程碑：45° 旋转菱形锚定计划日期行与名称标注', () => {
    const { container, viewport } = renderChart()
    // 里程碑行 = 第 61 行（60 任务 + 1 里程碑行）→ 滚动进入视口。
    scrollTo(viewport, 60 * 36 - 200, 0)
    const diamond = container.querySelector('[data-gantt-milestone] polygon')!
    expect(diamond.getAttribute('transform')).toBe('rotate(45 560 2178)')
    expect(diamond.getAttribute('fill')).toBe('var(--nx-workspace-blue)') // planned
    expect(container.querySelector('[data-gantt-milestone-name]')?.textContent).toBe('里程碑 M1')
  })

  test('四类依赖正交折线：FS/SS/FF/SF d 路径精确断言', () => {
    const store = createGanttViewStore()
    store.setState({ showAllDependencies: true })
    const { container, viewport } = renderChart({ store })
    // 滚动 0：行窗口 0..27 → 依赖 1/2/3（端点行 0-21）。
    let deps = depsOf(container)
    expect(deps).toHaveLength(3)
    const pathOf = (depId: number): string =>
      container.querySelector(`[data-dep-id="${depId}"] path`)!.getAttribute('d')!
    expect(pathOf(1)).toBe('M80,18 H104 V54 H280') // fs：任务1→任务2
    expect(pathOf(2)).toBe('M400,378 H376 V414 H200') // ss：任务11→任务12
    expect(pathOf(3)).toBe('M400,738 H300 V774 H200') // ff：任务21→任务22
    expect(container.querySelector('[data-dep-id="1"]')!.getAttribute('data-dep-type')).toBe('fs')
    expect(container.querySelector('[data-dep-id="3"]')!.getAttribute('data-dep-type')).toBe('ff')
    // 滚动至行窗口含 30..31 → sf 依赖出现。
    scrollTo(viewport, 30 * 36, 0)
    deps = depsOf(container)
    expect(deps.some((d) => d.getAttribute('data-dep-id') === '4')).toBe(true)
    expect(pathOf(4)).toBe('M240,1098 H216 V1134 H120') // sf：任务31→任务32
    // 依赖连线均带 data-gantt-element。
    expect(
      container.querySelector('[data-gantt-dependency-layer] [data-gantt-element]'),
    ).not.toBeNull()
  })

  test('CPM 关键路径高亮：--nx-space-cyan 实线 + 发光底，开关控制显隐', () => {
    const { container, viewport, store } = renderChart()
    // 默认 showAllDependencies=false：滚动到关键链行（行 36..60 含 40–42）后仅关键依赖可见。
    scrollTo(viewport, 40 * 36, 0)
    const deps = depsOf(container)
    expect(deps).toHaveLength(2) // dep 5、6
    for (const dep of deps) {
      expect(dep.getAttribute('data-gantt-critical')).toBe('true')
      expect(dep.querySelector('path')!.getAttribute('stroke')).toBe('var(--nx-space-cyan)')
      expect(dep.querySelector('[data-gantt-dep-glow]')).not.toBeNull()
    }
    // 关闭关键路径 → 依赖全部消失（焦点为空）。
    act(() => store.setState({ showCriticalPath: false }))
    expect(depsOf(container)).toHaveLength(0)
    // 开启「全部依赖」并回到顶部 → 普通依赖以清晰的次要色呈现（不再是几乎透明的发丝线），带方向箭头。
    act(() => store.setState({ showAllDependencies: true }))
    scrollTo(viewport, 0, 0)
    const allDeps = depsOf(container)
    expect(allDeps.length).toBeGreaterThan(2)
    const normal = allDeps.find((d) => d.getAttribute('data-gantt-critical') !== 'true')!
    const normalPath = normal.querySelector(':scope > path')!
    expect(normalPath.getAttribute('stroke')).toBe('var(--nx-text-muted)')
    expect(normalPath.getAttribute('marker-end')).toBe('url(#nx-gantt-dep-arrow)')
  })

  test('悬停焦点链高亮：上下游依赖提亮、无关连线透明度降至 20%', () => {
    const store = createGanttViewStore()
    store.setState({ showAllDependencies: true })
    const { container } = renderChart({ store })
    const bar = container.querySelector('[data-task-id="1"] [data-gantt-bar]')!
    fireEvent.mouseOver(bar)
    const dep1 = container.querySelector('[data-dep-id="1"]') as HTMLElement
    expect(dep1.getAttribute('data-gantt-dep-focused')).toBe('true')
    expect(dep1.querySelector('path')!.getAttribute('stroke')).toBe('var(--nx-space-cyan)')
    const dep2 = container.querySelector('[data-dep-id="2"]') as HTMLElement
    expect(dep2.getAttribute('opacity')).toBe('0.2')
    fireEvent.mouseLeave(bar)
    expect(
      (container.querySelector('[data-dep-id="2"]') as HTMLElement).hasAttribute('opacity'),
    ).toBe(false)
  })

  test('滚动触发双向视口裁剪：行窗口/天窗口剔除视口外图元', () => {
    const { container, viewport } = renderChart()
    // 初始（scrollTop=0）：可见行 0..31，任务 1 在列。
    expect(barsOf(container).length).toBeGreaterThanOrEqual(28)
    expect(container.querySelector('[data-task-id="1"]')).not.toBeNull()
    // 纵向滚动 1000px：可见行 23..54 → 任务 1（行 0）剔除。
    scrollTo(viewport, 1000, 0)
    expect(container.querySelector('[data-task-id="1"]')).toBeNull()
    expect(container.querySelector('[data-task-id="24"]')).not.toBeNull()
    expect(barsOf(container).length).toBeLessThanOrEqual(35)
    // 横向滚动 600px：天窗口 11..49 → 任务 24（行 23，startDay 5、endDay 6）被天窗口剔除。
    scrollTo(viewport, 1000, 600)
    expect(container.querySelector('[data-task-id="24"]')).toBeNull()
    // 非视口依赖被空间索引剔除（dep1 端点行 0/1 在行窗口外）。
    const deps = depsOf(container)
    expect(deps.some((d) => d.getAttribute('data-dep-id') === '1')).toBe(false)
  })

  test('常驻活动图元 ≤ 200（design D9 断言机制）', () => {
    const { container, viewport } = renderChart()
    const countOf = () => container.querySelectorAll('svg [data-gantt-element]').length
    const initial = countOf()
    expect(initial).toBeLessThanOrEqual(200)
    scrollTo(viewport, 1000, 600)
    expect(countOf()).toBeLessThanOrEqual(200)
    scrollTo(viewport, 40 * 36, 1200)
    expect(countOf()).toBeLessThanOrEqual(200)
    // 渲染完成回调上报活动图元数（W4 性能预算断言通道）。
    expect(initial).toBeGreaterThan(0)
  })

  test('粒度切换：周刻度 W 序号标尺、条宽变为 2×(80/7)−1', () => {
    const { container } = renderChart()
    fireEvent.click(container.querySelector('[data-gantt-granularity="week"]')!)
    expect(
      container.querySelector('[data-gantt-granularity="week"]')!.getAttribute('aria-pressed'),
    ).toBe('true')
    const bar = container.querySelector('[data-task-id="1"] [data-gantt-bar]')!
    // 任务 1（非关键链）工期 2 天。
    expect(parseFloat(bar.getAttribute('width')!)).toBeCloseTo(2 * (80 / 7), 1)
    const minorLabels = Array.from(
      container.querySelectorAll('[data-gantt-tick-band="minor"] text'),
    ).map((t) => t.textContent ?? '')
    expect(minorLabels.some((label) => /^W\d+ \(\d{2}\/\d{2}\)$/.test(label))).toBe(true)
  })

  test('月刻度：单元格 ≈120px，周末阴影块在月档停用', () => {
    const { container } = renderChart()
    fireEvent.click(container.querySelector('[data-gantt-granularity="month"]')!)
    const bar = container.querySelector('[data-task-id="1"] [data-gantt-bar]')!
    expect(parseFloat(bar.getAttribute('width')!)).toBeCloseTo(2 * 4, 1)
    expect(container.querySelectorAll('[data-gantt-weekend-shade]')).toHaveLength(0)
    const labels = Array.from(
      container.querySelectorAll('[data-gantt-tick-band="minor"] text'),
    ).map((t) => t.textContent ?? '')
    expect(labels).toContain('2026年10月')
  })

  test('「定位到今天」一键聚焦：水平滚动居中目标', () => {
    const originalScrollTo = Element.prototype.scrollTo
    const scrollToSpy = vi.fn()
    Element.prototype.scrollTo = scrollToSpy
    try {
      const { container } = renderChart()
      fireEvent.click(container.querySelector('[data-gantt-today-button]')!)
      // 今天 = day 40 → 目标 = 40×40 − 1200/2 = 1000；画板宽 1928 − 视口 1200 → 上限 728。
      expect(scrollToSpy).toHaveBeenCalledWith({ left: 728, behavior: 'smooth' })
    } finally {
      Element.prototype.scrollTo = originalScrollTo
    }
  })

  test('月粒度下非工作日阴影块停用且网格线按 30 天步进', () => {
    const { container } = renderChart()
    fireEvent.click(container.querySelector('[data-gantt-granularity="month"]')!)
    expect(container.querySelectorAll('[data-gantt-grid-line]').length).toBeLessThanOrEqual(15)
  })
})

describe('WorkspaceGanttChart 打开任务详情与聚焦任务', () => {
  test('点左侧任务名或双击任务条打开详情；单击条只选中', () => {
    const onOpenTask = vi.fn()
    const { container, store } = renderChart({ props: { onOpenTask } })
    const nameRow = container.querySelector<HTMLElement>('[data-gantt-name-task-id="2"]')!
    fireEvent.click(nameRow)
    expect(onOpenTask).toHaveBeenLastCalledWith(2)
    expect(store.getState().selectedTaskId).toBe(2)

    const bar = container.querySelector('[data-gantt-bar-group][data-task-id="1"]')!
    fireEvent.click(bar)
    expect(onOpenTask).toHaveBeenCalledTimes(1)
    fireEvent.doubleClick(bar)
    expect(onOpenTask).toHaveBeenLastCalledWith(1)
  })

  test('聚焦任务：首次就绪时选中该任务（代替默认定位到今天）', () => {
    const { store } = renderChart({ props: { focusTaskId: 3 } })
    expect(store.getState().selectedTaskId).toBe(3)
  })
})
