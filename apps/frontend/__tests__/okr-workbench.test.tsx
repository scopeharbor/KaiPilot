/**
 * OKR 工作台页面测试（v3-okr-hierarchy-management tasks 6.4）。
 *
 * 覆盖：渲染、空态、加载态、错误重试
 *
 * @aiproj/frontend
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import OkrWorkbenchPage from '@/app/(dashboard)/organization/okrs/page'
import { asMock } from './_mock-types'

// Mock hooks
vi.mock('@/hooks/use-okr', () => ({
  useOkrCycles: vi.fn(),
  useOkrTree: vi.fn(),
  useCreateOkrObjective: vi.fn(),
  okrKeys: {
    all: (id: number) => ['okr', id] as const,
    cycles: (id: number) => ['okr', id, 'cycles'] as const,
    cycleList: (id: number) => ['okr', id, 'cycles', {}] as const,
    tree: (id: number) => ['okr', id, 'tree', {}] as const,
  },
}))

// Mock auth store：模拟已选择组织，`selectEffectiveOrganizationId` 返回 7。
// 测试内可通过改 `mockAuthState.currentOrganizationId` 模拟"未选择组织"。
const mockAuthState: { currentOrganizationId: number | null } = { currentOrganizationId: 7 }

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
  ),
  selectEffectiveOrganizationId: (state: { currentOrganizationId: number | null }) =>
    state.currentOrganizationId,
}))

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderWithClient(ui: React.ReactElement) {
  const qc = makeQueryClient()
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('OKR 工作台页面', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认已选择组织，避免上一个用例的改写泄漏
    mockAuthState.currentOrganizationId = 7
  })

  test('加载态显示加载文字', async () => {
    const hooks = await import('@/hooks/use-okr')
    vi.mocked(hooks.useOkrCycles).mockReturnValue(asMock({ data: null, isLoading: true }))
    vi.mocked(hooks.useOkrTree).mockReturnValue(asMock({ data: null, isLoading: true }))

    renderWithClient(<OkrWorkbenchPage />)
    expect(screen.getByText('加载中...')).toBeDefined()
  })

  test('错误态显示错误信息', async () => {
    const hooks = await import('@/hooks/use-okr')
    vi.mocked(hooks.useOkrCycles).mockReturnValue(asMock({ data: { data: [] }, isLoading: false }))
    vi.mocked(hooks.useOkrTree).mockReturnValue(
      asMock({ data: null, isLoading: false, error: new Error('无权访问') }),
    )

    renderWithClient(<OkrWorkbenchPage />)
    expect(screen.getByText(/加载失败/)).toBeDefined()
  })

  test('空态显示提示', async () => {
    const hooks = await import('@/hooks/use-okr')
    vi.mocked(hooks.useOkrCycles).mockReturnValue(asMock({ data: { data: [] }, isLoading: false }))
    vi.mocked(hooks.useOkrTree).mockReturnValue(
      asMock({
        data: { data: [], meta: { totalNodes: 0, maxDepth: 0, truncated: false, warnings: [] } },
        isLoading: false,
      }),
    )

    renderWithClient(<OkrWorkbenchPage />)
    expect(screen.getByText(/暂无 OKR 数据/)).toBeDefined()
  })

  test('正常渲染显示标题和筛选器', async () => {
    const hooks = await import('@/hooks/use-okr')
    vi.mocked(hooks.useOkrCycles).mockReturnValue(
      asMock({ data: { data: [{ id: 1, title: 'Q3', status: 'active' }] }, isLoading: false }),
    )
    vi.mocked(hooks.useOkrTree).mockReturnValue(
      asMock({
        data: {
          data: [
            {
              objective: {
                id: 1,
                title: '目标A',
                scope: 'organization',
                status: 'active',
                progress: 50,
                confidence: 'medium',
              },
              children: [],
              keyResults: [],
              alignments: [],
              evidence: [],
            },
          ],
          meta: { totalNodes: 1, maxDepth: 0, truncated: false, warnings: [] },
        },
        isLoading: false,
      }),
    )

    renderWithClient(<OkrWorkbenchPage />)
    expect(screen.getByText('OKR 层级管理')).toBeDefined()
    expect(screen.getByText('目标A')).toBeDefined()
    expect(screen.getByText('Q3')).toBeDefined()
  })

  test('warnings 显示在页面上', async () => {
    const hooks = await import('@/hooks/use-okr')
    vi.mocked(hooks.useOkrCycles).mockReturnValue(asMock({ data: { data: [] }, isLoading: false }))
    vi.mocked(hooks.useOkrTree).mockReturnValue(
      asMock({
        data: {
          data: [],
          meta: {
            totalNodes: 0,
            maxDepth: 0,
            truncated: false,
            warnings: [{ code: 'CACHE_DEGRADED', message: '缓存服务降级' }],
          },
        },
        isLoading: false,
      }),
    )

    renderWithClient(<OkrWorkbenchPage />)
    expect(screen.getByText('缓存服务降级')).toBeDefined()
  })

  test('查询以 auth store 的当前组织 id 发出（幽灵参数修复）', async () => {
    const hooks = await import('@/hooks/use-okr')
    vi.mocked(hooks.useOkrCycles).mockReturnValue(asMock({ data: { data: [] }, isLoading: false }))
    vi.mocked(hooks.useOkrTree).mockReturnValue(
      asMock({
        data: { data: [], meta: { totalNodes: 0, maxDepth: 0, truncated: false, warnings: [] } },
        isLoading: false,
      }),
    )

    renderWithClient(<OkrWorkbenchPage />)

    // 组织 id 必须来自 auth store（7），而不是路由参数（NaN/undefined）
    expect(hooks.useOkrCycles).toHaveBeenCalledWith(7, {})
    expect(hooks.useOkrTree).toHaveBeenCalledWith(7, expect.objectContaining({ depth: 5 }))
  })

  test('未选择组织时显示提醒且不发任何查询', async () => {
    const hooks = await import('@/hooks/use-okr')
    mockAuthState.currentOrganizationId = null

    renderWithClient(<OkrWorkbenchPage />)

    expect(screen.getByText('请先选择组织')).toBeDefined()
    expect(hooks.useOkrCycles).not.toHaveBeenCalled()
    expect(hooks.useOkrTree).not.toHaveBeenCalled()
  })
})
