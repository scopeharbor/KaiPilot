'use client'

import { useEffect, useRef } from 'react'

/**
 * 弹层无障碍底座（v3-next-track-dialog-a11y-closure · spec「新轨弹层键盘可达」+「弹层焦点落点与归还」）。
 *
 * 单点收口新轨手写弹层的三件事，避免每个弹层各复制一段同构 useEffect：
 *   - **Escape 关闭**：`canClose?.()` 为假（在途提交 / 未保存脏值）时不关，也不触发任何写请求；
 *   - **堆叠语义（LIFO）**：模块级注册表按注册序入栈，一次 Escape 只分派给最上层一层；
 *   - **焦点进/出**：打开后延迟 1 帧把焦点移入容器（容器带 `tabIndex={-1}` 时优先进容器，
 *     否则退到第一个可聚焦后代），关闭或卸载时归还给打开前的 `document.activeElement`。
 *
 * 边界（与本 change 的非目标一致）：
 *   - 不做焦点陷阱（Tab 循环）与后台 `inert`，也不隐藏任何子节点；
 *   - 不引入 CSS 动画 / `transition` / 平滑滚动，焦点迁移只有 `focus()` 一次调用；
 *   - 不依赖 `matchMedia`：缺该系统能力的测试环境无需特殊分支，环境守卫只判定 DOM 与
 *     `focus` 能力，`typeof window === 'undefined'`（SSR）或能力缺失时整体安全空转。
 */

/** 容器内可作为焦点的后代选择器；容器自身由 `tabIndex={-1}` 分支处理。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface UseDialogA11yOptions {
  /** 弹层容器 ref。调用方需同时给容器加 `tabIndex={-1}`，否则落点退到第一个可聚焦后代。 */
  ref: React.RefObject<HTMLElement | null>
  /** 弹层是否打开（打开时才注册 Escape 与焦点接管，关闭即摘除）。 */
  open: boolean
  /** 关闭回调。 */
  onClose: () => void
  /**
   * 可选：关闭前置守卫。返回 `false`（在途 mutation / 未保存脏值）时 Escape 不生效。
   * 不传时默认允许关闭（与接线前的「无守卫」语义一致）。
   */
  canClose?: () => boolean
}

/**
 * 模块级弹层栈：同一页面多个弹层（抽屉 + 其上的确认弹）同时打开时，
 * 只有最后注册者（最上层）响应 Escape，避免一次按键连关多层。
 */
const dialogStack: object[] = []

/** 只判定「能否安全操作 DOM」；缺 `focus` 能力的环境（部分 jsdom 配置）整体空转，不抛错。 */
function isDomReady(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof document.addEventListener === 'function' &&
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.focus === 'function'
  )
}

type FrameHandle = { kind: 'raf' | 'timeout'; id: number }

/** 延迟 1 帧：等弹层挂载与布局落定后再移动焦点。jsdom 下测试 setup 已把 rAF 换成宏任务。 */
function scheduleFrame(callback: () => void): FrameHandle | null {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return { kind: 'raf', id: window.requestAnimationFrame(() => callback()) }
  }
  if (typeof setTimeout === 'function') {
    return { kind: 'timeout', id: setTimeout(callback, 0) as unknown as number }
  }
  return null
}

function cancelFrame(handle: FrameHandle | null): void {
  if (!handle) return
  if (handle.kind === 'raf') {
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(handle.id)
    }
    return
  }
  clearTimeout(handle.id)
}

/** 焦点落点：容器声明了 `tabindex` 时优先容器本身，否则取第一个可聚焦后代，最后兜底容器。 */
function focusDialog(container: HTMLElement | null): void {
  if (!container || typeof container.focus !== 'function') return
  if (container.hasAttribute('tabindex')) {
    container.focus()
    return
  }
  const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
  if (first && typeof first.focus === 'function') {
    first.focus()
    return
  }
  container.focus()
}

/** 焦点归还：触发元素已随弹层一起从文档移除时安全降级，不抛错、不聚焦孤岛节点。 */
function restoreFocus(target: HTMLElement | null): void {
  if (!target || typeof target.focus !== 'function') return
  if (!target.isConnected) return
  target.focus()
}

export function useDialogA11y({ ref, open, onClose, canClose }: UseDialogA11yOptions): void {
  const onCloseRef = useRef(onClose)
  const canCloseRef = useRef(canClose)

  // 回调走 ref：Escape 监听只在 open 变化时注册/摘除，不因父组件每次渲染重建回调而重排栈序。
  useEffect(() => {
    onCloseRef.current = onClose
    canCloseRef.current = canClose
  }, [onClose, canClose])

  useEffect(() => {
    if (!open || !isDomReady()) return
    const token: object = {}
    dialogStack.push(token)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 非最上层不响应（不用 stopPropagation，免得吞掉同页其他监听）。
      if (dialogStack[dialogStack.length - 1] !== token) return
      if (canCloseRef.current?.() === false) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = dialogStack.indexOf(token)
      if (index !== -1) dialogStack.splice(index, 1)
    }
  }, [open, ref])

  useEffect(() => {
    if (!open || !isDomReady()) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const handle = scheduleFrame(() => focusDialog(ref.current))
    return () => {
      cancelFrame(handle)
      restoreFocus(previous)
    }
  }, [open, ref])
}
