/**
 * v3-ui-next-pmo-domain W6 · tasks 6.7 —— PMO 决策工作台队列页装配测试
 * （spec「决策工作台队列与议题建立」场景）。
 *
 * 覆盖：
 * - RBAC：无 pmo_decision:view → 受限横幅（data-permission-fallback）且决策接口
 *   零请求（RL-06）；orgId 未水合 → 中性引导态零请求；
 * - URL 过滤契约：parseDecisionUrlFilters / serializeDecisionUrlFilters 往返；
 *   状态 chips 写回 ?status=；行点击携带过滤串进入详情；分页写回 ?page= 且可还原；
 * - 队列三态：骨架（aria-busy）/ 空态 / 500 错误重试闭环；
 * - 建卡：无 pmo_decision:manage 时入口隐藏（RL-06）；manage 用户经对话框提交
 *   POST .../cases（ownerId = 当前用户，审计 actor），成功后关闭并刷新列表；
 *   失败保留输入并回显服务端错误。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoDecisionsPage from '@/app/(next)/next/pmo/decisions/page'
import { parseDecisionUrlFilters, serializeDecisionUrlFilters } from '@/lib/api/decision-workbench'
import type { PmoDecisionCaseDTO } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock（URL 状态 = 队列契约的单一事实源）
// ---------------------------------------------------------------------------
const navMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  searchParams: new URLSearchParams(''),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navMocks.replace, push: navMocks.push, back: navMocks.back }),
  useSearchParams: () => navMocks.searchParams,
}))

// ---------------------------------------------------------------------------
// 会话 & 伪后端
// ---------------------------------------------------------------------------
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
    const record: RequestRecord = {
      method,
      path: path.split('?')[0] ?? path,
      body: init?.body ? String(init.body) : null,
    }
    records.push(record)
    const matched = route(record.path, method, record.body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function makeCase(overrides: Partial<PmoDecisionCaseDTO> = {}): PmoDecisionCaseDTO {
  return {
    id: 101,
    organizationId: 1,
    title: '是否调整 Q4 跨项目资源投入方向',
    decisionQuestion: '下季度是否应把资源从项目 A 调往项目 B？',
    scopeSummary: '项目 A、项目 B · 2026-Q4',
    ownerId: 7,
    dueDate: '2026-11-30T00:00:00.000Z',
    status: 'under-review',
    revision: 3,
    supersededByCaseId: null,
    supersedesCaseId: null,
    createdBy: 7,
    updatedBy: 7,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-25T01:00:00.000Z',
    ...overrides,
  }
}

function createBackend(options: { rows?: PmoDecisionCaseDTO[]; totalPages?: number } = {}) {
  const rows = options.rows ?? [
    makeCase(),
    makeCase({ id: 102, title: '是否延长项目 C 验收窗口', status: 'draft' }),
  ]
  const totalPages = options.totalPages ?? 1
  const created: PmoDecisionCaseDTO[] = []
  const route = (path: string, method: string, body: string | null): Response | null => {
    if (path === '/organizations/1/pmo/decision-workbench/cases' && method === 'GET') {
      return jsonResponse(200, {
        data: [...created, ...rows],
        meta: { total: rows.length + created.length, page: 1, perPage: 20, totalPages },
      })
    }
    if (path === '/organizations/1/pmo/decision-workbench/cases' && method === 'POST') {
      const payload = JSON.parse(body ?? '{}') as { title: string; decisionQuestion: string }
      const record = makeCase({
        id: 200 + created.length + 1,
        title: payload.title,
        decisionQuestion: payload.decisionQuestion,
        status: 'draft',
      })
      created.push(record)
      return jsonResponse(201, { data: record })
    }
    return null
  }
  return { route }
}

/** 单树渲染；remount = 卸载旧树后以同容器重新挂载（用于 URL 参数变更场景）。 */
function mountApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let view = render(
    <QueryClientProvider client={client}>
      <PmoDecisionsPage />
    </QueryClientProvider>,
  )
  return {
    remount: () => {
      view.unmount()
      view = render(
        <QueryClientProvider client={client}>
          <PmoDecisionsPage />
        </QueryClientProvider>,
      )
      return view
    },
    ...view,
  }
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  vi.clearAllMocks()
  navMocks.searchParams = new URLSearchParams('')
  setAuth(['pmo_decision:view', 'pmo_decision:manage'])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// URL 过滤契约（纯函数往返）
// ---------------------------------------------------------------------------
describe('决策队列 URL 过滤契约（parse/serialize 往返）', () => {
  test('parseDecisionUrlFilters 从 URL 解析状态/分页/排序', () => {
    const filters = parseDecisionUrlFilters({
      status: 'draft,under-review',
      page: '2',
      perPage: '50',
      sort: 'dueDate',
      order: 'asc',
    })
    expect(filters.status).toEqual(['draft', 'under-review'])
    expect(filters.page).toBe(2)
    expect(filters.perPage).toBe(50)
    expect(filters.sort).toBe('dueDate')
    expect(filters.order).toBe('asc')
  })

  test('serializeDecisionUrlFilters 省略 undefined 与 page=1', () => {
    expect(serializeDecisionUrlFilters({ status: 'under-review', page: 1 })).toBe(
      '?status=under-review',
    )
    expect(serializeDecisionUrlFilters({ status: 'draft', page: 2 })).toBe('?status=draft&page=2')
    expect(serializeDecisionUrlFilters({})).toBe('')
  })
})

