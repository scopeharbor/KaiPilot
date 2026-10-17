'use client'

import type { Density } from '@/stores/ui-store'

/**
 * 内置 UI 设置命令的 bridge（design.md D3：「router 通过闭包或回调引用」同理）。
 *
 * `next-themes` 的 `setTheme` 与 `ui-store` 的 `setDensity` 都来自 React hook，
 * 静态命令模块无法直接调用。`CommandPaletteDialog` 挂载时通过 `setCommandSettings`
 * 注入这两个回调；静态主题/密度命令的 `execute` 经 bridge 间接调用。
 *
 * 这只做本地 UI 偏好切换（`effect: 'ui-setting'`），不触发任何业务写操作。
 */
export type CommandTheme = 'light' | 'dark' | 'system'

interface CommandSettings {
  setTheme: (theme: CommandTheme) => void
  setDensity: (density: Density) => void
}

let settingsRef: CommandSettings | null = null

export function setCommandSettings(settings: CommandSettings | null): void {
  settingsRef = settings
}

export function commandSetTheme(theme: CommandTheme): void {
  settingsRef?.setTheme(theme)
}

export function commandSetDensity(density: Density): void {
  settingsRef?.setDensity(density)
}
