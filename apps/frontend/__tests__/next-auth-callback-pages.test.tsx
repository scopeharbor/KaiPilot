import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GoogleAuthCallbackPage from '@/app/auth/google/callback/page'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import * as apiClient from '@/lib/api-client'

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(),
}))

function encodeUser(user: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(user), 'utf8').toString('base64url')
}

const SAMPLE_USER = {
  id: 101,
  email: 'deepspace@aiproj.test',
  fullName: '深空领航员',
  organizations: [{ id: 1, name: '深空总部', role: 'owner' }],
}

describe('W4 任务 4.4: 三协议回跳深空协议桩握手与错误状态回归测试', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let invalidateSpy: ReturnType<typeof vi.spyOn>

  function stubHash(hash: string) {
    vi.stubGlobal('location', { hash, assign: vi.fn(), origin: 'http://localhost:3000' })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hash, origin: 'http://localhost:3000', assign: vi.fn() },
    })
    window.history.replaceState = vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useNextTrackStore.getState().reset()
    useAuthStore.getState().clear()

    // 严禁 vi.mock('@/lib/api/*')，全局 mock fetch 处理会话写入与租户上下文
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          effectiveContext: {
            actorRef: 'user-101',
            organizationId: 1,
            scopeMode: 'organization',
            selectionSource: 'server_default',
            resolutionReason: 'verified_member',
            scopeHash: 'hash-101',
            resolvedAt: new Date().toISOString(),
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    // 监控租户缓存失效
    invalidateSpy = vi.spyOn(apiClient, 'invalidateTenantScopedCaches')

    if (!window.matchMedia) {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    invalidateSpy.mockRestore()
  })

  describe('1. Google OAuth 回跳协议桩 (/auth/google/callback)', () => {
    it('提取 fragment 成功完成登录、抹掉 hash 并跳转', async () => {
      const hash = `#accessToken=google-at&refreshToken=google-rt&user=${encodeUser(SAMPLE_USER)}&next=/projects/10`
      stubHash(hash)

      render(<GoogleAuthCallbackPage />)

      await waitFor(() => {
        expect(useAuthStore.getState().isAuthenticated).toBe(true)
      })

      expect(useAuthStore.getState().user?.email).toBe('deepspace@aiproj.test')
      expect(useAuthStore.getState().accessToken).toBe('google-at')
      expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/auth/google/callback')
      expect(routerMock.replace).toHaveBeenCalledWith('/projects/10')
      expect(routerMock.refresh).toHaveBeenCalled()
    })

    it('fragment 缺少参数时在深空外壳中展示暗黑仪器风错误卡，并支持返回登录', async () => {
      stubHash('#accessToken=only-token')
      useNextTrackStore.getState().setTrack('next')

      render(<GoogleAuthCallbackPage />)

      const alert = await screen.findByRole('alert')
      expect(alert).toBeTruthy()
      expect(screen.getByText('Google 登录未完成')).toBeTruthy()
      expect(screen.getByText('Google 登录回调缺少系统会话，请重新登录。')).toBeTruthy()

      // 会话未写入，不发生跳转
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(routerMock.replace).not.toHaveBeenCalled()

      // 点击返回登录导流至 /next-login
      const returnBtn = screen.getByRole('button', { name: '返回登录' })
      fireEvent.click(returnBtn)
      expect(routerMock.replace).toHaveBeenCalledWith('/next-login')
    })
  })
})
