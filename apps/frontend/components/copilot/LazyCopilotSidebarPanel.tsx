'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { useCopilotStore } from '@/stores/copilot-store'

const loadPanel = () => import('./CopilotSidebarPanel').then((mod) => mod.CopilotSidebarPanel)

const CopilotSidebarPanel = dynamic(loadPanel, { ssr: false })

/**
 * Copilot 侧栏按需加载（v3-frontend-load-performance）：
 *
 * 面板关闭时本来就渲染 null，但它的代码（消息列表、全屏面板、输入区等）随每个旧版页面首屏下载。
 * 改为：首次打开或开始流式时才挂载真正的面板，之后保持挂载（面板内的演示推进与续接逻辑不受影响）；
 * 页面空闲时预取面板代码，打开时无需等待下载。
 */
export function LazyCopilotSidebarPanel() {
  const needed = useCopilotStore((state) => state.open || state.streaming)
  const [mounted, setMounted] = React.useState(needed)
  if (needed && !mounted) setMounted(true)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const idle =
      window.requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1500) as unknown as number)
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    const handle = idle(() => {
      void loadPanel()
    })
    return () => cancel(handle)
  }, [])

  return mounted ? <CopilotSidebarPanel /> : null
}
