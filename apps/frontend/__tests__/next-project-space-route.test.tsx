/**
 * v3-ui-next-project-space tasks 1.7~1.9 —— 单项目空间路由、数据加载、权限守卫与
 * 中性 404 隔离测试。
 *
 * 覆盖：
 * - 合法项目加载：骨架屏 → 项目空间底座（标题 / #编号 / 时间主轴 / 镜头切换器）；
 * - 顶栏坐标联动：项目加载成功后坐标回显 `/next/projects/101 · 开项核心引擎`
 *   （entity store 注册 + resolveSpaceBreadcrumb + NextTopbar 消费链路）；
 * - RL-05：跨组织与 HTTP 404 统一中性空态「项目不存在或已被移除」，禁词扫描防泄露；
 * - RL-06：缺少 project:view / task:view 时权限横幅拦截，数据请求零发出；
 * - 非数字路径 id 直接中性 404，零网络请求；
 * - 非 404 错误（500）→ 错误卡 + 重新载入恢复。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { kanbanApi } from '@/lib/api/kanban'
import type { Task } from '@/lib/api/tasks'
import type { Project } from '@/lib/api/projects'
import NextProjectSpacePage from '@/app/(next)/next/projects/[id]/page'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useNextTrackStore } from '@/stores/next-track-store'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const apiMock = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/api/projects', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/projects')>()
  return { ...original, projectsApi: { ...original.projectsApi, get: apiMock.get } }
})

const paramsMock = vi.hoisted(() => ({ value: { id: '101' } as { id: string } }))

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/101',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 101,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-101',
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

function resetAuthState() {
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
}

/** 顶栏坐标回显 harness：复刻 W4 在 NextAppShell 中的消费装配（store 订阅 + 传参）。 */
function ShellCoordinateHarness() {
  const entityTitle = useProjectSpaceEntityStore((state) => state.entityTitle)
  return (
    <NextTopbar
      coordinateLabel={resolveSpaceBreadcrumb('/next/projects/101', entityTitle ?? undefined)}
    />
  )
}

function renderRoute(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <NextProjectSpacePage />
      <ShellCoordinateHarness />
    </QueryClientProvider>,
  )
}

/** RL-05 租户防泄露禁词（中性 404 空态绝不允许出现）。 */
const TENANT_LEAK_WORDS = ['无权', '其他组织', '不属于', '租户', '越权']

beforeEach(() => {
  paramsMock.value = { id: '101' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  apiMock.get.mockReset()
  // W4 总装后容器内含工作面看板：kanban 取数/移动一律 mock，杜绝真实网络请求
  // （route 测试聚焦路由/权限/隔离，看板行为由 W2/K4 集成测试专测）。
  vi.spyOn(kanbanApi, 'listColumn').mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, perPage: 25, totalPages: 0 },
  })
  vi.spyOn(kanbanApi, 'move').mockResolvedValue({} as Task)
  resetAuthState()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
})

