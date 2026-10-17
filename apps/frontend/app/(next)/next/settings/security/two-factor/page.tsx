import type { Metadata } from 'next'
import { TwoFactorWorkspace } from '@/components/next/settings/security/TwoFactorWorkspace'

/**
 * 两步验证页（`/next/settings/security/two-factor`，v3-ui-next-settings-admin-domains
 * W1 · tasks 1.11，spec「个人两步验证向导」，design D-2FA）。
 *
 * 与本目录下的企业安全页（compliance/dlp/kms/sso）不同：两步验证是**本人账号安全**
 * 能力而非企业能力——不设企业版门控、不设权限门（任何登录用户都应能给自己的账号
 * 加一道锁），服务端同样只允许操作当前会话用户本人的 2FA。
 *
 * 路由路径保持与旧轨 `/settings/security/two-factor` 近似（D-2FA），个人资料页的
 * 快捷入口与本页保持同一语义。页入口只做装配：登录守卫由 `(next)` 壳层提供，
 * 三态与安全约束全部由 `TwoFactorWorkspace` 承担。
 */
export const metadata: Metadata = {
  title: '两步验证',
  robots: { index: false, follow: false },
}

export default function NextTwoFactorSettingsPage() {
  return <TwoFactorWorkspace />
}
