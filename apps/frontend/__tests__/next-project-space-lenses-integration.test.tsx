/**
 * v3-ui-next-remaining-lenses tasks 5.6 —— 项目空间多镜头端到端全链路集成测试
 * （spec「LensSwitcher 全量点亮与路由 URL 双向绑定」+「图表汇出菜单全镜头接入」场景）。
 *
 * 覆盖：
 * - 六镜头漫游切换：看板 → WBS → 列表 → 日历 → 时间线 → 看板，工作面插槽平滑替换
 *   并对应更新 URL（?lens=wbs 等；回看板时移除 lens 参数），零路由 push；
 * - URL 直入：?lens=calendar 首载即激活日历镜头（双向绑定入口侧）；
 * - popstate：模拟浏览器前进/后退，镜头状态自动与 URL 参数同步回退；
 * - 甘特 What-if 守卫：未保存试算下点击切至时间线被阻断弹模态框，
 *   留在当前页面 → 仍停留甘特；放弃并离开 → 成功切入时间线并同步 URL；
 * - 四新镜头渲染冒烟：WBS 树（虚拟行）/ 列表高密度表格 / 日历月网格 /
 *   时间线流动主轴在容器内数据就绪态正常呈现；
 * - 汇出菜单在新镜头（WBS）下 resolveTarget 解析到 [data-project-space-lens-slot]
 *   并携带规范 viewType「WBS结构俯瞰」。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import { projectsApi, projectMembersApi, type Project } from '@/lib/api/projects'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { dependenciesApi, type TaskDependency } from '@/lib/api/dependencies'
import { milestonesApi, type Milestone } from '@/lib/api/milestones'
import { wbsApi, type WbsNode } from '@/lib/api/wbs'
import { calendarApi } from '@/lib/api/calendar'
import type { CalendarFullResponse, CalendarItem } from '@/lib/calendar-types'
import { kanbanApi, type KanbanColumn } from '@/lib/api/kanban'
import { useAuthStore } from '@/stores/auth-store'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'

// ---------------------------------------------------------------------------
// 1. jsdom Polyfill 与全局模块 Mock
// ---------------------------------------------------------------------------

function polyfillPointerEvent() {
  if (typeof window.PointerEvent === 'undefined') {
    class FakePointerEvent extends MouseEvent {
      readonly pointerId: number
      constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
        super(type, params)
        this.pointerId = params.pointerId ?? 1
      }
    }
    ;(window as unknown as { PointerEvent: typeof FakePointerEvent }).PointerEvent =
      FakePointerEvent
  }
}

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  useSearchParams: () => new URLSearchParams(),
}))

const toastMock = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: toastMock.toast }),
  toast: toastMock.toast,
}))

const engineMock = vi.hoisted(() => ({
  exportNodeToPng: vi.fn(async () => 'png-data-url'),
  exportNodeToSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  exportNodeToJpeg: vi.fn(async () => 'jpeg-data-url'),
}))

vi.mock('@/lib/next/chart-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/next/chart-export')>()
  return { ...actual, ...engineMock }
})

// ---------------------------------------------------------------------------
// 2. Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 101

function makeProject(): Project {
  return {
    id: PROJECT_ID,
    organizationId: 1,
    name: '星舰智能排程系统',
    code: 'STAR-101',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-10-31',
    budgetCents: null,
    currency: null,
    progressPercent: 20,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  }
}

function makeTask(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: PROJECT_ID,
    name: `任务 ${id}`,
    description: null,
    status: 'in_progress',
    priority: 'high',
    taskType: 'task',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 5,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 30,
    assigneeId: 1,
    assignee: { id: 1, fullName: '张总师', email: 'pm@example.com', initials: 'ZS' },
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

const GANTT_TASKS: Task[] = [
  makeTask(1, { name: '动力系统自检', startDate: '2026-09-01', endDate: '2026-09-05' }),
  makeTask(2, { name: '导航链路标定', startDate: '2026-09-06', endDate: '2026-09-10' }),
]

const GANTT_DEPS: TaskDependency[] = [
  {
    id: 1,
    predecessorId: 1,
    successorId: 2,
    type: 'fs',
    lagDays: 0,
    predecessor: {
      id: 1,
      name: '动力系统自检',
      status: 'in_progress',
      startDate: '2026-09-01',
      endDate: '2026-09-05',
    },
    successor: {
      id: 2,
      name: '导航链路标定',
      status: 'in_progress',
      startDate: '2026-09-06',
      endDate: '2026-09-10',
    },
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: null,
  },
]

/** 以本地「今天」为基线的日历平移（时间线/日历镜头冒烟需当前月锚点）。 */
function day(offset: number): string {
  const now = new Date()
  const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

function makeMilestone(id: number, overrides: Partial<Milestone> = {}): Milestone {
  return {
    id,
    projectId: PROJECT_ID,
    name: `里程碑 ${id}`,
    description: null,
    status: 'planned',
    storedStatus: 'planned',
    plannedDate: day(10 + id),
    autoCalculated: false,
    displayOrder: id,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

const TIMELINE_MILESTONES: Milestone[] = [
  makeMilestone(1, { name: '需求冻结', status: 'achieved', plannedDate: day(-40) }),
  makeMilestone(2, { name: '联调通过', status: 'missed', plannedDate: day(-10) }),
  makeMilestone(3, { name: '验收发布', status: 'planned', plannedDate: day(20) }),
]

function makeWbsNode(overrides: Partial<WbsNode> & { id: number; name: string }): WbsNode {
  return {
    projectId: PROJECT_ID,
    parentId: null,
    path: '/',
    code: '',
    depth: 0,
    isLeaf: true,
    collapsed: false,
    displayOrder: 0,
    taskId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

const WBS_NODES: WbsNode[] = [
  makeWbsNode({ id: 1, name: '整机总体设计', code: '1', depth: 0, isLeaf: false }),
  makeWbsNode({ id: 2, name: '子系统分解', parentId: 1, code: '1.1', depth: 1, isLeaf: false }),
  makeWbsNode({ id: 3, name: '动力单元设计', parentId: 2, code: '1.1.1', depth: 2 }),
  makeWbsNode({ id: 4, name: '导航单元设计', parentId: 2, code: '1.1.2', depth: 2 }),
  makeWbsNode({ id: 5, name: '总装集成规划', code: '2', depth: 0 }),
]

const LIST_TASKS: Task[] = [
  makeTask(21, {
    name: '数据库索引优化',
    status: 'not_started',
    priority: 'medium',
    assigneeId: 2,
    assignee: { id: 2, fullName: '李工', email: 'li@example.com', initials: 'LG' },
  }),
  makeTask(22, { name: '梳理 RBAC 权限用例', status: 'in_progress', priority: 'high' }),
]

/** 单日任务 + 里程碑（锚定今天，保证当前月网格内可见）。 */
const CALENDAR_ITEMS: CalendarItem[] = [
  {
    id: 'task-cal-1',
    kind: 'task',
    sourceId: 21,
    projectId: PROJECT_ID,
    name: '今日排程任务',
    status: 'in_progress',
    priority: 'high',
    assignee: null,
    dateRange: {
      start: day(0),
      end: day(0),
      isSpan: false,
      missingStart: false,
      missingEnd: false,
    },
    isMultiDay: false,
    isOverdue: false,
    detailUrl: `/projects/${PROJECT_ID}/tasks/21`,
  },
  {
    id: 'ms-cal-1',
    kind: 'milestone',
    sourceId: 3,
    projectId: PROJECT_ID,
    name: '今日里程碑',
    status: 'planned',
    priority: undefined,
    assignee: null,
    dateRange: {
      start: day(0),
      end: day(0),
      isSpan: false,
      missingStart: false,
      missingEnd: false,
    },
    isMultiDay: false,
    isOverdue: false,
    detailUrl: `/projects/${PROJECT_ID}/milestones/3`,
  },
]

const boardState: Record<KanbanColumn, Task[]> = {
  pending: [makeTask(31, { name: '看板待办卡', status: 'not_started' })],
  in_progress: [makeTask(32, { name: '看板进行卡', status: 'in_progress' })],
  completed: [],
  other: [],
}

// ---------------------------------------------------------------------------
// 3. 环境注入与挂载
// ---------------------------------------------------------------------------

/** setup.ts 的 matchMedia 会被 vi.restoreAllMocks 复位，beforeEach 需重建。 */
function installMatchMediaMock() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

/**
 * 虚拟滚动（WBS）+ 甘特拖拽几何注入：jsdom 缺省全 0。
 * virtual-core 3.17 读 offsetWidth/offsetHeight，3.19 起改读 clientWidth/clientHeight，两组都注入。
 */
function installGeometryMocks() {
  for (const prop of ['offsetHeight', 'clientHeight'] as const) {
    vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-wbs-scroll-viewport') ? 600 : 0
    })
  }
  for (const prop of ['offsetWidth', 'clientWidth'] as const) {
    vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-wbs-scroll-viewport') ? 900 : 0
    })
  }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 800,
      right: 1200,
      width: 1200,
      height: 800,
      toJSON: () => ({}),
    } as DOMRect
  })
}

