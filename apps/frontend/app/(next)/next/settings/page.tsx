import type { Metadata } from 'next'
import { SettingsLandingHub } from '@/components/next/settings/SettingsLandingHub'

/**
 * 设置空间门户首页（`/next/settings`，v3-ui-next-settings-admin-domains W1 · tasks 1.5，
 * spec「设置空间门户与信息架构」要求 1，design D-IA / D-HUB）。
 *
 * 旧轨 `/settings` 是「稳定父路由 → /settings/profile 重定向」的占位；本页按 D-IA
 * 升维为设置空间总览 + 全节检索入口，承载 15 个设置节的五组节卡（节卡白名单见
 * `lib/next/settings/settings-sections.ts`）。
 *
 * 权限与三态均由工作区组件承担（纯静态渲染：无数据请求、无独立准入权限——
 * 门在节卡级按 `permissions`/`planTier` 收敛，RL-06）。壳层已提供登录守卫。
 */
export const metadata: Metadata = {
  title: '设置空间',
  robots: { index: false, follow: false },
}

export default function NextSettingsLandingPage() {
  return <SettingsLandingHub />
}
