/**
 * v3-ui-next-batch2-auth-shell-assimilation W1 · tasks 1.3 / 1.4
 * 根路径深空外壳与无障碍/视觉红线测试（next-root-space-shell.test.tsx）
 *
 * 覆盖：
 * 1. 根路径组件在水合等待期正确挂载 RootSpaceLoadingShell，保持 aria-busy 与无障碍可访问；
 * 2. 深空暗黑背景（--nx-space-bg）与 BrandLoader 尺寸参数（size=64）绑定；
 * 3. 精确档（data-immersion="precise"）纯平降级：剥离 .nx-space-atmosphere 氛围光晕；
 * 4. RL-15 视觉红线守护：零 Canvas、零 WebGL、零 3D；
 * 5. RL-01 零写铁律：根路径加载与外壳呈现全生命周期 HTTP 写请求严格为 0。
 */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Home from '@/app/page'
import { RootSpaceLoadingShell } from '@/components/next/auth/RootSpaceLoadingShell'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'

// ---------------------------------------------------------------------------
// jsdom 环境补齐
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined' && !window.matchMedia) {
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

// ---------------------------------------------------------------------------
// 路由 Mock
// ---------------------------------------------------------------------------
const pushMock = vi.fn()
const replaceMock = vi.fn()
const routerMock = {
  push: pushMock,
  replace: replaceMock,
  back: vi.fn(),
  refresh: vi.fn(),
}

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}))

describe('根路径深空外壳与无障碍/视觉红线测试（tasks 1.3 / 1.4）', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
    act(() => {
      useNextTrackStore.getState().reset()
      useAuthStore.setState({
        isAuthenticated: false,
        hasHydrated: true,
        user: null,
        accessToken: null,
      })
    })
    document.documentElement.removeAttribute('data-immersion')
  })

  afterEach(() => {
    act(() => {
      useNextTrackStore.getState().reset()
    })
    document.documentElement.removeAttribute('data-immersion')
    vi.unstubAllGlobals()
  })

  describe('水合等待期外壳挂载与可访问性', () => {
    test('根路径组件在水合等待期（hasHydrated: false）正确挂载 RootSpaceLoadingShell', () => {
      act(() => {
        useAuthStore.setState({ isAuthenticated: false, hasHydrated: false })
      })

      const { container } = render(<Home />)

      // 验证深空加载外壳挂载
      const shell = container.querySelector('[data-root-space-loading]')
      expect(shell).not.toBeNull()
      expect(shell).toHaveAttribute('data-next-track')
      expect(shell).toHaveAttribute('aria-busy', 'true')

      // 验证 BrandLoader 状态与文案
      const statusRole = screen.getByRole('status')
      expect(statusRole).toHaveTextContent('正在进入开项 KaiPilot…')

      // 水合等待期禁止触发重定向
      expect(replaceMock).not.toHaveBeenCalled()
      expect(pushMock).not.toHaveBeenCalled()
    })
  })

  describe('深空暗黑背景与 BrandLoader 尺寸参数绑定', () => {
    test('RootSpaceLoadingShell 消费 --nx-space-bg 底色与 data-next-track 命名空间', () => {
      const { container } = render(<RootSpaceLoadingShell />)

      const shell = container.querySelector('[data-root-space-loading]')
      expect(shell).not.toBeNull()
      expect(shell).toHaveAttribute('data-next-track')
      expect(shell?.className).toContain('bg-[var(--nx-space-bg)]')
      expect(shell?.className).toContain('text-[var(--nx-text-secondary)]')
      expect(shell?.className).toContain('min-h-screen')
      expect(shell?.className).toContain('items-center')
      expect(shell?.className).toContain('justify-center')
    })

    test('BrandLoader 动画组件绑定 64px 尺寸与无障碍属性', () => {
      const { container } = render(<RootSpaceLoadingShell />)

      const loaderImg = container.querySelector('img')
      expect(loaderImg).not.toBeNull()
      expect(loaderImg).toHaveAttribute('width', '64')
      expect(loaderImg).toHaveAttribute('height', '64')

      const status = screen.getByRole('status')
      expect(status).toHaveAttribute('aria-live', 'polite')
      expect(status).toHaveTextContent('正在进入开项 KaiPilot…')
    })

    test('默认/沉浸档位下挂载 .nx-space-atmosphere 空间氛围渐变', () => {
      act(() => {
        useNextTrackStore.setState({ immersionTier: 'immersive' })
      })

      const { container } = render(<RootSpaceLoadingShell />)
      const shell = container.querySelector('[data-root-space-loading]')
      expect(shell?.className).toContain('nx-space-atmosphere')
      expect(shell).toHaveAttribute('data-immersion', 'immersive')
    })
  })

  describe('精确档（precise）纯平背景降级（RL-15）', () => {
    test('通过 store 设定 precise 档：剥离 .nx-space-atmosphere 光晕并保留纯黑底', () => {
      act(() => {
        useNextTrackStore.setState({ immersionTier: 'precise' })
      })

      const { container } = render(<RootSpaceLoadingShell />)
      const shell = container.querySelector('[data-root-space-loading]')
      expect(shell).not.toBeNull()

      // 精确档属性同步
      expect(shell).toHaveAttribute('data-immersion', 'precise')
      expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')

      // 光晕剥离，纯平背景
      expect(shell?.className).not.toContain('nx-space-atmosphere')
      expect(shell?.className).toContain('bg-[var(--nx-space-bg)]')
    })

    test('通过 prop 显式指定 immersionTier="precise"：同样实施纯平降级', () => {
      const { container } = render(<RootSpaceLoadingShell immersionTier="precise" />)
      const shell = container.querySelector('[data-root-space-loading]')

      expect(shell).toHaveAttribute('data-immersion', 'precise')
      expect(shell?.className).not.toContain('nx-space-atmosphere')
      expect(shell?.className).toContain('bg-[var(--nx-space-bg)]')
    })

    test('RL-15 视觉红线：外壳加载态零 Canvas、零 WebGL 画布节点', () => {
      const { container } = render(<RootSpaceLoadingShell />)
      expect(container.querySelector('canvas')).toBeNull()
      expect(container.querySelectorAll('canvas')).toHaveLength(0)
    })
  })

  describe('RL-01 零写铁律断言', () => {
    test('根路径挂载与加载态全生命周期中，外部 HTTP 写请求严格为 0', () => {
      act(() => {
        useAuthStore.setState({ isAuthenticated: false, hasHydrated: false })
      })

      const { unmount } = render(<Home />)

      // 验证未产生任何写请求（POST / PUT / PATCH / DELETE）
      const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE']
      const writeCalls = fetchSpy.mock.calls.filter((args) => {
        const init = args[1] as RequestInit | undefined
        const method = (init?.method || 'GET').toUpperCase()
        return writeMethods.includes(method)
      })

      expect(writeCalls).toHaveLength(0)
      expect(fetchSpy).not.toHaveBeenCalled()

      unmount()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
