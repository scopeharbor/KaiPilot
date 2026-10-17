'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useNxTheme } from '@/hooks/use-nx-theme'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import { ForegroundCutout } from '@/components/next/3d/shared/ForegroundCutout'
import { NextTopbar } from './NextTopbar'
import { TheaterBackgroundRunner } from '@/components/next/theater/TheaterBackgroundRunner'

/**
 * 新轨主壳体（v3-ui-next-track-foundation D-a + v3-ui-next-shell-space-map D1/D2 单点装配）。
 *
 * - 根节点挂 `[data-next-track]`（令牌作用域）与 `data-immersion`（沉浸档位）；
 * - 顶栏由 NextTopbar 常驻（内含品牌、坐标回显、沉浸档位切换、空间地图呼出、
 *   AI 占位气泡与回到旧版；快捷键 useNextShortcuts 由顶栏单点挂载，壳层不重复注册）；
 * - 空间地图 Overlay 由壳层统一挂载并受控（顶栏按钮 / Ctrl+M 经 onOpenSpaceMap 打开）；
 * - 坐标回显单源：`resolveSpaceBreadcrumb(pathname)`（派生自坐标白名单）注入顶栏；
 *   上下文实体空间（/next/projects/:id）的 `entityTitle` 由项目空间容器在加载成功后
 *   上报 entity store，壳层订阅后完成 `/next/projects/:id · <项目名称>` 动态回显
 *   （v3-ui-next-project-space design Decision 2「顶栏联动注册机制」，加载中为项目空间兜底）；
 * - 零旧 UI 视觉组件 import（不依赖 `components/layout/` 下任何组件），
 *   新轨与旧轨 AppShell 完全跳脱；「回到旧版」的偏好持久化与跳转由 NextTopbar 内置。
 */
export function NextAppShell({ children }: { children: React.ReactNode }) {
  const activeTier = useImmersionTier()
  useNxTheme()
  const pathname = usePathname() ?? '/'
  const entityTitle = useProjectSpaceEntityStore((state) => state.entityTitle)
  const [spaceMapOpen, setSpaceMapOpen] = React.useState(false)

  return (
    <div
      data-next-track
      data-immersion={activeTier}
      className="flex min-h-dvh min-w-0 flex-col bg-[var(--nx-bg-0)] text-[var(--nx-text-primary)]"
    >
      {/* Cinematic 全域共享层：前景剪纸纵深剪影（DOM 纯 CSS，RL-15 合规；精确档/浅色自适应） */}
      <ForegroundCutout />
      <NextTopbar
        onOpenSpaceMap={() => setSpaceMapOpen(true)}
        coordinateLabel={resolveSpaceBreadcrumb(pathname, entityTitle ?? undefined)}
      />
      <main className="min-w-0 flex-1 px-3 py-4 md:px-6 md:py-8">{children}</main>
      <SpaceMapOverlay open={spaceMapOpen} onOpenChange={setSpaceMapOpen} />
      {/* 生成剧场后台运行（离开剧场页也继续生成）+ 进度卡片 / 通知 + 一键生成模式弹窗 */}
      <TheaterBackgroundRunner />
    </div>
  )
}
