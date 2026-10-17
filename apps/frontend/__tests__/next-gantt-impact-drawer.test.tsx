/**
 * v3-ui-next-gantt-lens W2（task 2.8/2.9）—— 试算影响摘要抽屉与告警确认测试。
 *
 * 覆盖：项目整体完工日期延期天数呈现（workingDelta）、直接与级联任务前后日期对比表格、
 * CPM 关键路径漂移任务高亮（新加入/脱离）、里程碑变动计数、告警列表渲染，
 * 以及「已知晓告警」勾选解锁 HUD「应用方案」提交状态（未勾选前阻断）。
 *
 * 夹具采用全周工作日历（workdays 0-6），使 CPM 的浮动计算退化为纯粹日历天数学，
 * 保证关键路径漂移与级联顺延断言完全确定（与后端 preview 权威计算解耦，纯前端内存派生）。
 */

import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { WorkspaceGanttWhatIfHud } from '@/components/next/gantt/WorkspaceGanttWhatIfHud'
import {
  WorkspaceGanttImpactDrawer,
  formatTaskDateRange,
  formatWorkingDelta,
} from '@/components/next/gantt/WorkspaceGanttImpactDrawer'
import type { GanttRenderDependency, GanttRenderTask } from '@/lib/gantt/types'
import type { WorkingCalendarSettingsInput } from '@/lib/gantt/working-calendar'

const EPOCH_MS = Date.UTC(2026, 0, 12) // 周一
const MS_PER_DAY = 86_400_000

const ALL_DAYS_CALENDAR: WorkingCalendarSettingsInput = {
  workdays: [0, 1, 2, 3, 4, 5, 6],
  holidays: [],
  extraWorkdays: [],
}

function iso(day: number): string {
  return new Date(EPOCH_MS + day * MS_PER_DAY).toISOString().slice(0, 10)
}

function makeTask(
  id: number,
  name: string,
  startDay: number,
  durationDays: number,
  overrides: Partial<GanttRenderTask> = {},
): GanttRenderTask {
  return {
    id,
    name,
    wbsCode: '',
    depth: 0,
    parentId: null,
    kind: 'task',
    startDay,
    durationDays,
    progress: 0,
    status: 'not_started',
    ...overrides,
  }
}

/**
 * 夹具：T1(0,5) --FS--> T2(5,3) --FS--> M1(8)；T3(0,10) 独立长任务。
 * 基线关键路径 = T3（10 天 > 链 8 天）；试算把 T1 工期拉长至 10 天
 * （resize-duration）→ 链 13 天反超 → T1/T2/M1 进入关键路径、T3 脱离；
 * 级联顺延：T2 → 10、M1 → 13；项目整体延后 3 天。
 */
const BASE_TASKS: readonly GanttRenderTask[] = [
  makeTask(1, '需求设计', 0, 5),
  makeTask(2, '开发实现', 5, 3),
  makeTask(3, '独立长任务', 0, 10),
  makeTask(4, '原型发布', 8, 0, { kind: 'milestone', milestoneId: 40 }),
]
const BASE_DEPS: readonly GanttRenderDependency[] = [
  { id: 1, predecessorId: 1, successorId: 2, type: 'fs', lagDays: 0 },
  { id: 2, predecessorId: 2, successorId: 4, type: 'fs', lagDays: 0 },
]

const BACKEND_PREVIEW = {
  previewToken: 'tok_test_preview',
  changes: [],
  warnings: [],
  conflicts: [],
  calendar: { version: 1, workdays: [0, 1, 2, 3, 4, 5, 6], holidays: [], extraWorkdays: [] },
}

function resetStore() {
  useWhatIfSessionStore.setState({
    session: {
      status: 'idle',
      projectId: null,
      baseSnapshot: null,
      history: { entries: [], cursor: 0, maxEntries: 100 },
      derivedPreview: null,
      backendPreview: null,
      errorMessage: null,
      hasUnsavedChanges: false,
    },
    impactSummary: null,
  })
}

