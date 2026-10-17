/**
 * v3-ui-next-resource-team-domains W4 · tasks 4.4 —— 功能域通用页头组件测试
 * （DomainPageHeader 纯组件级 + 三域页面级返回动线 + 容器级镜头恢复 +
 * 顶栏面包屑文本回显；读写真实 entity store 与 mocked next/navigation）。
 *
 * 覆盖（design §5.2「统一页头 DomainPageHeader 与快捷返回」场景）：
 * - 点击「← 返回项目工作面」平滑跳转 /next/projects/:id（router.push）；
 * - projectName 就绪后 entity store 收到 `<项目名> · <领域名>` 注册，卸载后安全清理；
 * - projectName 加载中（null / undefined / 空串）标题降级为仅领域名且不注册面包屑；
 * - actions 领域操作插槽与 description 弱文案正确渲染；
 * - 资源/成员/文件三域页面：页头「← 返回项目工作面」平滑回 /next/projects/:id；
 * - 返回后主工作面按 URL 保留镜头参数恢复此前激活镜头（容器级模拟）；
 * - 顶栏全局面包屑文本回显 `/next/projects/:id · <项目名> · <领域名>`。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DomainPageHeader } from '@/components/next/common/DomainPageHeader'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useAuthStore } from '@/stores/auth-store'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'
import ProjectResourcesDomainPage from '@/app/(next)/next/projects/[id]/resources/page'
import ProjectMembersDomainPage from '@/app/(next)/next/projects/[id]/members/page'
import ProjectFilesDomainPage from '@/app/(next)/next/projects/[id]/files/page'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import type { Project } from '@/lib/api/projects'

// ---------------------------------------------------------------------------
// next/navigation mock（组件与域页面路由消费 useRouter / useParams）
// ---------------------------------------------------------------------------
const paramsMock = vi.hoisted(() => ({ value: { id: '42' } as { id: string } }))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42',
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
// 域页面装配所需：会话 / 伪后端 / 渲染辅助
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

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 42,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-042',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetCents: null,
    currency: null,
    progressPercent: 35,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
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

function paginated(data: unknown[]) {
  return { data, meta: { total: data.length, page: 1, perPage: 100, totalPages: 1 } }
}

type RouteFn = (
  path: string,
  method: string,
  body: Record<string, unknown> | null,
) => Response | null

function installFetchRouter(route: RouteFn): { records: Array<{ method: string; url: string }> } {
  const records: Array<{ method: string; url: string }> = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method, null)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

/** 三域页面通用伪后端（空数据态足够页头装配断言）。 */
function domainBackend(domain: 'resources' | 'members' | 'files'): RouteFn {
  return (path: string, method: string) => {
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: makeProject() })
    }
    if (domain === 'resources') {
      if (/^\/projects\/42\/resources(\?|$)/.test(path) && method === 'GET') {
        return jsonResponse(200, paginated([]))
      }
    }
    if (domain === 'members') {
      if (path === '/projects/42/members' && method === 'GET') {
        return jsonResponse(200, { data: [] })
      }
      if (path === '/projects/42/roles' && method === 'GET') {
        return jsonResponse(200, { data: [] })
      }
    }
    if (domain === 'files') {
      if (path === '/projects/42/attachments' && method === 'GET') {
        return jsonResponse(200, paginated([]))
      }
      if (/^\/projects\/42\/files(\?|$)/.test(path) && method === 'GET') {
        return jsonResponse(200, paginated([]))
      }
    }
    return null
  }
}

/** 主工作面容器装配（?lens=list 镜头）伪后端：项目 + 列表镜头双数据源。 */
function spaceBackend(): RouteFn {
  return (path: string, method: string) => {
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: makeProject() })
    }
    if (/^\/projects\/42\/tasks(\?|$)/.test(path) && method === 'GET') {
      return jsonResponse(200, paginated([]))
    }
    if (path === '/projects/42/members' && method === 'GET') {
      return jsonResponse(200, { data: [] })
    }
    if (/^\/projects\/42\/roles(\?|$)/.test(path) && method === 'GET') {
      return jsonResponse(200, { data: [] })
    }
    return null
  }
}

const DOMAIN_WORKSPACE_MARKER: Record<string, string> = {
  resources: '[data-project-resources-workspace]',
  members: '[data-members-workspace]',
  files: '[data-files-workspace-space]',
}

/** 顶栏面包屑回显探针（镜像 NextAppShell 消费公式：resolveSpaceBreadcrumb(pathname, entityTitle)）。 */
function BreadcrumbEchoProbe({ pathname }: { pathname: string }) {
  const entityTitle = useProjectSpaceEntityStore((state) => state.entityTitle)
  return (
    <span data-coordinate-echo>{resolveSpaceBreadcrumb(pathname, entityTitle ?? undefined)}</span>
  )
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  // entity store 为模块级单例，逐用例重置。
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
  window.history.replaceState(null, '', '/next/projects/42')
})

afterEach(() => {
  resetFetchRouter()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  window.history.replaceState(null, '', '/next/projects/42')
})