// ---------------------------------------------------------------------------
// RBAC 守卫与组织上下文（零请求）
// ---------------------------------------------------------------------------
describe('PmoDecisionsPage：RBAC 守卫与组织上下文', () => {
  test('无 pmo_decision:view：受限横幅渲染且决策接口零请求（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PmoDecisionsPage />
      </QueryClientProvider>,
    )

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看 PMO 决策工作台的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-pmo-decisions-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('orgId 未水合：中性引导态渲染且零请求', async () => {
    useAuthStore.setState({
      user: {
        id: 9,
        email: 'solo@example.com',
        fullName: '未入组成员',
        organizations: [],
      },
      currentOrganizationId: null,
      permissions: ['pmo_decision:view'],
    })
    const { records } = installFetchRouter(() => null)
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PmoDecisionsPage />
      </QueryClientProvider>,
    )

    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await settle()
    expect(records).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 授权装配：队列渲染 + URL 过滤契约 + 行下钻
// ---------------------------------------------------------------------------
describe('PmoDecisionsPage：授权用户队列装配与筛选', () => {
  test('队列加载：骨架 → 行渲染（状态徽标双通道）→ 全程 GET 请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    mountApp()

    expect(document.querySelector('[data-pmo-decisions-skeleton]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-decisions-skeleton]')?.getAttribute('aria-busy')).toBe(
      'true',
    )

    await waitFor(() =>
      expect(document.querySelectorAll('[data-pmo-decision-row]')).toHaveLength(2),
    )
    expect(screen.getByText('是否调整 Q4 跨项目资源投入方向')).toBeInTheDocument()
    expect(screen.getByText('是否延长项目 C 验收窗口')).toBeInTheDocument()
    expect(document.querySelector('[data-case-status="under-review"]')?.textContent).toBe('审查中')
    expect(document.querySelector('[data-case-status="draft"]')?.textContent).toBe('草稿')

    expect(
      records.some(
        (record) =>
          record.method === 'GET' &&
          record.path === '/organizations/1/pmo/decision-workbench/cases',
      ),
    ).toBe(true)
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('状态 chip 点击写回 ?status=（serialize 契约），再点取消回全部', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    const app = mountApp()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-pmo-decision-row]')).toHaveLength(2),
    )

    fireEvent.click(screen.getByRole('tab', { name: '审查中' }))
    await waitFor(() => {
      const lastCall = navMocks.replace.mock.calls.at(-1)?.[0] as string | undefined
      expect(lastCall).toBe('/next/pmo/decisions?status=under-review')
    })

    // URL 提交生效后（模拟导航返回新 searchParams）再点同态 chip = 取消筛选
    navMocks.searchParams = new URLSearchParams('status=under-review')
    app.remount()
    await waitFor(() => {
      expect(
        document
          .querySelector('[data-case-filter-status="under-review"]')
          ?.getAttribute('aria-selected'),
      ).toBe('true')
    })
    fireEvent.click(screen.getByRole('tab', { name: '审查中' }))
    await waitFor(() => {
      const lastCall = navMocks.replace.mock.calls.at(-1)?.[0] as string | undefined
      expect(lastCall).toBe('/next/pmo/decisions')
    })
  })

  test('URL 携带 status 进入：chip 激活态还原；行点击携带过滤串进入详情', async () => {
    navMocks.searchParams = new URLSearchParams('status=under-review')
    const backend = createBackend()
    installFetchRouter(backend.route)
    mountApp()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-pmo-decision-row]')).toHaveLength(2),
    )
    expect(
      document
        .querySelector('[data-case-filter-status="under-review"]')
        ?.getAttribute('aria-selected'),
    ).toBe('true')

    const firstRow = document.querySelector('[data-pmo-decision-row]') as HTMLElement
    fireEvent.click(firstRow)
    await waitFor(() => {
      const lastCall = navMocks.push.mock.calls.at(-1)?.[0] as string | undefined
      expect(lastCall).toBe('/next/pmo/decisions/101?status=under-review')
    })
  })

  test('分页：下一页写回 ?page=2，URL 还原后页码回显', async () => {
    const backend = createBackend({ totalPages: 3 })
    installFetchRouter(backend.route)
    const app = mountApp()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decisions-pagination]')).not.toBeNull(),
    )
    expect(screen.getByText(/第 1 \/ 3 页/)).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-pmo-decisions-next-page]') as HTMLElement)
    await waitFor(() => {
      const lastCall = navMocks.replace.mock.calls.at(-1)?.[0] as string | undefined
      expect(lastCall).toBe('/next/pmo/decisions?page=2')
    })

    navMocks.searchParams = new URLSearchParams('page=2')
    app.remount()
    await waitFor(() => expect(screen.getByText(/第 2 \/ 3 页/)).toBeInTheDocument())
  })

  test('空态与 500 错误重试闭环', async () => {
    const emptyBackend = createBackend({ rows: [] })
    installFetchRouter(emptyBackend.route)
    mountApp()
    await waitFor(() => expect(document.querySelector('[data-pmo-decisions-empty]')).not.toBeNull())
    resetFetchRouter()

    let fail = true
    const okBackend = createBackend()
    const { records } = installFetchRouter((path, method, body) => {
      if (path.endsWith('/cases') && method === 'GET' && fail) {
        fail = false
        return jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })
      }
      return okBackend.route(path, method, body)
    })
    mountApp()
    await waitFor(() => expect(document.querySelector('[data-pmo-decisions-error]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-pmo-decisions-retry]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-pmo-decision-row]')).toHaveLength(2),
    )
    expect(
      records.filter(
        (record) =>
          record.method === 'GET' &&
          record.path === '/organizations/1/pmo/decision-workbench/cases',
      ).length,
    ).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// 建卡（manage 门禁 + 人工提交）
