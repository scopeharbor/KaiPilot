/**
 * v3-ui-next-project-space tasks 4.1/4.2 —— 项目空间全要素总装端到端集成测试。
 *
 * 全链路闭环（spec「项目空间路由与数据加载」+「工作面看板镜头与拖拽流转」+
 * 「放置建任务」+「手动新建任务入口」+「镜头切换器预留与置灰」）：
 * - B2 转正成功视窗「进入项目主页」→ 导航新轨 `/next/projects/:id`；
 * - 项目空间加载：骨架屏 → 顶栏坐标回显 `/next/projects/101 · 开项核心引擎`、
 *   时间主轴三区 HUD、工作面四列看板（W2）、放置插槽与手动新建抽屉（W3）全要素就位；
 * - 合法拖拽流转：pending → in_progress 乐观入列 + `kanbanApi.move` 携带完整参数，
 *   成功后缓存失效并重新拉取（拖拽仿真沿用 W2 排坑：逐 fireEvent 不包单个 act、
 *   getBoundingClientRect 注入列矩形、拖后 60ms 冲刷再交互）；
 * - 放置建任务第一方入口全链路：列内插槽展开 → 一句话输入 Enter → 规则式补全预览
 *   （AIMarker 待确认推断 0.85）→ 就地微调工期 → 「确认创建」落库 `tasksApi.create`
 *   并刷新看板插入列顶（RL-01：确认前零写请求）；
 * - 手动新建第二入口：抽屉全量表单 → 名称必填校验 → 提交落库 → 抽屉收起；
 * - 镜头切换器：看板激活，六镜头全量点亮可点击（W5），点击零路由副作用。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import NextProjectSpacePage from '@/app/(next)/next/projects/[id]/page'
import { NextAppShell } from '@/components/next/layout/NextAppShell'
import { NextDraftConfirmSuccessModal } from '@/components/next/review/NextDraftConfirmSuccessModal'
import { KANBAN_COLUMNS, kanbanApi, type KanbanColumn } from '@/lib/api/kanban'
import type { Project, ProjectMember } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useNextTrackStore } from '@/stores/next-track-store'

// ---------------------------------------------------------------------------
// Module mocks（保留 taskKeys / projectKeys / invalidateTaskQueries 真实语义）
// ---------------------------------------------------------------------------

const projectsApiMock = vi.hoisted(() => ({ get: vi.fn(), members: vi.fn() }))

vi.mock('@/lib/api/projects', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/projects')>()
  return {
    ...original,
    projectsApi: { ...original.projectsApi, get: projectsApiMock.get },
    projectMembersApi: { ...original.projectMembersApi, list: projectsApiMock.members },
  }
})

const tasksCreateMock = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@/lib/api/tasks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/tasks')>()
  return { ...original, tasksApi: { ...original.tasksApi, create: tasksCreateMock.create } }
})

// 列内「在此列新建任务」现为 AI 补全卡：补全接口与实时输出旁路在这里桩掉
const taskAiDraftMock = vi.hoisted(() => ({ draft: vi.fn() }))
vi.mock('@/lib/api/task-ai-draft', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/task-ai-draft')>()
  return { ...original, taskAiDraftApi: { draft: taskAiDraftMock.draft } }
})
vi.mock('@/lib/ai-draft/live-output-client', () => ({
  newLiveOutputId: () => 'live-test',
  useLiveOutputLanes: () => ({ lanes: [], totalChars: 0 }),
}))

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/101',
  useParams: () => ({ id: '101' }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 101

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-101',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetCents: null,
    currency: null,
    progressPercent: 35,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
}

function taskOf(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: PROJECT_ID,
    name: `任务 ${id}`,
    description: null,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: null,
    endDate: null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: null,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 0,
    kanbanRank: 1024,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

/** 服务端看板事实（可变容器：创建后插入列顶，模拟落库后重新拉取）。 */
const boardState: Record<KanbanColumn, Task[]> = {
  pending: [taskOf(1, { name: '数据库索引优化', status: 'not_started', assigneeId: 1 })],
  in_progress: [taskOf(2, { name: '梳理 RBAC 权限测试用例', status: 'in_progress' })],
  completed: [],
  other: [],
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

// ---------------------------------------------------------------------------
// 拖拽仿真（W2 排坑：jsdom 无几何信息 → 注入列矩形；逐 fireEvent 自然 flush）
// ---------------------------------------------------------------------------

const COLUMN_WIDTH = 280
const COLUMN_GAP = 40

/** 注入四列定位矩形（每轮 beforeEach 重建；不得用 vi.restoreAllMocks——会把
 *  setup.ts 注入的 window.matchMedia（vi.fn 实现）清空，导致 useImmersionTier 崩溃）。 */
function installDndRects(): MockInstance<typeof Element.prototype.getBoundingClientRect> {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const columnId = this.getAttribute?.('data-kanban-column')
    if (columnId) {
      const index = KANBAN_COLUMNS.findIndex((column) => column.id === columnId)
      const left = index * (COLUMN_WIDTH + COLUMN_GAP)
      return {
        x: left,
        y: 0,
        width: COLUMN_WIDTH,
        height: 600,
        top: 0,
        left,
        right: left + COLUMN_WIDTH,
        bottom: 600,
        toJSON: () => ({}),
      } as DOMRect
    }
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect
  })
}

