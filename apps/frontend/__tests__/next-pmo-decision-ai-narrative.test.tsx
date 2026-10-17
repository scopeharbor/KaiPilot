/**
 * v3-ui-next-pmo-domain W6 · tasks 6.8 —— 决策 AI 叙述只读辅助测试
 * （spec「决策 AI 叙述只读辅助」场景）。
 *
 * 覆盖：
 * - 无 pmo_decision:request_ai：入口按钮物理隐藏（RL-06）；
 * - 显式触发：点击「生成 AI 叙述」→ 浮层展示常驻免责声明 → POST
 *   .../ai/narrative 恰好一次（生成中态）→ 叙述长文 + provider/hash 元信息；
 * - 重新生成 = 再一次显式触发（计数 +1）；关闭不产生任何状态写（RL-01）；
 * - fallback/isolated 诚实降级（无正文时展示提示而非伪造 AI 输出）；
 * - 失败 → 错误态 + 重试闭环。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoDecisionDetailPage from '@/app/(next)/next/pmo/decisions/[decisionId]/page'
import {
  pmoDecisionSmallCaseFixture,
  pmoDecisionOptionFixtures,
  pmoDecisionSnapshotSummaryFixture,
} from '@aiproj/types'
import type { PmoDecisionCaseDTO } from '@aiproj/types'

const navMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navMocks.replace, push: navMocks.push, back: navMocks.back }),
  useParams: () => ({ decisionId: '101' }),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  path: string
  body: string | null
}

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 7,
      email: 'pm@example.com',
      fullName: '项目经理',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(
  route: (path: string, method: string, body: string | null) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({
      method,
      path: path.split('?')[0] ?? path,
      body: init?.body ? String(init.body) : null,
    })
    const matched = route(records.at(-1)!.path, method, records.at(-1)!.body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

// ---------------------------------------------------------------------------
// 后端（case under-review + 可变 ai 响应）
// ---------------------------------------------------------------------------
const CASE_PATH = '/organizations/1/pmo/decision-workbench/cases/101'

function aiBackend(
  options: {
    narrativeMode?: 'ok' | 'fallback' | 'isolated' | 'error'
    status?: PmoDecisionCaseDTO['status']
  } = {},
) {
  const state = {
    mode: options.narrativeMode ?? 'ok',
    status: options.status ?? 'under-review',
  }
  const route = (path: string, method: string, body: string | null): Response | null => {
    if (path === CASE_PATH && method === 'GET') {
      return jsonResponse(200, {
        data: {
          ...pmoDecisionSmallCaseFixture(),
          status: state.status as PmoDecisionCaseDTO['status'],
        },
      })
    }
    if (path === CASE_PATH + '/options' && method === 'GET') {
      return jsonResponse(200, { data: pmoDecisionOptionFixtures() })
    }
    if (path === CASE_PATH + '/positions' && method === 'GET') {
      return jsonResponse(200, { data: [] })
    }
    if (path === CASE_PATH + '/evidence/snapshots' && method === 'GET') {
      return jsonResponse(200, { data: [pmoDecisionSnapshotSummaryFixture()] })
    }
    if (path === CASE_PATH + '/comparison' && method === 'GET') {
      return jsonResponse(200, {
        data: {
          caseId: 101,
          baselineOptionId: 1,
          candidateOptionId: 2,
          cells: [],
          findings: [],
          lensVersions: [],
          hasWinnerScore: false,
        },
      })
    }
    if (path === CASE_PATH + '/outcomes' && method === 'GET') {
      return jsonResponse(200, { data: [] })
    }
    if (path === CASE_PATH + '/handoffs' && method === 'GET') {
      return jsonResponse(200, { data: [] })
    }
    if (path === CASE_PATH + '/ai/narrative' && method === 'POST') {
      const payload = JSON.parse(body ?? '{}')
      expect(payload).toEqual({})
      if (state.mode === 'error') {
        return jsonResponse(503, {
          error: { code: 'AI_SERVICE_ERROR', message: '模型服务暂时不可用' },
        })
      }
      if (state.mode === 'fallback') {
        return jsonResponse(200, {
          data: {
            status: 'fallback',
            narrative: null,
            finding: {
              code: 'FALLBACK',
              severity: 'info',
              message: '模型不可用，已回退确定性摘要',
            },
            provider: 'mock',
            outputHash: 'hash-fallback',
          },
        })
      }
      if (state.mode === 'isolated') {
        return jsonResponse(200, {
          data: {
            status: 'isolated',
            narrative: null,
            finding: { code: 'ISOLATED', severity: 'warning', message: '模型输出未通过边界校验' },
            provider: 'mock',
            outputHash: 'hash-isolated',
          },
        })
      }
      return jsonResponse(200, {
        data: {
          status: 'ok',
          narrative:
            '综合组合层证据与现有立场，本议题的核心取舍在于短期交付稳定性与长期结构优化。建议在人工评审中把约束条件与受影响项目再核对一遍，并确认立场记录完整后再进入结论环节。\n本段为讨论性叙述，不构成任何自动执行动作。',
          finding: null,
          provider: 'mock-provider',
          outputHash: 'hash-ok-001',
        },
      })
    }
    return null
  }
  return { route, state }
}

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PmoDecisionDetailPage />
    </QueryClientProvider>,
  )
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  vi.clearAllMocks()
  setAuth([
    'pmo_decision:view',
    'pmo_decision:manage',
    'pmo_decision:decide',
    'pmo_decision:request_ai',
  ])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
describe('AI 叙述只读辅助（RL-01）', () => {
  test('无 pmo_decision:request_ai：入口隐藏且零 AI 请求', async () => {
    setAuth(['pmo_decision:view', 'pmo_decision:manage', 'pmo_decision:decide'])
    const backend = aiBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-detail-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-decision-ai-open]')).toBeNull()
    await settle()
    expect(
      records.some((record) => record.method === 'POST' && record.path.endsWith('/ai/narrative')),
    ).toBe(false)
  })

  test('显式点击 → 免责声明 + 生成中 → 叙述长文与元信息；只读不改变任何业务状态', async () => {
    const backend = aiBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-open]')).not.toBeNull(),
    )
    const aiPostsBefore = records.filter((record) => record.path.endsWith('/ai/narrative')).length

    fireEvent.click(document.querySelector('[data-pmo-decision-ai-open]') as HTMLElement)

    // 免责声明常驻
    expect(document.querySelector('[data-pmo-decision-ai-panel]')).not.toBeNull()
    expect(screen.getByText(/免责声明/)).toBeInTheDocument()
    expect(screen.getByText(/未经人工确认不会执行任何变更/)).toBeInTheDocument()

    await waitFor(() => {
      const posts = records.filter(
        (record) => record.method === 'POST' && record.path.endsWith('/ai/narrative'),
      )
      expect(posts.length).toBe(aiPostsBefore + 1)
    })
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-narrative]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-decision-ai-narrative]')?.textContent).toContain(
      '本段为讨论性叙述，不构成任何自动执行动作。',
    )
    expect(document.querySelector('[data-pmo-decision-ai-status="ok"]')?.textContent).toContain(
      'AI 叙述',
    )
    expect(document.querySelector('[data-pmo-decision-ai-body]')?.textContent).toContain(
      'provider mock-provider',
    )
    expect(document.querySelector('[data-pmo-decision-ai-body]')?.textContent).toContain(
      'hash hash-ok-001',
    )
  })

  test('关闭后零状态写请求（RL-01）；重新生成为显式第二次触发', async () => {
    const backend = aiBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-open]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-pmo-decision-ai-open]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-narrative]')).not.toBeNull(),
    )
    const afterFirst = records.filter(
      (record) => record.method === 'POST' && record.path.endsWith('/ai/narrative'),
    ).length
    expect(afterFirst).toBe(1)

    // 重新生成 = 显式第二次触发
    fireEvent.click(document.querySelector('[data-pmo-decision-ai-regenerate]') as HTMLElement)
    await waitFor(() => {
      expect(
        records.filter(
          (record) => record.method === 'POST' && record.path.endsWith('/ai/narrative'),
        ).length,
      ).toBe(2)
    })

    // 关闭：不产生任何额外写（仅 narrative POST 计数保持不变）
    fireEvent.click(document.querySelector('[data-pmo-decision-ai-close]') as HTMLElement)
    await waitFor(() => expect(document.querySelector('[data-pmo-decision-ai-panel]')).toBeNull())
    await settle()
    expect(
      records.filter((record) => record.method === 'POST' && record.path.endsWith('/ai/narrative'))
        .length,
    ).toBe(2)
    // 除 ai/narrative 外全程无其它写请求
    expect(
      records.filter((record) => record.method === 'POST' && !record.path.endsWith('/ai/narrative'))
        .length,
    ).toBe(0)
  })

  test('fallback / isolated：诚实降级提示，不伪造 AI 正文', async () => {
    const backend = aiBackend({ narrativeMode: 'fallback' })
    installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-open]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-pmo-decision-ai-open]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-status="fallback"]')).not.toBeNull(),
    )
    expect(screen.getByText(/模型不可用，已回退确定性摘要/)).toBeInTheDocument()
    expect(document.querySelector('[data-pmo-decision-ai-narrative]')).toBeNull()
  })

  test('生成失败：错误态呈现 + 重试成功闭环', async () => {
    const backend = aiBackend({ narrativeMode: 'error' })
    installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-open]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-pmo-decision-ai-open]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-error]')).not.toBeNull(),
    )
    expect(screen.getByText('模型服务暂时不可用')).toBeInTheDocument()

    backend.state.mode = 'ok'
    fireEvent.click(document.querySelector('[data-pmo-decision-ai-retry]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-narrative]')).not.toBeNull(),
    )
  })

  test('终态（decided）议题同样可显式请求叙述，且不触发任何业务写', async () => {
    const backend = aiBackend({ status: 'decided' })
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-open]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-pmo-decision-ai-open]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-ai-narrative]')).not.toBeNull(),
    )
    await settle()
    expect(
      records.filter((record) => record.method === 'POST' && !record.path.endsWith('/ai/narrative'))
        .length,
    ).toBe(0)
  })
})
