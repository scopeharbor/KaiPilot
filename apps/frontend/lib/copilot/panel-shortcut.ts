'use client'

import * as React from 'react'
import { useCommandRegistryStore } from '@/lib/command-registry/store'
import { resolveEffectiveShortcut } from '@/lib/command-registry/shortcut'
import { shortcutOverrideStore } from '@/lib/command-registry/shortcut-store'

/**
 * Copilot 开关命令 ID（与 `built-in/copilot.ts` 注册的一致）。
 */
export const COPILOT_TOGGLE_COMMAND_ID = 'copilot.toggle'

/** shortcut-store 写方法广播的自定义事件（见 shortcut-store.ts notifyShortcutsChanged）。 */
const SHORTCUTS_CHANGED_EVENT = 'aiproj:shortcuts-changed'

/** 快捷键覆盖修订号：事件每次触发 +1，供 useSyncExternalStore 制造新快照驱动重渲染。 */
let shortcutsRevision = 0

function subscribeToShortcutChanges(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => {
    shortcutsRevision += 1
    callback()
  }
  window.addEventListener(SHORTCUTS_CHANGED_EVENT, handler)
  return () => window.removeEventListener(SHORTCUTS_CHANGED_EVENT, handler)
}

/**
 * 当前 Copilot 开关快捷键的**显示文本**（task 2.6）。
 *
 * 从命令注册表 + 本地覆盖实时派生，禁止硬编码：
 * - 命令注册/注销 → 订阅 zustand 注册表（reactive）；
 * - 用户重绑/清除/重置 → 订阅 `aiproj:shortcuts-changed` 事件重算。
 *
 * 保证 tooltip 显示的和弦与活跃绑定（冲突检测用的同一份推导）永远一致。
 */
export function useCopilotToggleShortcutDisplay(): string {
  const commands = useCommandRegistryStore((s) => s.commands)
  const revision = React.useSyncExternalStore(subscribeToShortcutChanges, () => shortcutsRevision)

  return React.useMemo(() => {
    const cmd = commands.get(COPILOT_TOGGLE_COMMAND_ID)
    if (!cmd) return ''
    return resolveEffectiveShortcut(cmd, shortcutOverrideStore.getAll()).display
  }, [commands, revision])
}
