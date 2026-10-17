'use client'

import { useEffect, useRef } from 'react'
import { isEditableTarget } from '@/lib/command-registry/shortcut'

/**
 * 新轨全局快捷键 Hook（v3-ui-next-shell-space-map D5 第二层防护）。
 *
 * - 监听 `Ctrl+/`（Mac 为 `Cmd+/`）切换 AI 占位气泡显隐，与 `Cmd/Ctrl + M` 呼出空间地图；
 * - 复用旧轨 `isEditableTarget` 做可编辑目标抑制：焦点在 input/textarea/contenteditable
 *   内时坚决不响应；
 * - 匹配成功后立即 `preventDefault()` + `stopPropagation()`，事件不向外泄露；
 * - 由 NextTopbar 单点挂载（新轨快捷键唯一注册点），宿主可通过 `enabled` 在模态浮层
 *   打开期间暂时停用，避免与焦点陷阱竞争。
 */
export interface UseNextShortcutsOptions {
  /** 触发 AI 占位气泡显隐切换。 */
  onToggleAiSummon?: () => void
  /** 呼出空间地图。 */
  onOpenSpaceMap?: () => void
  /** 是否启用监听（默认 true）。 */
  enabled?: boolean
}

export function useNextShortcuts({
  onToggleAiSummon,
  onOpenSpaceMap,
  enabled = true,
}: UseNextShortcutsOptions): void {
  // 稳定引用：回调变化不重复注册/注销 listener，effect 只依赖 enabled。
  const callbacksRef = useRef({ onToggleAiSummon, onOpenSpaceMap })
  callbacksRef.current = { onToggleAiSummon, onOpenSpaceMap }

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) return
      // 精确和弦匹配：仅允许 Ctrl 或 Meta（Mac Cmd）之一按下，附加 Shift/Alt 视为
      // 不同和弦（与旧轨 parseShortcutEvent 的规范和弦语义一致，ctrl+shift+/ ≠ ctrl+/）。
      const hasChordModifier = (event.ctrlKey || event.metaKey) && event.ctrlKey !== event.metaKey
      if (!hasChordModifier || event.shiftKey || event.altKey) return

      const key = event.key.toLowerCase()
      if (key === '/') {
        event.preventDefault()
        event.stopPropagation()
        callbacksRef.current.onToggleAiSummon?.()
      } else if (key === 'm') {
        event.preventDefault()
        event.stopPropagation()
        callbacksRef.current.onOpenSpaceMap?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/** 是否为 macOS 系平台（与旧轨 copilot.ts 同一判定口径，仅用于展示文案）。 */
function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** AI 唤起快捷键展示文本（Mac 显示 ⌘/，其余显示 Ctrl+/）。 */
export function nextSummonShortcutLabel(): string {
  return isMacPlatform() ? '⌘/' : 'Ctrl+/'
}

/** 空间地图快捷键展示文本（Mac 显示 ⌘M，其余显示 Ctrl+M）。 */
export function nextSpaceMapShortcutLabel(): string {
  return isMacPlatform() ? '⌘M' : 'Ctrl+M'
}