describe('单项目空间路由 /next/projects/[id]（spec「项目空间路由与数据加载」）', () => {
  test('合法项目：骨架屏 → 项目空间底座，时间主轴与镜头切换器就位', async () => {
    setAuth(['project:view', 'task:view'])
    let resolveGet: (value: Project) => void
    apiMock.get.mockImplementationOnce(
      () =>
        new Promise<Project>((resolve) => {
          resolveGet = resolve
        }),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderRoute(client)

    // 加载期：仪器感骨架屏（aria-busy），禁止空态误报
    const skeleton = document.querySelector('[data-project-space-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('[data-project-space-empty]')).toBeNull()
    expect(screen.queryByText('项目不存在或已被移除')).toBeNull()

    resolveGet!(makeProject())
    await screen.findByText('开项核心引擎')

    expect(apiMock.get).toHaveBeenCalledTimes(1)
    expect(apiMock.get).toHaveBeenCalledWith(101)
    expect(document.querySelector('[data-project-space-title]')?.textContent).toBe('开项核心引擎')
    expect(document.querySelector('[data-project-space-code]')?.textContent).toBe('#PROJ-101')
    // 时间主轴与镜头切换器
    expect(document.querySelector('[data-timeline-bar]')).not.toBeNull()
    expect(document.querySelector('[data-timeline-axis]')).not.toBeNull()
    expect(document.querySelector('[data-lens-switcher]')).not.toBeNull()
    expect(
      document.querySelector('[data-lens-option="kanban"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
    // 工作面看板（W2 总装）与手动新建抽屉（W3 总装）就位
    expect(document.querySelector('[data-project-space-board-slot]')).not.toBeNull()
    expect(document.querySelector('[data-workspace-kanban-board]')).not.toBeNull()
    expect(document.querySelector('[data-manual-task-create-trigger]')).not.toBeNull()
    expect(document.querySelector('[data-project-space-skeleton]')).toBeNull()
  })

  test('顶栏坐标联动：项目加载成功后回显「/next/projects/101 · 开项核心引擎」', async () => {
    setAuth(['project:view', 'task:view'])
    apiMock.get.mockResolvedValueOnce(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderRoute(client)

    // 数据在途：未注册 → 「项目空间」兜底（design 文案）
    expect(screen.getByText('/next/projects/101 · 项目空间')).toBeInTheDocument()

    await waitFor(() => {
      expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎')
      expect(useProjectSpaceEntityStore.getState().projectId).toBe(101)
    })

    const coordinate = document.querySelector('[data-next-coordinate]')
    expect(coordinate?.textContent).toBe('/next/projects/101 · 开项核心引擎')

    // 与 space-breadcrumbs 解析器单测的口径一致
    expect(resolveSpaceBreadcrumb('/next/projects/101', '开项核心引擎')).toBe(
      '/next/projects/101 · 开项核心引擎',
    )
  })

  test('跨组织访问（organizationId 不匹配）：中性 404 空态，不泄露存在性（RL-05）', async () => {
    setAuth(['project:view', 'task:view'], 1)
    apiMock.get.mockResolvedValueOnce(makeProject({ organizationId: 2 }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderRoute(client)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(
      document
        .querySelector('[data-project-space-empty]')
        ?.getAttribute('data-project-space-empty'),
    ).toBe('not_found')
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(document.querySelector('[data-project-space-title]')).toBeNull()

    const bodyText = document.body.textContent ?? ''
    for (const word of TENANT_LEAK_WORDS) {
      expect(bodyText).not.toContain(word)
    }
    // 项目名绝不泄露
    expect(bodyText).not.toContain('开项核心引擎')
    // 实体标题不注册
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '返回角色首页' }))
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })

  test('HTTP 404：统一中性 404 空态，返回角色首页导航', async () => {
    setAuth(['project:view', 'task:view'])
    apiMock.get.mockRejectedValueOnce({ status: 404, code: 'RESOURCE_NOT_FOUND', message: '' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderRoute(client)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    const bodyText = document.body.textContent ?? ''
    for (const word of TENANT_LEAK_WORDS) {
      expect(bodyText).not.toContain(word)
    }
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回角色首页' }))
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })

  test('缺少 task:view 权限：权限横幅拦截，项目数据请求零发出（RL-06）', () => {
    setAuth(['project:view'])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderRoute(client)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目空间的权限')).toBeInTheDocument()
    expect(
      screen.getByText('请联系组织管理员或项目负责人授予 project:view 与 task:view 权限。'),
    ).toBeInTheDocument()
    expect(apiMock.get).not.toHaveBeenCalled()
    expect(document.querySelector('[data-project-space-skeleton]')).toBeNull()
  })

  test('缺少 project:view 权限：同样被权限守卫拦截', () => {
    setAuth(['task:view'])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderRoute(client)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  test('非数字路径 id：直接中性 404 空态，零网络请求', async () => {
    setAuth(['project:view', 'task:view'])
    paramsMock.value = { id: 'abc' }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderRoute(client)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(apiMock.get).not.toHaveBeenCalled()
    const bodyText = document.body.textContent ?? ''
    for (const word of TENANT_LEAK_WORDS) {
      expect(bodyText).not.toContain(word)
    }
    fireEvent.click(screen.getByRole('button', { name: '返回角色首页' }))
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })

  test('非 404 错误：错误卡 + 重新载入重新请求并恢复', async () => {
    setAuth(['project:view', 'task:view'])
    apiMock.get
      .mockRejectedValueOnce({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: '服务内部异常',
      })
      .mockResolvedValueOnce(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderRoute(client)

    await screen.findByRole('alert', { name: '项目加载错误' })
    expect(screen.getByText('项目加载失败')).toBeInTheDocument()
    expect(document.querySelector('[data-project-space-empty="error"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await screen.findByText('开项核心引擎')
    expect(apiMock.get).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-project-space-title]')?.textContent).toBe('开项核心引擎')
  })

  test('未认证会话（currentOrganizationId 为 null）不误判为跨组织，正常渲染', async () => {
    setAuth(['project:view', 'task:view'], null)
    apiMock.get.mockResolvedValueOnce(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderRoute(client)

    await screen.findByText('开项核心引擎')
    expect(document.querySelector('[data-project-space-empty]')).toBeNull()
  })

  test('坐标回显在容器卸载后清空（防串台）', async () => {
    setAuth(['project:view', 'task:view'])
    apiMock.get.mockResolvedValueOnce(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { unmount } = renderRoute(client)

    await waitFor(() => {
      expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎')
    })
    unmount()
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBeNull()
    expect(useProjectSpaceEntityStore.getState().projectId).toBeNull()
  })
})
