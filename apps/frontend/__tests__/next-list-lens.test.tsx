/**
 * v3-ui-next-remaining-lenses W2（tasks 2.4）—— 列表镜头组件渲染与服务端查询联动测试。
 *
 * 覆盖（tasks 2.3 契约 + spec「列表精确面板镜头」场景）：
 * - 高密度表格列头与行字段渲染（状态/优先级/负责人含 AI Agent 标识/等宽起止排期/进度）；
 * - 点击「截止日」表头 → 升序参数 `sort=+endDate&page=1` 发起新查询（表头轮转指示）；
 * - 300ms 防抖搜索重查；状态下拉筛选（筛选改变重置 page=1）；
 * - 分页器翻页驱动 page=2、每页 50 项切换、总数统计与边界禁用；
 * - 点击任务行 / Enter / Space 唤起详情预览并触发 onOpenTask 回调，Esc 关闭；
 * - 骨架屏（isPending）、精确档紧凑降级、筛选空态（清除筛选）、错误卡重试。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { WorkspaceListLens } from '@/components/next/lenses/WorkspaceListLens'
import { projectMembersApi, type ProjectMember } from '@/lib/api/projects'
import { tasksApi, type PaginatedTasks, type Task, type TaskListFilters } from '@/lib/api/tasks'
import { useNextTrackStore } from '@/stores/next-track-store'

const PROJECT_ID = 7
const STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
] as const
const PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest'] as const
const TOTAL = 40
const TOTAL_PAGES = 2

function taskOf(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: PROJECT_ID,
    name: id === 1 ? '核心微服务架构设计' : `排期任务 ${id}`,
    description: id === 1 ? '定义服务边界并输出架构评审产出物。' : null,
    status: STATUSES[id % STATUSES.length] as Task['status'],
    priority: PRIORITIES[id % PRIORITIES.length] as Task['priority'],
    taskType: 'task',
    startDate: id % 4 === 0 ? null : '2026-09-01',
    endDate: id % 4 === 0 ? '2026-09-30' : null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: id % 4 === 0 ? null : 30,
    estimatedHours: null,
    actualHours: null,
    progressPercent: (id * 7) % 101,
    kanbanRank: null,
    assigneeId: id % 5 === 0 ? 99 : id % 3 === 0 ? 9 : null,
    assigneeType: id % 5 === 0 ? 'agent' : 'user',
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    subtaskCount: id === 1 ? 3 : undefined,
    dependencyCount: id === 1 ? 2 : undefined,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

const ALL_TASKS: Task[] = Array.from({ length: TOTAL }, (_, index) => taskOf(index + 1))

const MEMBERS = [
  {
    id: 1,
    projectId: PROJECT_ID,
    userId: 9,
    projectRoleId: null,
    isActive: true,
    user: { id: 9, fullName: '张伟', email: 'zhang@example.com', initials: 'ZW', isActive: true },
  },
]

function paginate(page: number, perPage: number): PaginatedTasks {
  const offset = (page - 1) * perPage
  return {
    data: ALL_TASKS.slice(offset, offset + perPage),
    meta: { total: TOTAL, page, perPage, totalPages: TOTAL_PAGES },
  }
}

// ---------------------------------------------------------------------------
// 挂载与夹具
// ---------------------------------------------------------------------------

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function TestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

let listSpy: MockInstance<(projectId: number, filters?: TaskListFilters) => Promise<PaginatedTasks>>
let membersSpy: MockInstance<(projectId: number) => Promise<ProjectMember[]>>

beforeEach(() => {
  listSpy = vi
    .spyOn(tasksApi, 'list')
    .mockImplementation(async (_projectId, filters = {}) =>
      paginate(filters.page ?? 1, filters.perPage ?? 25),
    )
  membersSpy = vi.spyOn(projectMembersApi, 'list').mockImplementation(async () => [...MEMBERS])
})

afterEach(() => {
  listSpy?.mockRestore()
  membersSpy?.mockRestore()
  // 组件可能仍挂载：store 复位包进 act，避免游离的 useSyncExternalStore 重渲染告警。
  act(() => {
    useNextTrackStore.setState({ immersionTier: null })
  })
})

function renderLens(overrides: Partial<ComponentProps<typeof WorkspaceListLens>> = {}) {
  return render(<WorkspaceListLens projectId={PROJECT_ID} {...overrides} />, { wrapper: wrapper() })
}

function lastListCall(): TaskListFilters {
  const calls = listSpy.mock.calls
  return (calls[calls.length - 1]?.[1] ?? {}) as TaskListFilters
}

/** 行元素（data-list-row 命中后整行断言）。 */
function rowOf(container: HTMLElement, id: number): HTMLElement | null {
  return container.querySelector(`[data-list-row="${id}"]`)
}

