/**
 * v3-ui-next-batch2-auth-shell-assimilation W1 · tasks 1.2
 * 根路径双轨偏好分流与未登录定向测试（next-root-track-dispatch.test.tsx）
 *
 * 覆盖：
 * 1. 四象限分流契约（D23）：
 *    - track === 'next' && isAuthenticated === true  → router.replace('/next')
 *    - track === 'next' && isAuthenticated === false → router.replace('/next-login')
 *    - track === 'legacy' && isAuthenticated === true  → router.replace('/dashboard')
 *    - track === 'legacy' && isAuthenticated === false → router.replace('/login')
 * 2. 默认偏好（未选择过 / 首次访问）默认落在旧轨，绝不强制新轨重定向（D23 红线）；
 * 3. 历史栈保护：严格统一使用 router.replace，杜绝 router.push 造成的回环死循环；
 * 4. 会话与偏好水合防护：未水合完成前不触发任何路由重定向。
 */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Home from '@/app/page'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore, type TrackType } from '@/stores/next-track-store'

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

describe('根路径确定性双轨分流测试（tasks 1.1 / 1.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    act(() => {
      useNextTrackStore.getState().reset()
      useAuthStore.setState({
        isAuthenticated: false,
        hasHydrated: true,
        user: null,
        accessToken: null,
      })
    })
  })

  afterEach(() => {
    act(() => {
      useNextTrackStore.getState().reset()
    })
    vi.unstubAllGlobals()
  })

  describe('四象限确定性分流契约', () => {
    test('象限 1：偏好为 next 且已登录时定向到 /next，严格使用 replace', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'next' })
        useAuthStore.setState({ isAuthenticated: true, hasHydrated: true })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledTimes(1)
      expect(replaceMock).toHaveBeenCalledWith('/next')
      expect(pushMock).not.toHaveBeenCalled()
    })

    test('象限 2：偏好为 next 且未登录时定向到 /next-login，严格使用 replace', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'next' })
        useAuthStore.setState({ isAuthenticated: false, hasHydrated: true })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledTimes(1)
      expect(replaceMock).toHaveBeenCalledWith('/next-login')
      expect(pushMock).not.toHaveBeenCalled()
    })

    test('象限 3：偏好为 legacy 且已登录时定向到 /dashboard，严格使用 replace', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'legacy' })
        useAuthStore.setState({ isAuthenticated: true, hasHydrated: true })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledTimes(1)
      expect(replaceMock).toHaveBeenCalledWith('/dashboard')
      expect(pushMock).not.toHaveBeenCalled()
    })

    test('象限 4：偏好为 legacy 且未登录时定向到 /login，严格使用 replace', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'legacy' })
        useAuthStore.setState({ isAuthenticated: false, hasHydrated: true })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledTimes(1)
      expect(replaceMock).toHaveBeenCalledWith('/login')
      expect(pushMock).not.toHaveBeenCalled()
    })
  })

  describe('D23 红线守护：默认旧轨与非强制重定向', () => {
    test('默认未显式选择偏好（reset 后状态）+ 已登录 → 严格落旧轨 /dashboard，绝不强制新轨', () => {
      expect(useNextTrackStore.getState().track).toBe('legacy')
      act(() => {
        useAuthStore.setState({ isAuthenticated: true, hasHydrated: true })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledWith('/dashboard')
      expect(replaceMock).not.toHaveBeenCalledWith('/next')
      expect(pushMock).not.toHaveBeenCalled()
    })

    test('默认未显式选择偏好 + 未登录 → 严格落旧轨 /login，绝不强制新轨登录页', () => {
      expect(useNextTrackStore.getState().track).toBe('legacy')
      act(() => {
        useAuthStore.setState({ isAuthenticated: false, hasHydrated: true })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledWith('/login')
      expect(replaceMock).not.toHaveBeenCalledWith('/next-login')
      expect(pushMock).not.toHaveBeenCalled()
    })

    test('异常未知偏好值兜底：按 legacy 安全降级，绝不误入新轨', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'unknown_track' as unknown as TrackType })
        useAuthStore.setState({ isAuthenticated: true, hasHydrated: true })
      })

      render(<Home />)

      expect(replaceMock).toHaveBeenCalledWith('/dashboard')
      expect(replaceMock).not.toHaveBeenCalledWith('/next')
    })
  })

  describe('会话与偏好异步水合防护', () => {
    test('会话未完成水合（hasHydrated: false）时不触发重定向，呈现深空加载态', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'next' })
        useAuthStore.setState({ isAuthenticated: true, hasHydrated: false })
      })

      render(<Home />)

      expect(replaceMock).not.toHaveBeenCalled()
      expect(pushMock).not.toHaveBeenCalled()
      expect(screen.getByRole('status')).toHaveTextContent('正在进入开项 OpenXiang…')
    })

    test('会话完成水合后，自动评估并执行确定性分流', () => {
      act(() => {
        useNextTrackStore.setState({ track: 'next' })
        useAuthStore.setState({ isAuthenticated: true, hasHydrated: false })
      })

      const { rerender } = render(<Home />)
      expect(replaceMock).not.toHaveBeenCalled()

      // 模拟水合就绪
      act(() => {
        useAuthStore.setState({ isAuthenticated: true, hasHydrated: true })
      })
      rerender(<Home />)

      expect(replaceMock).toHaveBeenCalledTimes(1)
      expect(replaceMock).toHaveBeenCalledWith('/next')
    })
  })
})
