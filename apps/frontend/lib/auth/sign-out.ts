import { authApi } from '@/lib/api/auth'
import { clearPwaOfflineCaches } from '@/lib/pwa/offline-fallback'
import { useAuthStore } from '@/stores/auth-store'

/** 浏览器推送退订（best-effort，不阻塞）。 */
async function browserPushCleanup(): Promise<void> {
  try {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      await subscription.unsubscribe()
    }
  } catch {
    // 忽略清理失败
  }
}

/**
 * 退出登录（旧版用户菜单、新版个人资料页与 AI 同事共用）：通知服务端吊销会话，
 * 再清理 PWA 离线缓存、浏览器推送订阅与本地会话。网络失败时仍清本地会话，
 * 避免把用户困在失效状态；登录守卫随后把页面带回登录页。
 */
export async function signOutSession(): Promise<void> {
  const { accessToken, refreshToken } = useAuthStore.getState()
  try {
    if (accessToken && refreshToken) await authApi.logout(accessToken, refreshToken)
  } catch {
    // 网络失败时仍清理本地会话
  }
  void clearPwaOfflineCaches()
  void browserPushCleanup()
  useAuthStore.getState().clear()
}
