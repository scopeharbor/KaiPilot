'use client'

import { useSyncExternalStore } from 'react'

/**
 * 订阅 CSS 媒体查询（v3-classic-ui-openproject-parity）。
 * 服务端与 hydration 首帧返回 `false`，之后跟随 `matchMedia`，避免 hydration 不一致。
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  )
}
