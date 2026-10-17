import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/Toast'
import ProjectRisksPage from '@/app/(dashboard)/projects/[id]/risks/page'
import { RiskMatrix5x5 } from '@/components/views/risks/RiskMatrix5x5'
import { RiskCandidateList } from '@/components/views/risks/RiskCandidateList'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '1' }),
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock risk hooks
vi.mock('@/hooks/use-risks-v2', () => ({
  useRiskSummary: vi.fn(),
  useReviewQueue: vi.fn(),
  useEvaluateCandidates: vi.fn(),
  useAcceptCandidate: vi.fn(),
  useRejectCandidate: vi.fn(),
  useResponsePlans: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useRiskHistory: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
}))

// Mock risk matrix hook
vi.mock('@/hooks/use-risk-matrix', () => ({
  useRiskMatrix: vi.fn(),
}))

// Mock transition risk status
vi.mock('@/hooks/use-risks', () => ({
  useTransitionRiskStatus: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}))

// Mock risk view store
vi.mock('@/stores/risk-view-store', () => ({
  useRiskViewStore: vi.fn(() => ({
    matrixBasis: 'inherent',
    setMatrixBasis: vi.fn(),
    categoryFilter: null,
    setCategoryFilter: vi.fn(),
    statusFilter: null,
    setStatusFilter: vi.fn(),
    aiDrawerOpen: false,
    setAiDrawerOpen: vi.fn(),
  })),
}))

// Mock PermissionGuard to render children by default
vi.mock('@/components/PermissionGuard', () => ({
  default: ({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) => (
    <>{children ?? fallback ?? null}</>
  ),
}))

import {
  useRiskSummary,
  useReviewQueue,
  useEvaluateCandidates,
  useAcceptCandidate,
  useRejectCandidate,
} from '@/hooks/use-risks-v2'
import { useRiskMatrix } from '@/hooks/use-risk-matrix'

function mockRiskSummary(value: Partial<ReturnType<typeof useRiskSummary>>) {
  vi.mocked(useRiskSummary).mockReturnValue(value as ReturnType<typeof useRiskSummary>)
}

function mockReviewQueue(value: Partial<ReturnType<typeof useReviewQueue>>) {
  vi.mocked(useReviewQueue).mockReturnValue(value as ReturnType<typeof useReviewQueue>)
}

function mockEvaluateCandidates(value: Partial<ReturnType<typeof useEvaluateCandidates>>) {
  vi.mocked(useEvaluateCandidates).mockReturnValue(
    value as ReturnType<typeof useEvaluateCandidates>,
  )
}

function mockAcceptCandidate(value: Partial<ReturnType<typeof useAcceptCandidate>>) {
  vi.mocked(useAcceptCandidate).mockReturnValue(value as ReturnType<typeof useAcceptCandidate>)
}

function mockRejectCandidate(value: Partial<ReturnType<typeof useRejectCandidate>>) {
  vi.mocked(useRejectCandidate).mockReturnValue(value as ReturnType<typeof useRejectCandidate>)
}

function mockRiskMatrix(value: Partial<ReturnType<typeof useRiskMatrix>>) {
  vi.mocked(useRiskMatrix).mockReturnValue(value as ReturnType<typeof useRiskMatrix>)
}

const mockSummary = {
  data: {
    totalRisks: 5,
    openRisks: 3,
    highRiskCount: 1,
    criticalRiskCount: 0,
    overdueReviewCount: 2,
    incompleteResponsePlans: 1,
    trend30d: { created: 2, closed: 0 },
    healthScore: 75,
    topRisks: [
      { id: 1, title: '关键路径延迟', riskLevel: 'high' as const, score: 20, status: 'identified' },
      { id: 2, title: '资源不足', riskLevel: 'medium' as const, score: 12, status: 'analyzing' },
    ],
  },
}

const mockEmptySummary = {
  data: {
    totalRisks: 0,
    openRisks: 0,
    highRiskCount: 0,
    criticalRiskCount: 0,
    overdueReviewCount: 0,
    incompleteResponsePlans: 0,
    trend30d: { created: 0, closed: 0 },
    healthScore: null,
    topRisks: [],
  },
}

const mockMatrixCells = {
  data: {
    cells: [
      { probability: 4, impact: 5, count: 2, topRiskIds: [1, 2] },
      { probability: 3, impact: 3, count: 1, topRiskIds: [3] },
    ],
  },
}

const mockCandidates = [
  {
    id: 1,
    ruleId: 'overdue-task',
    ruleVersion: '1.0.0',
    severity: 'high' as const,
    evidence: [{ type: 'task', id: 101, title: '前端开发', detail: '逾期 3 天' }],
    recommendedAction: '增加前端开发资源以避免项目延期',
    confidence: 0.85,
    source: 'rule-engine',
    templateId: null,
    idempotencyKey: 'key-1',
    expiresAt: '2026-08-01T00:00:00Z',
    status: 'pending' as const,
  },
  {
    id: 2,
    ruleId: 'critical-path-drift',
    ruleVersion: '1.0.0',
    severity: 'medium' as const,
    evidence: [],
    recommendedAction: '检查关键路径任务状态',
    confidence: 0.45,
    source: 'rule-engine',
    templateId: null,
    idempotencyKey: 'key-2',
    expiresAt: '2026-07-20T00:00:00Z',
    status: 'expired' as const,
  },
]

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <ProjectRisksPage />
    </QueryClientProvider>,
  )
}

