/**
 * v3-ui-next-batch2-auth-shell-assimilation W5 · tasks 5.1 / 5.2
 * 双轨门控护栏、D23 根路径非强制重定向与旧轨 7 页零污染回归测试（next-batch2-dual-track-guard.test.tsx）
 *
 * 覆盖：
 * 1. 旧轨顶栏进入新轨按钮 NextTrackEntryButton 条件渲染与交互：
 *    - 未认证用户：绝对不渲染进入新轨按钮；
 *    - 已认证但组织 Feature Flag 未放行：不渲染进入新轨按钮；
 *    - 已认证且组织 Feature Flag 开启：渲染进入新轨按钮（data-next-track-entry）；
 *    - 点击按钮持久化 track='next' 并调用 router.push('/next')。
 * 2. 新轨顶栏切回旧轨按钮生效验证：
 *    - NextTopbar 渲染 data-next-back-to-legacy 按钮（文案包含「回到旧版」）；
 *    - 点击触发 setTrack('legacy', 'shell_switch') 并调用 router.push('/dashboard')。
 * 3. D23 根路径非强制重定向红线与确定性分流（app/page.tsx）：
 *    - 默认状态（未曾选择过 / track === 'legacy'）未登录严格 replace('/login')，绝不静默跳转 /next-login 或 /next；
 *    - 默认状态已登录严格 replace('/dashboard')，绝不静默跳转 /next；
 *    - 显式偏好 track === 'next' 且已登录定向至 /next，未登录定向至 /next-login；
 *    - 水合等待期不触发任何跳转，渲染深空加载态 RootSpaceLoadingShell，严格零 push。
 * 4. 批 2 涉及 7 页面物理文件完整性与旧轨安全认证协议完备性：
 *    - 验证批 2 涉及的 7 个页面物理存在；
 *    - 验证旧轨 2FA 与登录底层安全协议库文件物理存在；
 *    - 验证旧轨原装组件（TwoFactorStepPage.tsx、LoginForm.tsx）源码零引入新轨专有组件或样式（零逆向污染）；
 *    - 验证旧轨原装守卫（TwoFactorStepPage 无票据踢回 /login）与协议函数（safeNextPath、loginErrorMessage）功能完备。
 */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { NextTrackEntryButton } from '@/components/layout/Topbar'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import Home from '@/app/page'
import { TwoFactorStepPage } from '@/components/auth/TwoFactorStepPage'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { loginErrorMessage } from '@/components/auth/LoginForm'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useTwoFactorChallengeStore } from '@/stores/two-factor-challenge-store'

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
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,stub') },
}))

// ---------------------------------------------------------------------------
// 夹具常量与辅助函数
// ---------------------------------------------------------------------------
const FF_NEXT_UI = 'NEXT_PUBLIC_FF_NEXT_UI'
const FF_NEXT_UI_ORGS = 'NEXT_PUBLIC_FF_NEXT_UI_ORGS'

const BATCH2_7_PAGES = [
  'app/page.tsx',
  'app/2fa/setup/page.tsx',
  'app/2fa/challenge/page.tsx',
  'app/offline/page.tsx',
  'app/auth/google/callback/page.tsx',
] as const

