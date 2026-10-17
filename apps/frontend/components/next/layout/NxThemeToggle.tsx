'use client'

import { Moon, Sun } from 'lucide-react'
import { useNextTrackStore, type NxTheme } from '@/stores/next-track-store'

/**
 * 新轨明暗主题切换器（v3-next-cinematic-techniques-completion D5 顶栏 Actions）。
 *
 * - 双档分段控件：深色（dark，深空基座）/ 浅色（light，纸光仪器）；
 * - 点击写入 `next-track-store.nxTheme`（zustand persist 落 localStorage），
 *   页面壳层/登录页的 `useNxTheme` 统一同步到 `<html data-nx-theme>`；
 * - 切换器只订阅偏好，临时菜单卸载时不得清除页面根主题；
 * - 当前档位以 aria-pressed + 高亮回显。
 */
const THEMES: ReadonlyArray<{ value: NxTheme; label: string; icon: typeof Moon }> = [
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'light', label: '浅色', icon: Sun },
]

export function NxThemeToggle() {
  const activeTheme = useNextTrackStore((state) => state.nxTheme)
  const setNxTheme = useNextTrackStore((state) => state.setNxTheme)

  return (
    <div
      role="group"
      aria-label="明暗主题切换"
      data-nx-theme-toggle
      className="flex items-center gap-0.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-0.5"
    >
      {THEMES.map((theme) => {
        const isActive = activeTheme === theme.value
        const Icon = theme.icon
        return (
          <button
            key={theme.value}
            type="button"
            data-nx-theme-option={theme.value}
            aria-pressed={isActive}
            aria-label={`${theme.label}主题`}
            onClick={() => setNxTheme(theme.value)}
            className={
              isActive
                ? 'flex items-center gap-1 rounded-[4px] bg-[var(--nx-bg-0)] px-2.5 py-1 text-xs font-medium text-[var(--nx-accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]'
                : 'flex items-center gap-1 rounded-[4px] px-2.5 py-1 text-xs text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]'
            }
          >
            <Icon className="h-3 w-3" aria-hidden />
            {theme.label}
          </button>
        )
      })}
    </div>
  )
}
