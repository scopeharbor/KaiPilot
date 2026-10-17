/**
 * v3-ui-next-reports-domain W1 · tasks 1.6 —— 报表中心路由容器、模式切换与
 * 深链状态还原测试（页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「状态联动与深链支持」/「细粒度权限控制与跨组织 404 中性守卫」/
 * RL-05）：
 * - 默认挂载处于 preset 预设报表模式（顶栏坐标 + 模板卡组可见）；
 * - 顶栏 Tab 切换：工作区切换且 URL 经 history.replaceState 同步
 *   （?tab=periodic / ?tab=versions），无全页硬刷新（router.push/replace 零调用）；
 * - 深链 ?tab=versions&versionId=108 / 独立 ?versionId= 自动激活版本模式并定位目标版本；
 * - 加载期仪器感骨架屏（aria-busy）→ 就绪切换；
 * - 网络异常（500）错误态 + 点击「重新载入」成功重试；
 * - 无 report:view → 受限空态且零数据外发；HTTP 404 与跨组织项目 → 中性 404
 *   （「项目不存在或已被移除」），不泄露项目名。
 */
import { act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import NextProjectReportsPage from '@/app/(next)/next/projects/[id]/reports/page'
import { useAuthStore } from '@/stores/auth-store'
import {
  installFetchRouter,
  jsonResponse,
  makeProject,
  resetFetchRouter,
} from './helpers/chart-gallery-network'

// ---------------------------------------------------------------------------
// next/navigation + next/link mock
// ---------------------------------------------------------------------------

const paramsMock = vi.hoisted(() => ({
  value: { id: '42' } as { id: string },
}))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/reports',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
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

const BASE_URL = '/next/projects/42/reports'
const TENANT_LEAK_WORDS = ['无权', '其他组织', '不属于', '租户', '越权']

/** 报表中心项目后端：项目 + 空预设历史（preset 模式工作台）。 */
function reportsBackend(projectPayload: unknown = makeProject()) {
  return (path: string, method: string): Response | null => {
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: projectPayload })
    }
    if (path.startsWith('/projects/42/reports') && method === 'GET') {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
      })
    }
    return null
  }
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function reportsUrl(search = ''): void {
  window.history.replaceState(null, '', `${BASE_URL}${search}`)
}

function selectedTabId(): string | null {
  return (
    document
      .querySelector('[data-reports-tab-trigger][aria-selected="true"]')
      ?.getAttribute('data-reports-tab-trigger') ?? null
  )
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  setAuth(['report:view', 'report:create'])
  reportsUrl()
})

afterEach(() => {
  resetFetchRouter()
})

describe('默认挂载与顶栏坐标（spec「用户访问已授权项目的报表中心主页」）', () => {
  test('无查询参数进入：默认 preset 模式，顶栏回显项目坐标', async () => {
    installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)

    // 项目坐标
    expect(await screen.findByText('报表中心')).toBeInTheDocument()
    expect(document.querySelector('[data-reports-space-title]')?.textContent).toBe('开项核心引擎')
    expect(document.querySelector('[data-reports-space-code]')?.textContent).toBe('#PROJ-042')
    expect(screen.getByLabelText('返回项目主空间')).toHaveAttribute('href', '/next/projects/42')
    // 默认 preset 模式
    expect(selectedTabId()).toBe('preset')
    const presetPanel = document.querySelector('[data-reports-panel="preset"]')
    expect(presetPanel).not.toBeNull()
    // 面板内模板卡组加载（白名单 4 类 radio）
    const radios = await screen.findAllByRole('radio', undefined, { timeout: 3000 })
    expect(radios).toHaveLength(4)
    expect(
      document.querySelector('[data-report-history-empty]') ??
        document.querySelector('[data-report-history-list]'),
    ).not.toBeNull()
  })

  test('返回空间链接指向项目主工作面，且无全页硬刷新路由调用', async () => {
    const { records } = installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)
    await screen.findByText('报表中心')

    const back = screen.getByLabelText('返回项目主空间')
    expect(back).toHaveAttribute('href', '/next/projects/42')
    expect(navMock.push).not.toHaveBeenCalled()
    expect(navMock.replace).not.toHaveBeenCalled()
    expect(records.length).toBeGreaterThan(0)
  })
})

