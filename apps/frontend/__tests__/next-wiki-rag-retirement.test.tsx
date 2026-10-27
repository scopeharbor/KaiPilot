/**
 * v3-llm-wiki-rag-retirement —— 回答评测（先估算、确认后才开始、报告按种类显示）与「迁移 AI 同事记忆」按钮（审阅者、项目 / 组织空间）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WikiEvalRunDto, WikiIngestRunDto, WikiSpaceDto } from '@aiproj/types'
import { useAuthStore } from '@/stores/auth-store'
import { WikiWorkspace } from '@/components/next/wiki/WikiWorkspace'
import { WikiEvalReport } from '@/components/next/wiki/WikiEvalPanel'

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

const ANSWER_REPORT: WikiEvalRunDto = {
  id: 9,
  kind: 'answer',
  status: 'passed',
  reasons: ['带维基记忆的回答无泄露，正确率不低于无记忆'],
  qa: {
    questions: 5,
    legacy: { correct: 0, correctRate: 0, avgRecall: 0.1, leaks: 0, avgBytes: 20 },
    wiki: { correct: 3, correctRate: 0.6, avgRecall: 0.7, leaks: 0, avgBytes: 80 },
  },
  backtest: {
    projects: 0,
    tasks: 0,
    methods: {
      baseline: { mape: 0, p80Coverage: 0 },
      legacy: { mape: 0, p80Coverage: 0 },
      wiki: { mape: 0, p80Coverage: 0 },
    },
  },
  tokensUsed: 1234,
  modelName: 'fake-model',
  createdAt: '2026-10-27T00:00:00.000Z',
}

const RUN: WikiIngestRunDto = {
  id: 5,
  spaceId: 7,
  runKind: 'answer_eval',
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
  createdAt: '2026-10-27T00:00:00.000Z',
  finishedAt: null,
}

function backend(
  space: WikiSpaceDto,
  extra: (path: string, method: string, body: unknown) => Response | null = () => null,
) {
  return (path: string, method: string, body: unknown): Response | null => {
    const hit = extra(path, method, body)
    if (hit) return hit
    if (path === '/wiki/settings')
      return jsonResponse(200, { data: { enabled: true, canManage: true } })
    if (path === '/wiki/spaces/resolve' && method === 'POST')
      return jsonResponse(200, { data: space })
    if (path.startsWith(`/wiki/spaces/${space.id}/pages`)) return jsonResponse(200, list([]))
    if (path === '/wiki/shadow-summary') return jsonResponse(200, { data: { turns: 0 } })
    if (path === '/wiki/eval/runs') return jsonResponse(200, list([]))
    if (path === '/wiki/eval/answer-runs/latest') return jsonResponse(200, { data: null })
    if (path === '/wiki/shared-with-me') return jsonResponse(200, list([]))
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

describe('组织维基 · 回答评测', () => {
  test('先估算显示调用次数与 token，确认后才开始，并显示运行状态', async () => {
    let latest: WikiIngestRunDto | null = null
    const records = installFetch(
      backend(SPACE, (path, method) => {
        if (path === '/wiki/eval/answer-estimate' && method === 'POST')
          return jsonResponse(200, {
            data: {
              questions: 2,
              calls: 4,
              estimatedTokens: 2100,
              usedTokensToday: 100,
              dailyBudget: 200000,
              exceedsBudget: false,
            },
          })
        if (path === '/wiki/eval/answer-run' && method === 'POST') {
          latest = { ...RUN, status: 'model_unavailable' }
          return jsonResponse(202, { data: RUN })
        }
        if (path === '/wiki/eval/answer-runs/latest') return jsonResponse(200, { data: latest })
        return null
      }),
    )
    withClient(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('tab', { name: '评测' }))
    fireEvent.click(await screen.findByRole('button', { name: /估算回答评测费用/ }))
    expect(await screen.findByText(/将调用 AI 4 次，约 2100 token/)).toBeTruthy()
    expect(screen.getByText(/今日已用 100 \/ 每日预算 200000/)).toBeTruthy()
    expect(records.some((r) => r.url === '/wiki/eval/answer-run')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '确认费用并开始' }))
    expect(await screen.findByText(/没有可用的 AI 连接，没有调用 AI/)).toBeTruthy()
    const sent = records.find((r) => r.url === '/wiki/eval/answer-run')!
    expect(sent.body).toMatchObject({ confirmCost: true })
    expect((sent.body as { questions: unknown[] }).questions).toHaveLength(2)
    const estimateSent = records.find((r) => r.url === '/wiki/eval/answer-estimate')!
    expect(estimateSent.body).not.toHaveProperty('confirmCost')
  })

  test('超出预算的估算以错误样式提示；取消后不开始；JSON 不合法有提示', async () => {
    const records = installFetch(
      backend(SPACE, (path, method) => {
        if (path === '/wiki/eval/answer-estimate' && method === 'POST')
          return jsonResponse(200, {
            data: {
              questions: 2,
              calls: 4,
              estimatedTokens: 9000,
              usedTokensToday: 0,
              dailyBudget: 0,
              exceedsBudget: false,
            },
          })
        return null
      }),
    )
    withClient(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('tab', { name: '评测' }))
    fireEvent.click(await screen.findByRole('button', { name: /估算回答评测费用/ }))
    expect(await screen.findByText(/不设每日上限/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('button', { name: '确认费用并开始' })).toBeNull()
    expect(records.some((r) => r.url === '/wiki/eval/answer-run')).toBe(false)

    fireEvent.change(screen.getByLabelText('问答集（JSON）'), { target: { value: '{' } })
    fireEvent.click(screen.getByRole('button', { name: /估算回答评测费用/ }))
    expect(await screen.findByText('问答集不是合法的 JSON。')).toBeTruthy()
  })

  test('回答评测报告：列名为无记忆 / 带维基记忆，不显示回测表；历史标明种类与 token', async () => {
    const { unmount } = withClient(<WikiEvalReport report={ANSWER_REPORT} />)
    const qa = screen.getByRole('table', { name: '问答集对比' })
    expect(within(qa).getByText('无记忆')).toBeTruthy()
    expect(within(qa).getByText('带维基记忆')).toBeTruthy()
    expect(within(qa).getByText(/回答评测（调用 AI）/)).toBeTruthy()
    expect(screen.queryByRole('table', { name: '计划回测' })).toBeNull()
    expect(screen.getByText(/用 fake-model 生成回答，共消耗约 1234 token/)).toBeTruthy()
    unmount()

    installFetch(
      backend(SPACE, (path) =>
        path === '/wiki/eval/runs' ? jsonResponse(200, list([ANSWER_REPORT])) : null,
      ),
    )
    withClient(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('tab', { name: '评测' }))
    expect(
      await screen.findByText(/回答评测：带维基记忆正确率 60%（无记忆 0%）· 1234 token/),
    ).toBeTruthy()
  })
})

describe('迁移 AI 同事记忆', () => {
  test('组织与项目空间的审阅者可迁移并看到结果；非审阅者与个人空间没有按钮', async () => {
    const records = installFetch(
      backend(SPACE, (path, method) =>
        path === '/wiki/spaces/7/import-copilot-memory' && method === 'POST'
          ? jsonResponse(200, { data: { imported: 2, skipped: 1, pageId: 3, revisionId: 4 } })
          : null,
      ),
    )
    const { unmount } = withClient(<WikiWorkspace scopeKind="organization" />)
    fireEvent.click(await screen.findByRole('button', { name: /迁移 AI 同事记忆/ }))
    expect(
      await screen.findByText(
        /已把 2 条 AI 同事记忆整理为「AI 同事记忆（迁移）」页的待审提议（跳过 1 条/,
      ),
    ).toBeTruthy()
    expect(records.filter((r) => r.url === '/wiki/spaces/7/import-copilot-memory')).toHaveLength(1)
    unmount()

    const project = { ...SPACE, id: 8, scopeKind: 'project' as const, scopeRefId: 9 }
    installFetch(
      backend(project, (path, method) =>
        path === '/wiki/spaces/8/import-copilot-memory' && method === 'POST'
          ? jsonResponse(200, { data: { imported: 0, skipped: 0, pageId: null, revisionId: null } })
          : null,
      ),
    )
    const second = withClient(<WikiWorkspace scopeKind="project" scopeRefId={9} />)
    fireEvent.click(await screen.findByRole('button', { name: /迁移 AI 同事记忆/ }))
    expect(await screen.findByText('没有可迁移的 AI 同事记忆。')).toBeTruthy()
    second.unmount()

    installFetch(backend({ ...project, canReview: false }))
    const third = withClient(<WikiWorkspace scopeKind="project" scopeRefId={9} />)
    await screen.findByRole('heading', { name: '组织维基' })
    expect(screen.queryByRole('button', { name: /迁移 AI 同事记忆/ })).toBeNull()
    third.unmount()

    installFetch(backend({ ...SPACE, id: 11, scopeKind: 'user', scopeRefId: 1 }))
    withClient(<WikiWorkspace scopeKind="user" scopeRefId={1} />)
    await screen.findByRole('button', { name: /从 AI 记忆导入偏好/ })
    expect(screen.queryByRole('button', { name: /迁移 AI 同事记忆/ })).toBeNull()
  })
})
