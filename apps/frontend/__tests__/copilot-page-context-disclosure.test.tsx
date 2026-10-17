/**
 * v3-copilot-authoritative-page-context —— 页面语境披露 chips 组件测试（任务 2.4）。
 *
 * 覆盖：
 * - chips 展示 项目/页面/筛选/数据时间（design §G 文案形态）；
 * - context_unavailable → 诚实文案 + 「使用当前页面重试」入口；
 * - 页面切换竞态：回答绑定提交时快照，路由修订变化 → 明确标注 + 换绑重试；
 * - 长筛选文本显示不溢出（截断 class + 完整 title）；
 * - 隐私说明恒展示（spec REQ 透明性）。
 *
 * 纯 vitest + RTL；路由与提交模块 mock，零网络。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CopilotPageContextDisclosureV1 } from '@aiproj/types'
import {
  PageContextDisclosure,
  formatContextChipTime,
  summarizeAppliedFilters,
} from '@/components/copilot/PageContextDisclosure'
import { useCopilotStore } from '@/stores/copilot-store'
import { COPILOT_PAGE_CONTEXT_PRIVACY_NOTE } from '@aiproj/types'
import { derivePageContextDescriptor } from '@/lib/copilot/page-context'

// ---------------------------------------------------------------------------
// mocks
// ---------------------------------------------------------------------------

const mockNav = { currentPath: '/projects/1/(views)/kanban', currentQuery: '' }
vi.mock('next/navigation', () => ({
  usePathname: () => mockNav.currentPath,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(mockNav.currentQuery),
}))

const retryCurrentPageMock = vi.fn()
const retrySnapshotMock = vi.fn()

vi.mock('@/lib/copilot/submit', () => ({
  retryCopilotTurn: () => retrySnapshotMock(),
  retryCopilotTurnWithCurrentPage: (descriptor: unknown) => retryCurrentPageMock(descriptor),
}))

function makeDisclosure(
  overrides: Partial<CopilotPageContextDisclosureV1> = {},
): CopilotPageContextDisclosureV1 {
  return {
    version: 1,
    routeId: 'project-kanban',
    projectId: 1,
    viewId: 'kanban',
    filters: [{ key: 'status', op: 'eq', value: 'blocked' }],
    ignoredFilters: [],
    sortApplied: [],
    selectionCount: 0,
    observedAt: '2026-09-01T06:32:00.000Z',
    status: 'ready',
    privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
    ...overrides,
  }
}

/** 快照 descriptor：routeRevision 必须是当前页面 (pathname+query) 的派生指纹。 */
function snapshotDescriptor(query: string) {
  return derivePageContextDescriptor({
    pathname: '/projects/1/(views)/kanban',
    params: {},
    searchParams: new URLSearchParams(query),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNav.currentPath = '/projects/1/(views)/kanban'
  mockNav.currentQuery = 'status=blocked'
  useCopilotStore.setState({
    turn: {
      sessionId: 's',
      messageId: 'm',
      destinations: [],
      clarificationRequired: false,
      clarificationItems: [],
      assumptionEntries: [],
      ambiguity: null,
      warnings: [],
      degradedReason: null,
      rejectedReferenceCount: 0,
      scope: 'project',
      intentSummary: 'x',
      stats: { ruleHitCount: 1, fallbackCount: 0 },
      mode: 'live',
      pageContextDisclosure: makeDisclosure(),
    } as never,
    turnContextSnapshot: {
      pageContext: snapshotDescriptor('status=blocked'),
      submittedAt: '2026-09-01T06:30:00.000Z',
    },
  })
})

// ---------------------------------------------------------------------------
// chips 渲染
// ---------------------------------------------------------------------------

describe('PageContextDisclosure chips', () => {
  it('展示 项目/页面/筛选/数据时间（design §G 形态）', () => {
    render(<PageContextDisclosure />)
    expect(screen.getByText('当前项目')).toBeTruthy()
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByText('页面')).toBeTruthy()
    expect(screen.getByText('看板')).toBeTruthy()
    expect(screen.getByText('筛选')).toBeTruthy()
    expect(screen.getByText('status=blocked')).toBeTruthy()
    expect(screen.getByText('数据时间')).toBeTruthy()
    // 时间按运行环境本地时区展示（与消息时间戳同一格式函数）
    expect(screen.getByText(formatContextChipTime('2026-09-01T06:32:00.000Z'))).toBeTruthy()
    expect(screen.getByText(COPILOT_PAGE_CONTEXT_PRIVACY_NOTE)).toBeTruthy()
  })

  it('projectName 传入时展示项目名而非 #id', () => {
    render(<PageContextDisclosure projectName="登录模块重构" />)
    expect(screen.getByText('登录模块重构')).toBeTruthy()
  })

  it('长筛选文本：截断 class + title 保留完整文本（不溢出面板）', () => {
    const longValue = `keyword=${'非常长的筛选关键词'.repeat(10)}`
    useCopilotStore.setState({
      turn: {
        sessionId: 's',
        messageId: 'm',
        destinations: [],
        clarificationRequired: false,
        clarificationItems: [],
        assumptionEntries: [],
        ambiguity: null,
        warnings: [],
        degradedReason: null,
        rejectedReferenceCount: 0,
        scope: 'project',
        intentSummary: 'x',
        stats: { ruleHitCount: 1, fallbackCount: 0 },
        mode: 'live',
        pageContextDisclosure: makeDisclosure({
          filters: [{ key: 'keyword', op: 'eq', value: '非常长的筛选关键词'.repeat(10) }],
        }),
      } as never,
    })
    render(<PageContextDisclosure />)
    const valueEl = screen.getByText(longValue)
    expect(valueEl.className).toContain('truncate')
    expect(valueEl.getAttribute('title')).toBe(longValue)
  })

  it('被忽略筛选在摘要中披露（未知键不静默）', () => {
    const summary = summarizeAppliedFilters(
      makeDisclosure({
        filters: [{ key: 'status', op: 'eq', value: 'blocked' }],
        ignoredFilters: [{ key: 'dropTable', op: 'eq', value: 'tasks' }],
      }),
    )
    expect(summary).toContain('status=blocked')
    expect(summary).toContain('已忽略 1 项未知筛选')
  })

  it('无披露（未携带 pageContext 回合）时干净折叠', () => {
    useCopilotStore.setState({ turn: null, turnContextSnapshot: null })
    const { container } = render(<PageContextDisclosure />)
    expect(container.querySelector('[data-copilot-page-context]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// context_unavailable
// ---------------------------------------------------------------------------

describe('PageContextDisclosure context_unavailable', () => {
  it('诚实文案 + 重试入口（不假装有项目事实）', () => {
    useCopilotStore.setState({
      turn: {
        sessionId: 's',
        messageId: 'm',
        destinations: [],
        clarificationRequired: false,
        clarificationItems: [],
        assumptionEntries: [],
        ambiguity: null,
        warnings: [],
        degradedReason: null,
        rejectedReferenceCount: 0,
        scope: 'project',
        intentSummary: 'x',
        stats: { ruleHitCount: 1, fallbackCount: 0 },
        mode: 'live',
        pageContextDisclosure: makeDisclosure({
          status: 'context_unavailable',
          projectId: undefined,
        }),
      } as never,
    })
    render(<PageContextDisclosure onRetryCurrentPage={(d) => retryCurrentPageMock(d)} />)
    expect(screen.getByText(/我目前无法取得这个项目的数据/)).toBeTruthy()
    const button = screen.getByRole('button', { name: /使用当前页面重试/ })
    fireEvent.click(button)
    expect(retryCurrentPageMock).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 页面切换竞态（design §F-4）
// ---------------------------------------------------------------------------

describe('PageContextDisclosure 页面切换竞态', () => {
  it('当前路由修订与快照一致 → 不显示竞态标注与重试', () => {
    render(<PageContextDisclosure onRetryCurrentPage={(d) => retryCurrentPageMock(d)} />)
    expect(screen.queryByText(/页面已切换/)).toBeNull()
    expect(screen.queryByRole('button', { name: /使用当前页面重试/ })).toBeNull()
  })

  it('页面已切换（筛选变化）→ 标注「回答基于提交时页面」+ 用当前页面重试', () => {
    // 当前页面 status=in_progress（与快照 rev-1 的 status=blocked 不同）
    mockNav.currentQuery = 'status=in_progress'
    useCopilotStore.setState({
      turn: {
        sessionId: 's',
        messageId: 'm',
        destinations: [],
        clarificationRequired: false,
        clarificationItems: [],
        assumptionEntries: [],
        ambiguity: null,
        warnings: [],
        degradedReason: null,
        rejectedReferenceCount: 0,
        scope: 'project',
        intentSummary: 'x',
        stats: { ruleHitCount: 1, fallbackCount: 0 },
        mode: 'live',
        pageContextDisclosure: makeDisclosure(),
      } as never,
    })
    render(<PageContextDisclosure onRetryCurrentPage={(d) => retryCurrentPageMock(d)} />)
    expect(screen.getByText(/页面已切换，本次回答基于提交时的页面语境/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /使用当前页面重试/ }))
    expect(retryCurrentPageMock).toHaveBeenCalledTimes(1)
    // 传入的是**当前页面**重新派生的 descriptor（新 revision + 新筛选）
    const sent = retryCurrentPageMock.mock.calls[0]![0]
    expect(sent.routeRevision).not.toBe(snapshotDescriptor('status=blocked').routeRevision)
    expect(sent.filters).toEqual([{ key: 'status', op: 'eq', value: 'in_progress' }])
  })
})

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

describe('format 辅助', () => {
  it('formatContextChipTime 输出 HH:MM，非法时间返回空串', () => {
    // 按运行环境本地时区显示：用本地时间构造输入，断言与 CI/容器时区无关
    expect(formatContextChipTime(new Date(2026, 8, 1, 14, 32).toISOString())).toBe('14:32')
    expect(formatContextChipTime(new Date(2026, 8, 1, 9, 5).toISOString())).toBe('09:05')
    expect(formatContextChipTime('not-a-date')).toBe('')
  })
})
