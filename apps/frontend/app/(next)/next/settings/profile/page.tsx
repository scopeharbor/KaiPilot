import type { Metadata } from 'next'
import { ProfileWorkspace } from '@/components/next/settings/profile/ProfileWorkspace'

/**
 * 个人资料页（`/next/settings/profile`，v3-ui-next-settings-admin-domains W1 · tasks 1.7，
 * spec「个人资料与新旧 UI 轨偏好入口」）。
 *
 * 只读身份/组织展示 + 两步验证快捷入口 + 「界面呈现」新旧轨偏好卡（D-PREF / D2）；
 * 全部数据取自已水合的 `useAuthStore`（`auth/me` 契约），页面零业务请求。
 * 会话未水合骨架与未登录中性提示由工作区组件承担；登录守卫由 `(next)` 壳层提供。
 */
export const metadata: Metadata = {
  title: '个人资料',
  robots: { index: false, follow: false },
}

export default function NextSettingsProfilePage() {
  return <ProfileWorkspace />
}
