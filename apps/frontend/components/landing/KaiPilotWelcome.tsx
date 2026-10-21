'use client'

import { resolveSourceCodeUrl } from '@/components/edition/SourceCodeLink'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { KaiPilotLanding } from './KaiPilotLanding'

/** 官方源码仓库（导出时由发布参数 PUBLIC_REPO_URL 填入）。 */
export const KAIPILOT_REPO_URL = 'https://github.com/scopeharbor/KaiPilot'

/**
 * 「登录控制台」按钮的去向，与根路由的分流规则一致：
 * 未登录去登录页、已登录去工作台；选过新版界面的用户去新版对应页面。
 */
export function resolveConsoleHref(track: string | null | undefined, isAuthenticated: boolean) {
  if (track === 'next') return isAuthenticated ? '/next' : '/next-login'
  return isAuthenticated ? '/dashboard' : '/login'
}

/** /welcome 页面：读登录态与界面偏好，换算成介绍页的按钮地址。 */
export function KaiPilotWelcome() {
  const track = useNextTrackStore((state) => state.track)
  const hydrated = useAuthStore((state) => state.hasHydrated)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const authenticated = hydrated && isAuthenticated
  return (
    <KaiPilotLanding
      consoleHref={resolveConsoleHref(track, authenticated)}
      authenticated={authenticated}
      repoUrl={KAIPILOT_REPO_URL}
      sourceUrl={resolveSourceCodeUrl()}
    />
  )
}
