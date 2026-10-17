'use client'

import { useEffect, useState } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * 系统减弱动效偏好底座（v3-motion-fallback-closure D3 / spec「动效偏好读取点单一化」）。
 *
 * 返回 `prefers-reduced-motion: reduce` 的**系统原始偏好**（合成档位的判断见
 * `use-immersion-tier.ts`），是全前端唯一新增的媒体查询订阅点：
 * - 初始 `false`：SSR 与首帧 client 渲染一致，挂载后再读真实系统偏好，避免 hydration
 *   mismatch（jsdom / 无 `matchMedia` 环境同样安全返回 `false`）；
 * - 守卫：`typeof window` / `matchMedia` 函数缺失、或 `matchMedia()` 返回无效值（桩被还原）
 *   时保持默认偏好，不抛错；
 * - 订阅媒体查询 `change`，用户切换系统无障碍设置时立即响应，卸载时移除监听；
 * - `enabled = false` 时不订阅：消费方需要「手动设定优先于系统偏好」时短路，
 *   避免无用订阅（`use-immersion-tier` 的手动档语义）。
 */
export function useMotionPreference(enabled = true): boolean {
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    // `matchMedia` 缺失或桩失效（jsdom / 测试桩被还原）时保持默认偏好，不抛错。
    if (!media || typeof media.addEventListener !== 'function') return
    const sync = () => setReducedMotion(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [enabled])

  return reducedMotion
}
