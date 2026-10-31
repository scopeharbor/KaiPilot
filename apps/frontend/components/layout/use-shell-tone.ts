'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { applyClassicPalette, resolveClassicPalette } from '@/lib/classic-palettes'
import { useUiStore } from '@/stores/ui-store'
import { useHydrated } from '@/components/ui/BrandLogo'

/**
 * 旧版外壳顶栏 / 侧栏当前是否为深底（v3-classic-ui-openproject-style）：
 * 深色主题一律深底；浅色主题看色系定义。用来挑 logo 版本。
 */
export function useShellTone(): { headerOnDark: boolean; sidebarOnDark: boolean } {
  const { resolvedTheme } = useTheme()
  const palette = resolveClassicPalette(useUiStore((state) => state.classicPalette))
  // 主题与本地色系偏好只在客户端可知：hydration 前按默认色系、浅色主题计算，避免与服务端不一致。
  const hydrated = useHydrated()
  const dark = hydrated && resolvedTheme === 'dark'
  const effective = hydrated ? palette : resolveClassicPalette(null)
  return {
    headerOnDark: dark || effective.headerTone === 'dark',
    sidebarOnDark: dark || effective.sidebarTone === 'dark',
  }
}

/**
 * 旧版外壳挂载时把色系写到 `<html data-classic-palette>`，切换时更新，卸载时移除——
 * 客户端跳到新版界面时不残留旧版色系（首帧由根布局脚本写入）。
 */
export function useClassicPaletteAttribute() {
  const classicPalette = useUiStore((state) => state.classicPalette)
  React.useEffect(() => {
    applyClassicPalette(classicPalette)
  }, [classicPalette])
  React.useEffect(() => () => applyClassicPalette(null), [])
}
