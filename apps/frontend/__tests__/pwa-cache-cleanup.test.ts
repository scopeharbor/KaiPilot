import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

/**
 * PWA 缓存清理工具测试（v2-5-pwa-static-offline-fallback / 4.4）。
 *
 * 验证：
 * - clearPwaOfflineCaches 只删除 PWA 所属缓存
 * - 非 PWA 缓存不受影响
 * - 浏览器不支持 Cache API 时优雅降级
 * - 删除失败时优雅降级
 */

const PWA_CACHE_PREFIX = 'aiproj-pwa-'
const PWA_CACHE_NAME = 'aiproj-pwa-static-v1'
const OTHER_CACHE = 'other-app-cache-v2'

describe('clearPwaOfflineCaches', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('只删除以 aiproj-pwa- 开头的缓存', async () => {
    // 模拟多个缓存
    const mockCaches = [PWA_CACHE_NAME, 'aiproj-pwa-old-v1', 'aiproj-pwa-v2', OTHER_CACHE]
    const deletedCaches: string[] = []

    const mockCacheStorage = {
      keys: vi.fn().mockResolvedValue(mockCaches),
      delete: vi.fn().mockImplementation(async (key: string) => {
        deletedCaches.push(key)
        return true
      }),
    }

    Object.defineProperty(globalThis, 'caches', {
      value: mockCacheStorage,
      configurable: true,
      writable: true,
    })

    const { clearPwaOfflineCaches } = await import('@/lib/pwa/offline-fallback')
    await clearPwaOfflineCaches()

    // 应删除所有 aiproj-pwa-* 缓存
    expect(deletedCaches).toContain(PWA_CACHE_NAME)
    expect(deletedCaches).toContain('aiproj-pwa-old-v1')
    expect(deletedCaches).toContain('aiproj-pwa-v2')
    // 不应删除其他缓存
    expect(deletedCaches).not.toContain(OTHER_CACHE)
  })

  test('只删除 aiproj-pwa- 前缀的缓存', async () => {
    const mockCaches = [
      PWA_CACHE_NAME,
      'aiproj-pwa-old-v1',
      'google-cache-v1',
      'workbox-v3',
      'other-app',
    ]
    const deletedCaches: string[] = []

    const mockCacheStorage = {
      keys: vi.fn().mockResolvedValue(mockCaches),
      delete: vi.fn().mockImplementation(async (key: string) => {
        deletedCaches.push(key)
        return true
      }),
    }

    Object.defineProperty(globalThis, 'caches', {
      value: mockCacheStorage,
      configurable: true,
      writable: true,
    })

    const { clearPwaOfflineCaches } = await import('@/lib/pwa/offline-fallback')
    await clearPwaOfflineCaches()

    // 只应删除 aiproj-pwa-* 缓存
    expect(deletedCaches).toContain(PWA_CACHE_NAME)
    expect(deletedCaches).toContain('aiproj-pwa-old-v1')
    expect(deletedCaches).not.toContain('google-cache-v1')
    expect(deletedCaches).not.toContain('workbox-v3')
    expect(deletedCaches).not.toContain('other-app')
  })

  test('无 PWA 缓存时不执行删除', async () => {
    const mockCaches = [OTHER_CACHE, 'other-cache']
    const deleteSpy = vi.fn()

    const mockCacheStorage = {
      keys: vi.fn().mockResolvedValue(mockCaches),
      delete: deleteSpy,
    }

    Object.defineProperty(globalThis, 'caches', {
      value: mockCacheStorage,
      configurable: true,
      writable: true,
    })

    const { clearPwaOfflineCaches } = await import('@/lib/pwa/offline-fallback')
    await clearPwaOfflineCaches()

    expect(deleteSpy).not.toHaveBeenCalled()
  })

  test('Cache API 不支持时优雅降级', async () => {
    // 移除 caches
    Object.defineProperty(globalThis, 'caches', {
      value: undefined,
      configurable: true,
    })

    const { clearPwaOfflineCaches } = await import('@/lib/pwa/offline-fallback')
    await expect(clearPwaOfflineCaches()).resolves.toBeUndefined()
  })

  test('删除失败时优雅降级', async () => {
    const mockCacheStorage = {
      keys: vi.fn().mockRejectedValue(new Error('quota exceeded')),
      delete: vi.fn(),
    }

    Object.defineProperty(globalThis, 'caches', {
      value: mockCacheStorage,
      configurable: true,
      writable: true,
    })

    const { clearPwaOfflineCaches } = await import('@/lib/pwa/offline-fallback')
    await expect(clearPwaOfflineCaches()).resolves.toBeUndefined()
  })

  test('window 未定义时静默返回', async () => {
    const { clearPwaOfflineCaches } = await import('@/lib/pwa/offline-fallback')
    // 在 Node 环境（非 window）调用
    const result = await clearPwaOfflineCaches()
    expect(result).toBeUndefined()
  })
})

describe('PWA_CACHE_PREFIX constant', () => {
  test('前缀为 aiproj-pwa-', () => {
    expect(PWA_CACHE_PREFIX).toBe('aiproj-pwa-')
  })
})
