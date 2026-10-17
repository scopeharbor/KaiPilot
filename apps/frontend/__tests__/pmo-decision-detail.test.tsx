import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  PmoDecisionCaseDTO,
  PmoDecisionEvidenceSnapshotSummary,
  PmoDecisionOptionDTO,
} from '@aiproj/types'
import PmoDecisionDetailPage from '@/app/(dashboard)/pmo/decisions/[decisionId]/page'
import {
  useCheckReadinessOnce,
  useDecisionCase,
  useDecisionComparison,
  useDecisionHandoffs,
  useDecisionOptions,
  useDecisionOutcomes,
  useDecisionPositions,
  useDecisionSnapshots,
} from '@/hooks/use-decision-workbench'

vi.mock('@/hooks/use-decision-workbench', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-decision-workbench')>()
  return {
    ...actual,
    useDecisionCase: vi.fn(),
    useDecisionOptions: vi.fn(),
    useDecisionPositions: vi.fn(),
    useDecisionSnapshots: vi.fn(),
    useDecisionComparison: vi.fn(),
    useDecisionOutcomes: vi.fn(),
    useDecisionHandoffs: vi.fn(),
    useRefreshDecisionEvidence: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRecordDecisionPosition: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSubmitDecisionOutcome: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCreateDecisionHandoff: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useCheckReadinessOnce: vi.fn(),
  }
})
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => permissionsMock,
}))
let permissionsMock: { canAny: (permissions: string[]) => boolean } = { canAny: () => true }

