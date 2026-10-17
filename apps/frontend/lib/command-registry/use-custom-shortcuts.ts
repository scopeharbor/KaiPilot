/**
 * 自定义快捷键运行时 hook（spec command-palette / design.md D4）。
 *
 * 从当前可见命令列表派生有效快捷键绑定，监听全局 keydown 事件，
 * 在可编辑目标抑制触发，经现有 `runCommand(cmd)` 路径执行命令。
 *
 * 每个可见性快照只注册一次 listener，visibility 变化时重新计算绑定表。
 */

import * as React from 'react'
import { parseShortcutEvent, resolveEffectiveBindings, isEditableTarget } from './shortcut'
import { shortcutOverrideStore } from './shortcut-store'
import type { RegisteredCommand } from './types'

export interface UseCustomShortcutsOptions {
  /** 当前可见命令列表（已过 RBAC + when 过滤）。 */
  visibleCommands: RegisteredCommand[]
  /** 执行命令（与 palette 选中路径一致）。 */
  runCommand: (cmd: RegisteredCommand) => void
  /** 是否启用（默认 true）。组件卸载或功能关闭时禁用）。 */
  enabled?: boolean
}

/**
 * 挂载自定义快捷键全局 keydown listener。
 *
 * - 只在 enabled 且 visibleCommands 稳定时启动监听。
 * - 每次 visibleCommands 变化时从 store 读取 localStorage 覆盖并重建绑定表。
 * - 触发前检查 editable target；不可编辑目标才执行命令。
 * - 组件卸载时自动移除 listener。
 */
export function useCustomShortcuts({
  visibleCommands,
  runCommand,
  enabled = true,
}: UseCustomShortcutsOptions): void {
  // 稳定引用确保 effect 清理不引用过期 handler
  const runCommandRef = React.useRef(runCommand)
  runCommandRef.current = runCommand

  React.useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent): void {
      // 可编辑目标抑制
      if (isEditableTarget(event.target)) return

      // 解析当前和弦
      const chord = parseShortcutEvent(event)
      if (!chord) return

      // 从 store 读取本地覆盖
      const localOverrides = shortcutOverrideStore.getAll()
      const bindings = resolveEffectiveBindings(visibleCommands, localOverrides)

      // 按和弦查找命令
      const matched = bindings.find((b) => b.chord === chord)
      if (!matched) return

      const cmd = visibleCommands.find((c) => c.id === matched.commandId)
      if (!cmd) return

      event.preventDefault()
      event.stopPropagation()
      runCommandRef.current(cmd)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visibleCommands, enabled])
}

/**
 * 从 visibleCommands 和 localOverrides 派生命令 ID → 有效快捷键显示文本的映射。
 * 用于 palette 和快捷键管理 UI 渲染。
 */
export function useEffectiveShortcutDisplays(
  visibleCommands: RegisteredCommand[],
): Map<string, { display: string; isCustom: boolean }> {
  return React.useMemo(() => {
    const localOverrides = shortcutOverrideStore.getAll()
    const map = new Map<string, { display: string; isCustom: boolean }>()
    for (const cmd of visibleCommands) {
      const local = localOverrides.get(cmd.id)
      if (local) {
        map.set(cmd.id, { display: local.chord, isCustom: true })
      } else if (cmd.shortcut) {
        map.set(cmd.id, { display: cmd.shortcut, isCustom: false })
      }
    }
    return map
  }, [visibleCommands])
}

/**
 * 检查本地快捷键覆盖是否存在，用于 UI 状态判断（如"是否有自定义捷径可重置"）。
 */
export function hasAnyCustomShortcut(): boolean {
  return shortcutOverrideStore.getAll().size > 0
}

/**
 * 重置全部本地快捷键覆盖。
 */
export function resetAllCustomShortcuts(): void {
  shortcutOverrideStore.clearAll()
}

/**
 * 清除单条命令的本地快捷键覆盖。
 */
export function clearCustomShortcut(commandId: string): void {
  shortcutOverrideStore.remove(commandId)
}

/**
 * 设置命令的本地快捷键覆盖。
 * 返回 true 表示保存成功，false 表示冲突/保留（调用方应先检测）。
 */
export function setCustomShortcut(commandId: string, chord: string): void {
  shortcutOverrideStore.set(commandId, chord)
}