describe('DomainPageHeader：返回项目工作面快捷动线', () => {
  test('点击「返回项目工作面」平滑跳转 /next/projects/:id', () => {
    render(<DomainPageHeader projectId={42} projectName="开项核心引擎" domainLabel="资源工作台" />)

    expect(document.querySelector('[data-domain-header]')).not.toBeNull()
    const backButton = screen.getByRole('button', { name: '返回项目工作面' })
    expect(document.querySelector('[data-domain-back]')).toBe(backButton)

    fireEvent.click(backButton)
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42')
    expect(navMock.replace).not.toHaveBeenCalled()
    expect(navMock.back).not.toHaveBeenCalled()
  })
})

describe('DomainPageHeader：entity store 面包屑联动', () => {
  test('projectName 就绪后注册 <项目名> · <领域名>，卸载时安全清理', () => {
    const view = render(
      <DomainPageHeader projectId={42} projectName="开项核心引擎" domainLabel="资源工作台" />,
    )

    expect(useProjectSpaceEntityStore.getState().projectId).toBe(42)
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎 · 资源工作台')

    view.unmount()
    expect(useProjectSpaceEntityStore.getState().projectId).toBeNull()
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBeNull()
  })

  test('projectName 由空转为就绪后补注册（项目详情加载完成联动），无重复注册', () => {
    const view = render(
      <DomainPageHeader projectId={42} projectName={null} domainLabel="项目文件库" />,
    )
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBeNull()

    view.rerender(
      <DomainPageHeader projectId={42} projectName="开项核心引擎" domainLabel="项目文件库" />,
    )
    expect(useProjectSpaceEntityStore.getState().projectId).toBe(42)
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎 · 项目文件库')

    // 相同 props 再渲染不触发重复注册（effect 依赖稳定）
    view.rerender(
      <DomainPageHeader projectId={42} projectName="开项核心引擎" domainLabel="项目文件库" />,
    )
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎 · 项目文件库')

    view.unmount()
    expect(useProjectSpaceEntityStore.getState().projectId).toBeNull()
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBeNull()
  })

  test('卸载清理受 store projectId 守卫保护：不误清新注册的其它项目空间标题', () => {
    const view = render(
      <DomainPageHeader projectId={42} projectName="开项核心引擎" domainLabel="成员管理" />,
    )
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎 · 成员管理')

    // 模拟 header 存活期间其它空间抢先注册（如主工作面容器恢复上报）
    useProjectSpaceEntityStore.getState().register(99, '新项目代号')

    view.unmount()
    expect(useProjectSpaceEntityStore.getState().projectId).toBe(99)
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('新项目代号')
  })
})

describe('DomainPageHeader：呈现与标题降级', () => {
  test('actions 插槽内容与 description 弱文案正确渲染', () => {
    render(
      <DomainPageHeader
        projectId={42}
        projectName="开项核心引擎"
        domainLabel="资源工作台"
        description="全类型资源调配 · 团队负荷排查 · 分配明细"
        actions={<button type="button">新建资源</button>}
      />,
    )

    expect(screen.getByRole('button', { name: '新建资源' })).toBeInTheDocument()
    expect(screen.getByText('全类型资源调配 · 团队负荷排查 · 分配明细')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: '开项核心引擎 · 资源工作台' }),
    ).toBeInTheDocument()
    // actions 独立于返回按钮渲染（插槽按钮 ≠ 返回按钮）
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  test('projectName 缺省（null / undefined / 空串）标题降级为仅领域名，且不注册面包屑', () => {
    const missingNames: Array<string | null | undefined> = [null, undefined, '']
    for (const projectName of missingNames) {
      const view = render(
        <DomainPageHeader projectId={42} projectName={projectName} domainLabel="项目文件库" />,
      )

      expect(document.querySelector('[data-domain-title]')?.textContent).toBe('项目文件库')
      expect(screen.getByRole('heading', { level: 2, name: '项目文件库' })).toBeInTheDocument()
      expect(useProjectSpaceEntityStore.getState().projectId).toBeNull()
      expect(useProjectSpaceEntityStore.getState().entityTitle).toBeNull()

      view.unmount()
    }
  })
})

// ---------------------------------------------------------------------------
// 三域页面级返回动线（tasks 4.4，design §5.2「← 返回项目工作面」场景）
// ---------------------------------------------------------------------------
describe('资源/成员/文件三域页面：「← 返回项目工作面」平滑回 /next/projects/:id', () => {
  const cases: Array<{ domain: 'resources' | 'members' | 'files'; perms: string[] }> = [
    { domain: 'resources', perms: ['project:view', 'resource:view'] },
    { domain: 'members', perms: ['project:view'] },
    { domain: 'files', perms: ['project:view', 'file:view'] },
  ]

  for (const item of cases) {
    test(`${item.domain} 域页头返回按钮平滑跳转（router.push 且绝不 replace/back）`, async () => {
      setAuth(item.perms)
      installFetchRouter(domainBackend(item.domain))
      const page =
        item.domain === 'resources'
          ? React.createElement(ProjectResourcesDomainPage)
          : item.domain === 'members'
            ? React.createElement(ProjectMembersDomainPage)
            : React.createElement(ProjectFilesDomainPage)
      renderWithClient(page)

      // 骨架 → 域工作台装配（页头随项目数据就绪挂载）
      await waitFor(() =>
        expect(document.querySelector(DOMAIN_WORKSPACE_MARKER[item.domain]!)).not.toBeNull(),
      )
      const backButton = screen.getByRole('button', { name: '返回项目工作面' })
      expect(backButton).toHaveAttribute('data-domain-back')

      fireEvent.click(backButton)
      expect(navMock.push).toHaveBeenCalledTimes(1)
      expect(navMock.push).toHaveBeenCalledWith('/next/projects/42')
      expect(navMock.replace).not.toHaveBeenCalled()
      expect(navMock.back).not.toHaveBeenCalled()
    })
  }
})

