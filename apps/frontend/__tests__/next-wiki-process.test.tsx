/**
 * v3-llm-wiki-process-reality —— 记忆维基流程实况前端：组织维基「刷新流程实况」、流程页「请 AI 解读差异」与运行结果。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  WikiIngestRunDto,
  WikiPageSummaryDto,
  WikiPageViewDto,
  WikiSpaceDto,
} from '@aiproj/types'
import { useAuthStore } from '@/stores/auth-store'
import { WikiPageView } from '@/components/next/wiki/WikiPageView'
import {
  WikiProcessInterpret,
  wikiInterpretResultText,
} from '@/components/next/wiki/WikiProcessInterpret'
import { WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/wiki',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: new Headers(),
    json: async () => body,
  } as Response
}

function installFetch(route: (path: string, method: string) => Response | null) {
  const records: Array<{ method: string; url: string }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = raw.replace(API_PREFIX, '')
    records.push({ method, url: path })
    return route(path, method) ?? jsonResponse(404, { error: { code: 'NOT_FOUND', message: path } })
  })
  return records
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const run = (overrides: Partial<WikiIngestRunDto> = {}): WikiIngestRunDto => ({
  id: 41,
  spaceId: 7,
  runKind: 'process_interpret',
  triggerKind: 'manual',
  status: 'queued',
  eventsCount: 2,
  pagesTouched: 0,
  proposalsCreated: 0,
  opsAccepted: 0,
  opsRejected: 0,
  pagesFailed: 0,
  hasMore: false,
  tokensUsed: 0,
  modelName: null,
  errorCode: null,
  createdAt: '2026-10-25T00:00:00.000Z',
  finishedAt: null,
  ...overrides,
})

const PROCESS_PAGE: WikiPageSummaryDto = {
  id: 15,
  spaceId: 7,
  slug: 'process-task-flow',
  title: '任务流转：声明与实际',
  pageType: 'process',
  summaryLine: '任务实际怎么流转',
  status: 'active',
  publishedRevisionId: 30,
  hasPendingProposal: false,
  updatedAt: '2026-10-25T00:00:00.000Z',
}

function processView(overrides: Partial<WikiPageViewDto> = {}): WikiPageViewDto {
  return {
    page: PROCESS_PAGE,
    revision: {
      id: 30,
      authorKind: 'system',
      editClass: 'bookkeeping',
      createdAt: '2026-10-25T00:00:00.000Z',
      reviewedAt: null,
    },
    body: '## 实际的流程（数据怎么说）\n- 返工：20%。\n',
    claims: [],
    hasMaskedContent: false,
    outgoingLinks: [],
    canReview: true,
    canEdit: true,
    sharedWithProjectIds: null,
    asOf: null,
    ...overrides,
  }
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 1, email: 'a@example.com', fullName: '管理员', organizations: [] },
    accessToken: null,
    refreshToken: null,
    permissions: ['wiki:view'],
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  } as never)
})
afterEach(() => vi.unstubAllGlobals())

describe('解读结果文案', () => {
  test('各状态都有可读说明', () => {
    expect(wikiInterpretResultText(run())).toContain('正在对比')
    expect(
      wikiInterpretResultText(
        run({ status: 'succeeded', proposalsCreated: 1, opsAccepted: 2, opsRejected: 1 }),
      ),
    ).toBe('已生成解读提议（2 条），拦下 1 条不合规的说法，请到「审阅队列」确认后才会生效。')
    expect(wikiInterpretResultText(run({ status: 'succeeded' }))).toBe(
      'AI 没有找到值得写进页面的差异。',
    )
    expect(wikiInterpretResultText(run({ status: 'no_events' }))).toContain('先刷新流程实况')
    expect(wikiInterpretResultText(run({ status: 'budget_exhausted' }))).toBe(
      '今日编入预算已用完，没有生成解读。',
    )
  })
})

describe('请 AI 解读差异', () => {
  test('触发后轮询运行记录并显示结果', async () => {
    let polls = 0
    const records = installFetch((path, method) => {
      if (path === '/wiki/pages/15/interpret' && method === 'POST')
        return jsonResponse(202, { data: run() })
      if (path === '/wiki/spaces/7/ingest-runs') {
        polls++
        const current =
          polls < 2
            ? run({ status: 'running' })
            : run({ status: 'succeeded', proposalsCreated: 1, opsAccepted: 1 })
        return jsonResponse(200, {
          data: [current, run({ id: 40, runKind: 'ingest', status: 'failed' })],
          meta: { total: 2, page: 1, perPage: 2, totalPages: 1 },
        })
      }
      return null
    })
    withClient(<WikiProcessInterpret pageId={15} spaceId={7} />)
    const button = screen.getByRole('button', { name: /请 AI 解读差异/ })
    fireEvent.click(button)
    expect(await screen.findByText(/正在对比声明与实际/)).toBeTruthy()
    expect(
      await screen.findByText(/已生成解读提议（1 条）/, undefined, { timeout: 5000 }),
    ).toBeTruthy()
    expect(records.filter((r) => r.url === '/wiki/pages/15/interpret')).toHaveLength(1)
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  })

  test('触发失败时显示错误', async () => {
    installFetch((path, method) => {
      if (path === '/wiki/pages/15/interpret' && method === 'POST')
        return jsonResponse(409, {
          error: { code: 'WIKI_INGEST_BUSY', message: '本空间已有编入在进行中，请稍后再试' },
        })
      return null
    })
    withClient(<WikiProcessInterpret pageId={15} spaceId={7} />)
    fireEvent.click(screen.getByRole('button', { name: /请 AI 解读差异/ }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  test('只有审阅者在已发布的流程实况页上看到按钮', () => {
    installFetch(() => null)
    const { unmount } = withClient(
      <WikiPageView view={processView()} spaceId={7} onOpenSlug={vi.fn()} onEdit={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: /请 AI 解读差异/ })).toBeTruthy()
    unmount()
    for (const overrides of [
      { canReview: false },
      { asOf: '2026-10-01T00:00:00.000Z' },
      { page: { ...PROCESS_PAGE, slug: 'contract-approval' } },
      { page: { ...PROCESS_PAGE, pageType: 'lesson' as const } },
    ]) {
      const r = withClient(
        <WikiPageView
          view={processView(overrides)}
          spaceId={7}
          onOpenSlug={vi.fn()}
          onEdit={vi.fn()}
        />,
      )
      expect(screen.queryByRole('button', { name: /请 AI 解读差异/ })).toBeNull()
      r.unmount()
    }
  })
})

describe('刷新流程实况', () => {
  const SPACE: WikiSpaceDto = {
    id: 7,
    scopeKind: 'organization',
    scopeRefId: 1,
    title: '组织维基',
    canReview: true,
    canPropose: true,
    pageCount: 0,
    pendingProposalCount: 0,
  }
  const backend =
    (space: WikiSpaceDto) =>
    (path: string, method: string): Response | null => {
      if (path === '/wiki/settings')
        return jsonResponse(200, { data: { enabled: true, canManage: false } })
      if (path === '/wiki/spaces/resolve' && method === 'POST')
        return jsonResponse(200, { data: space })
      if (path.startsWith('/wiki/spaces/7/pages'))
        return jsonResponse(200, {
          data: [],
          meta: { total: 0, page: 1, perPage: 100, totalPages: 1 },
        })
      if (path === '/wiki/process/refresh' && method === 'POST')
        return jsonResponse(200, { data: { created: 1, updated: 0, unchanged: 1, skipped: 0 } })
      return null
    }

  test('组织维基审阅者可刷新并看到结果；非审阅者与项目空间没有按钮', async () => {
    const records = installFetch(backend(SPACE))
    const { unmount } = withClient(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /刷新流程实况/ }))
    expect(await screen.findByText(/流程实况已刷新：新建 1 页、更新 0 页、未变 1 页/)).toBeTruthy()
    expect(records.filter((r) => r.url === '/wiki/process/refresh')).toHaveLength(1)
    unmount()

    installFetch(backend({ ...SPACE, canReview: false }))
    const second = withClient(<WikiWorkspace scopeKind="organization" />)
    await screen.findByRole('heading', { name: '组织维基' })
    expect(screen.queryByRole('button', { name: /刷新流程实况/ })).toBeNull()
    second.unmount()

    installFetch(backend({ ...SPACE, scopeKind: 'project', scopeRefId: 9 }))
    withClient(<WikiWorkspace scopeKind="project" scopeRefId={9} />)
    await screen.findByRole('heading', { name: '组织维基' })
    expect(screen.queryByRole('button', { name: /刷新流程实况/ })).toBeNull()
  })

  test('没有变化时说明数据不足', async () => {
    installFetch((path, method) => {
      if (path === '/wiki/process/refresh' && method === 'POST')
        return jsonResponse(200, { data: { created: 0, updated: 0, unchanged: 0, skipped: 2 } })
      return backend(SPACE)(path, method)
    })
    withClient(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /刷新流程实况/ }))
    expect(await screen.findByText(/数据不足的 2 类未生成/)).toBeTruthy()
  })
})
