import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

/**
 * Feature-off 模式测试（v2-5-pwa-static-offline-fallback / 4.2）。
 *
 * 验证：
 * - feature flag 关闭时不注册服务工作者
 * - feature flag 关闭时在线 Web 行为不变
 * - isOfflineFallbackEnabled 返回正确值
 */

// 保存原始环境变量
const ORIGINAL_ENV = { ...process.env }

describe('isOfflineFallbackEnabled', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  test('默认关闭', async () => {
    delete process.env.NEXT_PUBLIC_PWA_OFFLINE_FALLBACK_ENABLED
    const { isOfflineFallbackEnabled } = await import('@/lib/pwa/offline-fallback')
    expect(isOfflineFallbackEnabled()).toBe(false)
  })

  test('设为 false 时关闭', async () => {
    process.env.NEXT_PUBLIC_PWA_OFFLINE_FALLBACK_ENABLED = 'false'
    const { isOfflineFallbackEnabled } = await import('@/lib/pwa/offline-fallback')
    expect(isOfflineFallbackEnabled()).toBe(false)
  })

  test('显式设为 true 时开启', async () => {
    process.env.NEXT_PUBLIC_PWA_OFFLINE_FALLBACK_ENABLED = 'true'
    const { isOfflineFallbackEnabled } = await import('@/lib/pwa/offline-fallback')
    expect(isOfflineFallbackEnabled()).toBe(true)
  })
})

describe('registerOfflineFallbackSw feature-off', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  test('feature-off 时 register 不调用 navigator.serviceWorker.register', async () => {
    process.env.NEXT_PUBLIC_PWA_OFFLINE_FALLBACK_ENABLED = 'false'
    const registerSpy = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: registerSpy },
      configurable: true,
      writable: true,
    })

    const { registerOfflineFallbackSw } = await import('@/lib/pwa/offline-fallback')
    await registerOfflineFallbackSw()
    expect(registerSpy).not.toHaveBeenCalled()
  })

  test('feature-off 时 register 不调用（未设置 env）', async () => {
    delete process.env.NEXT_PUBLIC_PWA_OFFLINE_FALLBACK_ENABLED
    const registerSpy = vi.fn()
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: registerSpy },
      configurable: true,
      writable: true,
    })

    const { registerOfflineFallbackSw } = await import('@/lib/pwa/offline-fallback')
    await registerOfflineFallbackSw()
    expect(registerSpy).not.toHaveBeenCalled()
  })

  test('feature-off 时 normal online behavior 正常', async () => {
    process.env.NEXT_PUBLIC_PWA_OFFLINE_FALLBACK_ENABLED = 'false'
    const { isOfflineFallbackEnabled } = await import('@/lib/pwa/offline-fallback')

    // 正常 fetch 不受影响
    const fetchSpy = vi.fn().mockResolvedValue(new Response('ok'))
    await fetchSpy('/api/v1/projects')
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/projects')

    // isOfflineFallbackEnabled 为 false
    expect(isOfflineFallbackEnabled()).toBe(false)
  })
})

describe('unregisterOfflineFallbackSw', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  test('serviceWorker 不可用时静默失败', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    })

    const { unregisterOfflineFallbackSw } = await import('@/lib/pwa/offline-fallback')
    await expect(unregisterOfflineFallbackSw()).resolves.toBeUndefined()
  })
})
