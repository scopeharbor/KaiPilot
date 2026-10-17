import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allocationsApi,
  availabilityApi,
  resourcesApi,
  type PaginatedResources,
  type Resource,
  type ResourcePlanningResult,
  type ResourceSuggestionPreview,
  type TaskResourceRequirement,
} from '@/lib/api/resources'

let mockParams: Record<string, string> = { id: '1' }
let mockSearch = 'view=team'
const push = vi.fn()
const replace = vi.fn()
const permissionState = vi.hoisted(() => ({
  permissions: new Set<string>(['resource:view', 'resource:manage']),
}))

vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

vi.mock('@/components/PermissionGuard', () => ({
  default: ({
    children,
    fallback = null,
    require: required,
  }: {
    children: ReactNode
    fallback?: ReactNode
    require?: string | string[]
  }) => {
    const requiredList = Array.isArray(required) ? required : required ? [required] : []
    const allowed =
      requiredList.length === 0 ||
      requiredList.some((permission) => permissionState.permissions.has(permission))
    return allowed ? <div data-testid="pg">{children}</div> : <>{fallback}</>
  },
}))

function mockResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    projectId: 1,
    userId: null,
    name: '张三',
    email: 'a@b.com',
    resourceType: 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: null,
    workDays: '[1,2,3,4,5]',
    timezone: 'Asia/Shanghai',
    costPerUnitCents: null,
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function mockPaginated(data: Resource[] = []): PaginatedResources {
  return { data, meta: { total: data.length, page: 1, perPage: 20, totalPages: 1 } }
}

function mockPlanning(): ResourcePlanningResult {
  return {
    from: '2026-10-01',
    to: '2026-10-03',
    summary: {
      totalResources: 1,
      activeResources: 1,
      totalCapacityHours: 24,
      totalAllocatedHours: 12,
      totalRemainingHours: 12,
      averageUtilizationPercent: 50,
      overloadedResources: 0,
      unavailableAllocations: 0,
      unmetRequirements: 1,
    },
    matrix: [
      {
        resourceId: 1,
        resourceName: '张三',
        resourceType: 'human',
        role: 'member',
        status: 'active',
        skillTags: ['React'],
        totalCapacityHours: 24,
        totalAllocatedHours: 12,
        totalRemainingHours: 12,
        utilizationPercent: 50,
        loadStatus: 'available',
        days: [
          {
            date: '2026-10-01',
            capacityHours: 8,
            allocatedHours: 4,
            remainingHours: 4,
            loadPercent: 50,
            loadStatus: 'available',
            conflictFlags: [],
          },
        ],
      },
    ],
    roleAggregates: [],
    skillAggregates: [],
    trend: [],
  }
}

