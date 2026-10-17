/**
 * v3-ui-next-project-space tasks 2.6 —— 工作面看板画板与拖拽流转（WorkspaceKanbanBoard）测试。
 *
 * 覆盖（spec「工作面看板镜头与拖拽流转」四场景 + RL-06 权限防线）：
 * - 四列并行取数（useKanbanColumns → kanbanApi.listColumn ×4）与逐列合并渲染；
 * - 合法拖拽：本地快照备份 → 乐观更新（零延迟入列）→ 异步 `POST /kanban/move`，
 *   成功分支请求参数携带 taskId/targetColumn/targetStatus/beforeTaskId；
 * - 非法流转：`canTransition` 拦截（如 cancelled → completed），卡片原位不动、
 *   顶部警示「不能从“已取消”直接移动到“已完成”」，服务端请求数恒为 0；
 * - 拖入「其他」列先弹快捷状态选择（blocked/on_hold/cancelled），源状态不可达
 *   的选项禁用，确认后才发起移动；取消弹窗零请求；
 * - 网络失败：以服务端数据重新加载（卡片回到原位），弹琥珀警告；
 * - 移动排队保存：保存期间其它卡仍可拖，请求按顺序发出（2026-09-29）；
 * - 进行中退回待处理：有进度先确认，0% 直接退回；
 * - 权限防线（RL-06）：仅为 task:view 的只读成员卡片锁定光标不可拖拽；
 *   task:update:self 仅放行本人 assignee 的任务。
 *
 * 拖拽仿真：@dnd-kit MouseSensor 在 jsdom 下需要几何信息——为各列 section
 * 注入 data-kanban-column 定位矩形（spy getBoundingClientRect），以真实
 * PointerEvent 序列（pointerdown → 位移激活 → 移动至目标列 → pointerup）
 * 驱动完整拖拽生命周期。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceKanbanBoard } from '@/components/next/project-space/WorkspaceKanbanBoard'
import { KANBAN_COLUMNS, kanbanApi, type KanbanColumn } from '@/lib/api/kanban'
import type { Task } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

// W3 并行开发中，插槽行为不受 W2 看板测试约束（装配见 W4 集成测试）。
vi.mock('@/components/next/project-space/TaskPlacementSlot', () => ({
  TaskPlacementSlot: () => <div data-testid="placement-slot-stub" />,
}))

const PROJECT_ID = 7

const TASKS: Record<KanbanColumn, Task[]> = {
  pending: [
    taskOf({
      id: 1,
      name: '数据库索引优化',
      status: 'not_started',
      assigneeId: 1,
      assignee: { id: 1, fullName: '项目经理', email: 'pm@example.com', initials: 'PM' },
    }),
  ],
  in_progress: [
    taskOf({
      id: 2,
      name: '梳理 RBAC 权限测试用例',
      status: 'in_progress',
      assigneeId: 1,
    }),
  ],
  completed: [taskOf({ id: 3, name: '跨系统联调验收', status: 'completed', assigneeId: 2 })],
  other: [
    taskOf({ id: 4, name: '供应商接口联调受阻', status: 'blocked', assigneeId: 1 }),
    taskOf({ id: 5, name: '旧版导出功能下线', status: 'cancelled', assigneeId: 1 }),
  ],
}

function taskOf(overrides: Partial<Task>): Task {
  return {
    id: 1,
    projectId: PROJECT_ID,
    name: '任务',
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

// ---------------------------------------------------------------------------
// 拖拽仿真工具
// ---------------------------------------------------------------------------

const COLUMN_WIDTH = 280
const COLUMN_GAP = 40

/** jsdom 缺省 getBoundingClientRect 全零：为四列 section 注入定位矩形。 */
function installDndRects() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
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

/** 目标列落点（列水平中心，y=300）。 */
function targetPoint(column: KanbanColumn): { x: number; y: number } {
  const index = KANBAN_COLUMNS.findIndex((item) => item.id === column)
  return { x: index * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH / 2 + 10, y: 300 }
}

