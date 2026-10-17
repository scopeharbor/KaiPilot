'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NextAppShell } from '@/components/next/layout/NextAppShell'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { isNextUiEnabledForOrg } from '@/lib/feature-flags/next-ui-gate'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import './next-tokens.css'
import './next-legacy-bridge.css'

/**
 * 新轨路由组布局（v3-ui-next-track-foundation D-a / tasks 3.5、4.1）。
 *
 * - 导入 `next-tokens.css`（[data-next-track] 作用域，见 D-e）与 `next-legacy-bridge.css`
 *   （内嵌旧版组件的主题桥接，仅 data-next-legacy-ui 作用域）；
 * - 挂载 `NextAppShell`（沉浸阶梯状态由此集成，`<html data-immersion>` 同步在 hook 内）；
 * - 路由守卫（tasks 4.1）：认证水合完成后——
 *   未认证 → `/next-login?next=...`；已认证但组织 Flag 关闭 → `/dashboard`；
 *   认证水合完成前只渲染骨架占位，禁止触发重定向（防 hydration race，design 风险表）。
 * - 守卫在 effect 中执行并随 `hasHydrated / isAuthenticated / enabled` 变化重评，
 *   组织切换导致 Flag 失效时也会立即踢回旧轨（Stale Flag 风险缓解）。
 */
export default function NextRouteLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const user = useAuthStore((state) => state.user)

  const enabled = React.useMemo(
    () => isNextUiEnabledForOrg(selectEffectiveOrganizationId({ currentOrganizationId, user })),
    [currentOrganizationId, user],
  )

  React.useEffect(() => {
    if (!hasHydrated) return
    if (!isAuthenticated) {
      router.replace(`/next-login?next=${encodeURIComponent(safeNextPath(pathname, '/next'))}`)
      return
    }
    if (!enabled) {
      router.replace('/dashboard')
    }
  }, [hasHydrated, isAuthenticated, enabled, pathname, router])

  // 认证水合前：骨架占位，绝不对未恢复的会话态下结论。
  if (!hasHydrated) {
    return (
      <div
        data-next-track
        aria-busy="true"
        className="flex min-h-screen items-center justify-center bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)]"
      >
        <span className="text-sm">正在加载新页面…</span>
      </div>
    )
  }

  // 未认证 / Flag 关闭：不渲染任何内容，重定向由上面的 effect 完成。
  if (!isAuthenticated || !enabled) return null

  return <NextAppShell>{children}</NextAppShell>
}
