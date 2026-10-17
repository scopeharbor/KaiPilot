/**
 * v3-ui-next-settings-admin-domains W7 · tasks 7.6 —— 编译器路由管理页入口装配测试
 * （spec「管理后台平台运营与信任控制台」要求 2）。
 *
 * 覆盖：
 * - 页装配：有 `ai:compiler:routing:view` 时挂载工作区并请求 rules；
 * - 无权受限横幅且底层业务接口零请求（RL-06）；free 档渲染企业版锁定占位零请求；
 * - 三态闭环：骨架屏（aria-busy）/ 语义空态 / 错误重试；
 * - 精确档（precise）降级。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import NextAdminCompilerRoutingPage from '@/app/(next)/next/admin/compiler-routing/page'
import type { RoutingRuleView } from '@aiproj/types/compiler-dynamic-routing'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/admin/compiler-routing',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NextAdminCompilerRoutingPage />
    </QueryClientProvider>,
  )
}

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms))

function q<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector(selector)
  if (!node) throw new Error(`未找到元素：${selector}`)
  return node as T
}

function setAuth(
  permissions: string[],
  planTier: 'free' | 'team' | 'enterprise' | null = 'enterprise',
) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '系统管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

const SAMPLE_RULE: RoutingRuleView = {
  id: 'default-plan-v1',
  version: { major: 1, minor: 0 },
  compatibleContracts: { min: '1.0', max: '2.0' },
  scenarioKinds: ['default_plan'],
  allowedStageIds: ['intent_ingestion'],
  allowedSkippedStageIds: [],
  reasonCode: 'ROUTE_DEFAULT_PLAN',
  isDefault: true,
  enabled: true,
  source: 'code_default',
}

function routingBackend(handler?: () => Response) {
  return (path: string, method: string): Response | null => {
    if (path.endsWith('/ai/compiler/routing/rules') && method === 'GET') {
      if (handler) return handler()
      return jsonResponse(200, {
        data: {
          version: 'reg-v1',
          rules: [SAMPLE_RULE],
          ruleCount: 1,
        },
      })
    }
    return null
  }
}

beforeEach(() => {
  setAuth(['ai:compiler:routing:view'])
  useNextTrackStore.setState({ immersionTier: 'immersive' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('编译器路由管理页装配（tasks 7.6）', () => {
  test('授权用户：挂载工作区并请求 rules', async () => {
    const { records } = installFetchRouter(routingBackend())
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-compiler-routing-workspace]')).not.toBeNull(),
    )
    expect(records.some((r) => r.url.includes('/ai/compiler/routing/rules'))).toBe(true)
    await waitFor(() =>
      expect(document.querySelector('[data-routing-rule="default-plan-v1"]')).not.toBeNull(),
    )
  })

  test('无权（付费档）：受限横幅且底层业务接口零请求（RL-06）', async () => {
    setAuth(['task:view'], 'enterprise')
    const { records } = installFetchRouter(routingBackend())
    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-testid="compiler-routing-restricted"]')).not.toBeNull()
    expect(document.querySelector('[data-compiler-routing-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('无权（free 档）：企业版锁定占位且零请求', async () => {
    setAuth(['task:view'], 'free')
    const { records } = installFetchRouter(routingBackend())
    renderPage()

    expect(document.querySelector('[data-enterprise-locked]')).not.toBeNull()
    expect(document.querySelector('[data-testid="compiler-routing-locked"]')).not.toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('三态：骨架屏（aria-busy）→ 数据加载成功', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    installFetchRouter(
      routingBackend(() => {
        const response = jsonResponse(200, {
          data: {
            version: 'reg-v1',
            rules: [SAMPLE_RULE],
            ruleCount: 1,
          },
        })
        response.json = async () => {
          await gate
          return {
            data: {
              version: 'reg-v1',
              rules: [SAMPLE_RULE],
              ruleCount: 1,
            },
          }
        }
        return response
      }),
    )
    renderPage()

    const loading = document.querySelector('[data-routing-rules-loading]')
    expect(loading).not.toBeNull()
    expect(loading?.getAttribute('aria-busy')).toBe('true')

    release?.()
    await waitFor(() =>
      expect(document.querySelector('[data-routing-rule="default-plan-v1"]')).not.toBeNull(),
    )
  })

  test('错误态：500 → 错误卡「重新载入」重试闭环', async () => {
    let attempts = 0
    installFetchRouter(
      routingBackend(() => {
        attempts += 1
        if (attempts === 1) {
          return jsonResponse(500, {
            error: { code: 'INTERNAL_ERROR', message: 'rules fetch failed' },
          })
        }
        return jsonResponse(200, {
          data: {
            version: 'reg-v1',
            rules: [SAMPLE_RULE],
            ruleCount: 1,
          },
        })
      }),
    )
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-routing-rules-error]')).not.toBeNull())
    fireEvent.click(q('[data-routing-rules-retry]'))
    await waitFor(() =>
      expect(document.querySelector('[data-routing-rule="default-plan-v1"]')).not.toBeNull(),
    )
  })

  test('空态：规则总数为 0 → 渲染语义空态而非错误卡', async () => {
    installFetchRouter(
      routingBackend(() =>
        jsonResponse(200, {
          data: {
            version: 'reg-v1',
            rules: [],
            ruleCount: 0,
          },
        }),
      ),
    )
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-routing-rules-empty]')).not.toBeNull())
    expect(document.querySelector('[data-routing-rules-error]')).toBeNull()
  })

  test('精确档降级：precise 档剥离光晕类名', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    installFetchRouter(routingBackend())
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-compiler-routing-workspace]')).not.toBeNull(),
    )
    const workspace = q('[data-compiler-routing-workspace]')
    expect(workspace.getAttribute('data-immersion')).toBe('precise')
    expect(workspace.className).not.toContain('nx-space-atmosphere')
  })
})