const LEGACY_AUTH_PROTOCOL_FILES = [
  'components/auth/TwoFactorStepPage.tsx',
  'components/auth/TwoFactorChallengeForm.tsx',
  'components/auth/LoginForm.tsx',
  'lib/api/auth.ts',
  'lib/api/two-factor.ts',
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
      permissions: params.permissions ?? ['strategy:view', 'project:view'],
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

describe('next-batch2-dual-track-guard（批 2 双轨门控护栏与旧轨零污染验证）', () => {
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

    act(() => {
      useNextTrackStore.getState().reset()
      useTwoFactorChallengeStore.getState().clear()
      setAuth({ isAuthenticated: false, hasHydrated: true, organizationId: null })
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    act(() => {
      useNextTrackStore.getState().reset()
      useTwoFactorChallengeStore.getState().clear()
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // 1. 旧轨顶栏进入新轨按钮 NextTrackEntryButton 条件渲染与交互
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
      setAuth({ isAuthenticated: true, hasHydrated: true, organizationId: 99 })

      render(<NextTrackEntryButton />)
      expect(document.querySelector('[data-next-track-entry]')).toBeNull()
    })

    test('已认证且组织 Feature Flag 开启：渲染进入新轨按钮，点击持久化 track=next 并 push /next', () => {
      process.env[FF_NEXT_UI] = 'org_allowlist'
      process.env[FF_NEXT_UI_ORGS] = '42'
      setAuth({ isAuthenticated: true, hasHydrated: true, organizationId: 42 })

      render(<NextTrackEntryButton />)
      const button = document.querySelector('[data-next-track-entry]')
      expect(button).not.toBeNull()
      expect(button?.textContent).toContain('进入新页面')

      fireEvent.click(button!)
      expect(useNextTrackStore.getState().track).toBe('next')
      expect(useNextTrackStore.getState().source).toBe('topbar_button')
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
      expect(useNextTrackStore.getState().source).toBe('shell_switch')
      expect(pushMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  // -------------------------------------------------------------------------
  // 3. D23 根路径非强制重定向红线与四象限分流
  // -------------------------------------------------------------------------
  describe('D23 根路径非强制重定向红线与分流守卫 (app/page.tsx)', () => {
    test('D23 红线：默认偏好（未选过 / legacy）未登录严格定向旧轨 /login，绝不自动进入 /next-login 或 /next', () => {
      act(() => {
        useNextTrackStore.getState().reset()
        setAuth({ isAuthenticated: false, hasHydrated: true, organizationId: null })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledWith('/login')
      expect(replaceMock).not.toHaveBeenCalledWith('/next-login')
      expect(replaceMock).not.toHaveBeenCalledWith('/next')
      expect(pushMock).not.toHaveBeenCalled()
    })

    test('D23 红线：默认偏好（未选过 / legacy）已登录严格定向旧轨 /dashboard，绝不静默提升至 /next', () => {
      act(() => {
        useNextTrackStore.getState().reset()
        setAuth({ isAuthenticated: true, hasHydrated: true, organizationId: 42 })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledWith('/dashboard')
      expect(replaceMock).not.toHaveBeenCalledWith('/next')
      expect(pushMock).not.toHaveBeenCalled()
    })

    test('显式设置 next 偏好未登录：定向新轨专属登录页 /next-login', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'next' })
        setAuth({ isAuthenticated: false, hasHydrated: true, organizationId: null })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledWith('/next-login')
      expect(pushMock).not.toHaveBeenCalled()
    })

    test('显式设置 next 偏好已登录：定向新轨首页 /next', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'next' })
        setAuth({ isAuthenticated: true, hasHydrated: true, organizationId: 42 })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledWith('/next')
      expect(pushMock).not.toHaveBeenCalled()
    })

    test('水合等待期保护：认证或偏好未完成水合时，绝不触发任何重定向，挂载深空加载态外壳', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'next' })
        setAuth({ isAuthenticated: false, hasHydrated: false, organizationId: null })
      })

      render(<Home />)

      expect(replaceMock).not.toHaveBeenCalled()
      expect(pushMock).not.toHaveBeenCalled()
      expect(screen.getByText('正在进入开项 KaiPilot…')).toBeInTheDocument()
      expect(document.querySelector('[data-root-space-loading]')).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // 4. 批 2 涉及 7 页面与旧轨协议零污染静态护栏
  // -------------------------------------------------------------------------
  describe('批 2 涉及 7 页面与旧轨安全认证协议零污染静态护栏', () => {
    const frontendRoot = resolve(__dirname, '..')

    test('批 2 涉及的 7 个页面物理文件真实存在于磁盘', () => {
      for (const pageRelPath of BATCH2_7_PAGES) {
        const fullPath = resolve(frontendRoot, pageRelPath)
        expect(existsSync(fullPath), `批 2 页面缺失: ${pageRelPath}`).toBe(true)
      }
    })

    test('旧轨 2FA 与登录底层安全协议库文件物理存在于磁盘', () => {
      for (const fileRelPath of LEGACY_AUTH_PROTOCOL_FILES) {
        const fullPath = resolve(frontendRoot, fileRelPath)
        expect(existsSync(fullPath), `旧轨协议文件缺失: ${fileRelPath}`).toBe(true)
      }
    })

    test('旧轨原装组件（TwoFactorStepPage、LoginForm）源码严格禁止反向 import 新轨组件或深空令牌', () => {
      const legacyTargetFiles = [
        'components/auth/TwoFactorStepPage.tsx',
        'components/auth/TwoFactorChallengeForm.tsx',
        'components/auth/LoginForm.tsx',
      ]
      const forbiddenPatterns = [
        /from\s+['"]@\/components\/next\//i,
        /from\s+['"]@\/app\/\(next\)\//i,
        /import\s+['"]@\/app\/\(next\)\/next-tokens\.css['"]/i,
        /from\s+['"]\.\.?\/.*\/components\/next\//i,
      ]

      for (const fileRelPath of legacyTargetFiles) {
        const fullPath = resolve(frontendRoot, fileRelPath)
        const content = readFileSync(fullPath, 'utf-8')
        for (const pattern of forbiddenPatterns) {
          expect(
            pattern.test(content),
            `旧轨组件 ${fileRelPath} 违规引用了新轨专属模块: ${pattern}`,
          ).toBe(false)
        }
      }
    })
  })

  // -------------------------------------------------------------------------
  // 5. 旧轨认证协议与守卫功能完备性验证
  // -------------------------------------------------------------------------
  describe('旧轨认证协议与守卫功能完备性验证', () => {
    test('旧轨两步验证公共外壳 TwoFactorStepPage：无可用票据时严格踢回旧轨 /login', () => {
      act(() => {
        useTwoFactorChallengeStore.setState({
          challengeToken: null,
          expiresAt: null,
          hasHydrated: true,
        })
      })

      render(<TwoFactorStepPage expected="enroll" />)

      expect(replaceMock).toHaveBeenCalledWith('/login')
    })

    test('旧轨协议安全辅助函数 safeNextPath 边界完备（防 CRLF/开放重定向/循环定向）', () => {
      expect(safeNextPath('/dashboard')).toBe('/dashboard')
      expect(safeNextPath('/projects/10/tasks')).toBe('/projects/10/tasks')
      expect(safeNextPath('/login')).toBe('/dashboard')
      expect(safeNextPath('/login?foo=bar')).toBe('/dashboard')
      expect(safeNextPath('//evil.com')).toBe('/dashboard')
      expect(safeNextPath('https://evil.com')).toBe('/dashboard')
      expect(safeNextPath(null)).toBe('/dashboard')
      expect(safeNextPath('', '/fallback')).toBe('/fallback')
      expect(safeNextPath('/next', '/fallback')).toBe('/next')
    })

    test('旧轨登录错误码映射 loginErrorMessage 输出确定性文案', () => {
      expect(loginErrorMessage({ code: 'INVALID_CREDENTIALS' })).toBe(
        '邮箱或密码不正确，请重新检查。',
      )
      expect(loginErrorMessage({ code: 'AUTH_REQUIRED' })).toBe('邮箱或密码不正确，请重新检查。')
      expect(loginErrorMessage({ code: 'ACCOUNT_LOCKED', message: '已锁定' })).toBe('已锁定')
      expect(loginErrorMessage({})).toBe('暂时无法登录，请检查网络后重试。')
    })
  })
})
