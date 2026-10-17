import { Sparkles } from 'lucide-react'
import { registerStaticCommands } from '../register'
import { useCopilotStore } from '@/stores/copilot-store'
import type { RegisteredCommand } from '../types'

/**
 * Copilot 开关快捷键（spec copilot-sidebar-shell / stage2a §2.3）。
 *
 * 走 registry 而非在 Topbar/面板自挂 keydown：可编辑目标抑制、本地自定义覆盖、
 * 冲突检测与面板内的 kbd 展示都由现有 `useCustomShortcuts` 统一负责（与
 * `built-in/layout.ts` 侧栏折叠快捷键同一范式，design.md D1）。
 *
 * `parseShortcutInput` 只解析单一和弦、不支持「meta 或 ctrl」二选一，故按平台分别注册，
 * 显示文本也随之正确（Mac 显示 Cmd，其余显示 Ctrl）。`/` 不在 `shortcut.ts` 的
 * `RESERVED_CHORDS`（浏览器保留键集）中，可直接绑定。
 */
export function copilotToggleShortcut(): string {
  const isMac =
    typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
  return isMac ? 'Cmd+/' : 'Ctrl+/'
}

export function buildCopilotCommands(): RegisteredCommand[] {
  return [
    {
      id: 'copilot.toggle',
      label: '打开/关闭 AI Copilot',
      keywords: ['copilot', 'AI', 'AI 助手', '对话', '助手', 'toggle', 'open', 'close'],
      icon: Sparkles,
      group: 'custom',
      effect: 'ui-setting',
      shortcut: copilotToggleShortcut(),
      // 新轨路由空间守卫（v3-ui-next-shell-space-map D5 第一层防护）：
      // 位于 /next 下时该命令从 visibleCommands 中被过滤，旧轨快捷键调度器
      // （useCustomShortcuts 只绑定可见命令）因此不再响应 Cmd/Ctrl+/，
      // 从根源上杜绝新轨内误触发旧 Copilot 侧栏（快捷键交新轨 useNextShortcuts 接管）。
      when: (ctx) => !ctx.pathname.startsWith('/next'),
      execute: () => useCopilotStore.getState().toggleOpen(),
    },
  ]
}

let registered = false

/** 注册内置 Copilot 开关命令（幂等，仅在客户端）。 */
export function registerCopilotCommands(): void {
  if (registered) return
  registered = true
  registerStaticCommands(buildCopilotCommands())
}