function setAuth() {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '张总师',
      organizations: [{ id: 1, name: '开项空间', slug: 'aiproj', role: 'admin' }],
      isSuperAdmin: false,
    },
    accessToken: 'test-token',
    refreshToken: 'test-refresh',
    permissions: ['task:update', 'task:view', 'project:view'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function resetStores() {
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
  useProjectSpaceEntityStore.getState().clear(PROJECT_ID)
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
}

let tasksListSpy: MockInstance<typeof tasksApi.list>
let milestonesSpy: MockInstance<typeof milestonesApi.list>

const taskPage = (tasks: Task[]) => ({
  data: tasks,
  meta: { total: tasks.length, page: 1, perPage: 100, totalPages: 1 },
})

beforeEach(() => {
  // 定向恢复 + 全量重建（restoreAllMocks 会清空 setup.ts 的 matchMedia 与几何 spy）
  vi.restoreAllMocks()
  polyfillPointerEvent()
  installMatchMediaMock()
  installGeometryMocks()
  resetStores()
  setAuth()
  navMock.push.mockReset()
  navMock.replace.mockReset()
  toastMock.toast.mockReset()
  engineMock.exportNodeToPng.mockReset()
  engineMock.exportNodeToSvg.mockReset()
  engineMock.exportNodeToJpeg.mockReset()
  engineMock.exportNodeToPng.mockResolvedValue('png-data-url')
  engineMock.exportNodeToSvg.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  engineMock.exportNodeToJpeg.mockResolvedValue('jpeg-data-url')

  vi.spyOn(projectsApi, 'get').mockResolvedValue(makeProject())
  vi.spyOn(projectMembersApi, 'list').mockResolvedValue([])
  tasksListSpy = vi.spyOn(tasksApi, 'list').mockImplementation(async () => taskPage(LIST_TASKS))
  vi.spyOn(dependenciesApi, 'listByProject').mockResolvedValue(GANTT_DEPS)
  milestonesSpy = vi.spyOn(milestonesApi, 'list').mockImplementation(async () => ({
    data: TIMELINE_MILESTONES,
    meta: { total: TIMELINE_MILESTONES.length, page: 1, perPage: 100, totalPages: 1 },
  }))
  vi.spyOn(wbsApi, 'tree').mockResolvedValue(WBS_NODES)
  vi.spyOn(calendarApi, 'listSchedule').mockImplementation(
    async (): Promise<CalendarFullResponse> => ({
      data: CALENDAR_ITEMS,
      meta: { total: CALENDAR_ITEMS.length, page: 1, perPage: 200, totalPages: 1 },
    }),
  )
  vi.spyOn(kanbanApi, 'listColumn').mockImplementation(
    async (_projectId: number, column: KanbanColumn) => ({
      data: boardState[column] ?? [],
      meta: { total: (boardState[column] ?? []).length, page: 1, perPage: 100, totalPages: 1 },
    }),
  )
  window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}`)
})

function renderSpace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    ),
  }
}

function lensOption(id: string): HTMLElement {
  return document.querySelector(`[data-lens-option="${id}"]`) as HTMLElement
}

function slotOf(id: string): HTMLElement | null {
  return document.querySelector(`[data-project-space-${id}-slot]`)
}

/** 逐 fireEvent 派发拖拽指针序列（甘特 What-if 激活，同 W4 排坑）。 */
function performDragSequence(handle: Element, startX: number, endX: number) {
  fireEvent.pointerDown(handle, { clientX: startX, clientY: 100, pointerId: 1, button: 0 })
  fireEvent.pointerMove(handle, { clientX: startX + 15, clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: endX, clientY: 100, pointerId: 1 })
  fireEvent.pointerUp(handle, { clientX: endX, clientY: 100, pointerId: 1 })
}

async function settleWhatIfDialog() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

// ---------------------------------------------------------------------------
// 4. 用例
// ---------------------------------------------------------------------------

describe('项目空间六镜头总装集成（tasks 5.6）', () => {
  it('六镜头漫游：看板→WBS→列表→日历→时间线→看板，插槽平滑替换并同步 URL', async () => {
    const { container } = renderSpace()
    await screen.findByText('星舰智能排程系统')

    // 起点：看板（URL 无 lens 参数）
    expect(slotOf('board')).not.toBeNull()
    expect(window.location.search).toBe('')

    // 切 WBS：URL ?lens=wbs，工作面替换为 WBS 树
    fireEvent.click(screen.getByRole('button', { name: 'WBS' }))
    await waitFor(() => {
      expect(slotOf('wbs')).not.toBeNull()
      expect(slotOf('board')).toBeNull()
    })
    expect(window.location.search).toBe('?lens=wbs')
    expect(lensOption('wbs').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-project-space-lens-slot]')).not.toBeNull()

    // 切列表：URL ?lens=list
    fireEvent.click(screen.getByRole('button', { name: '列表' }))
    await waitFor(() => {
      expect(slotOf('list')).not.toBeNull()
      expect(slotOf('wbs')).toBeNull()
    })
    expect(window.location.search).toBe('?lens=list')

    // 切日历：URL ?lens=calendar
    fireEvent.click(screen.getByRole('button', { name: '日历' }))
    await waitFor(() => {
      expect(slotOf('calendar')).not.toBeNull()
      expect(slotOf('list')).toBeNull()
    })
    expect(window.location.search).toBe('?lens=calendar')

    // 切时间线：URL ?lens=timeline
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    await waitFor(() => {
      expect(slotOf('timeline')).not.toBeNull()
      expect(slotOf('calendar')).toBeNull()
    })
    expect(window.location.search).toBe('?lens=timeline')

    // 回看板：lens 参数从 URL 移除（缺省无参数即看板）
    fireEvent.click(screen.getByRole('button', { name: '看板' }))
    await waitFor(() => {
      expect(slotOf('board')).not.toBeNull()
      expect(slotOf('timeline')).toBeNull()
    })
    expect(window.location.search).toBe('')
    expect(lensOption('kanban').getAttribute('aria-pressed')).toBe('true')
    // 全程零路由 push（replaceState 无刷新同步）
    expect(navMock.push).not.toHaveBeenCalled()
  })

  it('URL 直入 ?lens=calendar：首载激活日历镜头（双向绑定入口侧）', async () => {
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=calendar`)
    const { container } = renderSpace()

    await waitFor(() => {
      expect(container.querySelector('[data-calendar-lens]')).not.toBeNull()
    })
    expect(lensOption('calendar').getAttribute('aria-pressed')).toBe('true')
    expect(lensOption('kanban').getAttribute('aria-pressed')).toBeNull()
    expect(window.location.search).toBe('?lens=calendar')
  })

  it('popstate：浏览器后退/前进时镜头自动回退同步（含回到缺省看板）', async () => {
    renderSpace()
    await screen.findByText('星舰智能排程系统')
    expect(slotOf('board')).not.toBeNull()

    // 模拟历史回退到 ?lens=wbs 页：URL 已还原 + 触发 popstate → WBS 自动挂载
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=wbs`)
    fireEvent(window, new Event('popstate'))
    await waitFor(() => expect(slotOf('wbs')).not.toBeNull())
    expect(lensOption('wbs').getAttribute('aria-pressed')).toBe('true')

    // 再回退到 ?lens=list 页
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=list`)
    fireEvent(window, new Event('popstate'))
    await waitFor(() => expect(slotOf('list')).not.toBeNull())
    expect(lensOption('list').getAttribute('aria-pressed')).toBe('true')

    // 回退到无参首页 → 看板
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}`)
    fireEvent(window, new Event('popstate'))
    await waitFor(() => expect(slotOf('board')).not.toBeNull())
    expect(lensOption('kanban').getAttribute('aria-pressed')).toBe('true')

    // 非法 lens 参数回退 → 统一回落看板（不挂载未知镜头）
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=unknown`)
    fireEvent(window, new Event('popstate'))
    await waitFor(() => expect(lensOption('kanban').getAttribute('aria-pressed')).toBe('true'))
    expect(slotOf('board')).not.toBeNull()
  })

  it('四新镜头渲染冒烟：WBS 树 / 列表表格 / 日历网格 / 时间线主轴（数据就绪态）', async () => {
    // —— WBS：虚拟化树渲染可见行
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=wbs`)
    {
      const { container, unmount } = renderSpace()
      await waitFor(() => {
        expect(container.querySelectorAll('[data-wbs-row]').length).toBeGreaterThan(0)
      })
      expect(container.querySelector('[data-wbs-lens]')).not.toBeNull()
      await screen.findByText('整机总体设计')
      expect(screen.getByText('总装集成规划')).toBeInTheDocument()
      unmount()
    }

    // —— 列表：高密度表格行
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=list`)
    {
      const { container, unmount } = renderSpace()
      await waitFor(() => {
        expect(container.querySelectorAll('[data-list-lens-row]').length).toBeGreaterThan(0)
      })
      expect(container.querySelector('[data-project-space-list-slot]')).not.toBeNull()
      await screen.findByText('数据库索引优化')
      expect(screen.getByText('梳理 RBAC 权限用例')).toBeInTheDocument()
      unmount()
    }

    // —— 日历：月网格与今日锚点
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=calendar`)
    {
      const { container, unmount } = renderSpace()
      await waitFor(() => {
        expect(container.querySelectorAll('[data-calendar-day]').length).toBeGreaterThan(20)
      })
      expect(container.querySelector('[data-calendar-day][data-today="true"]')).not.toBeNull()
      expect(container.querySelector('[data-project-space-calendar-slot]')).not.toBeNull()
      await screen.findByText('今日排程任务')
      expect(screen.getByText('今日里程碑')).toBeInTheDocument()
      unmount()
    }

    // —— 时间线：流动主轴与里程碑/任务节点
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=timeline`)
    {
      const { container, unmount } = renderSpace()
      await waitFor(() => {
        expect(container.querySelector('[data-timeline-lens]')).not.toBeNull()
      })
      await screen.findByText('联调通过')
      expect(container.querySelector('[data-timeline-milestone]')).not.toBeNull()
      expect(container.querySelector('[data-timeline-task-card]')).not.toBeNull()
      expect(container.querySelector('[data-project-space-timeline-slot]')).not.toBeNull()
      expect(container.querySelector('[data-timeline-today-marker]')).not.toBeNull()
      unmount()
    }
  })

  it('甘特 What-if 未保存切至时间线被守卫拦截：留在当前 vs 放弃并切入', async () => {
    // 甘特画板需要带日期任务与空里程碑（渲染前注入，避免缓存旧数据）
    tasksListSpy.mockImplementation(async () => taskPage(GANTT_TASKS))
    milestonesSpy.mockImplementation(async () => ({
      data: [],
      meta: { total: 0, page: 1, perPage: 100, totalPages: 1 },
    }))
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=gantt`)
    const { container } = renderSpace()

    await waitFor(() => {
      expect(container.querySelector('[data-gantt-bar-group][data-task-id="1"]')).not.toBeNull()
    })

    // 拖拽产生未保存 What-if 变更（零网络写）
    performDragSequence(
      container.querySelector('[data-gantt-bar-group][data-task-id="1"]')!,
      100,
      220,
    )
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-hud]')).not.toBeNull()
    })

    // ① 点击切换「时间线」→ 被守卫阻断，弹离开确认模态框
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-leave-dialog]')).not.toBeNull()
    })
    expect(screen.getByText('离开前请确认')).toBeInTheDocument()
    expect(slotOf('timeline')).toBeNull()
    expect(window.location.search).toBe('?lens=gantt')

    // ② 「留在当前页面」→ 模态框关闭，仍停留甘特，URL 不变
    fireEvent.click(container.querySelector('[data-leave-dialog-stay]') as HTMLElement)
    await settleWhatIfDialog()
    expect(container.querySelector('[data-what-if-leave-dialog]')).toBeNull()
    expect(container.querySelector('[data-gantt-chart]')).not.toBeNull()
    expect(container.querySelector('[data-what-if-hud]')).not.toBeNull()

    // ③ 再次切「时间线」→ 阻断；点「放弃并离开」→ 会话销毁并成功切入时间线
    fireEvent.click(screen.getByRole('button', { name: '时间线' }))
    await waitFor(() => {
      expect(container.querySelector('[data-what-if-leave-dialog]')).not.toBeNull()
    })
    fireEvent.click(container.querySelector('[data-leave-dialog-discard]') as HTMLElement)

    await waitFor(() => {
      expect(slotOf('timeline')).not.toBeNull()
      expect(container.querySelector('[data-gantt-chart]')).toBeNull()
    })
    expect(window.location.search).toBe('?lens=timeline')
    expect(lensOption('timeline').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-what-if-leave-dialog]')).toBeNull()
  })

  it('汇出菜单在新镜头（WBS）下解析 lens-slot 目标并携带规范 viewType', async () => {
    window.history.replaceState(null, '', `/next/projects/${PROJECT_ID}?lens=wbs`)
    const { container } = renderSpace()

    await waitFor(() => {
      expect(container.querySelector('[data-project-space-wbs-slot]')).not.toBeNull()
    })

    // 新镜头菜单：三项标准指令，无看板分享卡
    fireEvent.click(screen.getByRole('button', { name: '汇出看板' }))
    expect(screen.getByRole('menuitem', { name: '导出快照 (PNG - 2x超清)' })).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: '生成 1200×630 看板分享卡' }),
    ).not.toBeInTheDocument()

    // 派发 PNG 导出：捕获目标 = 当前镜头统一工作面容器（WBS section）
    fireEvent.click(screen.getByRole('menuitem', { name: '导出快照 (PNG - 2x超清)' }))
    await waitFor(() => expect(engineMock.exportNodeToPng).toHaveBeenCalledTimes(1))
    const [target, options] = engineMock.exportNodeToPng.mock.calls.at(-1) as unknown as [
      HTMLElement,
      { entityName: string; viewType: string },
    ]
    expect(target.hasAttribute('data-project-space-lens-slot')).toBe(true)
    expect(target.hasAttribute('data-project-space-wbs-slot')).toBe(true)
    expect(options).toEqual({ entityName: '星舰智能排程系统', viewType: 'WBS结构俯瞰' })
  })
})
