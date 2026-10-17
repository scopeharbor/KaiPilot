/**
 * PWA 离线 Fallback 工具函数。
 *
 * 提供：
 * - registerOfflineFallbackSw：注册离线 fallback 服务工作者
 * - unregisterOfflineFallbackSw：注销离线 fallback 服务工作者
 * - clearPwaOfflineCaches：清理 PWA 所属缓存
 * - isOfflineFallbackEnabled：检查 feature flag 是否启用
 *
 * @see design.md D4-D5 / spec pwa-static-offline-fallback
 */

/** 本 change 使用的缓存名前缀。 */
export const PWA_CACHE_PREFIX = 'aiproj-pwa-'

/** 离线 fallback 服务工作者脚本路径。 */
export const SW_PATH = '/service-worker.js'

/**
 * 检查离线 fallback 功能是否启用。
 * 由环境变量 NEXT_PUBLIC_PWA_OFFLINE_FALLBACK_ENABLED 控制。
 */
export function isOfflineFallbackEnabled(): boolean {
  if (typeof process === 'undefined') return false
  return process.env.NEXT_PUBLIC_PWA_OFFLINE_FALLBACK_ENABLED === 'true'
}

/**
 * 注册离线 fallback 服务工作者。
 *
 * 仅在浏览器支持且 feature flag 启用时注册。
 * 注册失败不抛出，仅 console.warn。
 */
export async function registerOfflineFallbackSw(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!isOfflineFallbackEnabled()) return

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, {
      scope: '/',
    })
    // 等待激活，确保新 worker 生效
    if (registration.installing) {
      await new Promise<void>((resolve) => {
        registration.installing!.addEventListener('statechange', () => {
          if (registration.active) resolve()
        })
      })
    }
  } catch (error) {
    console.warn('PWA offline fallback SW registration failed:', error)
  }
}

/**
 * 注销离线 fallback 服务工作者。
 *
 * 查找匹配 SW_PATH 的 worker 并注销。
 * 注销失败不抛出，仅 console.warn。
 */
export async function unregisterOfflineFallbackSw(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return

  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH)
    if (registration) {
      await registration.unregister()
    }
  } catch (error) {
    console.warn('PWA offline fallback SW unregistration failed:', error)
  }
}

/**
 * 清理 PWA 所属缓存。
 *
 * 只删除以 PWA_CACHE_PREFIX 开头的缓存，不触碰其他缓存。
 * 当浏览器不支持 Cache API、删除失败时优雅降级。
 * 不抛出，不阻塞调用方。
 */
export async function clearPwaOfflineCaches(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('caches' in window)) return

  try {
    const cacheKeys = await caches.keys()
    const pwaCaches = cacheKeys.filter((key) => key.startsWith(PWA_CACHE_PREFIX))
    await Promise.all(pwaCaches.map((key) => caches.delete(key)))
  } catch (error) {
    console.warn('PWA cache cleanup failed:', error)
  }
}

/**
 * 完整回退：禁用离线 fallback 功能。
 *
 * 1. 注销服务工作者
 * 2. 清理 PWA 所属缓存
 *
 * 不抛出，不阻塞调用方。
 */
export async function disableOfflineFallback(): Promise<void> {
  await unregisterOfflineFallbackSw()
  await clearPwaOfflineCaches()
}
