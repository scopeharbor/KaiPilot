'use client'

import { useEffect } from 'react'
import { useMotionPreference } from '@/hooks/use-motion-preference'
import { useNextTrackStore, type ImmersionTier } from '@/stores/next-track-store'

/**
 * 沉浸阶梯状态底座（v3-ui-next-track-foundation D-f / spec「沉浸阶梯状态底座」）。
 *
 * 三档：immersive（沉浸）/ light（轻量）/ precise（精确）。合成优先级：
 *   1. 手动设定优先：`next-track-store.immersionTier` 非 null 时以用户显式选择为准；
 *   2. 系统减弱动画自动降级：未手动选择且 `prefers-reduced-motion: reduce` → `precise`；
 *   3. 默认值：其余情况回退 `immersive`。
 *
 * - 偏好读取复用 `useMotionPreference()`（v3-motion-fallback-closure D3）：系统偏好的
 *   媒体查询订阅收敛到该 hook，本 hook 不再自行订阅（`enabled` 在手动覆盖时为 false，
 *   保持原有「手动覆盖时不订阅」语义）；
 * - 解析结果写入 `<html data-immersion>`；组件根节点的 `data-immersion` 由消费方附加；
 * - 三档只改变呈现浓度，MUST NOT 改变交互逻辑与数据语义（spec）。
 */
export function useImmersionTier(): ImmersionTier {
  const manualTier = useNextTrackStore((state) => state.immersionTier)
  const reducedMotion = useMotionPreference(manualTier === null)

  const activeTier: ImmersionTier = manualTier ?? (reducedMotion ? 'precise' : 'immersive')

  useEffect(() => {
    document.documentElement.setAttribute('data-immersion', activeTier)
    return () => document.documentElement.removeAttribute('data-immersion')
  }, [activeTier])

  return activeTier
}