function mockRequirement(
  overrides: Partial<TaskResourceRequirement> = {},
): TaskResourceRequirement {
  return {
    id: 7,
    organizationId: 1,
    projectId: 1,
    taskId: 99,
    role: 'frontend',
    skillTags: ['React'],
    allocationPercent: 50,
    estimatedPersonDays: null,
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    priority: 'medium',
    status: 'open',
    sourceKind: 'manual',
    sourceRef: null,
    createdBy: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function mockPreview(): ResourceSuggestionPreview {
  return {
    previewHash: 'abcdef123456',
    operations: [
      {
        id: 'op1',
        type: 'create_resource_allocation',
        entityType: 'resource_allocation',
        action: 'create',
        requirementId: 7,
        resourceId: 1,
        before: null,
        after: { resourceId: 1, taskId: 99 },
        input: { taskId: 99, allocationPercent: 50 },
      },
    ],
    diff: { creates: 1, updates: 0, deletes: 0 },
    deterministicFacts: {
      source: 'resource_planning_service',
      generatedAt: '2026-10-01T00:00:00.000Z',
      writesApplied: false,
      trustedClientComputedLoadFields: false,
      window: { from: '2026-10-01', to: '2026-10-03' },
      summary: mockPlanning().summary,
    },
  }
}

describe('资源管理页面', () => {
  let client: QueryClient
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  beforeEach(() => {
    mockParams = { id: '1' }
    mockSearch = 'view=team'
    push.mockReset()
    replace.mockReset()
    permissionState.permissions = new Set(['resource:view', 'resource:manage'])
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(resourcesApi, 'planning').mockResolvedValue(mockPlanning())
    vi.spyOn(resourcesApi, 'conflicts').mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 1 },
    })
    vi.spyOn(resourcesApi, 'requirements').mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 1 },
    })
  })

  it('空资源显示引导', async () => {
    vi.spyOn(resourcesApi, 'list').mockResolvedValue(mockPaginated([]))
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/page')
    render(<Page />, { wrapper })
    await waitFor(() => expect(screen.getByText('暂无资源，请添加')).toBeInTheDocument())
  })

  it('有资源显示表格行', async () => {
    vi.spyOn(resourcesApi, 'list').mockResolvedValue(
      mockPaginated([mockResource({ id: 1, name: '张三' }), mockResource({ id: 2, name: '李四' })]),
    )
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/page')
    render(<Page />, { wrapper })
    await waitFor(() => {
      expect(screen.getAllByText('张三').length).toBeGreaterThan(0)
      expect(screen.getByText('李四')).toBeInTheDocument()
    })
  })

  it('显示资源矩阵、需求并可预览分配建议', async () => {
    vi.spyOn(resourcesApi, 'list').mockResolvedValue(
      mockPaginated([mockResource({ id: 1, name: '张三' })]),
    )
    vi.spyOn(resourcesApi, 'requirements').mockResolvedValue({
      data: [mockRequirement()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    vi.spyOn(resourcesApi, 'previewSuggestions').mockResolvedValue(mockPreview())
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/page')
    render(<Page />, { wrapper })

    await waitFor(() => expect(screen.getByText('资源矩阵')).toBeInTheDocument())
    expect(screen.getByText('任务 #99')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '预览建议' }))
    await waitFor(() => expect(screen.getByText(/1 项候选操作/)).toBeInTheDocument())
  })

  it('从 URL 恢复筛选并请求相同资源规划数据', async () => {
    mockSearch =
      'from=2026-11-01&to=2026-11-07&role=member&skill=React&loadStatus=available&mode=requirements'
    vi.spyOn(resourcesApi, 'list').mockResolvedValue(
      mockPaginated([
        mockResource({ id: 1, name: '张三', role: 'member', skillTags: '["React"]' }),
      ]),
    )
    const planningSpy = vi.spyOn(resourcesApi, 'planning').mockResolvedValue(mockPlanning())
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/page')
    render(<Page />, { wrapper })

    await waitFor(() =>
      expect(planningSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          from: '2026-11-01',
          to: '2026-11-07',
          role: 'member',
          skill: 'React',
          loadStatus: 'available',
        }),
      ),
    )
    await waitFor(() => expect(screen.getByText('资源工作台')).toBeInTheDocument())
    expect(screen.getByDisplayValue('member')).toBeInTheDocument()
    expect(screen.getByDisplayValue('React')).toBeInTheDocument()
    expect(screen.queryByText('资源矩阵')).not.toBeInTheDocument()
  })

  it('筛选变更会写回 URL 以便刷新恢复', async () => {
    vi.spyOn(resourcesApi, 'list').mockResolvedValue(mockPaginated([mockResource()]))
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/page')
    render(<Page />, { wrapper })

    await waitFor(() => expect(screen.getByText('资源工作台')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('React'), { target: { value: 'Vue' } })
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('skill=Vue'))
  })

  it('资源规划失败时保留资源列表并提供重试', async () => {
    vi.spyOn(resourcesApi, 'list').mockResolvedValue(
      mockPaginated([mockResource({ id: 1, name: '张三' })]),
    )
    vi.spyOn(resourcesApi, 'planning').mockRejectedValue(new Error('planning failed'))
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/page')
    render(<Page />, { wrapper })

    await waitFor(() => expect(screen.getByText('资源规划加载失败')).toBeInTheDocument())
    expect(screen.getAllByText('张三').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('冲突卡显示中文类型标签而非英文代码', async () => {
    mockSearch = 'view=team&mode=conflicts'
    vi.spyOn(resourcesApi, 'list').mockResolvedValue(mockPaginated([mockResource()]))
    vi.spyOn(resourcesApi, 'conflicts').mockResolvedValue({
      data: [
        {
          type: 'overload',
          severity: 'warning',
          message: '张三 在 2026-10-01 的分配比例为 120%，超过 100%。',
        },
        {
          type: 'unavailable_allocation',
          severity: 'warning',
          message: '张三 在 2026-10-02 可用容量为 0，但仍存在资源分配。',
        },
        {
          type: 'requirement_gap',
          severity: 'warning',
          message: '任务资源需求缺少候选资源：角色 frontend。',
        },
        {
          type: 'allocation_window_overflow',
          severity: 'warning',
          message: '资源分配窗口超出任务开始或结束日期。',
        },
        {
          type: 'illegal_reference',
          severity: 'error',
          message: '资源分配引用了当前项目外的资源或任务。',
        },
        { type: 'future_conflict_code', severity: 'warning', message: '未来的新冲突类型。' },
      ],
      meta: { total: 6, page: 1, perPage: 20, totalPages: 1 },
    })
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/page')
    render(<Page />, { wrapper })

    await waitFor(() => expect(screen.getByText('冲突清单')).toBeInTheDocument())
    expect(screen.getByText('分配比例超载')).toBeInTheDocument()
    expect(screen.getByText('不可用期间分配')).toBeInTheDocument()
    // 需求缺口同时是顶部摘要标签，用 getAllByText 断言冲突卡徽标存在
    expect(screen.getAllByText('需求缺口').length).toBeGreaterThan(0)
    expect(screen.getByText('分配窗口超出任务日期')).toBeInTheDocument()
    expect(screen.getByText('非法资源引用')).toBeInTheDocument()
    // 未知 code 兜底显示原始码，且已知 code 不再裸显英文
    expect(screen.getByText('future_conflict_code')).toBeInTheDocument()
    expect(screen.queryByText('allocation_window_overflow')).not.toBeInTheDocument()
    expect(screen.queryByText('illegal_reference')).not.toBeInTheDocument()
  })

  it('只读用户不能看到资源需求创建和确认采纳控件', async () => {
    permissionState.permissions = new Set(['resource:view'])
    vi.spyOn(resourcesApi, 'list').mockResolvedValue(
      mockPaginated([mockResource({ id: 1, name: '张三' })]),
    )
    vi.spyOn(resourcesApi, 'requirements').mockResolvedValue({
      data: [mockRequirement()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    vi.spyOn(resourcesApi, 'previewSuggestions').mockResolvedValue(mockPreview())
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/page')
    render(<Page />, { wrapper })

    await waitFor(() => expect(screen.getByText('任务 #99')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /新增需求/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '预览建议' }))
    await waitFor(() => expect(screen.getByText(/1 项候选操作/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /确认采纳/ })).not.toBeInTheDocument()
  })

  it('确认采纳失败时保留 preview 并显示失败提示', async () => {
    vi.spyOn(resourcesApi, 'list').mockResolvedValue(
      mockPaginated([mockResource({ id: 1, name: '张三' })]),
    )
    vi.spyOn(resourcesApi, 'requirements').mockResolvedValue({
      data: [mockRequirement()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    vi.spyOn(resourcesApi, 'previewSuggestions').mockResolvedValue(mockPreview())
    vi.spyOn(resourcesApi, 'applySuggestions').mockRejectedValue(new Error('apply failed'))
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/page')
    render(<Page />, { wrapper })

    await waitFor(() => expect(screen.getByText('任务 #99')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '预览建议' }))
    await waitFor(() => expect(screen.getByText(/1 项候选操作/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /确认采纳/ }))
    await waitFor(() =>
      expect(screen.getByText('建议处理失败，请刷新后重试。')).toBeInTheDocument(),
    )
    expect(screen.getByText(/1 项候选操作/)).toBeInTheDocument()
  })
})

describe('资源详情页面', () => {
  let client: QueryClient
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  beforeEach(() => {
    mockParams = { id: '1', resourceId: '1' }
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('显示可用性例外入口', async () => {
    vi.spyOn(resourcesApi, 'get').mockResolvedValue({
      data: { ...mockResource({ id: 1, userId: null }), allocations: [] },
    })
    vi.spyOn(allocationsApi, 'list').mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 1 },
    })
    vi.spyOn(availabilityApi, 'list').mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 1 },
    })

    const { default: Page } =
      await import('../app/(dashboard)/projects/[id]/resources/[resourceId]/page')
    render(<Page />, { wrapper })

    await waitFor(() => expect(screen.getByText('张三')).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: /可用性/ })).toBeInTheDocument()
  })
})

describe('负载视图页面', () => {
  let client: QueryClient
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('显示团队平均利用率', async () => {
    vi.spyOn(resourcesApi, 'load').mockResolvedValue({
      resources: [
        {
          resourceId: 1,
          resourceName: '张三',
          role: 'member',
          dailyCapacityHours: 8,
          overallUtilizationPercent: 75,
          days: [],
        },
      ],
      teamAverageUtilizationPercent: 75,
      from: '2026-07-07',
      to: '2026-07-31',
    })
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/load/page')
    render(<Page />, { wrapper })
    await waitFor(() => {
      const els = screen.getAllByText('75%')
      expect(els.length).toBeGreaterThan(0)
    })
  })

  it('过载时显示警告', async () => {
    vi.spyOn(resourcesApi, 'load').mockResolvedValue({
      resources: [],
      teamAverageUtilizationPercent: 110,
      from: '2026-07-07',
      to: '2026-07-31',
    })
    const { default: Page } = await import('../app/(dashboard)/projects/[id]/resources/load/page')
    render(<Page />, { wrapper })
    await waitFor(() => expect(screen.getByText('团队负载较高')).toBeInTheDocument())
  })
})
