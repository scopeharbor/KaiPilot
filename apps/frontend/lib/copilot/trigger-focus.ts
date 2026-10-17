'use client'

/**
 * Copilot 触发按钮元素持有者（任务 6.3：关闭后焦点回归触发按钮）。
 *
 * Topbar 的触发按钮在点击时把自身注册进来；面板关闭时调用 `focusCopilotTrigger()`。
 * 模块级引用，不落 store：避免持久化/重渲染副作用。真实 DOM 引用只用于 focus()。
 */
let triggerElement: HTMLElement | null = null

export function setCopilotTriggerElement(el: HTMLElement | null): void {
  triggerElement = el
}

export function focusCopilotTrigger(): void {
  if (triggerElement && typeof triggerElement.focus === 'function') {
    triggerElement.focus()
  }
}
