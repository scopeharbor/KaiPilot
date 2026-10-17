'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { setOnSessionExpired } from '@/lib/api-client'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { useAuthStore } from '@/stores/auth-store'
import { clearPwaOfflineCaches } from '@/lib/pwa/offline-fallback'
import { BrandLoader } from '@/components/ui/BrandLogo'

/** 浏览器推送退订（best-effort，不阻塞）。 */
async function browserPushCleanup() {
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

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    void Promise.resolve(useAuthStore.persist.rehydrate()).finally(() => {
      useAuthStore.getState().setHasHydrated(true)
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    setOnSessionExpired(() => {
      if (window.location.pathname === '/login') return
      // 清理 PWA 离线缓存和浏览器推送订阅（不阻塞会话清理和跳转）
      clearPwaOfflineCaches()
      browserPushCleanup()
      const current = safeNextPath(`${window.location.pathname}${window.location.search}`)
      router.replace(`/login?next=${encodeURIComponent(current)}`)
    })
    return () => setOnSessionExpired(null)
  }, [router])

  // 在认证状态恢复前阻止子组件渲染，防止 React Query 查询在无 token 时触发
  if (!hydrated) {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-background px-8"
        aria-busy="true"
      >
        <BrandLoader size={72} label="正在载入开项 OpenXiang…" />
      </main>
    )
  }

  return children
}