describe('模式切换与 URL 深链同步（spec「视图模式切换与状态保留」）', () => {
  test('点击顶栏 Tab 切换工作区且 URL 同步 ?tab=，无全页硬刷新', async () => {
    installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)
    await screen.findByText('报表中心')

    // preset → periodic
    fireEvent.click(screen.getByRole('tab', { name: 'AI 周期报表' }))
    expect(selectedTabId()).toBe('periodic')
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('periodic')
    expect(document.querySelector('[data-reports-slot="periodic"]')).not.toBeNull()
    expect(document.querySelector('[data-reports-panel="preset"]')).toBeNull()

    // periodic → versions
    fireEvent.click(screen.getByRole('tab', { name: '版本审查' }))
    expect(selectedTabId()).toBe('versions')
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('versions')
    expect(document.querySelector('[data-reports-slot="versions"]')).not.toBeNull()

    // versions → preset（回到默认：URL 移除 tab 参数）
    fireEvent.click(screen.getByRole('tab', { name: '预设报表' }))
    expect(selectedTabId()).toBe('preset')
    expect(new URLSearchParams(window.location.search).has('tab')).toBe(false)
    expect(document.querySelector('[data-reports-panel="preset"]')).not.toBeNull()

    // 全程 history.replaceState（客户端路由），零 router.push/replace 硬跳转
    expect(navMock.push).not.toHaveBeenCalled()
    expect(navMock.replace).not.toHaveBeenCalled()
  })

  test('深链 ?tab=versions&versionId=108：自动激活版本审查并定位目标版本', async () => {
    reportsUrl('?tab=versions&versionId=108')
    const router = installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)

    await screen.findByText('报表中心')
    expect(selectedTabId()).toBe('versions')
    expect(document.querySelector('[data-reports-panel="versions"]')).not.toBeNull()
    expect(document.querySelector('[data-reports-target-version="108"]')?.textContent).toContain(
      '目标版本 #108',
    )
    // W4 装配后：版本模式挂载真实审阅面板，仅发起版本时间轴 GET（零预设报表探测）
    await waitFor(() => {
      expect(router.records.some((record) => record.url.includes('/reports/v2/versions'))).toBe(
        true,
      )
    })
    expect(
      router.records.some((record) => /\/projects\/42\/reports\?perPage=/.test(record.url)),
    ).toBe(false)
    expect(router.records.some((record) => /\/reports\/\d+/.test(record.url))).toBe(false)
  })

  test('独立 ?versionId=108（无 tab 参数）：同样自动进入版本审查模式', async () => {
    reportsUrl('?versionId=108')
    installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)

    await screen.findByText('报表中心')
    expect(selectedTabId()).toBe('versions')
    expect(document.querySelector('[data-reports-target-version="108"]')).not.toBeNull()
  })

  test('非法 ?tab= 回落默认 preset 模式', async () => {
    reportsUrl('?tab=unknown-mode')
    installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)

    await screen.findByText('报表中心')
    expect(selectedTabId()).toBe('preset')
  })
})

describe('加载骨架屏与错误态重试（spec「全链路三态弹性呈现」）', () => {
  test('项目加载期间渲染仪器感骨架屏，就绪后切换真实工作台', async () => {
    let resolveProject: ((response: Response) => void) | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = rawUrl.replace('http://localhost:3333/api/v1', '')
      if (path === '/projects/42' && method === 'GET') {
        return new Promise<Response>((resolve) => {
          resolveProject = resolve
        })
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'unmatched' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage(<NextProjectReportsPage />)

    // 加载期骨架屏（aria-busy，结构占位）
    const skeleton = document.querySelector('[data-reports-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')

    // 项目响应到达 → 工作台切换
    await act(async () => {
      resolveProject?.(jsonResponse(200, { data: makeProject() }))
    })
    expect(await screen.findByText('报表中心')).toBeInTheDocument()
    expect(document.querySelector('[data-reports-skeleton]')).toBeNull()
    expect(selectedTabId()).toBe('preset')
  })

  test('后端 500：错误警示卡 + 点击「重新载入」成功恢复', async () => {
    let attempts = 0
    const flakyBackend = (path: string, method: string): Response | null => {
      if (path === '/projects/42' && method === 'GET') {
        attempts += 1
        if (attempts === 1) {
          return jsonResponse(500, { error: { code: 'INTERNAL', message: '临时故障' } })
        }
        return jsonResponse(200, { data: makeProject() })
      }
      if (path.startsWith('/projects/42/reports') && method === 'GET') {
        return jsonResponse(200, {
          data: [],
          meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
        })
      }
      return null
    }
    installFetchRouter(flakyBackend)
    renderPage(<NextProjectReportsPage />)

    expect(await screen.findByText('报表中心加载失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))

    expect(await screen.findByText('报表中心', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(document.querySelector('[data-reports-error]')).toBeNull()
    expect(attempts).toBeGreaterThanOrEqual(2)
  })
})

describe('准入门禁与中性 404（spec「细粒度权限控制与跨组织 404 中性守卫」）', () => {
  test('缺少 report:view：受限空态提示开通权限，底层接口零外发', () => {
    setAuth(['task:view'])
    const router = installFetchRouter(() => null)
    renderPage(<NextProjectReportsPage />)

    expect(screen.getByText('暂无报表查看权限')).toBeInTheDocument()
    expect(document.querySelector('[data-reports-permission-fallback]')).not.toBeNull()
    expect(router.records).toHaveLength(0)
  })

  test('HTTP 404：统一中性空态「项目不存在或已被移除」，不泄露项目名（RL-05）', async () => {
    const router = installFetchRouter((path, method) => {
      if (path === '/projects/42' && method === 'GET') {
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '' } })
      }
      return null
    })
    renderPage(<NextProjectReportsPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(document.body.textContent).not.toContain('开项核心引擎')
    const bodyText = document.body.textContent ?? ''
    for (const word of TENANT_LEAK_WORDS) expect(bodyText).not.toContain(word)
    // 仅项目 GET，无任何报表数据探测
    expect(router.records).toHaveLength(1)
  })

  test('跨组织项目（organizationId 失配）：同样中性 404，绝不泄露资源属性', async () => {
    const router = installFetchRouter(reportsBackend(makeProject({ organizationId: 2 })))
    renderPage(<NextProjectReportsPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(document.body.textContent).not.toContain('开项核心引擎')
    expect(router.records).toHaveLength(1)
  })

  test('非数字路径 id：直接中性 404，零网络请求', async () => {
    setAuth(['report:view'])
    paramsMock.value = { id: 'abc' }
    const router = installFetchRouter(() => null)
    renderPage(<NextProjectReportsPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(router.records).toHaveLength(0)
  })
})
