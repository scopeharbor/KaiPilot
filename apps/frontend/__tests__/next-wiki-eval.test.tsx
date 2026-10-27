/**
 * v3-llm-wiki-eval-gate —— 组织维基「评测」页签：只对管理者显示、提交问答集、报告渲染、JSON 与服务端错误提示。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WikiEvalRunDto, WikiSpaceDto } from '@aiproj/types'
import { useAuthStore } from '@/stores/auth-store'
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

function installFetch(route: (path: string, method: string, body: unknown) => Response | null) {
  const records: Array<{ method: string; url: string; body: unknown }> = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = raw.replace(API_PREFIX, '')
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    records.push({ method, url: path, body })
    return (
      route(path, method, body) ??
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: path } })
    )
  })
  return records
}

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const list = <T,>(data: T[]) => ({
  data,
  meta: { total: data.length, page: 1, perPage: data.length || 1, totalPages: 1 },
})

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

const REPORT: WikiEvalRunDto = {
  id: 3,
  kind: 'retrieval',
  status: 'passed',
  reasons: ['维基路径无泄露，问答正确率与回测工期误差都不劣于旧路径'],
  qa: {
    questions: 5,
    legacy: { correct: 1, correctRate: 0.2, avgRecall: 0.2, leaks: 0, avgBytes: 120 },
    wiki: { correct: 4, correctRate: 0.8, avgRecall: 0.9, leaks: 0, avgBytes: 640 },
  },
  backtest: {
    projects: 3,
    tasks: 6,
    methods: {
      baseline: { mape: 0.33, p80Coverage: 0 },
      legacy: { mape: 0.1, p80Coverage: 80 },
      wiki: { mape: 0.08, p80Coverage: 85 },
    },
  },
  tokensUsed: 0,
  modelName: null,
  createdAt: '2026-10-26T00:00:00.000Z',
}

function backend(
  canManage: boolean,
  extra: (path: string, method: string, body: unknown) => Response | null = () => null,
) {
  return (path: string, method: string, body: unknown): Response | null => {
    const hit = extra(path, method, body)
    if (hit) return hit
    if (path === '/wiki/settings') return jsonResponse(200, { data: { enabled: true, canManage } })
    if (path === '/wiki/spaces/resolve' && method === 'POST')
      return jsonResponse(200, { data: SPACE })
    if (path.startsWith('/wiki/spaces/7/pages')) return jsonResponse(200, list([]))
    if (path === '/wiki/shadow-summary') return jsonResponse(200, { data: { turns: 0 } })
    if (path === '/wiki/eval/runs') return jsonResponse(200, list([]))
    return null
  }
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

describe('组织维基 · 评测', () => {
  test('管理者提交问答集后显示门禁结论、两条路径对比与回测表，并刷新历史', async () => {
    let runs: WikiEvalRunDto[] = []
    const records = installFetch(
      backend(true, (path, method) => {
        if (path === '/wiki/eval/run' && method === 'POST') {
          runs = [REPORT]
          return jsonResponse(201, { data: REPORT })
        }
        if (path === '/wiki/eval/runs') return jsonResponse(200, list(runs))
        return null
      }),
    )
    withClient(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('tab', { name: '评测' }))
    expect(await screen.findByText('还没有评测记录。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /运行评测/ }))
    expect(await screen.findByText(/门禁结论：通过/)).toBeTruthy()
    const qa = screen.getByRole('table', { name: '问答集对比' })
    expect(within(qa).getByText('80%')).toBeTruthy()
    expect(within(qa).getByText('旧检索')).toBeTruthy()
    const bt = screen.getByRole('table', { name: '计划回测' })
    expect(within(bt).getByText('维基参照类')).toBeTruthy()
    expect(within(bt).getByText('85%')).toBeTruthy()
    expect(
      await screen.findByText(/通过 · 维基正确率 80%（旧检索 20%）· 回测 3 个项目/),
    ).toBeTruthy()
    const sent = records.find((r) => r.url === '/wiki/eval/run')!
    expect((sent.body as { questions: unknown[] }).questions).toHaveLength(2)
  })

  test('JSON 不合法与服务端校验错误都有提示；不通过时显示原因', async () => {
    installFetch(
      backend(true, (path, method, body) => {
        if (path === '/wiki/eval/run' && method === 'POST') {
          const n = (body as { questions: unknown[] }).questions.length
          return n === 1
            ? jsonResponse(400, {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: '第 1 题的 expect 必须是 1–10 个、每个 1–100 字',
                },
              })
            : jsonResponse(201, {
                data: {
                  ...REPORT,
                  status: 'failed',
                  reasons: ['维基路径有 1 题出现了不该出现的内容（泄露）'],
                },
              })
        }
        return null
      }),
    )
    withClient(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('tab', { name: '评测' }))
    const input = await screen.findByLabelText('问答集（JSON）')
    fireEvent.change(input, { target: { value: '不是 JSON' } })
    fireEvent.click(screen.getByRole('button', { name: /运行评测/ }))
    expect(await screen.findByText('问答集不是合法的 JSON。')).toBeTruthy()
    fireEvent.change(input, { target: { value: JSON.stringify([{ question: 'x', expect: [] }]) } })
    fireEvent.click(screen.getByRole('button', { name: /运行评测/ }))
    expect(await screen.findByText(/第 1 题的 expect/)).toBeTruthy()
    fireEvent.change(input, {
      target: {
        value: JSON.stringify([
          { question: 'a', expect: ['b'] },
          { question: 'c', expect: ['d'] },
        ]),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /运行评测/ }))
    expect(
      await screen.findByText(/门禁结论：不通过。维基路径有 1 题出现了不该出现的内容/),
    ).toBeTruthy()
  })

  test('非管理者看不到评测页签', async () => {
    const records = installFetch(backend(false))
    withClient(<WikiWorkspace scopeKind="organization" />)
    await screen.findByRole('tab', { name: '体检' })
    expect(screen.queryByRole('tab', { name: '评测' })).toBeNull()
    expect(records.some((r) => r.url === '/wiki/eval/runs')).toBe(false)
  })
})
