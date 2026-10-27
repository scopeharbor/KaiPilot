/**
 * v3-llm-wiki-lint-consolidation —— 体检页：AI 矛盾体检按钮与结果、矛盾发现展示与打开页面、忽略发现、体检摘要新计数；撤回结果说明。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WikiIngestRunDto, WikiLintFindingDto, WikiSpaceDto } from '@aiproj/types'
import { useAuthStore } from '@/stores/auth-store'
import { WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'
import { wikiContradictionResultText } from '@/components/next/wiki/WikiContradictionCheck'
import { wikiRetractResultText } from '@/components/next/wiki/WikiPageView'

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

const SPACE: WikiSpaceDto = {
  id: 7,
  scopeKind: 'organization',
  scopeRefId: 1,
  title: '组织维基',
  canReview: true,
  canPropose: true,
  pageCount: 2,
  pendingProposalCount: 0,
}

const list = <T,>(data: T[]) => ({
  data,
  meta: { total: data.length, page: 1, perPage: data.length || 1, totalPages: 1 },
})

const RUN = (overrides: Partial<WikiIngestRunDto> = {}): WikiIngestRunDto =>
  ({
    id: 31,
    spaceId: 7,
    runKind: 'contradiction_check',
    triggerKind: 'manual',
    status: 'succeeded',
    eventsCount: 6,
    pagesTouched: 0,
    proposalsCreated: 0,
    opsAccepted: 1,
    opsRejected: 0,
    pagesFailed: 0,
    hasMore: false,
    tokensUsed: 100,
    errorCode: null,
    createdAt: '2026-10-26T00:00:00.000Z',
    startedAt: '2026-10-26T00:00:00.000Z',
    finishedAt: '2026-10-26T00:00:01.000Z',
    ...overrides,
  }) as WikiIngestRunDto

const CONTRADICTION: WikiLintFindingDto = {
  id: 91,
  pageId: 11,
  findingKind: 'contradiction',
  status: 'open',
  detail: {
    claimA: 1,
    claimB: 2,
    pageA: 11,
    pageB: 12,
    statementA: '上线需双人审批。',
    statementB: '小改动可单人上线。',
    reason: '一条要求双人审批，另一条允许单人上线。',
  },
  createdAt: '2026-10-26T00:00:00.000Z',
}

const STALE: WikiLintFindingDto = {
  id: 92,
  pageId: 12,
  findingKind: 'stale_page',
  status: 'open',
  detail: { days: 90 },
  createdAt: '2026-10-26T00:00:00.000Z',
}

function backend(
  findings: () => WikiLintFindingDto[],
  extra: (path: string, method: string) => Response | null = () => null,
) {
  return (path: string, method: string): Response | null => {
    const hit = extra(path, method)
    if (hit) return hit
    if (path === '/wiki/settings')
      return jsonResponse(200, { data: { enabled: true, canManage: true } })
    if (path === '/wiki/spaces/resolve' && method === 'POST')
      return jsonResponse(200, { data: SPACE })
    if (path.startsWith('/wiki/spaces/7/pages')) return jsonResponse(200, list([]))
    if (path.startsWith('/wiki/spaces/7/lint-findings')) return jsonResponse(200, list(findings()))
    if (path === '/wiki/spaces/7/retractions') return jsonResponse(200, list([]))
    return null
  }
}

async function openLint() {
  withClient(<WikiWorkspace scopeKind="organization" />)
  fireEvent.click(await screen.findByRole('tab', { name: '体检' }))
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 1, email: 'a@example.com', fullName: '管理员', organizations: [] },
    accessToken: null,
    refreshToken: null,
    permissions: ['wiki:view', 'wiki:review'],
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

describe('体检页 · AI 矛盾体检', () => {
  test('触发后轮询运行记录，显示找到的矛盾数并刷新发现列表', async () => {
    let checked = false
    const records = installFetch(
      backend(
        () => (checked ? [CONTRADICTION] : []),
        (path, method) => {
          if (path === '/wiki/spaces/7/contradiction-check' && method === 'POST') {
            checked = true
            return jsonResponse(202, { data: RUN({ status: 'queued', opsAccepted: 0 }) })
          }
          if (path === '/wiki/spaces/7/ingest-runs') return jsonResponse(200, list([RUN()]))
          return null
        },
      ),
    )
    await openLint()
    fireEvent.click(await screen.findByRole('button', { name: /AI 矛盾体检/ }))
    expect(await screen.findByText(/找到 1 处可能的矛盾/)).toBeTruthy()
    expect(await screen.findByText('「上线需双人审批。」')).toBeTruthy()
    expect(screen.getByText('「小改动可单人上线。」')).toBeTruthy()
    expect(screen.getByText(/理由：一条要求双人审批/)).toBeTruthy()
    expect(
      records.filter((r) => r.url === '/wiki/spaces/7/contradiction-check' && r.method === 'POST'),
    ).toHaveLength(1)
  })

  test('触发失败显示错误', async () => {
    installFetch(
      backend(
        () => [],
        (path, method) =>
          path === '/wiki/spaces/7/contradiction-check' && method === 'POST'
            ? jsonResponse(409, { error: { code: 'CONFLICT', message: '本空间有正在进行的运行' } })
            : null,
      ),
    )
    await openLint()
    fireEvent.click(await screen.findByRole('button', { name: /AI 矛盾体检/ }))
    expect(await screen.findByText(/本空间有正在进行的运行/)).toBeTruthy()
  })

  test('结果说明覆盖各状态', () => {
    expect(wikiContradictionResultText(RUN({ status: 'running' }))).toMatch(/正在检查/)
    expect(wikiContradictionResultText(RUN({ opsAccepted: 0, opsRejected: 2 }))).toBe(
      '没有发现矛盾（拦下 2 条不合规的结果）。',
    )
    expect(wikiContradictionResultText(RUN({ opsAccepted: 2 }))).toMatch(/不会修改页面/)
    expect(wikiContradictionResultText(RUN({ status: 'no_events' }))).toMatch(/不足两条/)
    expect(wikiContradictionResultText(RUN({ status: 'budget_exhausted' }))).toMatch(
      /没有完成矛盾体检/,
    )
  })
})

describe('体检页 · 发现', () => {
  test('矛盾发现可打开所在页面；忽略发送请求并刷新列表', async () => {
    let dismissed = false
    const records = installFetch(
      backend(
        () => (dismissed ? [STALE] : [CONTRADICTION, STALE]),
        (path, method) => {
          if (path === '/wiki/lint-findings/91/dismiss' && method === 'POST') {
            dismissed = true
            return jsonResponse(200, { data: { ...CONTRADICTION, status: 'dismissed' } })
          }
          return null
        },
      ),
    )
    await openLint()
    expect(await screen.findByText('页面已过期，建议复核（页面 #12）')).toBeTruthy()
    const dismiss = document.querySelector('[data-wiki-dismiss="91"]') as HTMLButtonElement
    fireEvent.click(dismiss)
    await waitFor(() => expect(document.querySelector('[data-wiki-contradiction]')).toBeNull())
    expect(records.some((r) => r.url === '/wiki/lint-findings/91/dismiss')).toBe(true)
  })

  test('打开页面切回页面页签并请求该页', async () => {
    const records = installFetch(backend(() => [CONTRADICTION]))
    await openLint()
    fireEvent.click(await screen.findByRole('button', { name: '打开第二条所在页面' }))
    await waitFor(() => expect(records.some((r) => r.url.startsWith('/wiki/pages/12'))).toBe(true))
  })

  test('体检摘要含移除已撤回的说法与已解决的矛盾', async () => {
    installFetch(
      backend(
        () => [],
        (path, method) =>
          path === '/wiki/spaces/7/lint' && method === 'POST'
            ? jsonResponse(200, {
                data: {
                  fixedBrokenLinks: 1,
                  closedClaims: 0,
                  indexRefreshed: false,
                  orphanPages: 0,
                  stalePages: 0,
                  retractedClaims: 2,
                  resolvedContradictions: 1,
                },
              })
            : null,
      ),
    )
    await openLint()
    fireEvent.click(await screen.findByRole('button', { name: /立即体检/ }))
    expect(await screen.findByText(/移除已撤回的说法 2 条，已解决的矛盾 1 处。/)).toBeTruthy()
  })
})

describe('撤回结果说明', () => {
  test('同一说法在其他页面一并撤回时注明', () => {
    expect(wikiRetractResultText({ cascadedClaims: 3, cascadedPages: 3 })).toMatch(
      /同样的说法（2 处）也一并撤回，共生成 3 条删除修订提议/,
    )
    expect(wikiRetractResultText({ cascadedClaims: 1, cascadedPages: 1 })).toBe(
      '已撤回该主张，并生成了删除它的修订提议，请在审阅队列中确认。',
    )
    expect(wikiRetractResultText({})).toMatch(/已撤回该主张，并生成了/)
  })
})
