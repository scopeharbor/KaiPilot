/**
 * v3-llm-wiki-person-space —— 个人空间前端：我的维基「刷新我的估算校准」「从 AI 记忆导入偏好」，项目维基「成员授权给你的个人页」。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WikiPageSummaryDto, WikiSharedWithMeDto, WikiSpaceDto } from '@aiproj/types'
import { useAuthStore } from '@/stores/auth-store'
import { WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/me/wiki',
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

const SPACE = (overrides: Partial<WikiSpaceDto> = {}): WikiSpaceDto => ({
  id: 7,
  scopeKind: 'user',
  scopeRefId: 1,
  title: '我的维基',
  canReview: true,
  canPropose: true,
  pageCount: 0,
  pendingProposalCount: 0,
  ...overrides,
})

const sharedPage = (id: number, title: string): WikiPageSummaryDto => ({
  id,
  spaceId: 30 + id,
  slug: 'estimate-calibration',
  title,
  pageType: 'person',
  summaryLine: '只供本人自我校准',
  status: 'active',
  publishedRevisionId: 100 + id,
  hasPendingProposal: false,
  updatedAt: '2026-10-26T00:00:00.000Z',
})

function backend(
  space: WikiSpaceDto,
  extra: (path: string, method: string) => Response | null = () => null,
) {
  return (path: string, method: string): Response | null => {
    const hit = extra(path, method)
    if (hit) return hit
    if (path === '/wiki/settings')
      return jsonResponse(200, { data: { enabled: true, canManage: false } })
    if (path === '/wiki/spaces/resolve' && method === 'POST')
      return jsonResponse(200, { data: space })
    if (path.startsWith('/wiki/spaces/7/pages'))
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 100, totalPages: 1 },
      })
    return null
  }
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 1, email: 'a@example.com', fullName: '本人', organizations: [] },
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

describe('我的维基', () => {
  test('刷新估算校准：成功、已最新与样本不足各有说明', async () => {
    const results = [
      { created: 1, updated: 0, unchanged: 0, skipped: 0 },
      { created: 0, updated: 0, unchanged: 1, skipped: 0 },
      { created: 0, updated: 0, unchanged: 0, skipped: 1 },
    ]
    const records = installFetch(
      backend(SPACE(), (path, method) =>
        path === '/wiki/me/estimate-calibration/refresh' && method === 'POST'
          ? jsonResponse(200, { data: results.shift() })
          : null,
      ),
    )
    withClient(<WikiWorkspace scopeKind="user" />)
    const button = await screen.findByRole('button', { name: /刷新我的估算校准/ })
    fireEvent.click(button)
    expect(await screen.findByText(/估算校准已更新。只有你自己能看到/)).toBeTruthy()
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    fireEvent.click(button)
    expect(await screen.findByText('估算校准已是最新。')).toBeTruthy()
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    fireEvent.click(button)
    expect(await screen.findByText(/不足 5 个），暂时无法校准/)).toBeTruthy()
    expect(records.filter((r) => r.url === '/wiki/me/estimate-calibration/refresh')).toHaveLength(3)
  })

  test('导入 AI 记忆：提示到审阅队列确认；没有新偏好时说明', async () => {
    const results = [
      { imported: 2, skipped: 1, pageId: 5, revisionId: 9 },
      { imported: 0, skipped: 0, pageId: null, revisionId: null },
    ]
    installFetch(
      backend(SPACE(), (path, method) =>
        path === '/wiki/me/import-memory' && method === 'POST'
          ? jsonResponse(200, { data: results.shift() })
          : null,
      ),
    )
    withClient(<WikiWorkspace scopeKind="user" />)
    const button = await screen.findByRole('button', { name: /从 AI 记忆导入偏好/ })
    fireEvent.click(button)
    expect(
      await screen.findByText(
        /已整理 2 条偏好（跳过 1 条已有、敏感或不合规的），请到「审阅队列」确认/,
      ),
    ).toBeTruthy()
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    fireEvent.click(button)
    expect(await screen.findByText('没有可导入的新偏好。')).toBeTruthy()
  })

  test('组织维基没有个人按钮，也不请求授权列表', async () => {
    const records = installFetch(backend(SPACE({ scopeKind: 'organization', title: '组织维基' })))
    withClient(<WikiWorkspace scopeKind="organization" />)
    await screen.findByRole('heading', { name: '组织维基' })
    expect(screen.queryByRole('button', { name: /刷新我的估算校准/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /从 AI 记忆导入偏好/ })).toBeNull()
    expect(records.some((r) => r.url === '/wiki/shared-with-me')).toBe(false)
  })
})

describe('项目维基 · 成员授权给你的个人页', () => {
  const rows: WikiSharedWithMeDto[] = [
    { page: sharedPage(21, '我的估算校准'), ownerName: '张三', projectIds: [9] },
    { page: sharedPage(22, '我的工作偏好'), ownerName: '李四', projectIds: [12] },
  ]

  test('只列授权给本项目的页面，点击打开只读页面', async () => {
    const records = installFetch(
      backend(SPACE({ scopeKind: 'project', scopeRefId: 9, title: '项目维基' }), (path) => {
        if (path === '/wiki/shared-with-me')
          return jsonResponse(200, {
            data: rows,
            meta: { total: 2, page: 1, perPage: 2, totalPages: 1 },
          })
        return null
      }),
    )
    withClient(<WikiWorkspace scopeKind="project" scopeRefId={9} />)
    const item = await screen.findByRole('button', { name: '张三 · 我的估算校准' })
    expect(screen.queryByText(/李四/)).toBeNull()
    expect(screen.getByText(/不用于考核或比较/)).toBeTruthy()
    fireEvent.click(item)
    await waitFor(() => expect(records.some((r) => r.url === '/wiki/pages/21')).toBe(true))
  })

  test('没有授权给本项目的页面时不显示该区块', async () => {
    installFetch(
      backend(SPACE({ scopeKind: 'project', scopeRefId: 9, title: '项目维基' }), (path) =>
        path === '/wiki/shared-with-me'
          ? jsonResponse(200, {
              data: [rows[1]],
              meta: { total: 1, page: 1, perPage: 1, totalPages: 1 },
            })
          : null,
      ),
    )
    withClient(<WikiWorkspace scopeKind="project" scopeRefId={9} />)
    await screen.findByRole('heading', { name: '项目维基' })
    await waitFor(() => expect(document.querySelector('[data-wiki-shared-with-me]')).toBeNull())
    expect(screen.queryByRole('button', { name: /刷新我的估算校准/ })).toBeNull()
  })
})
