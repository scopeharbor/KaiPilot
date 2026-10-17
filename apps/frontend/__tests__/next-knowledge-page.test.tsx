/**
 * v3-ui-next-help-knowledge-domain W2 · tasks 2.8 —— 知识库页面装配、运营视图切换与
 * RBAC 测试（页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「四层知识库底册表格浏览与多维过滤」/「知识库运营视图与别名路由平滑接入」/
 * RBAC 守卫场景 + tasks 2.8）：
 * - /next/knowledge 初次加载：五状态并集账本拉取期间渲染骨架占位，成功后渲染底册行；
 * - 无 knowledge:view：渲染受限 EmptyState「无权限访问知识库」且业务请求零发出（RL-06）；
 * - knowledge:author 控制「新建知识」按钮物理显隐；knowledge:manage 控制行内治理出口；
 * - knowledge_memory_operating:view 控制「运营视图」切换按钮显隐；点击触发
 *   router.replace('/next/knowledge?view=operations')；
 * - ?view=operations + 运营权限 → 无缝切入既有 KnowledgeOperationsView（flag off 显示
 *   未启用占位，底册账本请求零发出）；view 参数但无运营权限 → 回落四层底册；
 * - 别名路由 /next/knowledge/operations：有运营权限渲染统一运营视图；无权限渲染受限
 *   警告卡片（引导返回四层知识浏览）且零请求；
 * - 组织隔离：详情 404 → 审查抽屉中性提示「未找到相关知识记录」。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import KnowledgePage from '@/app/(next)/next/knowledge/page'
import KnowledgeOperationsAliasPage from '@/app/(next)/next/knowledge/operations/page'
import type {
  KnowledgeItemLowSensitiveProjection,
  KnowledgeLayer,
  KnowledgeLifecycleStatus,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/knowledge',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))

// ---------------------------------------------------------------------------
// 会话 & 夹具
// ---------------------------------------------------------------------------
function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

let nextItemId = 1000
function makeItem(overrides: Partial<KnowledgeItemLowSensitiveProjection> = {}) {
  return {
    id: nextItemId++,
    layer: 'L1' as KnowledgeLayer,
    title: 'API 错误处理规范',
    status: 'active' as KnowledgeLifecycleStatus,
    domain: '接口架构',
    purpose: '参考',
    complexity: '初级',
    provenance: {
      sources: [{ layer: 'L1' as KnowledgeLayer, sourceId: 's1', title: '团队工程规范 V2' }],
    },
    isSynthetic: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } satisfies KnowledgeItemLowSensitiveProjection
}

function seedLedger() {
  nextItemId = 1000
  return [
    makeItem({ id: 1, layer: 'L1', title: 'API 错误处理规范', status: 'active' }),
    makeItem({ id: 2, layer: 'L2', title: '双机房割接观察记录', status: 'pending' }),
    makeItem({
      id: 3,
      layer: 'L3',
      title: '合成压测案例：千任务甘特重排',
      status: 'active',
      isSynthetic: true,
    }),
    makeItem({ id: 4, layer: 'L4', title: 'Q3 真实排程耗时分布', status: 'deprecated' }),
    makeItem({ id: 5, layer: 'L2', title: '风险例会迟到观察', status: 'draft' }),
  ]
}

// ---------------------------------------------------------------------------
// 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

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
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (path: string, method: string) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = await route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function createBackend() {
  const ledger = seedLedger()
  const detail404 = new Set<number>()
  return {
    store: ledger,
    route: (path: string, method: string): Response | null => {
      // 底册账本：/knowledge?status=…（五状态并集遍历）
      const listMatch = path.startsWith('/knowledge?')
      if (listMatch && method === 'GET') {
        const qs = new URLSearchParams(path.slice('/knowledge?'.length))
        const status = qs.get('status')
        const page = Number(qs.get('page') ?? 1)
        const perPage = Number(qs.get('perPage') ?? 100)
        const rows = status ? ledger.filter((item) => item.status === status) : ledger
        const totalPages = Math.max(1, Math.ceil(rows.length / perPage))
        const slice = rows.slice((page - 1) * perPage, page * perPage)
        return jsonResponse(200, {
          data: slice,
          meta: { total: rows.length, page, perPage, totalPages },
        })
      }
      // 详情
      const detailMatch = path.match(/^\/knowledge\/(\d+)$/)
      if (detailMatch && method === 'GET') {
        const id = Number(detailMatch[1])
        if (detail404.has(id)) {
          return jsonResponse(404, {
            error: { code: 'RESOURCE_NOT_FOUND', message: '知识记录不存在或不属于当前组织' },
          })
        }
        const item = ledger.find((entry) => entry.id === id)
        if (!item) {
          return jsonResponse(404, {
            error: { code: 'RESOURCE_NOT_FOUND', message: '知识记录不存在或不属于当前组织' },
          })
        }
        return jsonResponse(200, {
          data: {
            ...item,
            content: '# 正文\n\n示例内容',
            provenance: { ...item.provenance, reviewHistory: [] },
          },
        })
      }
      return null
    },
    markDetail404: (id: number) => detail404.add(id),
  }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  window.history.replaceState({}, '', '/next/knowledge')
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('KnowledgePage：/next/knowledge 装配与 RBAC（tasks 2.8）', () => {
  test('具备 knowledge:view：骨架屏占位 → 底册行渲染，author 显示新建按钮、manage 显示治理入口', async () => {
    setAuth(['knowledge:view', 'knowledge:author', 'knowledge:manage'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<KnowledgePage />)

    // 首次加载：5 行骨架占位（aria-busy）
    expect(document.querySelector('[data-knowledge-ledger-skeleton]')).not.toBeNull()
    expect(
      document.querySelector('[data-knowledge-ledger-skeleton]')?.getAttribute('aria-busy'),
    ).toBe('true')
    await waitFor(() => expect(document.querySelectorAll('[data-knowledge-row]')).toHaveLength(5))
    // 头部操作：新建知识（author）与运营视图切换（需 ops 权限——本用例未授予）
    expect(document.querySelector('[data-knowledge-create-open]')).not.toBeNull()
    expect(document.querySelector('[data-knowledge-operations-toggle]')).toBeNull()
    // 底册完整（L3 合成行带 SYNTHETIC 徽标）
    expect(screen.getByText('API 错误处理规范')).toBeInTheDocument()
    expect(
      document.querySelector('[data-knowledge-row="3"] [data-knowledge-synthetic-badge]'),
    ).not.toBeNull()
    // 治理权限：pending 行可见确认转正入口
    expect(
      document.querySelector('[data-knowledge-row="2"] [data-knowledge-row-confirm]'),
    ).not.toBeNull()
    expect(document.querySelectorAll('[data-knowledge-row-status]').length).toBeGreaterThan(0)
  })

  test('无 knowledge:view：受限 EmptyState 渲染且业务请求零发出（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<KnowledgePage />)

    expect(document.querySelector('[data-knowledge-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('无权限访问知识库')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })

  test('无 knowledge:author：新建按钮物理隐藏；无 knowledge:manage：行内无确认/推进出口', async () => {
    setAuth(['knowledge:view'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<KnowledgePage />)

    await waitFor(() => expect(document.querySelectorAll('[data-knowledge-row]')).toHaveLength(5))
    expect(document.querySelector('[data-knowledge-create-open]')).toBeNull()
    expect(document.querySelector('[data-knowledge-row-confirm]')).toBeNull()
    expect(document.querySelector('[data-knowledge-row-status]')).toBeNull()
  })

  test('具备运营权限：切换按钮可见，点击触发 router.replace 至 ?view=operations', async () => {
    setAuth(['knowledge:view', 'knowledge:author', 'knowledge_memory_operating:view'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<KnowledgePage />)
    await waitFor(() => expect(document.querySelectorAll('[data-knowledge-row]')).toHaveLength(5))
    const toggle = document.querySelector('[data-knowledge-operations-toggle]')
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle as Element)
    expect(navMock.replace).toHaveBeenCalledTimes(1)
    expect(navMock.replace).toHaveBeenCalledWith('/next/knowledge?view=operations')
  })

  test('无运营权限：切换按钮隐藏，view=operations 参数视为无效回落四层底册', async () => {
    setAuth(['knowledge:view', 'knowledge:author'])
    searchParamsMock.value = new URLSearchParams('view=operations')
    window.history.replaceState({}, '', '/next/knowledge?view=operations')
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<KnowledgePage />)

    expect(document.querySelector('[data-knowledge-operations-toggle]')).toBeNull()
    await waitFor(() => expect(document.querySelector('[data-knowledge-workspace]')).not.toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-knowledge-row]')).toHaveLength(5))
    expect(document.querySelector('[data-knowledge-operations-mode]')).toBeNull()
  })
})

describe('KnowledgePage：?view=operations 运营视图切换（tasks 2.8 / spec 平滑接入）', () => {
  test('view=operations + 运营权限：切入统一运营视图，四层账本请求零发出', async () => {
    setAuth(['knowledge:view', 'knowledge:author', 'knowledge_memory_operating:view'])
    searchParamsMock.value = new URLSearchParams('view=operations')
    window.history.replaceState({}, '', '/next/knowledge?view=operations')
    const { records } = installFetchRouter(() => null)
    renderPage(<KnowledgePage />)

    await waitFor(() =>
      expect(document.querySelector('[data-knowledge-operations-mode]')).not.toBeNull(),
    )
    // 返回出口
    expect(document.querySelector('[data-knowledge-operations-back]')).not.toBeNull()
    // 运营层视图本体（flag off → 未启用占位；flag on → 运营页）——两者皆非四层底册
    const operating =
      document.querySelector('[data-testid="feature-off"]') ??
      document.querySelector('[data-testid="knowledge-memory-operating-page"]')
    expect(operating).not.toBeNull()
    // 不挂载四层底册：无任何 /knowledge 账本请求
    expect(document.querySelector('[data-knowledge-workspace]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })
})

describe('KnowledgeOperationsAliasPage：/next/knowledge/operations 别名路由（tasks 2.7/2.8）', () => {
  test('具备运营权限：渲染统一运营视图（与主路由同源）', async () => {
    setAuth(['knowledge_memory_operating:view'])
    window.history.replaceState({}, '', '/next/knowledge/operations')
    const { records } = installFetchRouter(() => null)
    renderPage(<KnowledgeOperationsAliasPage />)

    const operating =
      document.querySelector('[data-testid="feature-off"]') ??
      document.querySelector('[data-testid="knowledge-memory-operating-page"]')
    await waitFor(() => expect(operating).not.toBeNull())
    expect(document.querySelector('[data-knowledge-operations-permission-fallback]')).toBeNull()
    expect(records).toHaveLength(0)
  })

  test('无运营权限：受限警告卡片 + 返回四层知识浏览引导，零业务请求', async () => {
    setAuth(['knowledge:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<KnowledgeOperationsAliasPage />)

    expect(document.querySelector('[data-knowledge-operations-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('无权限访问知识库运营视图')).toBeInTheDocument()
    const back = document.querySelector('[data-knowledge-operations-back-to-browse]')
    expect(back).not.toBeNull()
    fireEvent.click(back as Element)
    expect(navMock.push).toHaveBeenCalledWith('/next/knowledge')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })
})

describe('KnowledgePage：组织隔离中性 404（RL-05，tasks 2.8）', () => {
  test('点击条目打开审查抽屉，详情跨租户 404 → 中性提示「未找到相关知识记录」', async () => {
    setAuth(['knowledge:view', 'knowledge:manage'])
    const backend = createBackend()
    backend.markDetail404(3)
    const { records } = installFetchRouter(backend.route)
    renderPage(<KnowledgePage />)

    await waitFor(() => expect(document.querySelectorAll('[data-knowledge-row]')).toHaveLength(5))
    fireEvent.click(document.querySelector('[data-knowledge-row="3"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-knowledge-review-drawer]')).not.toBeNull(),
    )
    await waitFor(() => expect(screen.getByText('未找到相关知识记录')).toBeInTheDocument())
    // 只发过账本与详情请求；中性文案不含后端原始 message
    const detailRequests = records.filter((r) => r.url === '/knowledge/3')
    expect(detailRequests).toHaveLength(1)
    expect(document.body.textContent).not.toContain('不属于当前组织')
  })
})
