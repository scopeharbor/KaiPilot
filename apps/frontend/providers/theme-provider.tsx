'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { useEffect, type ReactNode } from 'react'
import { useUiStore } from '@/stores/ui-store'
import { TooltipProvider } from '@/components/ui/Tooltip'

/**
 * 主题与密度接线（design.md D2）：
 * - 主题走 next-themes，attribute="data-mode"、enableSystem（浅/深/跟随系统三态），
 *   偏好由 next-themes 持久化，首屏防闪烁由其内联脚本处理。
 * - 密度走 ui-store（`[data-density]`），与主题正交；此处注册全局快捷键 Cmd/Ctrl+Shift+D。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const toggleDensity = useUiStore((s) => s.toggleDensity)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl + Shift + D 切换密度（DESIGN.md §10）
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault()
        toggleDensity()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleDensity])

  return (
    <NextThemesProvider
      attribute="data-mode"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </NextThemesProvider>
  )
}
