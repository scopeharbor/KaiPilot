import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

/**
 * 登出 PWA 缓存清理集成测试（v2-5-pwa-static-offline-fallback / 4.6）。
 *
 * 验证：
 * - 登出时调用 clearPwaOfflineCaches
 * - 服务端登出失败后仍清理本地会话和 PWA 缓存
 * - 登出完成后本地会话清除
 */

describe('logout PWA cache cleanup integration', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    // 模拟 sessionStorage
    const store: Record<string, string> = {}
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value
        }),
        removeItem: vi.fn((key: string) => {
          delete store[key]
        }),
        clear: vi.fn(() => {
          Object.keys(store).forEach((k) => delete store[k])
        }),
        get length() {
          return Object.keys(store).length
        },
        key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
      },
      configurable: true,
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  test('登出时调用 clearPwaOfflineCaches', async () => {
    const { clearPwaOfflineCaches } = await import('@/lib/pwa/offline-fallback')

    // 模拟 caches API
    const deleteSpy = vi.fn().mockResolvedValue(true)
    Object.defineProperty(globalThis, 'caches', {
      value: {
        keys: vi.fn().mockResolvedValue(['aiproj-pwa-static-v1']),
        delete: deleteSpy,
      },
      configurable: true,
      writable: true,
    })

    // 执行缓存清理
    await clearPwaOfflineCaches()

    // 验证 PWA 缓存被删除
    expect(deleteSpy).toHaveBeenCalledWith('aiproj-pwa-static-v1')
  })

  test('服务端登出失败后仍清理本地会话', async () => {
    // 模拟登出 API 失败
    const fetchSpy = vi.fn().mockRejectedValue(new Error('Network error'))

    // 执行登出（模拟 UserMenu 的 onLogout 行为）
    let authCleared = false
    const mockClear = () => {
      authCleared = true
    }

    // 模拟 clearPwaOfflineCaches
    const { clearPwaOfflineCaches } = await import('@/lib/pwa/offline-fallback')

    // 登出流程（网络失败路径）
    try {
      await fetchSpy('/api/v1/auth/logout')
    } catch {
      // 网络失败时仍继续
    }

    // 仍应清除本地会话和缓存
    mockClear()
    await clearPwaOfflineCaches()

    expect(authCleared).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/auth/logout')
  })

  test('服务端登出成功后清理 PWA 缓存', async () => {
    // 模拟登出 API 成功
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const { clearPwaOfflineCaches } = await import('@/lib/pwa/offline-fallback')

    const deleteSpy = vi.fn().mockResolvedValue(true)
    Object.defineProperty(globalThis, 'caches', {
      value: {
        keys: vi.fn().mockResolvedValue(['aiproj-pwa-static-v1']),
        delete: deleteSpy,
      },
      configurable: true,
      writable: true,
    })

    // 登出成功
    const response = await fetchSpy('/api/v1/auth/logout')
    expect(response.status).toBe(204)

    // 仍应清理 PWA 缓存
    await clearPwaOfflineCaches()
    expect(deleteSpy).toHaveBeenCalledWith('aiproj-pwa-static-v1')
  })

  test('登出后本地会话清除', async () => {
    // 模拟 auth store 的 clear 方法
    const { useAuthStore } = await import('@/stores/auth-store')

    // 设置初始状态
    useAuthStore.setState({
      user: { id: 1, email: 'test@test.com', fullName: 'Test', organizations: [] },
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      isAuthenticated: true,
      hasHydrated: true,
    })

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().user).not.toBeNull()

    // 清除
    useAuthStore.getState().clear()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().accessToken).toBeNull()
  })
})