describe('Risk V2 Page', () => {
  test('renders summary cards', async () => {
    mockRiskSummary({
      data: mockSummary,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    mockReviewQueue({ data: { data: [] }, isLoading: false })
    mockEvaluateCandidates({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    mockAcceptCandidate({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    mockRejectCandidate({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    mockRiskMatrix({ data: mockMatrixCells, isLoading: false })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('总风险数')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('高/严重风险')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('逾期复查')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('健康分')).toBeInTheDocument()
      expect(screen.getByText('75')).toBeInTheDocument()
    })

    expect(screen.getByText('关键路径延迟')).toBeInTheDocument()
    expect(screen.getByText('资源不足')).toBeInTheDocument()
  })

  test('renders loading state', async () => {
    mockRiskSummary({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    })
    mockReviewQueue({ data: undefined, isLoading: true })
    mockEvaluateCandidates({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    mockAcceptCandidate({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    mockRejectCandidate({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    mockRiskMatrix({ data: undefined, isLoading: true })

    renderPage()

    // Should show skeleton loading placeholders (animate-pulse elements)
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  test('renders empty state when totalRisks is 0', async () => {
    mockRiskSummary({
      data: mockEmptySummary,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    mockReviewQueue({ data: { data: [] }, isLoading: false })
    mockEvaluateCandidates({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    mockAcceptCandidate({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    mockRejectCandidate({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    mockRiskMatrix({ data: mockMatrixCells, isLoading: false })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('暂无风险')).toBeInTheDocument()
    })
    expect(screen.getByText(/使用规则评估或 AI 建议/)).toBeInTheDocument()
  })
})

describe('RiskMatrix5x5', () => {
  test('renders with default config and cells', async () => {
    mockRiskMatrix({ data: mockMatrixCells, isLoading: false })

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RiskMatrix5x5 projectId={1} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('概率-影响矩阵')).toBeInTheDocument()
    })

    // Should show basis toggle buttons
    expect(screen.getByText('固有')).toBeInTheDocument()
    expect(screen.getByText('残余')).toBeInTheDocument()

    // Should show axis labels
    expect(screen.getByText('概率 →')).toBeInTheDocument()
  })

  test('renders loading state', () => {
    mockRiskMatrix({ data: undefined, isLoading: true })

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RiskMatrix5x5 projectId={1} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('加载矩阵...')).toBeInTheDocument()
  })

  test('does not call onCellClick in readOnly mode', () => {
    mockRiskMatrix({ data: mockMatrixCells, isLoading: false })
    const onCellClick = vi.fn()

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RiskMatrix5x5 projectId={1} onCellClick={onCellClick} readOnly />
      </QueryClientProvider>,
    )

    const cells = document.querySelectorAll('[role="img"]')
    expect(cells.length).toBeGreaterThan(0)
    // No role="button" cells in readOnly mode
    expect(document.querySelectorAll('[role="button"]').length).toBe(0)
  })
})

describe('RiskCandidateList', () => {
  test('shows candidate evidence and severity', () => {
    render(<RiskCandidateList candidates={mockCandidates} onAccept={vi.fn()} onReject={vi.fn()} />)

    expect(screen.getByText('高')).toBeInTheDocument()
    expect(screen.getByText('中')).toBeInTheDocument()
    expect(screen.getByText('规则: overdue-task')).toBeInTheDocument()
    expect(screen.getAllByText('v1.0.0').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('前端开发: 逾期 3 天')).toBeInTheDocument()
  })

  test('shows expired badge for expired candidates', () => {
    render(<RiskCandidateList candidates={mockCandidates} onAccept={vi.fn()} onReject={vi.fn()} />)

    expect(screen.getByText('已过期')).toBeInTheDocument()
  })

  test('shows empty state when no candidates', () => {
    render(<RiskCandidateList candidates={[]} onAccept={vi.fn()} onReject={vi.fn()} />)

    expect(screen.getByText('无规则风险候选')).toBeInTheDocument()
  })

  test('shows accept/reject buttons for pending candidates', () => {
    render(<RiskCandidateList candidates={mockCandidates} onAccept={vi.fn()} onReject={vi.fn()} />)

    const acceptBtns = screen.getAllByText('采纳')
    expect(acceptBtns.length).toBe(1) // only first candidate (pending) has accept button
    const rejectBtns = screen.getAllByText('拒绝')
    expect(rejectBtns.length).toBe(1)
  })

  test('calls onAccept when accept clicked', () => {
    const onAccept = vi.fn()
    render(
      <RiskCandidateList
        candidates={[mockCandidates[0]!]}
        onAccept={onAccept}
        onReject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('采纳'))
    expect(onAccept).toHaveBeenCalledWith(mockCandidates[0])
  })

  test('calls onReject when reject clicked', () => {
    const onReject = vi.fn()
    render(
      <RiskCandidateList
        candidates={[mockCandidates[0]!]}
        onAccept={vi.fn()}
        onReject={onReject}
      />,
    )

    fireEvent.click(screen.getByText('拒绝'))
    expect(onReject).toHaveBeenCalledWith(mockCandidates[0])
  })
})