/**
 * 驱动 MouseSensor 完整生命周期：down → 位移激活 → 移动至目标 → up。
 *
 * 注意：不能把整段序列包进单个 act()——React 18 的 act 会把中间态更新
 * 推迟到退出时统一 flush，dnd-kit 的碰撞 / sensorContext 依赖事件间渲染，
 * 会导致 over 永远为空。fireEvent 自带 act，逐事件自然 flush。
 */
function dragCardToColumn(card: HTMLElement, column: KanbanColumn) {
  const start = { x: 20, y: 20 }
  const target = targetPoint(column)
  fireEvent(card, mouseEvent('mousedown', start.x, start.y))
  // 第一段位移超过 MouseSensor 距离阈值 6px → 激活拖拽
  fireEvent(document, mouseEvent('mousemove', start.x + 40, start.y + 40))
  // 第二段移动至目标列中心 → 碰撞检测命中目标列
  fireEvent(document, mouseEvent('mousemove', target.x, target.y))
  fireEvent(document, mouseEvent('mouseup', target.x, target.y))
}

// ---------------------------------------------------------------------------
// 挂载与夹具
// ---------------------------------------------------------------------------

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function TestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function login(permissions: string[], userId = 1) {
  useAuthStore.getState().setSession({
    user: {
      id: userId,
      email: 'pm@example.com',
      fullName: '项目经理',
      organizations: [{ id: 1, name: '组织', slug: 'org', role: 'owner' }],
    },
    accessToken: accessTokenWith(permissions, { organizationId: 1 }),
    refreshToken: 'refresh',
  })
  useAuthStore.setState({ permissions, currentOrganizationId: 1, isAuthenticated: true })
}

const moveMock = () => vi.spyOn(kanbanApi, 'move')

function mockColumns() {
  return vi
    .spyOn(kanbanApi, 'listColumn')
    .mockImplementation(async (_projectId: number, column: KanbanColumn) => ({
      data: TASKS[column],
      meta: { total: TASKS[column].length, page: 1, perPage: 25, totalPages: 1 },
    }))
}

function renderBoard() {
  return render(<WorkspaceKanbanBoard projectId={PROJECT_ID} />, { wrapper: wrapper() })
}

function columnSection(column: KanbanColumn): HTMLElement {
  return document.querySelector(`[data-kanban-column="${column}"]`) as HTMLElement
}

function cardIn(column: KanbanColumn, taskId: number): boolean {
  return Boolean(columnSection(column).querySelector(`[data-task-id="${taskId}"]`))
}

/** 锁定卡片本体（排除内嵌 Lock 图标上的同名 title 节点）。 */
function lockedCards(): HTMLElement[] {
  // 锁定卡：不可拖（aria-disabled），悬停提示说明原因（无权限 / 指派给了别人）
  return Array.from(document.querySelectorAll<HTMLElement>('[data-task-id][aria-disabled="true"]'))
}

