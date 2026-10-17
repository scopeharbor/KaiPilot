'use client'

import * as React from 'react'

/**
 * PWA 安装提示状态枚举。
 *
 * - `unsupported`：浏览器未触发 `beforeinstallprompt`，或运行在不支持的环境。
 * - `available`：已捕获 `beforeinstallprompt` 事件，等待用户触发安装。
 * - `prompting`：已调用 `prompt()` 等待用户选择。
 * - `installed`：已通过 `appinstalled` 事件或 display-mode 检测确认安装。
 * - `dismissed`：用户在此会话中拒绝过安装提示（本地记忆，不写后端）。
 */
export type PwaInstallState = 'unsupported' | 'available' | 'prompting' | 'installed' | 'dismissed'

export interface UsePwaInstallPromptReturn {
  /** 当前安装状态 */
  state: PwaInstallState
  /** 是否在 standalone/installed 模式下运行 */
  isStandalone: boolean
  /** 显示系统安装提示（仅 `available` 状态下有效） */
  install: () => Promise<void>
  /** 记录用户已忽略/关闭（不清除 deferredEvent，用户可再次触发） */
  dismiss: () => void
  /** 重置本地 dismissed 状态，使安装入口重新可见 */
  resetDismissed: () => void
}

const STORAGE_KEY = 'pwa-install-dismissed'

/**
 * 管理 `beforeinstallprompt` / `appinstalled` 事件与安装流程的 hook。
 *
 * **非目标（本 change 不实现）：**
 * - service worker 注册 / 离线缓存 / 静态 fallback
 * - Web Push / Pending Sync / 后台同步
 * - 安装遥测或业务写入
 *
 * @see design.md D3 / spec pwa-installable-shell
 */
export function usePwaInstallPrompt(): UsePwaInstallPromptReturn {
  const deferredEventRef = React.useRef<Event | null>(null)
  const [state, setState] = React.useState<PwaInstallState>('unsupported')

  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true)

  // 初始化时检查是否已安装
  React.useEffect(() => {
    if (isStandalone) {
      setState('installed')
    }
  }, [isStandalone])

  // 检查用户是否在本地关闭过
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY)
      if (dismissed === 'true' && state === 'unsupported') {
        setState('dismissed')
      }
    } catch {
      // localStorage 不可用时忽略
    }
  }, [state])

  // 监听 beforeinstallprompt / appinstalled
  React.useEffect(() => {
    if (typeof window === 'undefined' || isStandalone) return

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      deferredEventRef.current = e
      // 检查是否曾被用户 dismiss
      try {
        if (localStorage.getItem(STORAGE_KEY) === 'true') {
          setState('dismissed')
          return
        }
      } catch {
        // ignore
      }
      setState('available')
    }

    function onAppInstalled() {
      deferredEventRef.current = null
      setState('installed')
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [isStandalone])

  const install = React.useCallback(async () => {
    const event = deferredEventRef.current
    if (!event) return

    setState('prompting')

    const promptEvent = event as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
    }
    try {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      if (choice.outcome === 'accepted') {
        setState('installed')
      } else {
        setState('available')
      }
    } catch {
      setState('available')
    }
    deferredEventRef.current = null
  }, [])

  const dismiss = React.useCallback(() => {
    setState('dismissed')
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch {
      // ignore
    }
  }, [])

  const resetDismissed = React.useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    // 重新检查是否有 deferred event
    if (deferredEventRef.current) {
      setState('available')
    } else {
      setState('unsupported')
    }
  }, [])

  return { state, isStandalone, install, dismiss, resetDismissed }
}
