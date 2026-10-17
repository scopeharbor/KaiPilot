import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PmoAiPriorityRecommendationsPage from '@/app/(dashboard)/pmo/ai-priority-recommendations/page'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePermissions } from '@/hooks/use-permissions'
import {
  usePmoRecommendationList,
  usePmoRecommendationSummary,
} from '@/hooks/use-pmo-ai-priority-recommendations'
import type { Mock } from 'vitest'
import type { StubProps } from './_mock-types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/hooks/use-permissions', () => ({ usePermissions: vi.fn() }))

vi.mock('@/hooks/use-pmo-ai-priority-recommendations', () => ({
  usePmoRecommendationList: vi.fn(),
  usePmoRecommendationSummary: vi.fn(),
  usePmoRecommendationDetail: vi.fn(() => ({ data: null, isLoading: true })),
  useRefreshPmoRecommendations: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useGeneratePmoAiRationale: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdatePmoRecommendationStatus: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

vi.mock('next/navigation', () => ({ useRouter: vi.fn(() => ({ push: vi.fn() })) }))

vi.mock('@/components/ui/Select', () => ({
  Select: ({ children }: StubProps) => <div data-testid="select">{children}</div>,
  SelectContent: ({ children }: StubProps) => <div>{children}</div>,
  SelectItem: ({ children, value }: StubProps) => <div data-value={value}>{children}</div>,
  SelectTrigger: ({ children }: StubProps) => <div>{children}</div>,
  SelectValue: () => <div />,
}))

vi.mock('@/components/ui/Sheet', () => ({
  Sheet: ({ children, open }: StubProps) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: StubProps) => <div data-testid="sheet-content">{children}</div>,
  SheetDescription: ({ children }: StubProps) => <div>{children}</div>,
  SheetHeader: ({ children }: StubProps) => <div>{children}</div>,
  SheetTitle: ({ children }: StubProps) => <div>{children}</div>,
}))

vi.mock('@/components/ui/Alert', () => ({
  Alert: ({ children, variant }: StubProps) => (
    <div role="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: StubProps) => <div>{children}</div>,
}))

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, variant, className }: StubProps) => (
    <span className={className} data-variant={variant}>
      {children}
    </span>
  ),
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, variant, size }: StubProps) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, className }: StubProps) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardContent: ({ children }: StubProps) => <div>{children}</div>,
  CardHeader: ({ children }: StubProps) => <div>{children}</div>,
  CardTitle: ({ children }: StubProps) => <div>{children}</div>,
}))

vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: ({ className }: StubProps) => <div data-testid="skeleton" className={className} />,
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

const emptySummary = {
  totalCount: 0,
  newCount: 0,
  reviewingCount: 0,
  acceptedCount: 0,
  dismissedCount: 0,
  convertedCount: 0,
  criticalCount: 0,
  highCount: 0,
  staleCount: 0,
  aiAvailableCount: 0,
  maxSeverity: null,
  scoringAvailable: false,
  scoringStale: false,
  topRecommendations: [],
  warnings: [],
  generatedAt: null,
}

function setLoadedWithEmptyData() {
  ;(usePmoRecommendationList as Mock).mockReturnValue({
    data: {
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      summary: emptySummary,
    },
    isLoading: false,
    error: null,
  })
  ;(usePmoRecommendationSummary as Mock).mockReturnValue({ data: emptySummary })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PmoAiPriorityRecommendationsPage />
    </QueryClientProvider>,
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PmoAiPriorityRecommendationsPage — 权限感知', () => {
  it('无 portfolio:view 权限时显示无权限提示', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => false })
    // 即使無權限，hook 也會被調用，需設置默認返回值避免 undefined destructure
    ;(usePmoRecommendationList as Mock).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    })
    ;(usePmoRecommendationSummary as Mock).mockReturnValue({ data: null })
    renderPage()
    expect(screen.getByText('您没有 PMO 组合管理的访问权限。请联系管理员。')).toBeTruthy()
  })

  it('有 portfolio:view 权限时显示標題', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => true })
    setLoadedWithEmptyData()
    renderPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PMO AI 优先级推荐')
  })

  it('有權限且空隊列時顯示空態提示', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => true })
    setLoadedWithEmptyData()
    renderPage()
    expect(screen.getByText('当前没有需要关注的推荐')).toBeTruthy()
  })
})

describe('PmoAiPriorityRecommendationsPage — 加载态', () => {
  it('数据加载中显示骨架屏', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => true })
    ;(usePmoRecommendationList as Mock).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    })
    renderPage()
    const skeletons = screen.getAllByTestId('skeleton')
    expect(skeletons.length).toBeGreaterThan(0)
  })
})

describe('PmoAiPriorityRecommendationsPage — 错误态', () => {
  it('API 错误时显示错误提示', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => true })
    ;(usePmoRecommendationList as Mock).mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('API Error'),
    })
    renderPage()
    expect(screen.getByText('加载推荐数据失败，请稍后重试。')).toBeTruthy()
  })
})

describe('PmoAiPriorityRecommendationsPage — 权限受限维度', () => {
  it('权限不足时不显示刷新按钮', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => false })
    renderPage()
    expect(screen.queryByText('刷新推荐')).toBeNull()
  })
})

describe('PmoAiPriorityRecommendationsPage — 可访问性', () => {
  it('页面主标题是 h1', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => true })
    setLoadedWithEmptyData()
    renderPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PMO AI 优先级推荐')
  })

  it('数据加載後显示刷新按鈕', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => true })
    setLoadedWithEmptyData()
    renderPage()
    expect(screen.getByText('刷新推荐')).toBeTruthy()
  })
})

describe('PmoAiPriorityRecommendationsPage — 移动端布局', () => {
  it('页面在移动端布局中不崩潰', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => true })
    setLoadedWithEmptyData()
    renderPage()
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getByText('刷新推荐')).toBeTruthy()
  })
})
