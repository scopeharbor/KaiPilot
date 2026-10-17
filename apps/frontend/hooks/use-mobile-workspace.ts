'use client'

import { useSyncExternalStore } from 'react'

export const MOBILE_WORKSPACE_QUERY =
  '(max-width: 767px), (pointer: coarse) and (max-width: 1023px)'
function subscribe(onChange: () => void) {
  const media = window.matchMedia(MOBILE_WORKSPACE_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
function snapshot() {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_WORKSPACE_QUERY).matches
  )
}
export function useMobileWorkspace() {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
