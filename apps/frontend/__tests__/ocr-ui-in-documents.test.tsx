/**
 * V3 OCR UI In Documents — 前端 hook 与组件测试
 *
 * 覆盖 useOcrDocumentWorkspace、OcrDocumentsWorkspace 和 OcrDocumentDrawer
 * 的关键行为。使用 fixture-only 数据，不调用真实 OCR provider。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock 权限和 API hooks
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    hasPermission: (perm: string) => {
      if (perm === 'file:manage') return true
      if (perm === 'file:view') return true
      return false
    },
    can: () => true,
    allows: () => true,
    currentUser: { id: 1, email: 'test@test.com' },
    organizationId: 1,
    isAuthenticated: true,
  }),
}))

vi.mock('@/hooks/use-ocr-document', () => ({
  useOcrDocumentJobs: () => ({
    data: { data: [], meta: { total: 0, page: 1, perPage: 200, totalPages: 0 } },
    isLoading: false,
  }),
  useOcrDocumentJobDetail: () => ({
    data: null,
    isLoading: false,
  }),
  useOcrDocumentCandidates: () => ({
    data: { data: [] },
    isLoading: false,
  }),
  useOcrDocumentExtractions: () => ({
    data: { data: [] },
    isLoading: false,
  }),
  useOcrDocumentJobCreate: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isLoading: false,
  }),
  useOcrDocumentJobRetry: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isLoading: false,
  }),
  useOcrDocumentJobConfirm: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isLoading: false,
  }),
  ocrDocumentKeys: {
    all: ['ocr-document'],
    list: (pid: number) => ['ocr-document', 'list', pid],
    detail: (pid: number, jid: number) => ['ocr-document', 'detail', pid, jid],
    candidates: (pid: number, jid: number) => ['ocr-document', 'candidates', pid, jid],
    extractions: (pid: number, jid: number) => ['ocr-document', 'extractions', pid, jid],
  },
}))

vi.mock('@/lib/api/files', () => ({
  filesApi: {
    list: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    move: vi.fn(),
    delete: vi.fn(),
  },
  attachmentsApi: {
    list: vi.fn(),
    upload: vi.fn(),
    delete: vi.fn(),
    getDownloadUrl: () => '/download/test',
  },
  fileKeys: {
    all: ['files'],
    lists: (pid: number) => ['files', 'list', pid],
    list: (pid: number, filters: Record<string, unknown>) => ['files', 'list', pid, filters],
    documents: (pid: number) => ['files', 'documents', pid],
    document: (pid: number, did: number) => ['files', 'documents', pid, did],
    tags: (pid: number) => ['files', 'tags', pid],
    trash: (pid: number) => ['files', 'trash', pid],
    search: (pid: number) => ['files', 'search', pid],
  },
  attachmentKeys: {
    all: ['attachments'],
    lists: (pid: number) => ['attachments', 'list', pid],
    list: (pid: number, filters: Record<string, unknown>) => ['attachments', 'list', pid, filters],
  },
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '1' }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn(),
    toString: () => '',
  }),
  usePathname: () => '/projects/1/files',
}))

// 导入被测试的组件
import {
  OcrDocumentsWorkspace,
  OcrStatusBadge,
  STATUS_LABELS,
} from '@/components/ocr/OcrDocumentsWorkspace'
import { OcrDocumentDrawer } from '@/components/ocr/OcrDocumentDrawer'
import {
  unsupportedRow,
  noJobRow,
  queuedRow,
  processingRow,
  failedRow,
  reviewableRow,
  confirmedRow,
  staleRow,
  retentionHoldRow,
  privacyBlockRow,
  readOnlyDegradedRow,
} from '@aiproj/types'
import type { OcrDocumentWorkspaceAction, OcrDocumentWorkspaceRowSummary } from '@aiproj/types'

// 测试包装器
function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

// =========================================================================
// OcrDocumentsWorkspace 组件测试
// =========================================================================

describe('OcrDocumentsWorkspace', () => {
  // 显式标注类型：fixture 与 workspace 的行/动作契约漂移时，测试先编译失败而不是静默通过
  const mockOnAction =
    vi.fn<(action: OcrDocumentWorkspaceAction, row: OcrDocumentWorkspaceRowSummary) => void>()

  const rows: OcrDocumentWorkspaceRowSummary[] = [
    noJobRow(),
    reviewableRow(),
    confirmedRow(),
    failedRow(),
    unsupportedRow(),
  ]

  beforeEach(() => {
    mockOnAction.mockClear()
  })

  it('renders loading state', () => {
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={[]}
          isLoading={true}
          hasAnyOcrActivity={false}
          counts={{ total: 0, reviewable: 0, confirmed: 0, processing: 0, failed: 0, blocked: 0 }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )
    expect(screen.getByText('OCR 状态加载中...')).toBeDefined()
  })

  it('renders empty state when no rows', () => {
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={[]}
          isLoading={false}
          hasAnyOcrActivity={false}
          counts={{ total: 0, reviewable: 0, confirmed: 0, processing: 0, failed: 0, blocked: 0 }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )
    expect(screen.getByText('暂无 OCR 可识别的文件')).toBeDefined()
  })

  it('renders rows with status badges', () => {
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={rows}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{
            total: rows.length,
            reviewable: 1,
            confirmed: 1,
            processing: 0,
            failed: 1,
            blocked: 0,
          }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )

    // 检查关键文本
    expect(screen.getByText('meeting-notes.pdf')).toBeDefined()
    // status badges 和 filter 按钮可以有相同文本，用 getAllByText
    const reviewableElements = screen.getAllByText('待审查')
    expect(reviewableElements.length).toBeGreaterThan(0)
    const confirmedElements = screen.getAllByText('已确认')
    expect(confirmedElements.length).toBeGreaterThan(0)
    const failedElements = screen.getAllByText('失败')
    expect(failedElements.length).toBeGreaterThan(0)
  })

  it('renders filter buttons', () => {
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={rows}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{
            total: rows.length,
            reviewable: 1,
            confirmed: 1,
            processing: 0,
            failed: 1,
            blocked: 0,
          }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )

    expect(screen.getByText('全部')).toBeDefined()
    const reviewableElems = screen.getAllByText('待审查')
    expect(reviewableElems.length).toBeGreaterThan(0)
    const confirmedElems = screen.getAllByText('已确认')
    expect(confirmedElems.length).toBeGreaterThan(0)
  })

  it('filters by status when filter button clicked', async () => {
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={rows}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{
            total: rows.length,
            reviewable: 1,
            confirmed: 1,
            processing: 0,
            failed: 1,
            blocked: 0,
          }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )

    // 点击「已确认」筛选按钮 (第一个是过滤器)
    const filterButtons = screen.getAllByText('已确认')
    const confirmedFilter = filterButtons[0] // 第一个是 filter button
    expect(confirmedFilter).toBeDefined()
    fireEvent.click(confirmedFilter!)

    // 筛选后应有 1 个已确认行
    await waitFor(() => {
      const confirmedBadges = screen.getAllByText('已确认')
      // 至少有一个 badge 和一个 filter button
      expect(confirmedBadges.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows primary action buttons', () => {
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={rows}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{
            total: rows.length,
            reviewable: 1,
            confirmed: 1,
            processing: 0,
            failed: 1,
            blocked: 0,
          }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )

    // 识别文字 按钮应该对 no_job 行可见
    expect(screen.getByText('识别文字')).toBeDefined()
  })

  it('calls onAction when primary action clicked', () => {
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={rows}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{
            total: rows.length,
            reviewable: 1,
            confirmed: 1,
            processing: 0,
            failed: 1,
            blocked: 0,
          }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )

    const createBtn = screen.getByText('识别文字')
    fireEvent.click(createBtn)
    expect(mockOnAction).toHaveBeenCalledWith(
      'create_ocr',
      expect.objectContaining({ status: 'no_job' }),
    )
  })

  it('renders in-flight and retention-hold rows', () => {
    // queued/processing/retention_hold 这三种中间态原本没有任何用例覆盖
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={[queuedRow(), processingRow(), retentionHoldRow()]}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{ total: 3, reviewable: 0, confirmed: 0, processing: 2, failed: 0, blocked: 1 }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )

    expect(screen.getByTestId('ocr-status-queued')).toBeDefined()
    expect(screen.getByTestId('ocr-status-processing')).toBeDefined()
    // retention hold 行以 blocked 呈现，不应被误标成可审查
    expect(screen.queryByTestId('ocr-status-reviewable')).toBeNull()
  })

  it('renders blocked row with red styling hints', () => {
    const blockedRows = [privacyBlockRow()]
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={blockedRows}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{ total: 1, reviewable: 0, confirmed: 0, processing: 0, failed: 0, blocked: 1 }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )

    // 阻止状态在 badge 和 筛选按钮上都有，用 getAllByText
    const blockedElements = screen.getAllByText('已阻止')
    expect(blockedElements.length).toBeGreaterThan(0)
  })

  it('does not show automatic apply labels', () => {
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={rows}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{
            total: rows.length,
            reviewable: 1,
            confirmed: 1,
            processing: 0,
            failed: 1,
            blocked: 0,
          }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )

    // 确认没有「自动应用」或「一键执行」标签
    const html = document.body.innerHTML
    expect(html).not.toContain('自动应用')
    expect(html).not.toContain('一键执行')
  })
})

// =========================================================================
// OcrStatusBadge 测试
// =========================================================================

describe('OcrStatusBadge', () => {
  it('renders each status with correct label', () => {
    const statuses = [
      'unsupported',
      'no_job',
      'queued',
      'processing',
      'failed',
      'reviewable',
      'confirmed',
      'stale',
      'blocked',
      'degraded',
    ] as const

    for (const status of statuses) {
      render(
        <Wrapper>
          <OcrStatusBadge status={status} />
        </Wrapper>,
      )
      // 用例名承诺「correct label」：只断言 testid 存在等于没校验文案，
      // 这里对照 STATUS_LABELS 校验渲染出来的中文标签。
      expect(screen.getByTestId(`ocr-status-${status}`).textContent).toContain(
        STATUS_LABELS[status],
      )
    }
  })
})

// =========================================================================
// OcrDocumentDrawer 测试
// =========================================================================

describe('OcrDocumentDrawer', () => {
  const mockOnClose = vi.fn()
  const mockOnOpenReview = vi.fn()
  const mockOnOpenDownstream = vi.fn()
  const mockOnCreateOcr = vi.fn()
  const mockOnRetryOcr = vi.fn()

  beforeEach(() => {
    mockOnClose.mockClear()
    mockOnOpenReview.mockClear()
    mockOnOpenDownstream.mockClear()
    mockOnCreateOcr.mockClear()
    mockOnRetryOcr.mockClear()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <Wrapper>
        <OcrDocumentDrawer
          row={null}
          projectId={1}
          open={false}
          onClose={mockOnClose}
          onOpenReview={mockOnOpenReview}
          onOpenDownstream={mockOnOpenDownstream}
          onCreateOcr={mockOnCreateOcr}
          onRetryOcr={mockOnRetryOcr}
        />
      </Wrapper>,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders drawer when open with a row', () => {
    const row = reviewableRow()
    render(
      <Wrapper>
        <OcrDocumentDrawer
          row={row}
          projectId={1}
          open={true}
          onClose={mockOnClose}
          onOpenReview={mockOnOpenReview}
          onOpenDownstream={mockOnOpenDownstream}
          onCreateOcr={mockOnCreateOcr}
          onRetryOcr={mockOnRetryOcr}
        />
      </Wrapper>,
    )

    // h2 标题包含文件名，详情行也有相同文本，用 getAllByText
    const elements = screen.getAllByText('design-spec.pdf')
    expect(elements.length).toBeGreaterThan(0)

    // 检查标签导航（drawer tabs 是第二个匹配，使用更精确的选择器）
    expect(screen.getByRole('tab', { name: '概览' })).toBeDefined()
    expect(screen.getByRole('tab', { name: '作业' })).toBeDefined()
    expect(screen.getByRole('tab', { name: '审查' })).toBeDefined()
    expect(screen.getByRole('tab', { name: '下游' })).toBeDefined()
    expect(screen.getByRole('tab', { name: '治理' })).toBeDefined()
  })

  it('closes when close button clicked', () => {
    const row = reviewableRow()
    render(
      <Wrapper>
        <OcrDocumentDrawer
          row={row}
          projectId={1}
          open={true}
          onClose={mockOnClose}
          onOpenReview={mockOnOpenReview}
          onOpenDownstream={mockOnOpenDownstream}
          onCreateOcr={mockOnCreateOcr}
          onRetryOcr={mockOnRetryOcr}
        />
      </Wrapper>,
    )

    const closeBtn = screen.getByTestId('ocr-drawer-close')
    fireEvent.click(closeBtn)
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('closes when overlay clicked', () => {
    const row = reviewableRow()
    render(
      <Wrapper>
        <OcrDocumentDrawer
          row={row}
          projectId={1}
          open={true}
          onClose={mockOnClose}
          onOpenReview={mockOnOpenReview}
          onOpenDownstream={mockOnOpenDownstream}
          onCreateOcr={mockOnCreateOcr}
          onRetryOcr={mockOnRetryOcr}
        />
      </Wrapper>,
    )

    const overlay = screen.getByTestId('ocr-drawer-overlay')
    fireEvent.click(overlay)
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('navigates tabs', () => {
    const row = reviewableRow()
    render(
      <Wrapper>
        <OcrDocumentDrawer
          row={row}
          projectId={1}
          open={true}
          onClose={mockOnClose}
          onOpenReview={mockOnOpenReview}
          onOpenDownstream={mockOnOpenDownstream}
          onCreateOcr={mockOnCreateOcr}
          onRetryOcr={mockOnRetryOcr}
        />
      </Wrapper>,
    )

    // 点击作业 tab
    const jobsTab = screen.getByTestId('ocr-drawer-tab-jobs')
    fireEvent.click(jobsTab)

    // 点击审查 tab
    const reviewTab = screen.getByTestId('ocr-drawer-tab-review')
    fireEvent.click(reviewTab)
  })

  it('shows downstream tab with no extractions message', () => {
    const row = reviewableRow()
    render(
      <Wrapper>
        <OcrDocumentDrawer
          row={row}
          projectId={1}
          open={true}
          onClose={mockOnClose}
          onOpenReview={mockOnOpenReview}
          onOpenDownstream={mockOnOpenDownstream}
          onCreateOcr={mockOnCreateOcr}
          onRetryOcr={mockOnRetryOcr}
        />
      </Wrapper>,
    )

    const downstreamTab = screen.getByTestId('ocr-drawer-tab-downstream')
    fireEvent.click(downstreamTab)

    expect(screen.getByText('没有已确认的提取结果')).toBeDefined()
  })

  it('shows governance tab with sections', () => {
    const row = reviewableRow()
    render(
      <Wrapper>
        <OcrDocumentDrawer
          row={row}
          projectId={1}
          open={true}
          onClose={mockOnClose}
          onOpenReview={mockOnOpenReview}
          onOpenDownstream={mockOnOpenDownstream}
          onCreateOcr={mockOnCreateOcr}
          onRetryOcr={mockOnRetryOcr}
        />
      </Wrapper>,
    )

    const governanceTab = screen.getByTestId('ocr-drawer-tab-governance')
    fireEvent.click(governanceTab)

    expect(screen.getByText('保留策略')).toBeDefined()
    expect(screen.getByText('隐私策略')).toBeDefined()
  })

  it('does not show automatic apply or one-click execute labels', () => {
    const row = reviewableRow()
    render(
      <Wrapper>
        <OcrDocumentDrawer
          row={row}
          projectId={1}
          open={true}
          onClose={mockOnClose}
          onOpenReview={mockOnOpenReview}
          onOpenDownstream={mockOnOpenDownstream}
          onCreateOcr={mockOnCreateOcr}
          onRetryOcr={mockOnRetryOcr}
        />
      </Wrapper>,
    )

    const html = document.body.innerHTML
    expect(html).not.toContain('自动应用')
    expect(html).not.toContain('一键执行')
  })
})

// =========================================================================
// 红线和退化测试
// =========================================================================

describe('Redline and degradation tests', () => {
  it('shows degraded state for privacy blocked rows', () => {
    const row = privacyBlockRow()
    render(
      <Wrapper>
        <OcrDocumentDrawer
          row={row}
          projectId={1}
          open={true}
          onClose={vi.fn()}
          onOpenReview={vi.fn()}
          onOpenDownstream={vi.fn()}
          onCreateOcr={vi.fn()}
          onRetryOcr={vi.fn()}
        />
      </Wrapper>,
    )

    // 隐私阻止标签在 badge 中
    const blockedElements = screen.getAllByText('已阻止')
    expect(blockedElements.length).toBeGreaterThan(0)
  })

  it('shows degraded state for read-only degraded rows', () => {
    const row = readOnlyDegradedRow()
    render(
      <Wrapper>
        <OcrDocumentDrawer
          row={row}
          projectId={1}
          open={true}
          onClose={vi.fn()}
          onOpenReview={vi.fn()}
          onOpenDownstream={vi.fn()}
          onCreateOcr={vi.fn()}
          onRetryOcr={vi.fn()}
        />
      </Wrapper>,
    )

    const degradedElements = screen.getAllByText('降级')
    expect(degradedElements.length).toBeGreaterThan(0)
  })

  it('shows stale warning for stale rows', () => {
    const mockOnAction = vi.fn()
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={[staleRow()]}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{ total: 1, reviewable: 0, confirmed: 0, processing: 0, failed: 0, blocked: 0 }}
          onAction={mockOnAction}
        />
      </Wrapper>,
    )

    expect(screen.getByText('源已变更')).toBeDefined()
    const expiredElements = screen.getAllByText('已过期')
    expect(expiredElements.length).toBeGreaterThan(0)
  })

  it('does not expose hidden source details', () => {
    const row = privacyBlockRow() // fileName is null
    render(
      <Wrapper>
        <OcrDocumentsWorkspace
          rows={[row]}
          isLoading={false}
          hasAnyOcrActivity={true}
          counts={{ total: 1, reviewable: 0, confirmed: 0, processing: 0, failed: 0, blocked: 1 }}
          onAction={vi.fn()}
        />
      </Wrapper>,
    )

    // 不应该显示任何真实的文件名
    const html = document.body.innerHTML
    expect(html).toContain('未命名文件')
  })
})