/** 进入沙盒并执行一次工期拉伸（模拟 W2 拖拽产生的单条命令）。 */
function enterAndResize() {
  const store = useWhatIfSessionStore.getState()
  store.enterSession(BASE_TASKS, BASE_DEPS, ALL_DAYS_CALENDAR, 'v1', 101, EPOCH_MS)
  const result = store.executeCommand({
    kind: 'resize-duration',
    taskId: 1,
    newStartDate: iso(0),
    newEndDate: iso(9), // 工期 5 → 10 天
  })
  expect(result.valid).toBe(true)
  // 模拟 W3 阶段 1 预览通过后写入 backendPreview（HUD 应用门禁的前置条件）
  store.setBackendPreview(BACKEND_PREVIEW)
}

/**
 * 语义 data-* 属性选择器查询（组件未定义 data-testid，
 * 按 data-impact-* 与 data-what-if-* 前缀属性寻址）。
 */
function getByData<T extends HTMLElement = HTMLElement>(attr: string): T {
  const el = document.querySelector(`[${attr}]`)
  if (!el) throw new Error(`missing [${attr}]`)
  return el as T
}

async function findByData<T extends HTMLElement = HTMLElement>(attr: string): Promise<T> {
  await waitFor(() => getByData(attr))
  return getByData<T>(attr)
}