vi.mock('next/navigation', () => ({
  useParams: () => ({ decisionId: '101' }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

function makeCase(overrides: Partial<PmoDecisionCaseDTO> = {}): PmoDecisionCaseDTO {
  return {
    id: 101,
    organizationId: 1,
    title: '是否调整 Q4 资源投入方向',
    decisionQuestion: 'Q4 资源决策？',
    scopeSummary: '项目 A、B',
    ownerId: 7,
    dueDate: null,
    status: 'under-review',
    revision: 5,
    supersededByCaseId: null,
    supersedesCaseId: null,
    createdBy: 7,
    updatedBy: 7,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T01:00:00.000Z',
    ...overrides,
  }
}

function makeSnapshot(
  overrides: Partial<PmoDecisionEvidenceSnapshotSummary> = {},
): PmoDecisionEvidenceSnapshotSummary {
  return {
    id: 9001,
    caseId: 101,
    snapshotRevision: 1,
    snapshotHash: 'deadbeef',
    readiness: 'degraded',
    collectedAt: '2026-08-24T01:00:00.000Z',
    sourceStates: [
      { source: 'portfolio_dashboard', state: 'available', required: true },
      { source: 'resource_contention', state: 'forbidden', required: false },
    ],
    warningCodes: ['SOURCE_FORBIDDEN'],
    truncated: false,
    ...overrides,
  }
}

const OPTION_A: PmoDecisionOptionDTO = {
  id: 1,
  organizationId: 1,
  caseId: 101,
  label: '维持现状',
  assumptions: [],
  constraints: [],
  affectedProjectRefs: [],
  proposedOutcomeCategory: 'no_change',
  evidenceRefs: [],
  revision: 2,
  active: true,
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
}
const OPTION_B: PmoDecisionOptionDTO = { ...OPTION_A, id: 2, label: '调动资源', revision: 1 }

function mockQueries(overrides?: { blockedReadiness?: boolean }) {
  const decision = makeCase()
  vi.mocked(useDecisionCase).mockReturnValue({
    data: decision,
    isLoading: false,
    isError: false,
  } as never)
  vi.mocked(useDecisionOptions).mockReturnValue({ data: [OPTION_A, OPTION_B] } as never)
  vi.mocked(useDecisionPositions).mockReturnValue({ data: [] } as never)
  vi.mocked(useDecisionSnapshots).mockReturnValue({
    data: [
      makeSnapshot(),
      makeSnapshot({ id: 9000, snapshotRevision: 0, snapshotHash: 'oldhash', readiness: 'ready' }),
    ],
  } as never)
  vi.mocked(useDecisionComparison).mockReturnValue({
    data: {
      caseId: 101,
      baselineOptionId: 1,
      candidateOptionId: 2,
      cells: [
        {
          lensId: 'portfolio_health',
          measureRef: 'portfolio_dashboard:visibleProjectCount',
          baselineValue: 42,
          candidateValue: 42,
          delta: 0,
          comparable: true,
          notComparableReason: null,
          unit: 'count',
        },
      ],
      findings: [],
      lensVersions: [{ lensId: 'portfolio_health', version: 'portfolio-health.v1' }],
      hasWinnerScore: false,
    },
  } as never)
  vi.mocked(useDecisionOutcomes).mockReturnValue({ data: [] } as never)
  vi.mocked(useDecisionHandoffs).mockReturnValue({ data: [] } as never)
  const readyPacket = {
    ready: true,
    blockingFindings: [],
    warnings: [],
    fingerprint: { fingerprint: 'abc12345', issuedAt: '', expiresAt: '', ttlMinutes: 15 },
    binding: null,
    checkedAt: '',
  }
  const blockedPacket = {
    ready: false,
    blockingFindings: [
      { code: 'REQUIRED_SOURCE_FAILED', severity: 'blocking', message: '必需来源不可用' },
    ],
    warnings: [],
    fingerprint: null,
    binding: null,
    checkedAt: '',
  }
  vi.mocked(useCheckReadinessOnce).mockReturnValue({
    mutateAsync: vi.fn(async () => {
      return overrides?.blockedReadiness ? blockedPacket : readyPacket
    }),
    isPending: false,
    reset: vi.fn(),
    data: undefined,
    error: null,
    isError: false,
    isIdle: true,
    isSuccess: false,
    status: 'idle',
    variables: undefined,
    context: undefined as never,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    submittedAt: 0,
  } as never)
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PmoDecisionDetailPage />
    </QueryClientProvider>,
  )
}

describe('PMO 决策工作台详情页（tasks 10.3–10.7）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionsMock = { canAny: () => true }
  })

  it('lifecycle header 展示标题/状态/修订/scope；终态显示只读标记', () => {
    mockQueries()
    renderPage()
    expect(screen.getByText('是否调整 Q4 资源投入方向')).toBeTruthy()
    expect(document.querySelector('[data-status="under-review"]')).not.toBeNull()
    expect(screen.getByText('修订 r5')).toBeTruthy()
    expect(screen.getByText('范围：项目 A、B')).toBeTruthy()

    // 终态只读
    vi.mocked(useDecisionCase).mockReturnValue({
      data: makeCase({ status: 'decided' }),
      isLoading: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.getAllByText('终态只读').length).toBeGreaterThan(0)
  })

  it('evidence 面板逐来源文本态：available 与 forbidden 均为文字+属性，非 color-only', () => {
    mockQueries()
    renderPage()
    expect(screen.getByText('可用')).toBeTruthy()
    expect(screen.getByText('权限受限')).toBeTruthy()
    expect(document.querySelector('[data-source-state="forbidden"]')).not.toBeNull()
    // 不渲染隐藏值或零值伪装：forbidden 来源无任何数值单元格
    const forbiddenRow = document.querySelector('[data-source-state="forbidden"]')
    expect(forbiddenRow?.textContent).not.toContain('0 个')
  })

  it('对比表展示权威事实与 lens 版本，且声明无 winner 分数', () => {
    mockQueries()
    renderPage()
    expect(screen.getByText('portfolio_dashboard:visibleProjectCount')).toBeTruthy()
    expect(screen.getByText(/不生成总分或 winner/)).toBeTruthy()
    expect(screen.getByText(/portfolio-health\.v1/)).toBeTruthy()
  })

  it('readiness 就绪时确认对话框可提交；决策 ≠ 执行披露可见', async () => {
    const { act } = await import('@testing-library/react')
    mockQueries()
    renderPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批准' }))
    })
    // 对话框出现并披露「决策 ≠ 执行」
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('决策 ≠ 执行')
    // 取消零写入：点击取消后对话框关闭
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('blocking finding 时 fail closed：不弹确认对话框并展示阻塞原因', async () => {
    const { act } = await import('@testing-library/react')
    mockQueries({ blockedReadiness: true })
    renderPage()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批准' }))
    })
    expect(screen.getByText('阻塞：必需来源不可用')).toBeTruthy()
    // blocking 时不允许进入确认流程（比仅禁用按钮更强的 fail closed）
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull()
  })

  it('viewer 无记录结论区（权限裁剪）', () => {
    permissionsMock = { canAny: (permissions) => !permissions.includes('pmo_decision:decide') }
    mockQueries()
    renderPage()
    expect(screen.queryByText('记录人工结论')).toBeNull()
  })

  it('decided + manage 权限时显示 handoff 区：pending/replayed 状态与安全下钻引用', () => {
    vi.mocked(useDecisionCase).mockReturnValue({
      data: makeCase({ status: 'decided' }),
      isLoading: false,
      isError: false,
    } as never)
    vi.mocked(useDecisionHandoffs).mockReturnValue({
      data: [
        {
          id: 6001,
          organizationId: 1,
          caseId: 101,
          target: 'allocation_draft',
          idempotencyKey: 'k1',
          requestHash: 'aa',
          resultHash: null,
          status: 'pending',
          pendingTargetRef: '/pmo/allocation?from=decision-101&option=2',
          failReasonCode: null,
          actorId: 7,
          createdAt: '2026-08-24T02:00:00.000Z',
          updatedAt: '2026-08-24T02:00:00.000Z',
        },
        {
          id: 6002,
          organizationId: 1,
          caseId: 101,
          target: 'navigation',
          idempotencyKey: 'k2',
          requestHash: 'bb',
          resultHash: null,
          status: 'replayed',
          pendingTargetRef: '/pmo/decisions',
          failReasonCode: null,
          actorId: 7,
          createdAt: '2026-08-24T02:05:00.000Z',
          updatedAt: '2026-08-24T02:06:00.000Z',
        },
      ],
    } as never)
    renderPage()
    expect(screen.getByText('结论历史与受控交接')).toBeTruthy()
    // 决策不等于执行：交接区明确下游仍需预览确认
    expect(screen.getByText(/下游仍需其自身的预览与显式确认/)).toBeTruthy()
    // pending 与 replayed 状态文本（非 color-only）
    expect(screen.getByText(/待下游处理/)).toBeTruthy()
    expect(screen.getByText(/幂等重放/)).toBeTruthy()
    // 安全下钻：引用为相对路径链接，不含 token/handle
    const drill = screen
      .getAllByRole('link')
      .find((link) => link.getAttribute('href')?.includes('decision-101'))
    expect(drill).toBeTruthy()
    expect(drill!.getAttribute('href')).not.toContain('token')
  })

  it('任何状态下不渲染 apply/confirm 直接执行控件', () => {
    vi.mocked(useDecisionCase).mockReturnValue({
      data: makeCase({ status: 'decided' }),
      isLoading: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^确认执行$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })
})