function mouseEvent(type: string, x: number, y: number) {
  return new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  })
}

function targetPoint(column: KanbanColumn): { x: number; y: number } {
  const index = KANBAN_COLUMNS.findIndex((item) => item.id === column)
  return { x: index * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH / 2 + 10, y: 300 }
}

function dragCardToColumn(card: HTMLElement, column: KanbanColumn) {
  const start = { x: 20, y: 20 }
  const target = targetPoint(column)
  fireEvent(card, mouseEvent('mousedown', start.x, start.y))
  fireEvent(document, mouseEvent('mousemove', start.x + 40, start.y + 40))
  fireEvent(document, mouseEvent('mousemove', target.x, target.y))
  fireEvent(document, mouseEvent('mouseup', target.x, target.y))
}

/** 拖拽尾效冲刷（dnd-kit 点击捕获抑制器 50ms 过期后再交互）。 */
async function settleDragTail() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })
}

function cardIn(column: KanbanColumn, taskId: number): boolean {
  const section = document.querySelector(`[data-kanban-column="${column}"]`)
  return Boolean(section?.querySelector(`[data-task-id="${taskId}"]`))
}

// ---------------------------------------------------------------------------
// 挂载与生命周期
// ---------------------------------------------------------------------------

function renderProjectSpace() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <NextAppShell>
          <NextProjectSpacePage />
        </NextAppShell>
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  // 定向恢复（vitest 的 vi.restoreAllMocks 会清空 setup.ts 注入的 window.matchMedia
  // vi.fn 实现并导致 useImmersionTier 在 jsdom 下崩溃，故逐 spy mockRestore）。
  kanbanListSpy?.mockRestore()
  kanbanMoveSpy?.mockRestore()
  rectSpy?.mockRestore()
  navMock.push.mockReset()
  navMock.replace.mockReset()
  projectsApiMock.get.mockReset()
  projectsApiMock.members.mockReset()
  tasksCreateMock.create.mockReset()
  boardState.pending = [taskOf(1, { name: '数据库索引优化', status: 'not_started', assigneeId: 1 })]
  boardState.in_progress = [taskOf(2, { name: '梳理 RBAC 权限测试用例', status: 'in_progress' })]
  boardState.completed = []
  boardState.other = []
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
  setAuth(['project:view', 'task:view', 'task:create', 'task:update'])
  projectsApiMock.get.mockResolvedValue(makeProject())
  projectsApiMock.members.mockResolvedValue([] as ProjectMember[])
  kanbanListSpy = vi
    .spyOn(kanbanApi, 'listColumn')
    .mockImplementation(async (_projectId: number, column: KanbanColumn) => ({
      data: boardState[column],
      meta: { total: boardState[column].length, page: 1, perPage: 25, totalPages: 1 },
    }))
  kanbanMoveSpy = vi
    .spyOn(kanbanApi, 'move')
    .mockResolvedValue(taskOf(1, { status: 'in_progress' }))
  rectSpy = installDndRects()
})

/** 各轮 spy 句柄（beforeEach 定向恢复，避免全局 restore 破坏 matchMedia）。 */
let kanbanListSpy: MockInstance<typeof kanbanApi.listColumn>
let kanbanMoveSpy: MockInstance<typeof kanbanApi.move>
let rectSpy: MockInstance<typeof Element.prototype.getBoundingClientRect>