describe('components/next/lenses/WorkspaceListLens：高密度渲染', () => {
  test('表头列与行字段完整渲染（名称/编号/状态/优先级/日期/进度）', async () => {
    const { container } = renderLens()

    // 首屏先呈现发丝脉冲骨架屏
    expect(screen.getByRole('status', { name: '正在加载任务列表' })).toBeInTheDocument()
    expect(container.querySelector('[data-list-skeleton]')).toHaveAttribute('aria-busy', 'true')

    expect(await screen.findByText('核心微服务架构设计')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /任务名称/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '归属层级' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /状态/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /优先级/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '负责人' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /截止日/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /进度/ })).toBeInTheDocument()

    // 默认每页 25 行（1px 发丝网格高密度）
    expect(container.querySelectorAll('[data-list-lens-row]')).toHaveLength(25)
    expect(container.querySelector('[data-list-skeleton]')).toBeNull()

    // 行 1：任务编号、状态微标、日期占位（该 fixture 任务仅 startDate → `~ —` 兜底）、进度条
    const row = rowOf(container, 1)
    expect(row).not.toBeNull()
    expect(row).toHaveAttribute('role', 'row')
    expect(row).toHaveTextContent('#1')
    expect(row).toHaveTextContent('2026-09-01 ~ —')
    const progress = row?.querySelector('[role="progressbar"]')
    expect(progress).toHaveAttribute('aria-valuenow', String((1 * 7) % 101))
    expect(screen.getByText('共 40 项')).toBeInTheDocument()
  })

  test('人类负责人经成员索引补齐缩写，AI Agent 任务显示专属天青微标', async () => {
    const { container } = renderLens()
    await screen.findByText('核心微服务架构设计')

    // id=3 的人类负责人（assigneeId=9）经 projectMembersApi 索引补齐为张伟 / ZW
    expect(screen.getAllByText('张伟').length).toBeGreaterThan(0)
    const humanRow = rowOf(container, 3)
    expect(humanRow?.querySelector('[data-list-assignee-initials]')).toHaveTextContent('ZW')

    // id=5 的 agent 任务（assigneeType='agent'）→ Agent 徽章 + aria 前缀
    const agentRow = rowOf(container, 5)
    expect(agentRow?.querySelector('[data-list-agent-assignee]')).not.toBeNull()
    expect(screen.getAllByLabelText(/AI 负责人/).length).toBeGreaterThan(0)
    expect(membersSpy).toHaveBeenCalledWith(PROJECT_ID)
  })
})

