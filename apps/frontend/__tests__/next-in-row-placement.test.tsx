/**
 * v3-ui-next-batch1-strategy-launch-tasks W3 任务 3.6
 * 列表行间放置插槽 Enter 规则推断与 Ctrl+Enter 确认落库测试。
 *
 * 覆盖：
 * 1. 行间悬停激活插槽（点击「+」按钮展开 44px 单行卡片）；
 * 2. 输入一句话自然语言解析任务名、工期与优先级；
 * 3. 呈现琥珀色「⚡ 待确认推断 (0.85)」微标，断言写请求为 0（RL-01）；
 * 4. 按下 Ctrl+Enter 快捷键或点击确认落库（POST /tasks）并收起插槽；
 * 5. Esc / 取消按钮安全收起零请求；
 * 6. 权限防护：无 task:create 权限时插槽禁用。
 *
 * 硬约束遵循：
 * - 一律使用 vi.stubGlobal('fetch')，严禁 vi.mock('@/lib/api/*')；
 * - 异步拒绝断言用 rejects.toMatchObject({message})。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { InRowTaskPlacementSlot } from '@/components/next/project-space/InRowTaskPlacementSlot'
import type { Task } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'

const PROJECT_ID = 42

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 101,
    projectId: PROJECT_ID,
    name: '编写单元测试',
    description: null,
    status: 'not_started',
    priority: 'high',
    taskType: 'task',
    startDate: '2026-09-11',
    endDate: null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: 3,
    estimatedHours: 24,
    actualHours: null,
    progressPercent: 0,
    kanbanRank: null,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-09-11T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as unknown as Response
}

function renderSlot(
  queryClient: QueryClient,
  props: Partial<React.ComponentProps<typeof InRowTaskPlacementSlot>> = {},
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <InRowTaskPlacementSlot projectId={PROJECT_ID} afterTaskId={1} {...props} />
    </QueryClientProvider>,
  )
}

describe('InRowTaskPlacementSlot 行间放置建任务（W3 任务 3.5 / 3.6）', () => {
  let queryClient: QueryClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    useAuthStore.setState({
      user: {
        id: 1,
        email: 'dev@example.com',
        fullName: '核心研发',
        organizations: [{ id: 1, name: '研发组', slug: 'dev', role: 'member' }],
      },
      currentOrganizationId: 1,
      permissions: ['task:view', 'task:create', 'task:update'],
      isAuthenticated: true,
      hasHydrated: true,
    })

    fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return Promise.resolve(jsonResponse(makeTask(body)))
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('行间放置插槽初始折叠，点击「+」按钮激活原地展开 44px 卡片', () => {
    const { container } = renderSlot(queryClient)

    const slot = container.querySelector('[data-in-row-placement-slot]')
    expect(slot).toHaveAttribute('data-slot-active', 'false')

    const btn = screen.getByLabelText('在行间放置新任务')
    fireEvent.click(btn)

    expect(slot).toHaveAttribute('data-slot-active', 'true')
    expect(slot).toHaveAttribute('data-placement-phase', 'input')
    expect(screen.getByPlaceholderText(/输入任务一句话/)).toBeInTheDocument()
  })

  test('输入自然语言按 Enter 触发规则推断，呈现琥珀色待确认微标且网络写请求严格为 0（RL-01）', () => {
    const { container } = renderSlot(queryClient)

    // 激活插槽
    fireEvent.click(screen.getByLabelText('在行间放置新任务'))

    const input = screen.getByLabelText('一句话任务描述')
    fireEvent.change(input, { target: { value: '编写单元测试 3天 高' } })

    // 按下 Enter 键触发纯客户端规则推断
    fireEvent.keyDown(input, { key: 'Enter' })

    const slot = container.querySelector('[data-in-row-placement-slot]')
    expect(slot).toHaveAttribute('data-placement-phase', 'preview')

    // 断言解析出的字段
    expect(screen.getByText('编写单元测试')).toBeInTheDocument()
    expect(screen.getByText('3 天')).toBeInTheDocument()
    const prioritySelect = screen.getByTestId('placement-priority-select') as HTMLSelectElement
    expect(prioritySelect.value).toBe('high')

    // 断言琥珀色「⚡ 待确认推断」微标存在
    const marker = container.querySelector('[data-placement-marker]')
    expect(marker).toBeInTheDocument()
    expect(marker).toHaveTextContent('⚡ 待确认推断')
    expect(marker).toHaveAttribute('data-confidence', '0.85')

    // 严格断言此阶段写请求为 0（RL-01 红线）
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('核对推断字段后按下 Ctrl+Enter 快捷键显式确认落库并收起插槽', async () => {
    const onCreated = vi.fn()
    const { container } = renderSlot(queryClient, { onCreated })

    fireEvent.click(screen.getByLabelText('在行间放置新任务'))

    const input = screen.getByLabelText('一句话任务描述')
    fireEvent.change(input, { target: { value: '编写单元测试 3天 高' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // 在插槽卡片上按下 Ctrl+Enter 确认落库
    const slotCard = container.querySelector('[data-in-row-placement-slot]')!
    fireEvent.keyDown(slotCard, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [calledUrl, calledInit] = firstCall!
    expect(calledUrl).toContain(`/projects/${PROJECT_ID}/tasks`)
    expect(calledInit.method).toBe('POST')

    const sentBody = JSON.parse(calledInit.body)
    expect(sentBody.name).toBe('编写单元测试')
    expect(sentBody.durationDays).toBe(3)
    expect(sentBody.priority).toBe('high')
    expect(sentBody.status).toBe('not_started')

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    // 成功后自动收起
    expect(slotCard).toHaveAttribute('data-slot-active', 'false')
  })

  test('点击「确认创建」按钮显式落库', async () => {
    const onCreated = vi.fn()
    renderSlot(queryClient, { onCreated })

    fireEvent.click(screen.getByLabelText('在行间放置新任务'))

    const input = screen.getByLabelText('一句话任务描述')
    fireEvent.change(input, { target: { value: '联调支付接口 2天 紧急' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const confirmBtn = screen.getByText('确认创建')
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const sentBody = JSON.parse(firstCall![1].body)
    expect(sentBody.name).toBe('联调支付接口')
    expect(sentBody.durationDays).toBe(2)
    expect(sentBody.priority).toBe('highest')

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
  })

  test('Esc 键或点击取消按钮安全收拢插槽，零网络请求', () => {
    const { container } = renderSlot(queryClient)

    fireEvent.click(screen.getByLabelText('在行间放置新任务'))
    const slot = container.querySelector('[data-in-row-placement-slot]')
    expect(slot).toHaveAttribute('data-slot-active', 'true')

    // 按 Esc 键
    fireEvent.keyDown(slot!, { key: 'Escape' })
    expect(slot).toHaveAttribute('data-slot-active', 'false')
    expect(fetchMock).not.toHaveBeenCalled()

    // 再次激活后在预览态点击取消
    fireEvent.click(screen.getByLabelText('在行间放置新任务'))
    const input = screen.getByLabelText('一句话任务描述')
    fireEvent.change(input, { target: { value: '测试取消 1天' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    fireEvent.click(screen.getByLabelText('取消放置'))
    expect(slot).toHaveAttribute('data-slot-active', 'false')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('权限防护：未授权用户（缺少 task:create）操作插槽物理置灰阻断', () => {
    useAuthStore.setState({
      permissions: ['task:view'],
    })

    renderSlot(queryClient)

    const btn = screen.getByLabelText('在行间放置新任务')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', '你没有在该项目中创建任务的权限')
  })
})
