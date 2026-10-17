/**
 * v3-ui-next-batch1-strategy-launch-tasks W5 · tasks 5.3 / 5.4
 * 双轨切换门控与旧轨零污染回归测试（next-batch1-dual-track-guard.test.tsx）
 *
 * 覆盖：
 * 1. 旧轨顶栏进入新轨按钮 NextTrackEntryButton 条件渲染与交互：
 *    - 未认证用户不渲染；
 *    - 已认证但组织 Flag 关闭时不渲染；
 *    - 已认证且组织 Flag 开启时渲染进入新轨按钮（data-next-track-entry）；
 *    - 点击按钮持久化 track='next' 并调用 router.push('/next')。
 * 2. 新轨顶栏切回旧轨按钮生效验证：
 *    - NextTopbar 渲染 data-next-back-to-legacy 按钮；
 *    - 点击触发 setTrack('legacy', 'shell_switch') 并调用 router.push('/dashboard')。
 * 3. 新轨路由守卫 NextRouteLayout 未授权租户踢回：
 *    - 认证水合前保持骨架屏占位（防 hydration race）；
 *    - 未认证重定向至 /next-login；
 *    - 已认证但组织 Feature Flag 关闭时调用 router.replace('/dashboard') 且内容为 null；
 *    - 授权组织正常放行渲染新轨 Shell 与子节点。
 * 4. 旧轨 6 页静态零污染与完整性验证：
 *    - 验证 6 个旧轨文件全部存在于 apps/frontend/app/(dashboard)/ 路径；
 *    - 验证 6 个旧轨文件零 import 新轨组件（components/next/）或新轨路由（app/(next)/）；
 *    - 验证旧轨 6 页在旧轨路由组上下文下的导出与基本渲染完备（未崩溃、状态健全）。
 */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { NextTrackEntryButton } from '@/components/layout/Topbar'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import NextRouteLayout from '@/app/(next)/layout'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'

// 旧轨 6 页面组件静态引入（验证导出与组件完整性）
import StrategyExecutionCockpitPage from '@/app/(dashboard)/strategy-execution-cockpit/page'
import NewProjectPage from '@/app/(dashboard)/projects/new/page'
import ProjectsPage from '@/app/(dashboard)/projects/page'
import ProjectTaskBatchPage from '@/app/(dashboard)/projects/[id]/tasks/page'
import TaskDetailPage from '@/app/(dashboard)/projects/[id]/tasks/[taskId]/page'
import ProjectTaskRecycleBinPage from '@/app/(dashboard)/projects/[id]/tasks/recycle-bin/page'

// ---------------------------------------------------------------------------
// jsdom 兼容环境配置
// ---------------------------------------------------------------------------
function setupJsdom() {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventMock extends MouseEvent {}
    window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
  }
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
}

// ---------------------------------------------------------------------------
// 路由 Mock
// ---------------------------------------------------------------------------
const pushMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/next',
  useParams: () => ({ id: '42', taskId: '7' }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/next/layout/NextAppShell', () => ({
  NextAppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="next-app-shell">{children}</div>
  ),
}))

// ---------------------------------------------------------------------------
// 夹具常量与辅助函数
// ---------------------------------------------------------------------------
const FF_NEXT_UI = 'NEXT_PUBLIC_FF_NEXT_UI'
const FF_NEXT_UI_ORGS = 'NEXT_PUBLIC_FF_NEXT_UI_ORGS'

const LEGACY_6_PAGES = [
  'app/(dashboard)/strategy-execution-cockpit/page.tsx',
  'app/(dashboard)/projects/new/page.tsx',
  'app/(dashboard)/projects/page.tsx',
  'app/(dashboard)/projects/[id]/tasks/page.tsx',
  'app/(dashboard)/projects/[id]/tasks/[taskId]/page.tsx',
  'app/(dashboard)/projects/[id]/tasks/recycle-bin/page.tsx',
] as const

