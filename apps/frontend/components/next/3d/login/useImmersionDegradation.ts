'use client'

import * as React from 'react'
import { probeWebGLCapabilities, type WebGLCapabilities } from '@/lib/next/3d/webgl-capabilities'

export interface UseImmersionDegradationOptions {
  forceTier?: 'high' | 'low' | 'fallback'
}

export interface UseImmersionDegradationReturn {
  tier: 'high' | 'low' | 'fallback'
  isMounted: boolean
  isFallback: boolean
  isFadedIn: boolean
  hasContextLost: boolean
  handleContextLost: () => void
  handleCanvasCreated: () => void
}

/**
 * 设备分级与沉浸降级状态调度 Hook
 *
 * 规范遵循：v3-next-layer1-login-3d-m0 design.md Decision 3 & Decision 9
 */
export function useImmersionDegradation(
  options: UseImmersionDegradationOptions = {},
): UseImmersionDegradationReturn {
  const { forceTier } = options
  const [isMounted, setIsMounted] = React.useState(false)
  const [caps, setCaps] = React.useState<WebGLCapabilities | null>(null)
  const [hasContextLost, setHasContextLost] = React.useState(false)
  const [isFadedIn, setIsFadedIn] = React.useState(false)

  React.useEffect(() => {
    setIsMounted(true)
    if (!forceTier) {
      setCaps(probeWebGLCapabilities())
    }
  }, [forceTier])

  // 监听无障碍偏好动态变更
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = () => {
      setCaps(probeWebGLCapabilities())
    }

    mql.addEventListener?.('change', handleChange)
    return () => {
      mql.removeEventListener?.('change', handleChange)
    }
  }, [])

  // 最终生效档位计算
  const effectiveTier: 'high' | 'low' | 'fallback' = React.useMemo(() => {
    if (forceTier) return forceTier
    if (hasContextLost) return 'fallback'
    if (!isMounted || !caps) return 'fallback'
    return caps.tier
  }, [forceTier, hasContextLost, isMounted, caps])

  const isFallback = effectiveTier === 'fallback'

  const handleContextLost = React.useCallback(() => {
    setHasContextLost(true)
  }, [])

  const handleCanvasCreated = React.useCallback(() => {
    // 触发 700ms 交叉淡入动画
    setIsFadedIn(true)
  }, [])

  return {
    tier: effectiveTier,
    isMounted,
    isFallback,
    isFadedIn,
    hasContextLost,
    handleContextLost,
    handleCanvasCreated,
  }
}
