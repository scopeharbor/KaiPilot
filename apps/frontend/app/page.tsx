'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { RootSpaceLoadingShell } from '@/components/next/auth/RootSpaceLoadingShell'
import './(next)/next-tokens.css'

/**
 * 根路由 `/` —— 确定性双轨分流入口（v3-ui-next-batch2-auth-shell-assimilation W1 · tasks 1.1 / spec next-auth-shell-assimilation）。
 *
 * 遵循 D23 红线（旧轨长期保留不退役、根路径不做强制重定向）：
 * - 四象限确定性分流矩阵：
 *   - track === 'next' && isAuthenticated === true  → router.replace('/next')
 *   - track === 'next' && isAuthenticated === false → router.replace('/next-login')
 *   - track === 'legacy' && isAuthenticated === true  → router.replace('/dashboard')
 *   - track === 'legacy' && isAuthenticated === false → router.replace('/login')
 * - 默认偏好判定：未曾显式选择新轨（空值或 legacy）恒默认按 'legacy' 处理，绝不静默自动导向新轨。
 * - 历史栈保护：统一 100% 使用 router.replace，杜绝 router.push 造成的回环与死循环。
 * - 水合防护：会话（auth-store）与轨道偏好（next-track-store）异步水合未全部就绪前，
 *   不触发任何重定向，渲染 BrandLoader 深空沉浸加载态（RootSpaceLoadingShell）。
 */
export default function Home() {
  const router = useRouter()
  const track = useNextTrackStore((state) => state.track)
  const authHydrated = useAuthStore((state) => state.hasHydrated)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const redirectedTargetRef = useRef<string | null>(null)

  const [trackHydrated, setTrackHydrated] = useState(() => {
    return typeof useNextTrackStore?.persist?.hasHydrated === 'function'
      ? useNextTrackStore.persist.hasHydrated()
      : true
  })

  useEffect(() => {
    if (typeof useNextTrackStore?.persist?.hasHydrated === 'function') {
      if (useNextTrackStore.persist.hasHydrated()) {
        return
      }
      return useNextTrackStore.persist.onFinishHydration(() => {
        setTrackHydrated(true)
      })
    }
  }, [])

  const isHydrated = authHydrated && trackHydrated

  useEffect(() => {
    if (!isHydrated) return

    const isNextTrack = track === 'next'
    const target = isNextTrack
      ? isAuthenticated
        ? '/next'
        : '/next-login'
      : isAuthenticated
        ? '/dashboard'
        : '/login'

    if (redirectedTargetRef.current === target) return
    redirectedTargetRef.current = target
    router.replace(target)
  }, [isHydrated, track, isAuthenticated, router])

  return <RootSpaceLoadingShell />
}
