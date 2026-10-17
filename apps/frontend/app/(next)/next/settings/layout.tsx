'use client'

import * as React from 'react'
import { SettingsSpaceNav } from '@/components/next/settings/SettingsSpaceNav'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'

/**
 * 设置空间壳（v3-ui-next-settings-admin-domains W1 · tasks 1.3，
 * spec「设置空间门户与信息架构」要求 1）。
 *
 * - 左栏节导航侧栏（`SettingsSpaceNav`，分组/节序由 `settings-sections.ts` 静态
 *   白名单驱动）+ 右侧主内容区；
 * - 主内容区统一 `max-w-*` 约束（`max-w-6xl`），保证深色仪器面板在宽屏下不拉散；
 * - 精确档（`precise`）下侧栏折叠动效与过渡归零，边框保持 1px 中性发丝线（RL-15）；
 * - 登录与组织 Flag 守卫由上层 `app/(next)/layout.tsx` 单点承担，本层不重复判定，
 *   也不发起任何数据请求（纯壳，零网络）。
 */
export default function SettingsSpaceLayout({ children }: { children: React.ReactNode }) {
  const tier = useImmersionTier()

  return (
    <div
      data-settings-space-shell
      data-immersion={tier}
      className={cn(
        'mx-auto flex w-full max-w-6xl flex-col gap-4 lg:flex-row lg:items-start lg:gap-5',
        !(tier === 'precise') && 'transition-colors',
      )}
    >
      <SettingsSpaceNav className="lg:sticky lg:top-4 lg:w-[248px] lg:shrink-0" />
      <div data-settings-space-content className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  )
}