// ---------------------------------------------------------------------------
describe('PmoDecisionsPage：新建议题入口与建卡提交', () => {
  test('无 pmo_decision:manage：入口隐藏且交互过程零写请求（RL-06）', async () => {
    setAuth(['pmo_decision:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    mountApp()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-pmo-decision-row]')).toHaveLength(2),
    )

    expect(document.querySelector('[data-pmo-decisions-create-open]')).toBeNull()
    await settle()
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('manage 用户：对话框 → POST .../cases（ownerId=当前用户）→ 关闭并刷新列表', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    mountApp()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-pmo-decision-row]')).toHaveLength(2),
    )

    fireEvent.click(document.querySelector('[data-pmo-decisions-create-open]') as HTMLElement)
    expect(document.querySelector('[data-pmo-decision-create-panel]')).not.toBeNull()
    expect(screen.getByText(/你的身份（项目经理/)).toBeInTheDocument()

    const submit = document.querySelector('[data-pmo-decision-create-submit]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(
      document.querySelector('[data-pmo-decision-create-title]') as HTMLInputElement,
      { target: { value: '是否合并两个并行试点项目' } },
    )
    fireEvent.change(
      document.querySelector('[data-pmo-decision-create-question]') as HTMLTextAreaElement,
      { target: { value: 'Q4 是否合并试点 A 与试点 B 的交付节奏？' } },
    )
    fireEvent.change(
      document.querySelector('[data-pmo-decision-create-scope]') as HTMLInputElement,
      { target: { value: '试点 A / 试点 B' } },
    )
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    await waitFor(() => {
      const create = records.find(
        (record) =>
          record.method === 'POST' &&
          record.path === '/organizations/1/pmo/decision-workbench/cases',
      )
      expect(create).toBeDefined()
      const payload = JSON.parse(create?.body ?? '{}') as Record<string, unknown>
      expect(payload.title).toBe('是否合并两个并行试点项目')
      expect(payload.decisionQuestion).toBe('Q4 是否合并试点 A 与试点 B 的交付节奏？')
      expect(payload.scopeSummary).toBe('试点 A / 试点 B')
      expect(payload.ownerId).toBe(7)
    })
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-create-panel]')).toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelectorAll('[data-pmo-decision-row]')).toHaveLength(3),
    )
    expect(screen.getByText('是否合并两个并行试点项目')).toBeInTheDocument()
  })

  test('建卡失败：保留输入并回显服务端错误，弹窗不关闭', async () => {
    const backend = createBackend()
    installFetchRouter((path, method, body) => {
      if (path.endsWith('/cases') && method === 'POST') {
        return jsonResponse(422, { error: { code: 'VALIDATION_ERROR', message: '标题超长' } })
      }
      return backend.route(path, method, body)
    })
    mountApp()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decisions-create-open]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-pmo-decisions-create-open]') as HTMLElement)
    fireEvent.change(
      document.querySelector('[data-pmo-decision-create-title]') as HTMLInputElement,
      { target: { value: '失败议题' } },
    )
    fireEvent.change(
      document.querySelector('[data-pmo-decision-create-question]') as HTMLTextAreaElement,
      { target: { value: '触发 422 的决策问题' } },
    )
    fireEvent.click(document.querySelector('[data-pmo-decision-create-submit]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-create-error]')).not.toBeNull(),
    )
    expect(screen.getByText('标题超长')).toBeInTheDocument()
    expect(document.querySelector('[data-pmo-decision-create-panel]')).not.toBeNull()
    expect(
      (document.querySelector('[data-pmo-decision-create-title]') as HTMLInputElement).value,
    ).toBe('失败议题')
  })
})