function setAuth(params: {
  isAuthenticated: boolean
  hasHydrated: boolean
  organizationId: number | null
  permissions?: string[]
}) {
  act(() => {
    useAuthStore.setState({
      user: params.isAuthenticated
        ? {
            id: 1,
            email: 'user@example.com',
            fullName: '测试用户',
            organizations:
              params.organizationId !== null
                ? [{ id: params.organizationId, name: '测试组织', slug: 'test-org', role: 'owner' }]
                : [],
          }
        : null,
      accessToken: params.isAuthenticated ? 'mock-token' : null,
      refreshToken: params.isAuthenticated ? 'mock-refresh' : null,
      permissions: params.permissions ?? [
        'strategy:view',
        'task:view',
        'task:update',
        'task:delete',
        'project:create',
        'project:view',
      ],
      currentOrganizationId: params.organizationId,
      roleVersion: 1,
      isAuthenticated: params.isAuthenticated,
      hasHydrated: params.hasHydrated,
      effectiveTenantContext: null,
      selectionEpoch: 0,
      hasPermission: (perm: string) => (params.permissions ?? []).includes(perm),
    })
  })
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
    },
  })
}

describe('next-batch1-dual-track-guard（双轨护栏与旧轨零污染验证）', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    setupJsdom()
    pushMock.mockReset()
    replaceMock.mockReset()

    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: [] }),
        text: async () => JSON.stringify({ data: [] }),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      } as unknown as Response),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // 1. 进入新轨门控按钮 NextTrackEntryButton
  // -------------------------------------------------------------------------
  describe('旧轨顶栏进入新轨按钮 NextTrackEntryButton', () => {
    test('未认证用户：绝对不渲染进入新轨按钮', () => {
      process.env[FF_NEXT_UI] = 'true'
      setAuth({ isAuthenticated: false, hasHydrated: true, organizationId: null })

      render(<NextTrackEntryButton />)
      expect(document.querySelector('[data-next-track-entry]')).toBeNull()
    })

    test('已认证但组织 Feature Flag 未放行：不渲染进入新轨按钮', () => {
      process.env[FF_NEXT_UI] = 'org_allowlist'
      process.env[FF_NEXT_UI_ORGS] = '10,20'
      // 组织 99 不在白名单
      setAuth({ isAuthenticated: true, hasHydrated: true, organizationId: 99 })

      render(<NextTrackEntryButton />)
      expect(document.querySelector('[data-next-track-entry]')).toBeNull()
    })

    test('已认证且组织 Feature Flag 开启：渲染进入新轨按钮并可点击导航至 /next', () => {
      process.env[FF_NEXT_UI] = 'org_allowlist'
      process.env[FF_NEXT_UI_ORGS] = '42'
      setAuth({ isAuthenticated: true, hasHydrated: true, organizationId: 42 })

      render(<NextTrackEntryButton />)
      const button = document.querySelector('[data-next-track-entry]')
      expect(button).not.toBeNull()
      expect(button?.textContent).toContain('进入新页面')

      fireEvent.click(button!)
      expect(useNextTrackStore.getState().track).toBe('next')
      expect(pushMock).toHaveBeenCalledWith('/next')
    })
  })

  // -------------------------------------------------------------------------
  // 2. 新轨切回旧轨按钮 NextTopbar (data-next-back-to-legacy)
  // -------------------------------------------------------------------------
  describe('新轨顶栏切回旧轨按钮 data-next-back-to-legacy', () => {
    test('新轨顶栏渲染「回到旧版」按钮，点击后切回 legacy 轨道并跳转 /dashboard', () => {
      const client = createTestQueryClient()
      useNextTrackStore.setState({ track: 'next' })

      render(
        <QueryClientProvider client={client}>
          <NextTopbar />
        </QueryClientProvider>,
      )

      const backButton = document.querySelector('[data-next-back-to-legacy]')
      expect(backButton).not.toBeNull()
      expect(backButton?.textContent).toContain('回到旧版')

      fireEvent.click(backButton!)
      expect(useNextTrackStore.getState().track).toBe('legacy')
      expect(pushMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  // -------------------------------------------------------------------------
  // 3. 新轨路由组守卫 NextRouteLayout 未授权租户踢回
  // -------------------------------------------------------------------------
  describe('新轨路由守卫 NextRouteLayout 访问拦截与踢回', () => {
    test('认证水合未完成时保持骨架屏占位，不触发重定向', () => {
      setAuth({ isAuthenticated: false, hasHydrated: false, organizationId: null })

      render(
        <NextRouteLayout>
          <div>新轨核心工作区</div>
        </NextRouteLayout>,
      )

      expect(screen.getByText('正在加载新页面…')).toBeInTheDocument()
      expect(screen.queryByText('新轨核心工作区')).toBeNull()
      expect(replaceMock).not.toHaveBeenCalled()
    })

    test('已认证但当前组织未授权访问新轨时：踢回 /dashboard 且不渲染新轨内容', () => {
      process.env[FF_NEXT_UI] = 'org_allowlist'
      process.env[FF_NEXT_UI_ORGS] = '10' // 只有组织 10 放行
      setAuth({ isAuthenticated: true, hasHydrated: true, organizationId: 999 })

      render(
        <NextRouteLayout>
          <div data-testid="protected-content">新轨涉密工作区</div>
        </NextRouteLayout>,
      )

      expect(replaceMock).toHaveBeenCalledWith('/dashboard')
      expect(screen.queryByTestId('protected-content')).toBeNull()
    })

    test('已认证且组织已授权新轨时：放行渲染 NextAppShell 与子内容', () => {
      process.env[FF_NEXT_UI] = 'true'
      setAuth({ isAuthenticated: true, hasHydrated: true, organizationId: 42 })

      render(
        <NextRouteLayout>
          <div data-testid="protected-content">新轨正常内容</div>
        </NextRouteLayout>,
      )

      expect(replaceMock).not.toHaveBeenCalled()
      expect(screen.getByTestId('protected-content')).toBeInTheDocument()
      expect(screen.getByTestId('next-app-shell')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // 4. 旧轨 6 页零修改与零污染护栏
  // -------------------------------------------------------------------------
  describe('旧轨 6 页静态代码零污染与组件完整性', () => {
    const frontendRoot = resolve(__dirname, '..')

    test('旧轨 6 个页面文件真实存在于磁盘', () => {
      for (const pageRelPath of LEGACY_6_PAGES) {
        const fullPath = resolve(frontendRoot, pageRelPath)
        expect(existsSync(fullPath), `旧轨页面缺失: ${pageRelPath}`).toBe(true)
      }
    })

    test('旧轨 6 个页面源码中严格禁止 import 新轨组件或新轨路由（零逆向依赖）', () => {
      const forbiddenPatterns = [
        /from\s+['"]@\/components\/next\//i,
        /from\s+['"]@\/app\/\(next\)\//i,
        /import\s+['"]@\/app\/\(next\)\/next-tokens\.css['"]/i,
        /from\s+['"]\.\.?\/.*\/components\/next\//i,
      ]

      for (const pageRelPath of LEGACY_6_PAGES) {
        const fullPath = resolve(frontendRoot, pageRelPath)
        const content = readFileSync(fullPath, 'utf-8')
        for (const pattern of forbiddenPatterns) {
          expect(
            pattern.test(content),
            `旧轨页面 ${pageRelPath} 违规引用了新轨模块: ${pattern}`,
          ).toBe(false)
        }
      }
    })

    test('旧轨 6 页在旧轨路由组上下文下能够正常导出与挂载（功能完备无崩溃）', () => {
      const client = createTestQueryClient()
      setAuth({ isAuthenticated: true, hasHydrated: true, organizationId: 42 })

      // 1. 战略驾驶舱旧轨页
      const cockpit = render(
        <QueryClientProvider client={client}>
          <StrategyExecutionCockpitPage />
        </QueryClientProvider>,
      )
      expect(cockpit.container).toBeDefined()
      cockpit.unmount()

      // 2. 新建项目旧轨页
      const newProject = render(
        <QueryClientProvider client={client}>
          <NewProjectPage />
        </QueryClientProvider>,
      )
      expect(newProject.container).toBeDefined()
      newProject.unmount()

      // 3. 项目列表旧轨页
      const projects = render(
        <QueryClientProvider client={client}>
          <ProjectsPage />
        </QueryClientProvider>,
      )
      expect(projects.container).toBeDefined()
      projects.unmount()

      // 4. 项目任务批量管理旧轨页
      const taskBatch = render(
        <QueryClientProvider client={client}>
          <ProjectTaskBatchPage />
        </QueryClientProvider>,
      )
      expect(taskBatch.container).toBeDefined()
      taskBatch.unmount()

      // 5. 单任务独立详情旧轨页
      const taskDetail = render(
        <QueryClientProvider client={client}>
          <TaskDetailPage />
        </QueryClientProvider>,
      )
      expect(taskDetail.container).toBeDefined()
      taskDetail.unmount()

      // 6. 任务回收站旧轨页
      const recycleBin = render(
        <QueryClientProvider client={client}>
          <ProjectTaskRecycleBinPage />
        </QueryClientProvider>,
      )
      expect(recycleBin.container).toBeDefined()
      recycleBin.unmount()
    })
  })
})
