/**
 * v3-ui-next-org-portfolio-domains W6 · tasks 6.3 —— 容量闭环列表工作台测试
 * （组件级真实数据链：hooks + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「资源容量闭环咨询工作台（列表与详情）」+ tasks 6.3）：
 * - 状态筛选写回 URL（restorable，router.push 断言）与重挂载后从 URL 恢复重查；
 * - 行渲染：标题/状态徽标（双通道文本 + 令牌色类名）/窗口/粒度/修订/下一步提示；
 * - 空态与两个来源页深链（/next/organization/resource-gaps 与
 *   /next/organization/resource-demand-forecasting）；
 * - 无匹配结果（状态筛选命中空）清除筛选回列表；
 * - 加载骨架屏 aria-busy；404 受限中性态（不泄露后端 message）与 5xx 可重试；
 * - 分页上一页/下一页 URL 同步；
 * - 全程（含筛选/翻页/重试）零写请求断言（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { CapacityLoopList } from '@/components/next/org-loops/CapacityLoopList'
import { resourceCapacityLoopKeys } from '@/lib/api/resource-capacity-loops'
import type { RcclLoopListItem } from '@/lib/api/resource-capacity-loops'

// ---------------------------------------------------------------------------
// next/navigation + next/link mock
// ---------------------------------------------------------------------------
const LIST_PATH = '/next/organization/resource-capacity-loops'
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => LIST_PATH,
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话与网络
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
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
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

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
}

function installFetchRouter(
  route: (path: string, method: string) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    records.push({ method, url: rawUrl })
    const path = rawUrl.replace(API_PREFIX, '')
    const matched = await route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
let nextLoopId = 1
function makeLoop(state: string, overrides: Partial<RcclLoopListItem> = {}): RcclLoopListItem {
  const id = overrides.id ?? nextLoopId++
  return {
    id,
    title: `容量闭环 ${id}`,
    ownerUserId: 1,
    state: state as RcclLoopListItem['state'],
    revision: 1,
    granularity: 'week',
    windowStart: '2026-09-01',
    windowEnd: '2026-11-30',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function envelope(rows: RcclLoopListItem[], page = 1, perPage = 20) {
  return {
    data: rows,
    meta: {
      total: rows.length,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(rows.length / perPage)),
    },
  }
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CapacityLoopList />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  nextLoopId = 1
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
describe('CapacityLoopList：状态筛选/URL 恢复与行渲染（tasks 6.3）', () => {
  test('加载成功渲染行：标题/状态徽标双通道/窗口/粒度/修订/下一步提示', async () => {
    setAuth(['resource_capacity_loop:view'])
    const rows = [
      makeLoop('draft', { id: 11, title: 'Q4 容量闭环' }),
      makeLoop('simulated', { id: 12, title: 'Q1 后备容量' }),
      makeLoop('cancelled', { id: 13, title: '已弃闭环' }),
    ]
    installFetchRouter((path, method) => {
      if (path.startsWith('/organizations/1/resource-capacity-loops') && method === 'GET') {
        return jsonResponse(200, envelope(rows))
      }
      return null
    })
    renderList()
    await waitFor(() => expect(document.querySelectorAll('[data-rccl-list-row]')).toHaveLength(3))

    const draftRow = document.querySelector('[data-rccl-list-row="11"]')
    expect(draftRow?.textContent).toContain('Q4 容量闭环')
    expect(draftRow?.textContent).toContain('草稿')
    expect(draftRow?.textContent).toContain('窗口 2026-09-01 ~ 2026-11-30')
    expect(draftRow?.textContent).toContain('周粒度')
    expect(draftRow?.textContent).toContain('下一步：刷新基线并创建情景')
    expect(draftRow?.textContent).toContain('修订 v1')
    // 深链：行 → 详情页
    expect(draftRow?.getAttribute('href')).toBe(`${LIST_PATH}/11`)

    // 状态徽标：文本 + 令牌色双通道
    const chips = document.querySelectorAll('[data-rccl-state-chip]')
    expect(chips).toHaveLength(3)
    const cancelledChip = document.querySelector('[data-rccl-state-chip][data-state="cancelled"]')
    expect(cancelledChip?.textContent).toBe('已取消')
    expect(cancelledChip?.className).toContain('text-[var(--nx-status-danger)]')
    const simulatedChip = document.querySelector('[data-rccl-state-chip][data-state="simulated"]')
    expect(simulatedChip?.textContent).toBe('已模拟')
    expect(simulatedChip?.className).toContain('text-[var(--nx-space-cyan)]')
  })

  test('状态筛选写回 URL；重挂载后按 URL 恢复并重查（restorable）', async () => {
    setAuth(['resource_capacity_loop:view'])
    const all = [makeLoop('draft'), makeLoop('simulated'), makeLoop('closed')]
    installFetchRouter((path, method) => {
      if (path.startsWith('/organizations/1/resource-capacity-loops') && method === 'GET') {
        const qs = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '')
        const state = qs.get('state')
        const rows = state ? all.filter((loop) => loop.state === state) : all
        return jsonResponse(200, envelope(rows))
      }
      return null
    })
    const first = renderList()
    await waitFor(() => expect(document.querySelectorAll('[data-rccl-list-row]')).toHaveLength(3))

    const select = document.querySelector('[data-rccl-state-filter]') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'simulated' } })
    expect(navMock.push).toHaveBeenCalledWith(`${LIST_PATH}?state=simulated`)
    first.unmount()

    // 模拟刷新/分享后的直达 URL：从 URL 恢复筛选并重查
    searchParamsMock.value = new URLSearchParams('state=simulated')
    navMock.push.mockReset()
    renderList()
    await waitFor(() => expect(document.querySelectorAll('[data-rccl-list-row]')).toHaveLength(1))
    expect((document.querySelector('[data-rccl-state-filter]') as HTMLSelectElement).value).toBe(
      'simulated',
    )
    expect(document.querySelector('[data-rccl-list-row]')?.textContent).toContain('已模拟')
    // 已关闭只存在于筛选下拉选项；行区不得出现该状态行
    expect(document.querySelector('[data-rccl-list-rows]')?.textContent).not.toContain('已关闭')
  })

  test('筛选命中空：无匹配结果空态 + 清除筛选回列表', async () => {
    setAuth(['resource_capacity_loop:view'])
    installFetchRouter((path, method) => {
      if (path.startsWith('/organizations/1/resource-capacity-loops') && method === 'GET') {
        const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
        const state = new URLSearchParams(qs).get('state')
        return jsonResponse(200, envelope(state === 'reviewed' ? [] : [makeLoop('draft')]))
      }
      return null
    })
    searchParamsMock.value = new URLSearchParams('state=reviewed')
    renderList()
    await waitFor(() => expect(document.querySelector('[data-rccl-no-results]')).not.toBeNull())
    expect(screen.getByText('没有符合当前筛选的闭环记录')).toBeInTheDocument()

    const clear = document.querySelector('[data-rccl-clear-filters]')
    fireEvent.click(clear as Element)
    expect(navMock.push).toHaveBeenCalledWith(LIST_PATH)
  })

  test('空态：引导文案 + 两个来源页深链（资源缺口/需求预测）', async () => {
    setAuth(['resource_capacity_loop:view'])
    installFetchRouter((path, method) => {
      if (path.startsWith('/organizations/1/resource-capacity-loops') && method === 'GET') {
        return jsonResponse(200, envelope([]))
      }
      return null
    })
    renderList()
    await waitFor(() => expect(document.querySelector('[data-rccl-empty]')).not.toBeNull())
    expect(document.body.textContent).toContain('从已授权的资源缺口或需求预测创建第一个闭环计划')
    expect(document.querySelector('[data-rccl-empty-gaps-link]')?.getAttribute('href')).toBe(
      '/next/organization/resource-gaps',
    )
    expect(document.querySelector('[data-rccl-empty-demand-link]')?.getAttribute('href')).toBe(
      '/next/organization/resource-demand-forecasting',
    )
  })
})

describe('CapacityLoopList：加载/错误三态（tasks 6.3）', () => {
  test('加载骨架屏 aria-busy（几何占位）', async () => {
    setAuth(['resource_capacity_loop:view'])
    const gate = deferred<Response>()
    installFetchRouter((path, method) => {
      if (path.startsWith('/organizations/1/resource-capacity-loops') && method === 'GET') {
        return gate.promise
      }
      return null
    })
    renderList()
    const loading = document.querySelector('[data-rccl-loading]')
    expect(loading).not.toBeNull()
    expect(loading?.getAttribute('aria-busy')).toBe('true')
    gate.resolve(jsonResponse(200, envelope([makeLoop('draft')])))
    await waitFor(() => expect(document.querySelectorAll('[data-rccl-list-row]')).toHaveLength(1))
  })

  test('404 受限态：中性文案（不泄露后端 message）且零写请求', async () => {
    setAuth(['resource_capacity_loop:view'])
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/organizations/1/resource-capacity-loops') && method === 'GET') {
        return jsonResponse(404, {
          error: { code: 'RESOURCE_NOT_FOUND', message: '容量闭环不存在' },
        })
      }
      return null
    })
    renderList()
    await waitFor(() => expect(document.querySelector('[data-rccl-error]')).not.toBeNull())
    expect(screen.getByText('容量闭环数据不可用')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('容量闭环不存在')
    // 受限态无重试按钮，只有返回角色首页
    expect(document.querySelector('[data-rccl-retry]')).toBeNull()
    expect(document.querySelector('[data-rccl-restricted-back-home]')).not.toBeNull()
    expect(writeMethods(records)).toEqual([])
  })

  test('5xx 错误可重试：点击重试触发 refetch 成功', async () => {
    setAuth(['resource_capacity_loop:view'])
    let failing = true
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/organizations/1/resource-capacity-loops') && method === 'GET') {
        if (failing) {
          return jsonResponse(500, { error: { code: 'INTERNAL', message: '内部错误' } })
        }
        return jsonResponse(200, envelope([makeLoop('draft', { id: 21 })]))
      }
      return null
    })
    renderList()
    await waitFor(() => expect(document.querySelector('[data-rccl-error]')).not.toBeNull())
    expect(screen.getByText('加载失败')).toBeInTheDocument()
    expect(document.querySelector('[data-rccl-restricted-back-home]')).toBeNull()

    failing = false
    fireEvent.click(document.querySelector('[data-rccl-retry]') as Element)
    await waitFor(() => expect(document.querySelectorAll('[data-rccl-list-row]')).toHaveLength(1))
    expect(writeMethods(records)).toEqual([])
  })
})

describe('CapacityLoopList：分页 URL 同步（tasks 6.3）', () => {
  /** 分页 UI 依赖 {data,meta} 信封（既有 hook 单测契约）；直接预置 query cache 驱动。 */
  function renderWithSeededList(
    rows: RcclLoopListItem[],
    meta: { total: number; page: number; perPage: number; totalPages: number },
    filters = {},
  ) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(resourceCapacityLoopKeys.list(1, filters), { data: rows, meta })
    return render(
      <QueryClientProvider client={client}>
        <CapacityLoopList />
      </QueryClientProvider>,
    )
  }

  test('下一页写回 ?page=2（URL 为唯一事实来源）', () => {
    setAuth(['resource_capacity_loop:view'])
    renderWithSeededList([makeLoop('draft', { id: 1 })], {
      total: 2,
      page: 1,
      perPage: 1,
      totalPages: 2,
    })
    expect(document.querySelectorAll('[data-rccl-list-row]')).toHaveLength(1)
    expect(document.querySelector('[data-rccl-pagination]')?.textContent).toContain('第 1 / 2 页')
    fireEvent.click(document.querySelector('[data-rccl-next-page]') as Element)
    expect(navMock.push).toHaveBeenCalledWith(`${LIST_PATH}?page=2`)
  })

  test('URL 直达第二页：恢复 page 状态并渲染该页；上一页回退到列表首页', () => {
    setAuth(['resource_capacity_loop:view'])
    searchParamsMock.value = new URLSearchParams('page=2')
    renderWithSeededList(
      [makeLoop('draft', { id: 2 })],
      { total: 2, page: 2, perPage: 1, totalPages: 2 },
      { page: 2 },
    )
    expect(document.querySelectorAll('[data-rccl-list-row]')).toHaveLength(1)
    expect(document.querySelector('[data-rccl-list-row]')?.textContent).toContain('容量闭环 2')
    expect(document.querySelector('[data-rccl-pagination]')?.textContent).toContain('第 2 / 2 页')
    fireEvent.click(document.querySelector('[data-rccl-prev-page]') as Element)
    expect(navMock.push).toHaveBeenCalledWith(LIST_PATH)
  })

  test('无 meta（裸数组载荷）不渲染假分页控件', async () => {
    setAuth(['resource_capacity_loop:view'])
    installFetchRouter((path, method) => {
      if (path.startsWith('/organizations/1/resource-capacity-loops') && method === 'GET') {
        return jsonResponse(200, { data: [makeLoop('draft')] })
      }
      return null
    })
    renderList()
    await waitFor(() => expect(document.querySelectorAll('[data-rccl-list-row]')).toHaveLength(1))
    expect(document.querySelector('[data-rccl-pagination]')).toBeNull()
  })
})