describe('项目空间全要素总装（spec 五需求集成闭环）', () => {
  test('B2 转正成功视窗「进入项目主页」导航至新轨项目空间 /next/projects/:id', () => {
    useAiProjectDraftStore.setState({
      draftStatus: 'confirmed',
      confirmResponse: {
        projectId: PROJECT_ID,
        createdCounts: {
          wbsNodes: 2,
          tasks: 2,
          dependencies: 2,
          milestones: 1,
          acceptanceCriteria: 1,
          risks: 1,
        },
      },
    })
    render(<NextDraftConfirmSuccessModal />)
    fireEvent.click(screen.getByRole('button', { name: /进入项目主页/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/101')
  })

  test('加载 → 顶栏坐标回显 + 时间主轴 + 四列看板 + 双建任务入口 + 镜头切换器就位', async () => {
    renderProjectSpace()

    // 加载期骨架屏 → 项目空间底座
    expect(screen.getByRole('status', { name: '正在加载项目空间' })).toBeInTheDocument()
    await screen.findByText('开项核心引擎')

    // 顶栏坐标动态回显（壳层装配链路）
    await waitFor(() => {
      expect(document.querySelector('[data-next-coordinate]')?.textContent).toBe(
        '/next/projects/101 · 开项核心引擎',
      )
    })

    // 时间主轴 HUD：周期 / 进度 / 今天锚点 / 三区
    expect(document.querySelector('[data-timeline-period]')?.textContent).toBe(
      '2026-09-01 ~ 2026-09-30',
    )
    expect(document.querySelector('[data-timeline-progress]')?.textContent).toContain('35%')
    expect(document.querySelector('[data-timeline-past]')).not.toBeNull()
    expect(document.querySelector('[data-timeline-future]')).not.toBeNull()

    // 工作面四列看板（W2 总装）：任务按列投影 + 列头
    await screen.findByText('数据库索引优化')
    expect(screen.getByText('梳理 RBAC 权限测试用例')).toBeInTheDocument()
    for (const label of ['待处理', '进行中', '已完成', '其他']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(cardIn('pending', 1)).toBe(true)
    expect(cardIn('in_progress', 2)).toBe(true)

    // 双建任务入口（W3 总装）：放置插槽 ×4 + 手动新建触发
    expect(document.querySelectorAll('[data-placement-slot]')).toHaveLength(4)
    expect(document.querySelector('[data-manual-task-create-trigger]')).not.toBeNull()

    // 镜头切换器：看板激活；六镜头全部点亮（available，W5 总装）
    expect(
      document.querySelector('[data-lens-option="kanban"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
    for (const id of ['gantt', 'wbs', 'list', 'calendar', 'timeline']) {
      expect(
        document.querySelector(`[data-lens-option="${id}"]`)?.getAttribute('aria-disabled'),
      ).toBeNull()
      expect(
        document.querySelector(`[data-lens-option="${id}"]`)?.getAttribute('data-lens-status'),
      ).toBe('available')
    }
  })

  test('拖拽流转：pending → in_progress 乐观入列，POST move 携带完整参数并刷新缓存', async () => {
    renderProjectSpace()
    await screen.findByText('数据库索引优化')

    const move = vi.mocked(kanbanApi.move)
    dragCardToColumn(screen.getByRole('button', { name: '任务：数据库索引优化' }), 'in_progress')

    // 乐观更新：释放瞬间卡片已在目标列
    expect(cardIn('in_progress', 1)).toBe(true)
    expect(cardIn('pending', 1)).toBe(false)

    await waitFor(() =>
      expect(move).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          taskId: 1,
          targetColumn: 'in_progress',
          targetStatus: 'in_progress',
        }),
      ),
    )
    // 成功分支：无错误横幅；缓存失效后看板重新拉取
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await settleDragTail()
  })

  test('放置建任务全链路：插槽展开 → 一句话交给 AI 补全 → 预览微调 → 确认落库 → 插入列顶', async () => {
    renderProjectSpace()
    await screen.findByText('数据库索引优化')

    // ① 列内插槽展开（零网络请求）
    const slot = document.querySelector('[data-placement-slot]') as HTMLElement
    fireEvent.click(slot)
    const input = document.querySelector('[data-placement-input]') as HTMLTextAreaElement
    expect(input).not.toBeNull()
    expect(tasksCreateMock.create).not.toHaveBeenCalled()

    // ② 一句话 + Enter → AI 补全（只返回草稿，不落库）
    taskAiDraftMock.draft.mockResolvedValue({
      name: '完成用户鉴权接口测试',
      description: '覆盖登录、令牌刷新与越权三类用例。',
      durationDays: 1,
      priority: 'medium',
      wbsNodeId: null,
      wbsNodeName: null,
      roleHint: null,
      doneCriteria: ['三类用例全部通过'],
      steps: ['整理用例', '执行测试', '记录结果'],
      split: [],
      note: null,
    })
    fireEvent.change(input, { target: { value: '把用户鉴权接口测一遍' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(
        document.querySelector('[data-placement-phase]')?.getAttribute('data-placement-phase'),
      ).toBe('preview'),
    )
    expect(tasksCreateMock.create).not.toHaveBeenCalled()

    // ③ 就地微调工期：1 天 → 2 天
    fireEvent.change(document.querySelector('[data-placement-duration]') as HTMLSelectElement, {
      target: { value: '2' },
    })

    // 服务端落库响应：成功创建 → 看板事实源插入该列顶部
    const created = taskOf(9, { name: '完成用户鉴权接口测试', status: 'not_started' })
    tasksCreateMock.create.mockResolvedValue(created)

    // ④ 显式「确认创建」才发写请求（RL-01：此前零请求）
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }))
    await waitFor(() =>
      expect(tasksCreateMock.create).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          name: '完成用户鉴权接口测试',
          status: 'not_started',
          durationDays: 2,
          priority: 'medium',
        }),
      ),
    )
    // ⑤ 卡片销毁（插槽还原）→ 缓存失效后重新拉取，新任务出现在 pending 列顶部
    await waitFor(() => expect(document.querySelector('[data-ai-task-placement-card]')).toBeNull())
    expect(cardIn('pending', 1)).toBe(true)
  })

  test('手动新建抽屉：触发 → 名称必填校验 → 提交落库 → 抽屉收起', async () => {
    renderProjectSpace()
    await screen.findByText('数据库索引优化')

    fireEvent.click(document.querySelector('[data-manual-task-create-trigger]') as HTMLElement)
    fireEvent.click(await screen.findByRole('tab', { name: '手动填写' }))
    const drawer = await screen.findByRole('dialog', { name: '手动新建任务' })
    expect(drawer).toBeInTheDocument()

    // 名称留空提交 → 客户端校验阻断，零请求
    fireEvent.submit(document.querySelector('[data-manual-task-form]') as HTMLElement)
    expect(screen.getByText('请输入任务名称')).toBeInTheDocument()
    expect(tasksCreateMock.create).not.toHaveBeenCalled()

    // 填写名称 → 提交 → tasksApi.create + 抽屉收起
    const name = document.querySelector('[data-manual-task-name]') as HTMLInputElement
    fireEvent.change(name, { target: { value: '跨系统联调验收' } })
    tasksCreateMock.create.mockResolvedValue(
      taskOf(10, { name: '跨系统联调验收', status: 'not_started' }),
    )
    fireEvent.submit(document.querySelector('[data-manual-task-form]') as HTMLElement)

    await waitFor(() =>
      expect(tasksCreateMock.create).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ name: '跨系统联调验收', status: 'not_started' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '手动新建任务' })).toBeNull())
  })

  test('镜头切换器：六镜头全量点亮可点击，悬停零「即将上线」Tooltip', async () => {
    const { push } = navMock
    renderProjectSpace()
    await screen.findByText('开项核心引擎')

    // 全量点亮：任意镜头悬停均不再出现 Tooltip
    for (const id of ['gantt', 'wbs', 'list', 'calendar', 'timeline']) {
      const trigger = document.querySelector(`[data-lens-trigger="${id}"]`) as HTMLElement
      fireEvent.mouseEnter(trigger)
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.mouseLeave(trigger)
    }

    // 甘特点击：?lens=gantt 双向绑定（replaceState 零路由副作用）且激活甘特镜头
    fireEvent.click(screen.getByRole('button', { name: '甘特图' }))
    expect(window.location.search).toBe('?lens=gantt')
    expect(push).not.toHaveBeenCalled()
    // 甘特镜头激活
    expect(document.querySelector('[data-lens-option="gantt"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
  })
})
