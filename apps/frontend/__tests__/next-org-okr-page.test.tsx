/**
 * v3-ui-next-org-portfolio-domains W2 · tasks 2.5 —— OKR 层级管理页面装配与 RBAC
 * 测试（spec「OKR 层级管理与达成仪表盘（幽灵守卫修复）」页面场景）。
 *
 * 覆盖：
 * - 无 org:view/portfolio:view：受限横幅（data-permission-fallback）且 /okrs
 *   cycles/tree 底层接口零请求（RL-06）；页面不存在 `okr:view` 幽灵守卫引用；
 * - 未选择组织：中性引导态且零请求（RL-05 静默空转修复）；
 * - 授权装配：org:view 与仅 portfolio:view（PM 兜底）两径完整装配，cycles/tree
 *   双 GET 正常、零写请求；
 * - 面包屑回显：坐标探针路径段 `/next/organization/okrs ·`（精确标签随 W10
 *   坐标注册定案为「OKR 层级管理」，页面内标题同源锁定语义）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrganizationOkrsPage from '@/app/(next)/next/organization/okrs/page'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'
import { makeOkrCycle, makeOkrKeyResult, makeOkrObjective } from '@aiproj/types'
import type { OkrObjectiveTree } from '@aiproj/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话 & 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'member@example.com',
      fullName: '组织成员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'member' }],
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

interface RequestRecord {
  method: string
  url: string
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

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
function makeTree(): OkrObjectiveTree[] {
  return [
    {
      objective: makeOkrObjective({
        id: 1,
        title: '提升用户满意度',
        progress: 72,
        status: 'active',
        ownerId: 3,
      }),
      children: [
        {
          objective: makeOkrObjective({
            id: 2,
            title: '缩短核心路径响应',
            progress: 40,
            status: 'active',
          }),
          children: [],
          keyResults: [],
          alignments: [],
          evidence: [],
        },
      ],
      keyResults: [
        makeOkrKeyResult({
          id: 11,
          title: 'NPS 提升至 60',
          baselineValue: 30,
          targetValue: 60,
          currentValue: 50,
          status: 'active',
        }),
      ],
      alignments: [],
      evidence: [],
    },
  ]
}

function createBackend() {
  const cycles = [
    makeOkrCycle({ id: 1, title: '2026 Q3' }),
    makeOkrCycle({ id: 2, title: '2026 Q4', status: 'draft' }),
  ]
  const tree = makeTree()
  const route = (path: string, method: string): Response | null => {
    if (path === '/organizations/1/okrs/cycles' && method === 'GET') {
      return jsonResponse(200, {
        data: cycles,
        meta: { total: 2, page: 1, perPage: 50, totalPages: 1 },
      })
    }
    if (path.startsWith('/organizations/1/okrs/tree') && method === 'GET') {
      return jsonResponse(200, {
        data: tree,
        meta: { totalNodes: 2, maxDepth: 2, truncated: false, warnings: [] },
      })
    }
    return null
  }
  return { route }
}

/** 顶栏坐标回显探针（镜像 NextAppShell 消费公式）。 */
function BreadcrumbEchoProbe({ pathname }: { pathname: string }) {
  return <span data-coordinate-echo>{resolveSpaceBreadcrumb(pathname)}</span>
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  setAuth(['org:view'])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// 权限与组织上下文守卫（零请求）
// ---------------------------------------------------------------------------
describe('OrganizationOkrsPage：RBAC 守卫与组织上下文', () => {
  test('无 org:view 与 portfolio:view：受限横幅渲染且 /okrs 接口零请求', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<OrganizationOkrsPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看组织 OKR 的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-okr-workbench]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('未选择组织：中性引导态渲染且零请求', async () => {
    // 有效租户缺失（无组织成员关系 + JWT 无组织声明）→ 引导态，绝不静默空转。
    useAuthStore.setState({
      user: {
        id: 9,
        email: 'solo@example.com',
        fullName: '未入组成员',
        organizations: [],
      },
      currentOrganizationId: null,
      permissions: ['org:view'],
    })
    const { records } = installFetchRouter(() => null)
    renderPage(<OrganizationOkrsPage />)

    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await settle()
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 授权装配（org:view / portfolio:view 兜底）
// ---------------------------------------------------------------------------
describe('OrganizationOkrsPage：授权用户完整装配', () => {
  test('org:view 成员：cycles 与 tree 双 GET，目标树渲染，零写请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<OrganizationOkrsPage />)

    await waitFor(() => expect(document.querySelector('[data-okr-workbench]')).not.toBeNull())
    expect(screen.getByRole('heading', { name: 'OKR 层级管理' })).toBeInTheDocument()
    // 树行（O 行 2 + KR 行 1）
    await waitFor(() =>
      expect(document.querySelectorAll('[data-okr-row-kind="objective"]')).toHaveLength(2),
    )
    expect(document.querySelectorAll('[data-okr-row-kind="key_result"]')).toHaveLength(1)
    expect(screen.getByText('提升用户满意度')).toBeInTheDocument()

    await waitFor(() => {
      const cycleGets = records.filter(
        (record) => record.url === '/organizations/1/okrs/cycles' && record.method === 'GET',
      )
      const treeGets = records.filter((record) =>
        record.url.startsWith('/organizations/1/okrs/tree'),
      )
      expect(cycleGets.length).toBeGreaterThanOrEqual(1)
      expect(treeGets.length).toBeGreaterThanOrEqual(1)
    })
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('仅 portfolio:view 的 PM：经任一集合兜底准入（幽灵守卫修复回归）', async () => {
    setAuth(['portfolio:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<OrganizationOkrsPage />)

    await waitFor(() => expect(document.querySelector('[data-okr-workbench]')).not.toBeNull())
    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    await waitFor(() =>
      expect(records.some((record) => record.url.startsWith('/organizations/1/okrs/tree'))).toBe(
        true,
      ),
    )
  })

  test('面包屑回显：坐标探针路径段 /next/organization/okrs ·（标签随坐标注册定案）', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(
      <>
        <OrganizationOkrsPage />
        <BreadcrumbEchoProbe pathname="/next/organization/okrs" />
      </>,
    )
    await waitFor(() => expect(document.querySelector('[data-okr-workbench]')).not.toBeNull())

    const echo = document.querySelector('[data-coordinate-echo]')
    expect(echo?.textContent).toMatch(/^\/next\/organization\/okrs ·/)
    // 页面内标题与坐标标签语义同源锁定「OKR 层级管理」
    expect(document.querySelector('[data-okr-workbench-title]')?.textContent).toBe('OKR 层级管理')
  })
})
