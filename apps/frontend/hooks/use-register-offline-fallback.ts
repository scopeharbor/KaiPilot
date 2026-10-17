'use client'

import * as React from 'react'
import { registerOfflineFallbackSw, isOfflineFallbackEnabled } from '@/lib/pwa/offline-fallback'

/**
 * 在客户端注册离线 Fallback 服务工作者的 Hook。
 *
 * 仅在 feature flag 启用时注册，组件卸载时不注销（worker 独立运行）。
 * 注册失败静默处理，不阻塞 UI 渲染。
 *
 * @see design.md D5 / spec pwa-static-offline-fallback
 */
export function useRegisterOfflineFallback(): void {
  const registeredRef = React.useRef(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (registeredRef.current) return
    if (!isOfflineFallbackEnabled()) return

    registeredRef.current = true
    registerOfflineFallbackSw()
  }, [])
}
