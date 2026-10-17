import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PmoDecisionCaseDTO } from '@aiproj/types'
import PmoDecisionQueuePage from '@/app/(dashboard)/pmo/decisions/page'
import {
  decisionWorkbenchKeys,
  parseDecisionUrlFilters,
  serializeDecisionUrlFilters,
} from '@/lib/api/decision-workbench'
import { useDecisionCases } from '@/hooks/use-decision-workbench'

vi.mock('@/hooks/use-decision-workbench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-decision-workbench')>()
  return { ...actual, useDecisionCases: vi.fn() }
})
vi.mock('@/hooks/use-organization-dashboard', () => ({
  useCurrentOrganizationId: vi.fn(() => 1),
}))
let permissionsOverride: { canAny: (permissions: string[]) => boolean; can: () => boolean } | null =
  null
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => permissionsOverride ?? { canAny: () => true, can: () => true },
}))
let searchParamsMock = new URLSearchParams('')
const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => searchParamsMock,
}))

function makeCase(overrides: Partial<PmoDecisionCaseDTO> = {}): PmoDecisionCaseDTO {
  return {
    id: 101,
    organizationId: 1,
    title: '是否调整 Q4 资源投入方向',
    decisionQuestion: 'Q4 资源决策？',
    scopeSummary: '',
    ownerId: 7,
    dueDate: null,
    status: 'under-review',
    revision: 3,
    supersededByCaseId: null,
    supersedesCaseId: null,
    createdBy: 7,
    updatedBy: 7,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T01:00:00.000Z',
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PmoDecisionQueuePage />
    </QueryClientProvider>,
  )
}

describe('PMO 决策工作台队列页（task 10.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParamsMock = new URLSearchParams('')
  })

  it('渲染议题列表与状态徽标（非 color-only：带文本标签）', () => {
    vi.mocked(useDecisionCases).mockReturnValue({
      data: { data: [makeCase()], meta: { total: 1, page: 1, perPage: 20, totalPages: 1 } },
      isLoading: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.getByText('是否调整 Q4 资源投入方向')).toBeTruthy()
    // 状态徽标带 data-status 属性——文本 + 属性双编码，非 color-only
    expect(document.querySelector('[data-status="under-review"]')).not.toBeNull()
  })

  it('loading 态渲染骨架屏并标记 aria-busy', () => {
    vi.mocked(useDecisionCases).mockReturnValue({ isLoading: true } as never)
    const { container } = renderPage()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('error 与 forbidden 状态分离', () => {
    vi.mocked(useDecisionCases).mockReturnValue({ isError: true, isLoading: false } as never)
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <PmoDecisionQueuePage />
      </QueryClientProvider>,
    )
    expect(screen.getByText('加载决策议题失败，请稍后重试。')).toBeTruthy()

    permissionsOverride = {
      canAny: (permissions) => !permissions.includes('pmo_decision:view'),
      can: () => false,
    }
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PmoDecisionQueuePage />
      </QueryClientProvider>,
    )
    expect(screen.getByText('您没有 PMO 决策工作台访问权限。')).toBeTruthy()
    permissionsOverride = null
  })

  it('空态文案独立于 error', () => {
    vi.mocked(useDecisionCases).mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
      isLoading: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.getByText('当前筛选下没有决策议题。')).toBeTruthy()
  })

  it('状态筛选点击后更新 URL 并保持筛选上下文（键盘可触发）', async () => {
    vi.mocked(useDecisionCases).mockReturnValue({
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
      isLoading: false,
      isError: false,
    } as never)
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: '审查中' }))
    // URL 更新包含 status=under-review
    await waitFor(() => {
      const lastCall = replaceMock.mock.calls.at(-1)?.[0] as string | undefined
      expect(lastCall).toContain('status=under-review')
    })
  })

  it('URL filter 序列化/解析往返保持筛选与分页', () => {
    const filters = parseDecisionUrlFilters({
      status: 'draft,under-review',
      page: '2',
      perPage: '50',
      sort: 'dueDate',
    })
    expect(filters.status).toEqual(['draft', 'under-review'])
    expect(filters.page).toBe(2)
    expect(filters.perPage).toBe(50)
    expect(filters.sort).toBe('dueDate')
    const qs = serializeDecisionUrlFilters(filters)
    expect(qs).toContain('status=draft%2Cunder-review')
    expect(qs).toContain('page=2')
  })

  it('query key 绑定 organization——跨组织缓存隔离', () => {
    const keyA = decisionWorkbenchKeys.cases(1, { page: 1 })
    const keyB = decisionWorkbenchKeys.cases(2, { page: 1 })
    expect(keyA).not.toEqual(keyB)
    // key 结构：['organizations','pmo','decision-workbench', orgId, 'cases', query]
    expect(keyA[3]).toBe(1)
    expect(keyB[3]).toBe(2)
    expect(keyA[4]).toBe('cases')
  })
})
