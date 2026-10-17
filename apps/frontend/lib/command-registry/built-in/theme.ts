import { Monitor, Moon, Sun } from 'lucide-react'
import { registerStaticCommands } from '../register'
import { commandSetTheme } from '../settings-bridge'
import type { RegisteredCommand } from '../types'

/**
 * 内置主题切换命令（design.md D5）：浅色/深色/跟随系统，`effect: 'ui-setting'`，
 * `execute` 经 settings-bridge 调 `next-themes` 的 `setTheme`。
 */
export function buildThemeCommands(): RegisteredCommand[] {
  return [
    {
      id: 'theme.light',
      label: '浅色主题',
      keywords: ['主题', '浅色', 'light'],
      icon: Sun,
      group: 'theme',
      effect: 'ui-setting',
      execute: () => commandSetTheme('light'),
    },
    {
      id: 'theme.dark',
      label: '深色主题',
      keywords: ['主题', '深色', 'dark'],
      icon: Moon,
      group: 'theme',
      effect: 'ui-setting',
      execute: () => commandSetTheme('dark'),
    },
    {
      id: 'theme.system',
      label: '跟随系统',
      keywords: ['主题', '跟随系统', 'system'],
      icon: Monitor,
      group: 'theme',
      effect: 'ui-setting',
      execute: () => commandSetTheme('system'),
    },
  ]
}

let registered = false

/** 注册内置主题命令（幂等，仅在客户端）。 */
export function registerThemeCommands(): void {
  if (registered) return
  registered = true
  registerStaticCommands(buildThemeCommands())
}
