/**
 * v3-ui-next-batch1-strategy-launch-tasks W3 任务 3.2
 * 列表镜头多选勾选与跨页计数单元测试。
 *
 * 覆盖：
 * 1. 行项多选勾选；
 * 2. 表头全选与半选状态流转；
 * 3. Shift 区间连续选中；
 * 4. 分页切换后已选计数保持。
 *
 * 硬约束遵循：
 * - 一律使用 vi.stubGlobal('fetch')，严禁 vi.mock('@/lib/api/*')；
 * - jsdom 补齐 matchMedia / PointerEvent；
 * - 只读测试 0 写请求。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceListLens } from '@/components/next/lenses/WorkspaceListLens'
import type { PaginatedTasks, Task } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'

// Mock matchMedia & PointerEvent for jsdom
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
}

const PROJECT_ID = 42
const TOTAL_TASKS = 40
const PER_PAGE = 25

function makeTask(id: number): Task {
  return {
    id,
    projectId: PROJECT_ID,
    name: `排期任务 ${id}`,
    description: null,
    status: id % 2 === 0 ? 'in_progress' : 'not_started',
    priority: id % 3 === 0 ? 'high' : 'medium',
    taskType: 'task',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 30,
    estimatedHours: 8,
    actualHours: null,
    progressPercent: (id * 10) % 100,
    kanbanRank: null,
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
  }
}

const ALL_TASKS: Task[] = Array.from({ length: TOTAL_TASKS }, (_, i) => makeTask(i + 1))

function jsonEnvelope(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as unknown as Response
}

function renderLens(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceListLens projectId={PROJECT_ID} />
    </QueryClientProvider>,
  )
}

describe('WorkspaceListLens 行头多选与 Shift 连选（W3 任务 3.1 / 3.2）', () => {
  let queryClient: QueryClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目经理',
        organizations: [{ id: 1, name: '主组织', slug: 'main', role: 'admin' }],
      },
      currentOrganizationId: 1,
      permissions: ['task:view', 'task:create', 'task:update', 'task:delete'],
      isAuthenticated: true,
      hasHydrated: true,
    })

    fetchMock = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url)
      if (urlStr.includes('/tasks') && !urlStr.includes('/members')) {
        const parsed = new URL(urlStr, 'http://localhost')
        const page = Number(parsed.searchParams.get('page') || '1')
        const perPage = Number(parsed.searchParams.get('perPage') || String(PER_PAGE))
        const offset = (page - 1) * perPage
        const slice = ALL_TASKS.slice(offset, offset + perPage)
        const paginated: PaginatedTasks = {
          data: slice,
          meta: {
            total: TOTAL_TASKS,
            page,
            perPage,
            totalPages: Math.ceil(TOTAL_TASKS / perPage),
          },
        }
        return Promise.resolve(jsonEnvelope(paginated))
      }
      if (urlStr.includes('/members')) {
        return Promise.resolve(jsonEnvelope([]))
      }
      return Promise.resolve(jsonEnvelope({}))
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('行项多选勾选：单项切换与计数回显', async () => {
    renderLens(queryClient)

    // 等待首屏渲染
    await screen.findByText('排期任务 1')

    const row1Checkbox = screen.getByLabelText('选择任务 排期任务 1') as HTMLInputElement
    const row2Checkbox = screen.getByLabelText('选择任务 排期任务 2') as HTMLInputElement

    expect(row1Checkbox.checked).toBe(false)
    expect(row2Checkbox.checked).toBe(false)
    expect(screen.queryByText(/已选.*项/)).toBeNull()

    // 点击勾选第 1 项
    fireEvent.click(row1Checkbox)
    expect(row1Checkbox.checked).toBe(true)
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()

    // 点击勾选第 2 项
    fireEvent.click(row2Checkbox)
    expect(row2Checkbox.checked).toBe(true)
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()

    // 取消勾选第 1 项
    fireEvent.click(row1Checkbox)
    expect(row1Checkbox.checked).toBe(false)
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
  })

  test('表头全选与半选状态流转：none -> indeterminate -> all -> none', async () => {
    renderLens(queryClient)

    await screen.findByText('排期任务 1')

    const selectAllCheckbox = screen.getByLabelText('全选当前页任务') as HTMLInputElement
    expect(selectAllCheckbox.checked).toBe(false)
    expect(selectAllCheckbox.indeterminate).toBe(false)

    // 勾选单行后，表头呈现半选态（indeterminate === true）
    const row1Checkbox = screen.getByLabelText('选择任务 排期任务 1')
    fireEvent.click(row1Checkbox)
    expect(selectAllCheckbox.checked).toBe(false)
    expect(selectAllCheckbox.indeterminate).toBe(true)

    // 点击表头全选当前页
    fireEvent.click(selectAllCheckbox)
    expect(selectAllCheckbox.checked).toBe(true)
    expect(selectAllCheckbox.indeterminate).toBe(false)
    expect(screen.getByText(`已选 ${PER_PAGE} 项`)).toBeInTheDocument()

    // 验证当前页全部勾选
    for (let i = 1; i <= PER_PAGE; i++) {
      const cb = screen.getByLabelText(`选择任务 排期任务 ${i}`) as HTMLInputElement
      expect(cb.checked).toBe(true)
    }

    // 再次点击表头全选，全部取消勾选
    fireEvent.click(selectAllCheckbox)
    expect(selectAllCheckbox.checked).toBe(false)
    expect(selectAllCheckbox.indeterminate).toBe(false)
    expect(screen.queryByText(/已选.*项/)).toBeNull()
  })

  test('Shift 区间连续多选：选中起始项后 Shift+点击目标项实现区间批量选中', async () => {
    renderLens(queryClient)

    await screen.findByText('排期任务 1')

    const row1Checkbox = screen.getByLabelText('选择任务 排期任务 1') as HTMLInputElement
    const row2Checkbox = screen.getByLabelText('选择任务 排期任务 2') as HTMLInputElement
    const row3Checkbox = screen.getByLabelText('选择任务 排期任务 3') as HTMLInputElement
    const row4Checkbox = screen.getByLabelText('选择任务 排期任务 4') as HTMLInputElement

    // 1. 普通点击第 1 行（索引 0）
    fireEvent.click(row1Checkbox)
    expect(row1Checkbox.checked).toBe(true)
    expect(row2Checkbox.checked).toBe(false)
    expect(row3Checkbox.checked).toBe(false)

    // 2. 按住 Shift 键点击第 3 行（索引 2）
    fireEvent.click(row3Checkbox, { shiftKey: true })

    // 断言区间第 1、2、3 行均被选中
    expect(row1Checkbox.checked).toBe(true)
    expect(row2Checkbox.checked).toBe(true)
    expect(row3Checkbox.checked).toBe(true)
    expect(row4Checkbox.checked).toBe(false)
    expect(screen.getByText('已选 3 项')).toBeInTheDocument()
  })

  test('跨页切换后已选计数保持且返回原页仍为选中', async () => {
    renderLens(queryClient)

    await screen.findByText('排期任务 1')

    const row1Checkbox = screen.getByLabelText('选择任务 排期任务 1')
    const row2Checkbox = screen.getByLabelText('选择任务 排期任务 2')

    // 第 1 页勾选 2 项
    fireEvent.click(row1Checkbox)
    fireEvent.click(row2Checkbox)
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()

    // 切换至第 2 页
    const nextPageBtn = screen.getByLabelText('下一页')
    fireEvent.click(nextPageBtn)

    // 第 2 页加载后，计数仍保持 2 项
    await screen.findByText('排期任务 26')
    expect(screen.getByText('已选 2 项')).toBeInTheDocument()

    // 在第 2 页再勾选 1 项（排期任务 26）
    const row26Checkbox = screen.getByLabelText('选择任务 排期任务 26') as HTMLInputElement
    fireEvent.click(row26Checkbox)
    expect(row26Checkbox.checked).toBe(true)
    expect(screen.getByText('已选 3 项')).toBeInTheDocument()

    // 切回第 1 页
    const prevPageBtn = screen.getByLabelText('上一页')
    fireEvent.click(prevPageBtn)

    await screen.findByText('排期任务 1')
    // 计数保持 3 项
    expect(screen.getByText('已选 3 项')).toBeInTheDocument()
    // 第 1 页的第 1、2 项仍为 checked
    const backRow1 = screen.getByLabelText('选择任务 排期任务 1') as HTMLInputElement
    const backRow2 = screen.getByLabelText('选择任务 排期任务 2') as HTMLInputElement
    expect(backRow1.checked).toBe(true)
    expect(backRow2.checked).toBe(true)
  })
})
