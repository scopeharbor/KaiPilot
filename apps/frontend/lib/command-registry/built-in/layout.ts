import { PanelLeft } from 'lucide-react'
import { registerStaticCommands } from '../register'
import { useUiStore } from '@/stores/ui-store'
import type { RegisteredCommand } from '../types'

/**
 * 侧栏折叠快捷键。
 *
 * 走 registry 而非在 `AppShell` 自挂 keydown：可编辑目标抑制、本地自定义覆盖、
 * 冲突检测与面板内的 kbd 展示都由 `useCustomShortcuts` 统一负责，
 * 也避免 `AppShell` 里三份 Sidebar 造成重复监听。
 *
 * 不用 `Cmd/Ctrl + B`（VS Code / Claude 键位）：`shortcut.ts` 的 `RESERVED_CHORDS`
 * 已把 `ctrl+b`/`meta+b` 列为浏览器保留（Firefox 书签侧栏），自带默认键位若占用它，
 * 用户在「管理快捷键」里反而会被告知该键不可绑定——自相矛盾。改用 Notion 同款 `\`。
 *
 * `parseShortcutInput` 只解析单一和弦、不支持「meta 或 ctrl」二选一，故按平台分别注册，
 * 显示文本也随之正确（Mac 显示 Cmd，其余显示 Ctrl）。
 */
export function sidebarToggleShortcut(): string {
  const isMac =
    typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
  return isMac ? 'Cmd+\\' : 'Ctrl+\\'
}

export function buildLayoutCommands(): RegisteredCommand[] {
  return [
    {
      id: 'layout.toggleSidebar',
      label: '折叠/展开侧栏',
      keywords: ['侧栏', '侧边栏', '导航', '折叠', '展开', 'sidebar', 'toggle', 'collapse'],
      icon: PanelLeft,
      group: 'custom',
      effect: 'ui-setting',
      shortcut: sidebarToggleShortcut(),
      execute: () => useUiStore.getState().toggleSidebarCollapsed(),
    },
  ]
}

let registered = false

/** 注册内置布局命令（幂等，仅在客户端）。 */
export function registerLayoutCommands(): void {
  if (registered) return
  registered = true
  registerStaticCommands(buildLayoutCommands())
}