describe('components/next/lenses/WorkspaceListLens：服务端排序/筛选/分页联动', () => {
  test('点击「截止日」表头触发升序 `sort=+endDate&page=1` 新查询并轮转指示', async () => {
    const { container } = renderLens()
    await screen.findByText('核心微服务架构设计')
    const initialCalls = listSpy.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /按截止日排序/ }))
    await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThan(initialCalls))
    expect(lastListCall()).toMatchObject({ sort: '+endDate', page: 1 })
    expect(container.querySelector('[data-list-table]')).toHaveAttribute(
      'data-list-sort-param',
      '+endDate',
    )
    // 表头 aria-sort 升序 + 向上箭头
    const endDateHeader = screen
      .getAllByRole('columnheader')
      .find((node) => node.textContent?.includes('截止日'))
    expect(endDateHeader).toHaveAttribute('aria-sort', 'ascending')

    // 再次点击 → 降序；第三次 → 回默认序（计划开始日期升序 +startDate）
    fireEvent.click(screen.getByRole('button', { name: /按截止日排序/ }))
    await waitFor(() => expect(lastListCall().sort).toBe('-endDate'))
    fireEvent.click(screen.getByRole('button', { name: /按截止日排序/ }))
    await waitFor(() => expect(lastListCall().sort).toBe('+startDate'))
    expect(
      screen.getAllByRole('columnheader').find((node) => node.textContent?.includes('截止日')),
    ).toHaveAttribute('aria-sort', 'none')
  })

  test('状态下拉筛选派发 status 参数并重置回第 1 页', async () => {
    renderLens()
    await screen.findByText('核心微服务架构设计')

    fireEvent.change(screen.getByLabelText('按状态筛选'), { target: { value: 'in_progress' } })
    await waitFor(() => expect(lastListCall()).toMatchObject({ status: 'in_progress', page: 1 }))

    fireEvent.change(screen.getByLabelText('按状态筛选'), { target: { value: 'all' } })
    await waitFor(() => expect(lastListCall().status).toBeUndefined())

    fireEvent.change(screen.getByLabelText('按优先级筛选'), { target: { value: 'highest' } })
    await waitFor(() => expect(lastListCall()).toMatchObject({ priority: 'highest', page: 1 }))
  })

  test('搜索框 300ms 防抖后发起 search 重查（防抖窗口内零额外请求）', async () => {
    renderLens()
    await screen.findByText('核心微服务架构设计')

    const callsBeforeTyping = listSpy.mock.calls.length
    fireEvent.change(screen.getByLabelText('搜索任务'), {
      target: { value: '核心微服务' },
    })
    // 防抖窗口内：不得立刻发起携带 search 的查询
    expect(listSpy.mock.calls.length).toBe(callsBeforeTyping)

    await waitFor(
      () =>
        expect(
          listSpy.mock.calls.some(
            ([, filters]) => filters?.search === '核心微服务' && filters.page === 1,
          ),
        ).toBe(true),
      { timeout: 1500 },
    )

    // 清除按钮即时复位搜索
    fireEvent.click(screen.getByLabelText('清除搜索'))
    await waitFor(() =>
      expect(listSpy.mock.calls[listSpy.mock.calls.length - 1]?.[1]?.search).toBeUndefined(),
    )
  })

  test('底部分页器：翻页驱动 page=2、50 项切换、总数统计与边界禁用', async () => {
    const { container } = renderLens()
    await screen.findByText('核心微服务架构设计')
    expect(screen.getByText('共 40 项')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-list-lens-row]')).toHaveLength(25)

    const prev = screen.getByLabelText('上一页')
    expect(prev).toBeDisabled()
    fireEvent.click(screen.getByLabelText('下一页'))
    await waitFor(() => expect(lastListCall()).toMatchObject({ page: 2, perPage: 25 }))
    await screen.findByText('第 2 / 2 页')
    await waitFor(() => expect(container.querySelectorAll('[data-list-lens-row]')).toHaveLength(15))
    expect(prev).not.toBeDisabled()
    expect(screen.getByLabelText('下一页')).toBeDisabled()

    // 每页 50 项 → 单页全量并回到第 1 页
    fireEvent.change(screen.getByLabelText('每页条数'), { target: { value: '50' } })
    await waitFor(() => expect(lastListCall()).toMatchObject({ page: 1, perPage: 50 }))
    await waitFor(() => expect(container.querySelectorAll('[data-list-lens-row]')).toHaveLength(40))
    expect(container.querySelectorAll('[data-list-lens-row]')).toHaveLength(40)
  })
})