describe('components/next/project-space/WorkspaceKanbanBoard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAuthStore.getState().clear()
    installDndRects()
  })

  test('四列并行取数与逐列合并渲染：列头状态投影 + 任务过滤', async () => {
    login(['task:view', 'task:update'])
    const listColumn = mockColumns()
    renderBoard()

    expect(await screen.findByText('数据库索引优化')).toBeInTheDocument()
    expect(screen.getByText('梳理 RBAC 权限测试用例')).toBeInTheDocument()
    expect(screen.getByText('跨系统联调验收')).toBeInTheDocument()
    expect(screen.getByText('供应商接口联调受阻')).toBeInTheDocument()
    // 状态投影：blocked/cancelled 归入「其他」列
    expect(screen.getByRole('heading', { name: '其他' })).toBeInTheDocument()
    expect(cardIn('other', 4)).toBe(true)
    expect(cardIn('other', 5)).toBe(true)
    // 四列独立请求（useKanbanColumns 并行拉取）
    await waitFor(() =>
      expect(listColumn).toHaveBeenCalledWith(PROJECT_ID, 'pending', expect.anything()),
    )
    expect(listColumn).toHaveBeenCalledTimes(4)
  })

  test('合法拖拽：乐观更新零延迟入列，异步 kanbanApi.move 携带完整参数', async () => {
    login(['task:view', 'task:update'])
    mockColumns()
    const move = moveMock()
    move.mockResolvedValue(TASKS.pending[0]!)
    renderBoard()

    await screen.findByText('数据库索引优化')
    const card = screen.getByRole('button', { name: '任务：数据库索引优化' })

    dragCardToColumn(card, 'in_progress')

    // 乐观更新：拖拽释放瞬间卡片已入目标列（本地快照后直接置位）
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
    // 放到列的空白处不带锚点（由服务端追加到整列末尾）：本地只加载了一页，
    // 「当前页最后一张」不一定是整列最后一张，带上会被后端拒绝
    expect(move.mock.calls.at(-1)?.[1]).not.toHaveProperty('beforeTaskId')
    // 成功分支：移动错误被清空，无警告横幅
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  test('非法流转被状态机拦截：卡片弹回原位、警示文案、请求数恒为 0', async () => {
    login(['task:view', 'task:update'])
    mockColumns()
    const move = moveMock()
    renderBoard()

    await screen.findByText('旧版导出功能下线')
    const card = screen.getByRole('button', { name: '任务：旧版导出功能下线' })

    // cancelled → completed 违反六态状态机（cancelled 仅可回 not_started）
    dragCardToColumn(card, 'completed')

    // 冲刷拖拽尾效（sortable 行位移动画帧），避免 act() 告警
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
    })

    expect(screen.getByRole('alert')).toHaveTextContent('不能从“已取消”直接移动到“已完成”。')
    expect(cardIn('other', 5)).toBe(true)
    expect(cardIn('completed', 5)).toBe(false)
    expect(move).not.toHaveBeenCalled()
  })

  test('拖入「其他」列先弹快捷状态选择：源状态不可达选项禁用，确认后才移动', async () => {
    login(['task:view', 'task:update'])
    mockColumns()
    const move = moveMock()
    move.mockResolvedValue(TASKS.pending[0]!)
    renderBoard()

    await screen.findByText('数据库索引优化')
    const card = screen.getByRole('button', { name: '任务：数据库索引优化' })

    dragCardToColumn(card, 'other')

    // 弹层出现（尚未发起任何移动请求）
    const modal = screen.getByRole('dialog', { name: '选择“其他”列中的真实状态' })
    expect(modal).toBeInTheDocument()
    expect(move).not.toHaveBeenCalled()

    // 等 dnd-kit 的 click 捕获抑制器（拖拽结束 50ms 内拦截点击）过期，恢复真实点击；
    // 期间 React 产生的状态更新在 act 内冲刷，避免 act() 告警
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    // not_started 只能流转到 cancelled；blocked/on_hold 选项原位禁用
    const blocked = screen.getByRole('button', { name: '阻塞' })
    const onHold = screen.getByRole('button', { name: '暂停' })
    const cancelled = screen.getByRole('button', { name: '已取消' })
    expect(blocked).toBeDisabled()
    expect(onHold).toBeDisabled()
    expect(cancelled).toBeEnabled()

    fireEvent.click(cancelled)
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({
          taskId: 1,
          targetColumn: 'other',
          targetStatus: 'cancelled',
        }),
      ),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('网络失败：按服务端数据恢复原位并弹琥珀警告', async () => {
    login(['task:view', 'task:update'])
    mockColumns()
    const move = moveMock()
    move.mockRejectedValue({})
    renderBoard()

    await screen.findByText('梳理 RBAC 权限测试用例')
    const card = screen.getByRole('button', { name: '任务：梳理 RBAC 权限测试用例' })

    dragCardToColumn(card, 'completed')

    // 请求前卡片已乐观进入已完成列
    expect(cardIn('completed', 2)).toBe(true)

    // 失败后按服务端数据重新加载：回到原列
    await waitFor(() => expect(cardIn('in_progress', 2)).toBe(true))
    expect(cardIn('completed', 2)).toBe(false)
    expect(screen.getByRole('alert')).toHaveTextContent('任务移动失败，已按服务器数据恢复')
  })

  test('只读成员（仅 task:view）：卡片锁定光标、拖拽无效、零请求（RL-06）', async () => {
    login(['task:view'])
    mockColumns()
    const move = moveMock()
    renderBoard()

    await screen.findByText('数据库索引优化')
    // 全部卡片呈现锁定提示且不注册拖拽手柄
    expect(lockedCards()).toHaveLength(5)
    expect(screen.queryByRole('button', { name: '任务：数据库索引优化' })).not.toBeInTheDocument()
    const lockedCard = document.querySelector('[data-workspace-task-card]') as HTMLElement
    expect(lockedCard.className).toContain('cursor-not-allowed')

    dragCardToColumn(lockedCard, 'in_progress')
    expect(move).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('task:update:self 仅放行本人负责的任务（他人任务保持锁定）', async () => {
    login(['task:view', 'task:update:self'], 1)
    mockColumns()
    renderBoard()

    await screen.findByText('数据库索引优化')
    // 本人任务（assigneeId=1，当前用户=1）：可拖拽
    const ownCard = screen.getByRole('button', { name: '任务：数据库索引优化' })
    expect(ownCard).not.toHaveAttribute('aria-disabled')
    // 他人任务（assigneeId=2，当前用户=1）：锁定提示
    const locked = lockedCards()
    expect(locked).toHaveLength(1)
    expect(locked[0]).toHaveAttribute('data-task-id', '3')
    // 只有「编辑自己任务」权限：悬停说明是指派给了别人，而不是笼统的「没有权限」
    expect(locked[0]!.getAttribute('title')).toContain('只能拖动指派给自己的任务')
    // 整张卡就是拖动区域：不再显示拖动点图标，能拖的卡悬停提示「按住拖动」
    expect(document.querySelectorAll('[data-card-grip]')).toHaveLength(0)
    expect(ownCard.getAttribute('title')).toContain('按住拖动')
  })

  test('保存中不锁板：上一张还在保存时，刚拖过的卡和其它卡都能继续拖，请求按顺序发出', async () => {
    login(['task:view', 'task:update'])
    mockColumns()
    const move = moveMock()
    let release: (value: Task) => void = () => {}
    move.mockImplementationOnce(() => new Promise<Task>((resolve) => (release = resolve)))
    move.mockResolvedValue(TASKS.pending[0]!)
    renderBoard()

    await screen.findByText('数据库索引优化')
    dragCardToColumn(screen.getByRole('button', { name: '任务：数据库索引优化' }), 'in_progress')
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1))

    // 第一张还在保存：「进行中」里原有的卡照样能拖（此前保存中全板锁住）
    const second = screen.getByRole('button', { name: '任务：梳理 RBAC 权限测试用例' })
    expect(second).not.toHaveAttribute('aria-disabled')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    dragCardToColumn(second, 'completed')
    expect(cardIn('completed', 2)).toBe(true)
    // 排队：第一张保存完才发第二个请求
    expect(move).toHaveBeenCalledTimes(1)
    await act(async () => release(TASKS.pending[0]!))
    await waitFor(() => expect(move).toHaveBeenCalledTimes(2))
    expect(move.mock.calls[1]![1]).toMatchObject({ taskId: 2, targetStatus: 'completed' })
  })

  test('0% 的卡从进行中直接拖回待处理，不弹确认', async () => {
    login(['task:view', 'task:update'])
    mockColumns()
    const move = moveMock()
    move.mockResolvedValue(TASKS.in_progress[0]!)
    renderBoard()

    await screen.findByText('梳理 RBAC 权限测试用例')
    dragCardToColumn(
      screen.getByRole('button', { name: '任务：梳理 RBAC 权限测试用例' }),
      'pending',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(cardIn('pending', 2)).toBe(true)
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ taskId: 2, targetStatus: 'not_started' }),
      ),
    )
  })

  function renderHalfDone() {
    login(['task:view', 'task:update'])
    const halfDone = taskOf({
      id: 8,
      name: '做了一半的任务',
      status: 'in_progress',
      progressPercent: 40,
      assigneeId: 1,
    })
    vi.spyOn(kanbanApi, 'listColumn').mockImplementation(
      async (_projectId: number, column: KanbanColumn) => {
        const data = column === 'in_progress' ? [halfDone] : TASKS[column]
        return { data, meta: { total: data.length, page: 1, perPage: 25, totalPages: 1 } }
      },
    )
    const move = moveMock()
    move.mockResolvedValue(halfDone)
    renderBoard()
    return move
  }

  test('有进度的卡退回待处理：卡片先落在待处理再确认会清零，确认后才保存', async () => {
    const move = renderHalfDone()
    await screen.findByText('做了一半的任务')
    dragCardToColumn(screen.getByRole('button', { name: '任务：做了一半的任务' }), 'pending')
    const dialog = screen.getByRole('dialog', { name: '退回待处理' })
    expect(dialog).toHaveTextContent('当前进度 40%')
    // 确认前卡片已在待处理（此前飞回原列、还盖住确认框，用户以为拖不过去）
    expect(cardIn('pending', 8)).toBe(true)
    expect(move).not.toHaveBeenCalled()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    fireEvent.click(screen.getByRole('button', { name: '退回并清零' }))
    expect(cardIn('pending', 8)).toBe(true)
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ taskId: 8, targetStatus: 'not_started' }),
      ),
    )
  })

  test('退回确认点「留在进行中」：卡片放回原列，不发请求', async () => {
    const move = renderHalfDone()
    await screen.findByText('做了一半的任务')
    dragCardToColumn(screen.getByRole('button', { name: '任务：做了一半的任务' }), 'pending')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    fireEvent.click(screen.getByRole('button', { name: '留在进行中' }))
    expect(cardIn('in_progress', 8)).toBe(true)
    expect(cardIn('pending', 8)).toBe(false)
    expect(move).not.toHaveBeenCalled()
  })
})
describe('全部完成后一句话加新任务（2026-09-29）', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAuthStore.getState().clear()
    installDndRects()
  })

  test('待处理与进行中都空、已完成有卡：出现「全部完成」提示，可展开 AI 建卡，也可去开新项目', async () => {
    useAuthStore.setState({
      permissions: ['task:view', 'task:update', 'task:create'],
      currentOrganizationId: 1,
      isAuthenticated: true,
    })
    vi.spyOn(kanbanApi, 'listColumn').mockImplementation(
      async (_projectId: number, column: KanbanColumn) => {
        const data =
          column === 'completed'
            ? TASKS.completed.length
              ? TASKS.completed
              : [taskOf({ id: 99, status: 'completed' })]
            : []
        return { data, meta: { total: data.length, page: 1, perPage: 25, totalPages: 1 } }
      },
    )
    renderBoard()
    await screen.findByText('全部任务都完成了')
    expect(document.querySelector('[data-kanban-all-done-new-project]')).toHaveAttribute(
      'href',
      '/next/create',
    )
    fireEvent.click(screen.getByRole('button', { name: /用一句话加新任务/ }))
    expect(document.querySelector('[data-ai-task-placement-card]')).not.toBeNull()
  })

  test('还有待处理的任务时不出现', async () => {
    useAuthStore.setState({
      permissions: ['task:view', 'task:update', 'task:create'],
      currentOrganizationId: 1,
      isAuthenticated: true,
    })
    mockColumns()
    renderBoard()
    await screen.findAllByText(/./)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('全部任务都完成了')).toBeNull()
  })
})
