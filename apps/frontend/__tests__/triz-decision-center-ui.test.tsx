/**
 * v3-triz-decision-center —— 前端 UI 测试（tasks 7.7）。
 *
 * 覆盖：
 * - 队列过滤渲染
 * - 详情抽屉
 * - 权限脱敏（无权限不渲染详情）
 * - 动作文案（避免自动执行措辞）
 * - 显式确认提示
 * - stale 来源阻断提示
 * - formal-data no-apply 断言（advisory 语义）
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPermissions = vi.hoisted(() => ({ value: {} as Record<string, boolean> }))

// Mock API module
vi.mock('@/lib/api/triz-decision-center', () => ({
  trizDecisionCenterApi: {
    summary: vi.fn(),
    items: vi.fn(),
    detail: vi.fn(),
    readiness: vi.fn(),
    draftReason: vi.fn(),
  },
  trizDecisionCenterKeys: {
    all: ['triz-decision-center'],
    summary: (pid: number) => ['triz-decision-center', 'summary', pid],
    items: (pid: number, filters?: Record<string, unknown>) => [
      'triz-decision-center',
      'items',
      pid,
      filters ?? {},
    ],
    detail: (pid: number, itemId: string) => ['triz-decision-center', 'detail', pid, itemId],
    readiness: (pid: number) => ['triz-decision-center', 'readiness', pid],
  },
}))

// Mock useAuthStore for permissions
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { hasPermission: (p: string) => boolean }) => boolean) =>
    selector({
      hasPermission: (perm: string) => mockPermissions.value[perm] ?? false,
    }),
}))

// Mock next/navigation useParams / useRouter / useSearchParams（6.4 URL query 同步）
const searchParamsMock = new Map<string, string>()
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '42' }),
  useRouter: () => ({
    replace: vi.fn(),
    push: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => searchParamsMock.get(key) ?? null,
  }),
}))

// Mock triz-decision-log api（写动作编排复用）
vi.mock('@/lib/api/triz-decision-log', () => ({
  trizDecisionLogApi: {
    create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    supersede: vi.fn().mockResolvedValue({ data: { id: 2 } }),
    draftReason: vi.fn().mockResolvedValue({
      data: { draftReason: '草稿', warnings: [], costSummary: null, isFallback: true },
    }),
  },
  trizDecisionLogKeys: { all: ['triz-decision-logs'] },
}))

// Mock triz-delivery-loop api（task 10.2：交付闭环面板挂载于决策中心页）
const dlApiMocks = vi.hoisted(() => ({
  summary: vi.fn(),
  items: vi.fn(),
  detail: vi.fn(),
  ready: vi.fn(),
  verify: vi.fn(),
  reopen: vi.fn(),
  linkPreview: vi.fn(),
  linkConfirm: vi.fn(),
}))
vi.mock('@/lib/api/triz-delivery-loop', () => ({
  trizDeliveryLoopKeys: {
    all: ['triz-delivery-loop'],
    summary: (pid: number) => ['triz-delivery-loop', 'summary', pid],
    items: (pid: number, filters?: Record<string, unknown>) => [
      'triz-delivery-loop',
      'items',
      pid,
      filters ?? {},
    ],
    detail: (pid: number, itemId: string | null) => [
      'triz-delivery-loop',
      'detail',
      pid,
      itemId ?? '',
    ],
  },
  trizDeliveryLoopApi: {
    summary: dlApiMocks.summary,
    items: dlApiMocks.items,
    detail: dlApiMocks.detail,
    ready: dlApiMocks.ready,
    verify: dlApiMocks.verify,
    reopen: dlApiMocks.reopen,
    linkPreview: dlApiMocks.linkPreview,
    linkConfirm: dlApiMocks.linkConfirm,
  },
}))

import TrizDecisionCenterPage from '@/app/(dashboard)/projects/[id]/triz-decision-center/page'
import { trizDecisionCenterApi } from '@/lib/api/triz-decision-center'
import type { TrizDecisionCenterSummary, TrizDecisionCenterItem } from '@aiproj/types'
import type { TrizDlClosedLoopItem } from '@aiproj/types'

const summaryMock = vi.mocked(trizDecisionCenterApi.summary)
const itemsMock = vi.mocked(trizDecisionCenterApi.items)
const detailMock = vi.mocked(trizDecisionCenterApi.detail)
const readinessMock = vi.mocked(trizDecisionCenterApi.readiness)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const summaryFixture: TrizDecisionCenterSummary = {
  queueCounts: {
    pending_decision: 1,
    missing_reason: 0,
    stale_source: 1,
    ready_for_draft: 0,
    blocked: 1,
    recently_decided: 0,
  },
  sourceCounts: {
    contradiction: 1,
    compiler_triz_analysis: 0,
    recommendation_rationale: 0,
    innovation_workbench: 0,
    draft_blocker: 1,
    decision_log: 1,
  },
  warningCounts: {
    TRIZ_DC_MISSING_SOURCE: 0,
    TRIZ_DC_STALE_SOURCE_HASH: 1,
    TRIZ_DC_INACCESSIBLE_TARGET: 0,
    TRIZ_DC_PERMISSION_DENIED: 0,
    TRIZ_DC_AI_FALLBACK: 0,
    TRIZ_DC_NO_DECISION_LOG: 1,
    TRIZ_DC_SOURCE_ERROR: 0,
    TRIZ_DC_CROSS_ORG_REF: 0,
    TRIZ_DC_REASON_TRUNCATED: 0,
  },
  recentKeyDecisions: [],
  totalItems: 3,
  readyForDraftCount: 0,
  blockedCount: 1,
}

const itemFixture: TrizDecisionCenterItem = {
  id: 'dc-test-001',
  projectId: 42,
  organizationId: 1,
  queueStatus: 'pending_decision',
  source: {
    sourceKind: 'contradiction',
    sourceId: 'contra-1',
    sourceHash: 'abc123',
    title: '速度 vs 精度 矛盾',
    summary: '测试摘要',
    navigationRef: '/projects/42/contradictions/1',
    accessible: true,
  },
  subjectSummary: '测试主题',
  priority: 7,
  warnings: [],
  relatedDecisionLogIds: [],
  readiness: 'not_ready',
  allowedActions: ['adopt', 'reject', 'view_detail', 'generate_reason_draft'],
  createdAt: '2026-07-31T10:00:00.000Z',
  updatedAt: '2026-07-31T10:00:00.000Z',
  hasAccess: true,
}

const staleItemFixture: TrizDecisionCenterItem = {
  ...itemFixture,
  id: 'dc-stale-001',
  queueStatus: 'stale_source',
  source: {
    ...itemFixture.source,
    title: '过期矛盾',
  },
  warnings: [
    {
      code: 'TRIZ_DC_STALE_SOURCE_HASH',
      message: '来源 hash 已过期',
    },
  ],
  readiness: 'stale',
  allowedActions: ['view_detail'],
}

const listFixture = {
  data: [itemFixture, staleItemFixture],
  meta: { total: 2, page: 1, perPage: 20, totalPages: 1 },
}

const detailFixture = {
  item: itemFixture,
  evidenceChain: [itemFixture.source],
  decisionTimeline: [],
  draftBlockerInfo: null,
  rationaleSummary: '测试理由',
  workbenchSchemeSummary: null,
}

const readinessFixture = {
  data: {
    readyItems: [],
    blockedItems: [],
    staleItems: [],
    summary: {
      totalReady: 0,
      totalBlocked: 0,
      totalStale: 0,
      recommendations: ['建议测试'],
    },
  },
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function renderPage() {
  return render(React.createElement(TrizDecisionCenterPage), {
    wrapper: createWrapper(),
  })
}

// 原生 element.click() 不经 testing-library 的 act 包裹，点击处理器里同步触发的
// setState 会在 act 作用域外落地；fireEvent.click 内部自动包一层 act，消除该类警告。
function clickButton(element: Element | null | undefined) {
  if (element) fireEvent.click(element)
}

// ===========================================================================
// Permission States
// ===========================================================================

describe('TrizDecisionCenterPage permission state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.value = {}
  })

  it('renders permission denied when user lacks triz_decision:view', async () => {
    mockPermissions.value = {}
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('无权限查看 TRIZ 决策中心')).toBeInTheDocument()
    })
  })

  it('renders page content when user has view permission', async () => {
    mockPermissions.value = { 'triz_decision:view': true }
    summaryMock.mockResolvedValue(summaryFixture)
    itemsMock.mockResolvedValue(listFixture.data)
    readinessMock.mockResolvedValue(readinessFixture.data)

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('决策中心')).toBeInTheDocument()
    })
  })
})

// ===========================================================================
// Queue Filtering & Items
// ===========================================================================

describe('TrizDecisionCenterPage queue and items', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.value = {
      'triz_decision:view': true,
      'triz_decision:manage': true,
    }
    summaryMock.mockResolvedValue(summaryFixture)
    itemsMock.mockResolvedValue(listFixture.data)
    readinessMock.mockResolvedValue(readinessFixture.data)
  })

  it('renders queue tabs with counts', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('待决策')).toBeInTheDocument()
      expect(screen.getByText('来源过期')).toBeInTheDocument()
      expect(screen.getByText('已阻塞')).toBeInTheDocument()
    })
  })

  it('renders summary tiles with counts', async () => {
    renderPage()

    await waitFor(() => {
      // 总计 3 项
      expect(screen.getByText('总计')).toBeInTheDocument()
    })
  })

  it('renders item rows with titles', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('速度 vs 精度 矛盾')).toBeInTheDocument()
    })
  })

  it('renders stale warning badge for stale items', async () => {
    renderPage()

    await waitFor(() => {
      // 队列中存在带 TRIZ_DC_STALE_SOURCE_HASH 警告的过期项，渲染“过期”徽标。
      // 注意 readiness 面板与 summary 也可能渲染“过期”文案，故用 getAllByText。
      expect(screen.getAllByText('过期').length).toBeGreaterThan(0)
    })
  })

  it('renders search input', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText('搜索决策项')).toBeInTheDocument()
    })
  })
})

// ===========================================================================
// Readiness Panel
// ===========================================================================

describe('TrizDecisionCenterPage readiness panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.value = {
      'triz_decision:view': true,
      'triz_decision:manage': true,
    }
    summaryMock.mockResolvedValue(summaryFixture)
    itemsMock.mockResolvedValue(listFixture.data)
    readinessMock.mockResolvedValue(readinessFixture.data)
  })

  it('renders readiness panel with advisory note', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Draft Readiness')).toBeInTheDocument()
      expect(screen.getByText(/advisory/)).toBeInTheDocument()
    })
  })

  it('renders boundary notice about Draft Apply', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('边界提示')).toBeInTheDocument()
      // 应包含 Apply 仍需重新校验的提示
      expect(screen.getByText(/Preview\/Diff\/dry-run/)).toBeInTheDocument()
    })
  })
})

// ===========================================================================
// Detail Drawer
// ===========================================================================

describe('TrizDecisionCenterPage detail drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.value = {
      'triz_decision:view': true,
      'triz_decision:manage': true,
    }
    summaryMock.mockResolvedValue(summaryFixture)
    itemsMock.mockResolvedValue(listFixture.data)
    readinessMock.mockResolvedValue(readinessFixture.data)
  })

  it('opens detail drawer when clicking an item', async () => {
    detailMock.mockResolvedValue(detailFixture)

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('速度 vs 精度 矛盾')).toBeInTheDocument()
    })

    // 点击第一个 item
    const itemButton = screen.getByText('速度 vs 精度 矛盾')
    clickButton(itemButton.closest('button'))

    await waitFor(() => {
      expect(detailMock).toHaveBeenCalledWith(42, 'dc-test-001')
    })
  })
})

// ===========================================================================
// Action Wording (no auto-execution)
// ===========================================================================

describe('TrizDecisionCenterPage action wording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.value = {
      'triz_decision:view': true,
      'triz_decision:manage': true,
    }
    summaryMock.mockResolvedValue(summaryFixture)
    itemsMock.mockResolvedValue(listFixture.data)
    readinessMock.mockResolvedValue(readinessFixture.data)
  })

  it('uses review-oriented wording, not auto-execution', async () => {
    detailMock.mockResolvedValue(detailFixture)

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('速度 vs 精度 矛盾')).toBeInTheDocument()
    })

    // 打开详情查看动作文案
    const itemButton = screen.getByText('速度 vs 精度 矛盾')
    clickButton(itemButton.closest('button'))

    await waitFor(() => {
      // 应使用「记录采纳」而非「自动应用」
      expect(screen.getByText('记录采纳')).toBeInTheDocument()
      expect(screen.getByText('记录驳回')).toBeInTheDocument()
      // 不应出现「自动应用」措辞
      expect(screen.queryByText('自动应用')).not.toBeInTheDocument()
      expect(screen.queryByText('一键执行')).not.toBeInTheDocument()
    })
  })

  it('shows explicit confirmation notice in detail', async () => {
    detailMock.mockResolvedValue(detailFixture)

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('速度 vs 精度 矛盾')).toBeInTheDocument()
    })

    const itemButton = screen.getByText('速度 vs 精度 矛盾')
    clickButton(itemButton.closest('button'))

    await waitFor(() => {
      // 应包含显式确认提示
      expect(screen.getByText(/显式确认/)).toBeInTheDocument()
      expect(screen.getByText(/不自动落库/)).toBeInTheDocument()
    })
  })
})

// ===========================================================================
// Action Dialog, Evidence Chain, Reason Draft（7.5 / Requirement 6）
// ===========================================================================

describe('TrizDecisionCenterPage action dialog and evidence chain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.value = {
      'triz_decision:view': true,
      'triz_decision:manage': true,
    }
    summaryMock.mockResolvedValue(summaryFixture)
    itemsMock.mockResolvedValue(listFixture.data)
    readinessMock.mockResolvedValue(readinessFixture.data)
    detailMock.mockResolvedValue(detailFixture)
  })

  it('renders evidence chain section in detail drawer', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('速度 vs 精度 矛盾')).toBeInTheDocument()
    })

    const itemButton = screen.getByText('速度 vs 精度 矛盾')
    clickButton(itemButton.closest('button'))

    await waitFor(() => {
      // 证据链 section 应渲染（detailFixture.evidenceChain 含 1 条）
      expect(screen.getByText('证据链')).toBeInTheDocument()
    })
  })

  it('opens action dialog with source refs and confirmation on action click', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('速度 vs 精度 矛盾')).toBeInTheDocument()
    })

    // 打开详情抽屉
    const itemButton = screen.getByText('速度 vs 精度 矛盾')
    clickButton(itemButton.closest('button'))

    await waitFor(() => {
      expect(screen.getByText('记录采纳')).toBeInTheDocument()
    })

    // 点击动作按钮打开确认 dialog
    const actionButton = screen.getAllByRole('button', { name: '记录采纳' })[0]
    clickButton(actionButton)

    await waitFor(() => {
      // dialog 应展示来源引用与显式确认
      expect(screen.getByText('来源引用')).toBeInTheDocument()
      expect(screen.getByText(/明确确认提交此决策记录/)).toBeInTheDocument()
    })
  })

  it('disables submit until confirmation checkboxes are checked', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('速度 vs 精度 矛盾')).toBeInTheDocument()
    })

    clickButton(screen.getByText('速度 vs 精度 矛盾').closest('button'))

    await waitFor(() => {
      expect(screen.getByText('记录采纳')).toBeInTheDocument()
    })

    clickButton(screen.getAllByRole('button', { name: '记录采纳' })[0])

    await waitFor(() => {
      // 提交按钮存在且初始禁用（未勾选确认）
      const submitButtons = screen.getAllByRole('button', { name: '记录采纳' })
      const dialogSubmit = submitButtons[submitButtons.length - 1]
      expect(dialogSubmit).toBeDisabled()
    })
  })

  it('generates reason draft with fallback indicator', async () => {
    const draftMock = vi.mocked(trizDecisionCenterApi.draftReason)
    draftMock.mockResolvedValue({
      draftReason: '建议采纳因技术参数改善',
      warnings: [{ code: 'TRIZ_DC_AI_FALLBACK', message: 'fallback' }],
      costSummary: null,
      isFallback: true,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('速度 vs 精度 矛盾')).toBeInTheDocument()
    })

    clickButton(screen.getByText('速度 vs 精度 矛盾').closest('button'))

    await waitFor(() => {
      expect(screen.getByText('记录采纳')).toBeInTheDocument()
    })

    // 点击 ActionBadge「生成理由草稿」打开 dialog（isReasonDraft 流程）
    clickButton(screen.getAllByRole('button', { name: '生成理由草稿' })[0])

    await waitFor(() => {
      // dialog 内应出现理由摘要区与「生成理由草稿」按钮
      expect(screen.getByText('理由摘要')).toBeInTheDocument()
    })

    // 点击 dialog 内的生成草稿按钮触发 onGenerateDraft
    const dialogDraftButtons = screen.getAllByRole('button', { name: '生成理由草稿' })
    clickButton(dialogDraftButtons[dialogDraftButtons.length - 1])

    await waitFor(() => {
      // 应展示 fallback 指示
      expect(screen.getByText(/确定性 fallback 草稿/)).toBeInTheDocument()
    })
  })
})

// ===========================================================================
// URL Query Filter（6.4）
// ===========================================================================

describe('TrizDecisionCenterPage URL query filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.value = {
      'triz_decision:view': true,
      'triz_decision:manage': true,
    }
    summaryMock.mockResolvedValue(summaryFixture)
    itemsMock.mockResolvedValue(listFixture.data)
    readinessMock.mockResolvedValue(readinessFixture.data)
  })

  it('passes status filter to items query when tab selected', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('速度 vs 精度 矛盾')).toBeInTheDocument()
    })

    // 初始 items 调用不带 status（all）
    expect(itemsMock).toHaveBeenCalledWith(
      42,
      expect.not.objectContaining({ status: 'pending_decision' }),
    )

    // 切换到「待决策」tab
    const pendingTab = screen.getByRole('tab', { name: /待决策/ })
    clickButton(pendingTab)

    await waitFor(() => {
      expect(itemsMock).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ status: 'pending_decision' }),
      )
    })
  })
})

// ===========================================================================
// 交付闭环面板挂载（task 10.2：扩展决策中心 tabs）
// ===========================================================================

describe('TrizDecisionCenterPage delivery-loop section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.value = { 'triz_decision:view': true }
    summaryMock.mockResolvedValue(summaryFixture)
    itemsMock.mockResolvedValue(listFixture.data)
    readinessMock.mockResolvedValue(readinessFixture.data)
    dlApiMocks.summary.mockResolvedValue({
      totalByPosture: {},
      counts: { in_progress: 0, awaiting_verification: 0, verified: 0, needs_review: 0 },
      warnings: [],
    })
    dlApiMocks.items.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 100, totalPages: 0 },
    })
    dlApiMocks.ready.mockResolvedValue({
      itemId: 'link-1',
      ready: true,
      blockingReasons: [],
      verificationFingerprint: 'fp-ready-001',
      effectiveConclusion: null,
    })
  })

  const dlItemFixture = (over: Partial<TrizDlClosedLoopItem> = {}): TrizDlClosedLoopItem => ({
    itemId: 'link-9001',
    projectId: 42,
    organizationId: 1,
    decisionLogId: 'decision-9',
    linkMode: 'existing_entity',
    posture: 'awaiting_verification',
    warningCodes: [],
    degradedReasons: [],
    deliveryRefs: [{ kind: 'task', entityId: 't-1' }],
    contextRefs: [],
    latestConclusion: null,
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...over,
  })

  it('renders 交付闭环 tabs when enabled', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('tablist', { name: '交付闭环分组' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: '交付中' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: '待验证' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: '已验证' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: '需重审' })).toBeInTheDocument()
      // 只读投影提示
      expect(screen.getByText('闭环状态仅作复盘投影，不改变正式任务状态。')).toBeInTheDocument()
    })
  })

  it('shows safe disabled fallback when summary errors (flag off / no permission)', async () => {
    dlApiMocks.summary.mockRejectedValue(new Error('404 resource not found'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('dl-disabled-note')).toBeInTheDocument()
    })
    // 未启用时不再渲染闭环 tab 列表（不泄露功能面）
    expect(screen.queryByRole('tablist', { name: '交付闭环分组' })).not.toBeInTheDocument()
  })

  it('opens verification dialog with current fingerprint; cancel commits zero writes', async () => {
    dlApiMocks.items.mockResolvedValue({
      data: [dlItemFixture()],
      meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '待验证' })).toBeInTheDocument()
    })
    clickButton(screen.getByRole('tab', { name: '待验证' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '记录效果验证' })).toBeInTheDocument()
    })
    clickButton(screen.getByRole('button', { name: '记录效果验证' }))

    await waitFor(() => {
      expect(dlApiMocks.ready).toHaveBeenCalledWith(42, 'link-9001')
      expect(screen.getByTestId('dl-verify-dialog')).toBeInTheDocument()
    })

    clickButton(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => {
      expect(screen.queryByTestId('dl-verify-dialog')).not.toBeInTheDocument()
    })
    expect(dlApiMocks.verify).not.toHaveBeenCalled()
    expect(dlApiMocks.reopen).not.toHaveBeenCalled()
  })

  it('blocked readiness shows blocking reasons instead of the confirm dialog', async () => {
    dlApiMocks.items.mockResolvedValue({
      data: [dlItemFixture({ itemId: 'link-9002' })],
      meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
    })
    dlApiMocks.ready.mockResolvedValue({
      itemId: 'link-9002',
      ready: false,
      blockingReasons: ['DELIVERY_NOT_COMPLETED'],
      verificationFingerprint: null,
      effectiveConclusion: null,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: '待验证' })).toBeInTheDocument()
    })
    clickButton(screen.getByRole('tab', { name: '待验证' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '记录效果验证' })).toBeInTheDocument()
    })
    clickButton(screen.getByRole('button', { name: '记录效果验证' }))

    await waitFor(() => {
      expect(screen.getByTestId('dl-ready-blocked')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('dl-verify-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dl-reopen-dialog')).not.toBeInTheDocument()
  })
})