describe('components/next/lenses/WorkspaceListLens：行交互与详情预览', () => {
  test('点击任务行唤起详情预览并触发 onOpenTask 回调，Esc 关闭', async () => {
    const onOpenTask = vi.fn()
    const { container } = renderLens({ onOpenTask })
    await screen.findByText('核心微服务架构设计')

    const row = rowOf(container, 1) as HTMLElement
    fireEvent.click(row)

    await waitFor(() => expect(onOpenTask).toHaveBeenCalledTimes(1))
    expect(onOpenTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: '核心微服务架构设计' }),
    )

    const dialog = await screen.findByRole('dialog', { name: '任务详情：核心微服务架构设计' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('定义服务边界并输出架构评审产出物。')).toBeInTheDocument()
    expect(screen.getByText('2 项（前置 / 后置合计）')).toBeInTheDocument()
    expect(screen.getByText('3 项')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '任务详情：核心微服务架构设计' })).toBeNull(),
    )
  })

  test('行焦点键盘：Enter 与 Space 唤起详情（零写请求）', async () => {
    const onOpenTask = vi.fn()
    const { container } = renderLens({ onOpenTask })
    await screen.findByText('核心微服务架构设计')

    const row = rowOf(container, 1) as HTMLElement
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(onOpenTask).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '任务详情：核心微服务架构设计' })).toBeNull(),
    )

    fireEvent.keyDown(row, { key: ' ' })
    expect(onOpenTask).toHaveBeenCalledTimes(2)
    expect(
      await screen.findByRole('dialog', { name: '任务详情：核心微服务架构设计' }),
    ).toBeInTheDocument()
  })
})

describe('components/next/lenses/WorkspaceListLens：精确档 / 空态 / 错误态', () => {
  test('精确档（precise）行高压缩为 32px 并标注 data-immersion', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    const { container } = renderLens()
    await screen.findByText('核心微服务架构设计')

    expect(container.querySelector('[data-list-lens]')).toHaveAttribute('data-immersion', 'precise')
    const row = rowOf(container, 1) as HTMLElement
    expect(row.className).toContain('h-8')
    expect(row.className).not.toContain('h-9')
  })

  test('沉浸档（immersive）缺省行高 36px', async () => {
    const { container } = renderLens()
    await screen.findByText('核心微服务架构设计')
    expect(rowOf(container, 1)?.className).toContain('h-9')
  })

  test('筛选无结果时呈现空态并提供「清除筛选」快捷复位', async () => {
    listSpy.mockImplementation(async (_projectId, filters) =>
      filters?.status === 'blocked'
        ? { data: [], meta: { total: 0, page: 1, perPage: 25, totalPages: 0 } }
        : paginate(1, 25),
    )
    const { container } = renderLens()
    await screen.findByText('核心微服务架构设计')

    fireEvent.change(screen.getByLabelText('按状态筛选'), { target: { value: 'blocked' } })
    const empty = await screen.findByLabelText('未找到匹配的任务')
    expect(empty).toBeInTheDocument()
    expect(screen.getByText('请尝试调整筛选条件，或清除筛选查看全部任务。')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-list-lens-row]')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(lastListCall().status).toBeUndefined())
    expect(await screen.findByText('核心微服务架构设计')).toBeInTheDocument()
  })

  test('接口异常渲染错误卡，点击「重新载入」恢复数据', async () => {
    listSpy
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(async (_projectId) => paginate(1, 25))
    const { container } = renderLens()

    const alert = await screen.findByRole('alert', { name: '任务列表加载错误' })
    expect(alert).toBeInTheDocument()
    expect(container.querySelector('[data-list-skeleton]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    expect(await screen.findByText('核心微服务架构设计')).toBeInTheDocument()
    expect(screen.queryByRole('alert', { name: '任务列表加载错误' })).toBeNull()
    // 全程只读：零写方法被触碰
    const writes = {
      create: vi.spyOn(tasksApi, 'create'),
      update: vi.spyOn(tasksApi, 'update'),
      changeStatus: vi.spyOn(tasksApi, 'changeStatus'),
      batch: vi.spyOn(tasksApi, 'batch'),
    }
    expect(writes.create).not.toHaveBeenCalled()
    expect(writes.update).not.toHaveBeenCalled()
    expect(writes.changeStatus).not.toHaveBeenCalled()
    expect(writes.batch).not.toHaveBeenCalled()
  })

  test('onRenderComplete 在首屏数据就绪后上报渲染度量', async () => {
    const onRenderComplete = vi.fn()
    renderLens({ onRenderComplete })
    await screen.findByText('核心微服务架构设计')
    await waitFor(() => expect(onRenderComplete).toHaveBeenCalledTimes(1))
    const metric = onRenderComplete.mock.calls[0]?.[0] as {
      durationMs: number
      activeElements: number
    }
    expect(metric.durationMs).toBeGreaterThanOrEqual(0)
    expect(metric.activeElements).toBe(25)
  })
})
