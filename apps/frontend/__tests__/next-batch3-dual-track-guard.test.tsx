/**
 * v3-ui-next-batch3-global-convergence W5 · tasks 5.5 / 5.6
 * 双轨护栏测试与旧轨 6 页零污染回归测试（next-batch3-dual-track-guard.test.tsx）
 *
 * 覆盖：
 * 1. 物理文件完整性：旧轨 6 页与新轨 6 篇同化页物理存在；
 * 2. 旧轨 6 页零逆向污染：旧轨源码严格零引入新轨专属组件或样式；
 * 3. 旧轨顶栏进入新轨按钮 NextTrackEntryButton 条件渲染与组织白名单受控拦截；
 * 4. 新轨顶栏切回旧轨按钮 data-next-back-to-legacy 功能完好；
 * 5. 双轨切换状态机（useNextTrackStore）自由双向切换与持久化。
 */
import * as React from 'react'
import { act, fireEvent, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { NextTrackEntryButton } from '@/components/layout/Topbar'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'

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

// ---------------------------------------------------------------------------
// 常量与辅助
// ---------------------------------------------------------------------------
const FF_NEXT_UI = 'NEXT_PUBLIC_FF_NEXT_UI'
const FF_NEXT_UI_ORGS = 'NEXT_PUBLIC_FF_NEXT_UI_ORGS'

const LEGACY_BATCH3_6_PAGES = [
  'app/(dashboard)/search/page.tsx',
  'app/(dashboard)/notifications/page.tsx',
  'app/(dashboard)/calendar/page.tsx',
  'app/(dashboard)/tasks/page.tsx',
  'app/(dashboard)/recommendations/page.tsx',
  'app/(dashboard)/okr-alignment/page.tsx',
] as const

const NEW_BATCH3_6_ASSIMILATION_PAGES = [
  'app/(next)/next/search/page.tsx',
  'app/(next)/next/notifications/page.tsx',
  'app/(next)/next/calendar/page.tsx',
  'app/(next)/next/tasks/page.tsx',
  'app/(next)/next/recommendations/page.tsx',
  'app/(next)/next/okr-alignment/page.tsx',
] as const

function setAuth(params: {
  isAuthenticated: boolean
  hasHydrated: boolean
  organizationId: number | null
}) {
  act(() => {
    useAuthStore.setState({
      user: params.isAuthenticated
        ? {
            id: 1,
            email: 'user@example.com',
            fullName: '测试用户',
            organizations: params.organizationId
              ? [{ id: params.organizationId, name: '测试租户', slug: 'tenant', role: 'admin' }]
              : [],
          }
        : null,
      accessToken: params.isAuthenticated ? 'token' : null,
      refreshToken: params.isAuthenticated ? 'token' : null,
      permissions: [],
      currentOrganizationId: params.organizationId,
      planTier: null,
      roleVersion: 1,
      isAuthenticated: params.isAuthenticated,
      hasHydrated: params.hasHydrated,
      effectiveTenantContext: null,
      selectionEpoch: 0,
      hasPermission: () => true,
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

describe('next-batch3-dual-track-guard（批 3 双轨门控护栏与旧轨零污染回归验证）', () => {
  const originalEnv = { ...process.env }
  const frontendRoot = resolve(__dirname, '..')

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
      setAuth({ isAuthenticated: false, hasHydrated: true, organizationId: null })
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    act(() => {
      useNextTrackStore.getState().reset()
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // 1. 物理文件存在性与旧轨 6 页零逆向污染
  // -------------------------------------------------------------------------
  describe('物理文件完整性与零逆向污染', () => {
    test('旧轨 6 页物理文件真实存在于磁盘', () => {
      for (const pageRelPath of LEGACY_BATCH3_6_PAGES) {
        const fullPath = resolve(frontendRoot, pageRelPath)
        expect(existsSync(fullPath), `旧轨页面缺失: ${pageRelPath}`).toBe(true)
      }
    })

    test('新轨 6 篇同化承接页物理文件真实存在于磁盘', () => {
      for (const pageRelPath of NEW_BATCH3_6_ASSIMILATION_PAGES) {
        const fullPath = resolve(frontendRoot, pageRelPath)
        expect(existsSync(fullPath), `新轨同化页缺失: ${pageRelPath}`).toBe(true)
      }
    })

    test('旧轨 6 页面源码严格禁止反向 import 新轨组件、深空令牌或新轨路由', () => {
      const forbiddenPatterns = [
        /from\s+['"]@\/components\/next\//i,
        /from\s+['"]@\/app\/\(next\)\//i,
        /import\s+['"]@\/app\/\(next\)\/next-tokens\.css['"]/i,
        /from\s+['"]\.\.?\/.*\/components\/next\//i,
      ]

      for (const pageRelPath of LEGACY_BATCH3_6_PAGES) {
        const fullPath = resolve(frontendRoot, pageRelPath)
        const content = readFileSync(fullPath, 'utf-8')
        for (const pattern of forbiddenPatterns) {
          expect(
            pattern.test(content),
            `旧轨页面 ${pageRelPath} 违规引用了新轨专属模块: ${pattern}`,
          ).toBe(false)
        }
      }
    })
  })

  // -------------------------------------------------------------------------
  // 2. 旧轨顶栏进入新轨按钮条件渲染与门禁拦截
  // -------------------------------------------------------------------------
  describe('旧轨顶栏进入新轨按钮 NextTrackEntryButton', () => {
    test('未认证用户：绝对不渲染进入新轨按钮', () => {
      process.env[FF_NEXT_UI] = 'true'
      setAuth({ isAuthenticated: false, hasHydrated: true, organizationId: null })

      render(<NextTrackEntryButton />)
      expect(document.querySelector('[data-next-track-entry]')).toBeNull()
    })

    test('已认证但组织 Feature Flag 未放行：未授权组织受控拦截，不渲染进入新轨按钮', () => {
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
  // 3. 新轨顶栏切回旧轨按钮 NextTopbar
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
  // 4. 双向自由切换状态持久化验证
  // -------------------------------------------------------------------------
  describe('双轨状态机自由双向切换', () => {
    test('next 与 legacy 轨道可反复切换，状态与来源准确记录', () => {
      const store = useNextTrackStore.getState()
      expect(store.track).toBe('legacy')

      store.setTrack('next', 'topbar_button')
      expect(useNextTrackStore.getState().track).toBe('next')
      expect(useNextTrackStore.getState().source).toBe('topbar_button')

      store.setTrack('legacy', 'shell_switch')
      expect(useNextTrackStore.getState().track).toBe('legacy')
      expect(useNextTrackStore.getState().source).toBe('shell_switch')
    })
  })
})