// ---------------------------------------------------------------------------
// 容器级：返回后主工作面恢复此前激活镜头（tasks 4.4，spec「主工作面恢复
// 此前激活镜头」场景——URL 镜头参数（replaceState 双向绑定）保留期间返回，
// 容器按 ?lens= 恢复对应排程镜头）
// ---------------------------------------------------------------------------
describe('容器级返回动线：主工作面恢复此前激活镜头（tasks 4.4）', () => {
  test('空间（?lens=list）→ 功能域菜单成员页 → 返回 push 基础路径 → 重载空间恢复 list 镜头', async () => {
    setAuth(['project:view', 'task:view', 'resource:view'])
    installFetchRouter(spaceBackend())

    // 1. 主工作面以 ?lens=list 激活（URL 镜头参数为激活态的权威来源）
    window.history.replaceState(null, '', '/next/projects/42?lens=list')
    const spaceView = renderWithClient(<ProjectSpaceContainer projectId={42} />)
    await screen.findByText('开项核心引擎')
    await waitFor(() =>
      expect(document.querySelector('[data-project-space-list-slot]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-lens-option="list"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(window.location.search).toBe('?lens=list')

    // 2. 顶栏功能域菜单「成员与团队」→ push 直达成员域页面
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /成员与团队/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/members')
    spaceView.unmount()

    // 3. 成员页点「← 返回项目工作面」→ 平滑 push 回 /next/projects/:id
    const membersView = renderWithClient(<ProjectMembersDomainPage />)
    await waitFor(() => expect(document.querySelector('[data-members-workspace]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '返回项目工作面' }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42')
    expect(navMock.replace).not.toHaveBeenCalled()
    membersView.unmount()

    // 4. 返回主工作面：URL 镜头参数保留 → 容器按 ?lens=list 恢复此前激活镜头
    const restoredView = renderWithClient(<ProjectSpaceContainer projectId={42} />)
    await screen.findByText('开项核心引擎')
    await waitFor(() =>
      expect(document.querySelector('[data-project-space-list-slot]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-lens-option="list"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    // 主工作面确实回到列表镜头而非默认看板
    expect(document.querySelector('[data-project-space-board-slot]')).toBeNull()
    restoredView.unmount()
  })
})

// ---------------------------------------------------------------------------
// 顶栏全局面包屑文本回显（tasks 4.4，spec「/next/projects/:id/[resources|members|files]
// · <项目名称>」场景——面包屑文本由实体标题经 resolveSpaceBreadcrumb 回显）
// ---------------------------------------------------------------------------
describe('顶栏全局面包屑文本回显（tasks 4.4）', () => {
  const cases: Array<{ domain: 'resources' | 'members' | 'files'; label: string }> = [
    { domain: 'resources', label: '开项核心引擎 · 资源工作台' },
    { domain: 'members', label: '开项核心引擎 · 成员管理' },
    { domain: 'files', label: '开项核心引擎 · 项目文件库' },
  ]

  for (const item of cases) {
    test(`${item.domain} 域：项目数据就绪后顶栏回显「/next/projects/42 · ${item.label}」`, async () => {
      setAuth(
        item.domain === 'members'
          ? ['project:view']
          : ['project:view', item.domain === 'resources' ? 'resource:view' : 'file:view'],
      )
      installFetchRouter(domainBackend(item.domain))
      const page =
        item.domain === 'resources'
          ? React.createElement(ProjectResourcesDomainPage)
          : item.domain === 'members'
            ? React.createElement(ProjectMembersDomainPage)
            : React.createElement(ProjectFilesDomainPage)
      renderWithClient(
        <div>
          <BreadcrumbEchoProbe pathname={`/next/projects/42/${item.domain}`} />
          {page}
        </div>,
      )

      await waitFor(() =>
        expect(document.querySelector(DOMAIN_WORKSPACE_MARKER[item.domain]!)).not.toBeNull(),
      )
      // 实体注册（NextAppShell 订阅数据源）
      expect(useProjectSpaceEntityStore.getState().entityTitle).toBe(item.label)
      // 全局面包屑文本回显（路径 + 实体标题）
      await waitFor(() =>
        expect(document.querySelector('[data-coordinate-echo]')?.textContent).toBe(
          `/next/projects/42 · ${item.label}`,
        ),
      )
    })
  }
})