describe('WorkspaceGanttImpactDrawer + HUD 告警确认门禁（B4 甘特镜头 W2）', () => {
  beforeEach(resetStore)

  it('formatWorkingDelta：延期/提前/无变化的文案纯函数', () => {
    expect(formatWorkingDelta(3)).toBe('项目整体完工日期延后 3 天')
    expect(formatWorkingDelta(-2)).toBe('项目整体完工日期提前 2 天')
    expect(formatWorkingDelta(0)).toBe('项目整体完工日期无变化')
    expect(formatWorkingDelta(null)).toBe('项目整体完工日期无变化')
  })

  it('formatTaskDateRange：区间与里程碑单日', () => {
    expect(formatTaskDateRange(EPOCH_MS, 0, 5)).toBe('2026-01-12 ~ 2026-01-16')
    expect(formatTaskDateRange(EPOCH_MS, 8, 0)).toBe('2026-01-20')
  })

  it('抽屉呈现延期天数与前后排期对比（直接修改 + 级联顺延 + CPM 漂移 + 里程碑变动）', async () => {
    enterAndResize()
    const onClose = vi.fn()
    render(
      <>
        <WorkspaceGanttWhatIfHud onApply={null} />
        <WorkspaceGanttImpactDrawer open onClose={onClose} />
      </>,
    )

    // 影响摘要由 HUD 的 useWhatIfImpactSummary 自动计算：等一帧呈现
    const delta = await findByData('data-impact-working-delta')
    expect(delta).toHaveTextContent('项目整体完工日期延后 3 天')

    // 直接修改：仅 T1（工期 5 → 10，日期区间同步展示）
    const directRows = document.querySelectorAll(
      '[data-impact-task-row][data-impact-propagation="direct"]',
    )
    expect(directRows.length).toBe(1)
    expect(directRows[0]).toHaveTextContent('需求设计')
    expect(directRows[0]).toHaveTextContent(formatTaskDateRange(EPOCH_MS, 0, 5))
    expect(directRows[0]).toHaveTextContent(formatTaskDateRange(EPOCH_MS, 0, 10))
    expect(directRows[0]).toHaveTextContent('工期 5天 → 10天')
    expect(directRows[0]).toHaveTextContent('直接调整')

    // 级联顺延：T2 因 FS 约束被动后移（原 5-7 天 → 试算 10-12 天）
    const cascadeRows = document.querySelectorAll(
      '[data-impact-task-row][data-impact-propagation="cascade"]',
    )
    expect(cascadeRows.length).toBe(1)
    expect(cascadeRows[0]).toHaveTextContent('开发实现')
    expect(cascadeRows[0]).toHaveTextContent(formatTaskDateRange(EPOCH_MS, 5, 3))
    expect(cascadeRows[0]).toHaveTextContent(formatTaskDateRange(EPOCH_MS, 10, 3))
    expect(cascadeRows[0]).toHaveTextContent('依赖级联顺延')

    // 里程碑变动计数：M1 延后 1
    expect(getByData('data-impact-milestones')).toHaveTextContent('延后 1')

    // CPM 漂移：T1/T2/M1 新加入关键路径（链 13 天反超 T3），T3 脱离
    const added = document.querySelectorAll('[data-cp-added]')
    const removed = document.querySelectorAll('[data-cp-removed]')
    expect(added.length).toBe(3)
    expect(added[0]).toHaveTextContent('需求设计')
    expect(added[1]).toHaveTextContent('开发实现')
    expect(added[2]).toHaveTextContent('原型发布')
    expect(removed.length).toBe(1)
    expect(removed[0]).toHaveTextContent('独立长任务')
  })

  it('告警渲染 + 未勾选前阻断应用，勾选「已知晓告警」后解锁 HUD 应用按钮', async () => {
    enterAndResize()
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(
      <>
        <WorkspaceGanttWhatIfHud onApply={onApply} />
        <WorkspaceGanttImpactDrawer open onClose={onClose} />
      </>,
    )

    const applyButton = await findByData<HTMLButtonElement>('data-what-if-apply')
    // CPM 漂移产生 warning 级证据 → 未确认前应用按钮禁用（阻断提交）
    expect(applyButton).toBeDisabled()
    expect(getByData('data-impact-warnings')).toBeTruthy()

    // 告警确认勾选框存在且未勾选
    const checkbox = await findByData<HTMLInputElement>('data-impact-confirm-warnings')
    expect(checkbox).not.toBeChecked()
    expect(getByData('data-impact-gate-hint')).toHaveTextContent('「应用方案」按钮保持禁用')

    // 勾选确认
    fireEvent.click(checkbox)
    await waitFor(() => expect(checkbox).toBeChecked())

    // 解锁：应用按钮可用，点击触发 onApply（W3 提交接入点）
    await waitFor(() => expect(applyButton).toBeEnabled())
    fireEvent.click(applyButton)
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('无告警时勾选框不出现，抽屉呈现「无排程告警」', async () => {
    // 无 CPM 漂移 + 无里程碑顺延场景：T1 平移 1 天（链 8 天 < T3 10 天），
    // 且 M1 不挂在 FS 链上 → 无 warning 级证据
    const store = useWhatIfSessionStore.getState()
    const depsWithoutMilestone: readonly GanttRenderDependency[] = [
      { id: 1, predecessorId: 1, successorId: 2, type: 'fs', lagDays: 0 },
    ]
    store.enterSession(BASE_TASKS, depsWithoutMilestone, ALL_DAYS_CALENDAR, 'v1', 101, EPOCH_MS)
    store.executeCommand({ kind: 'move-task', taskId: 1, newStartDate: iso(1) })
    store.setBackendPreview(BACKEND_PREVIEW)

    render(
      <>
        <WorkspaceGanttWhatIfHud onApply={null} />
        <WorkspaceGanttImpactDrawer open onClose={vi.fn()} />
      </>,
    )
    await findByData('data-impact-no-warnings')
    expect(document.querySelector('[data-impact-confirm-warnings]')).toBeNull()
  })

  it('关闭按钮触发 onClose；无活跃派生预览时抽屉呈现空态', () => {
    const onClose = vi.fn()
    render(<WorkspaceGanttImpactDrawer open onClose={onClose} />)
    expect(getByData('data-impact-empty')).toHaveTextContent('暂无影响数据')
    fireEvent.click(getByData('data-impact-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('抽屉挂到 body 后重挂 data-next-track 令牌作用域（否则底色透明、与页面叠字）', () => {
    const { container } = render(<WorkspaceGanttImpactDrawer open onClose={() => {}} />)
    const drawer = document.querySelector('[data-what-if-impact-drawer]')
    expect(drawer).not.toBeNull()
    expect(container.contains(drawer)).toBe(false)
    expect(drawer?.hasAttribute('data-next-track')).toBe(true)
    expect(drawer?.className).toContain('z-[var(--z-modal)]')
  })

  it('discard 后 HUD 卸载、抽屉无摘要数据', async () => {
    enterAndResize()
    render(
      <>
        <WorkspaceGanttWhatIfHud onApply={null} />
        <WorkspaceGanttImpactDrawer open onClose={vi.fn()} />
      </>,
    )
    await findByData('data-impact-working-delta')

    useWhatIfSessionStore.getState().discardSession()
    await waitFor(() => expect(document.querySelector('[data-what-if-hud]')).toBeNull())
    expect(getByData('data-impact-empty')).toHaveTextContent('暂无影响数据')
  })
})
