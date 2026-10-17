'use client'

import type { ReactNode } from 'react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'

export interface TheaterShellProps {
  /** 剧场视口内的状态内容（状态视口容器由页面装配）。 */
  children?: ReactNode
  /** Layer 0 (z-0): 3D 沉浸视口容器（由页面动态挂载，保持双层物理隔离） */
  background3D?: ReactNode
}

/**
 * 生成剧场全屏外壳（v3-ui-next-theater-intent-clarify D1 / D6 / v3-next-layer1-theater-3d-m1 W4）。
 *
 * - 全屏固定视口（fixed inset-0），消费 `--nx-space-bg` 令牌与 `.nx-space-atmosphere`
 *   纯 CSS 径向漫射光晕营造深空沉浸感（RL-15）；
 * - 挂载 `useImmersionTier` 合成沉浸档位并回显 `data-immersion`（与 NextAppShell
 *   同一底座）；精确档 / prefers-reduced-motion 的彻底降级由 next-tokens.css 的
 *   `[data-immersion='precise'] .nx-space-atmosphere::before` 规则承载。
 * - 双层物理隔离：Layer 0（z-0）全屏 3D Canvas / 纯 CSS 降级背景；Layer 1（z-10 pointer-events-auto）语义 DOM。
 */
export function TheaterShell({ children, background3D }: TheaterShellProps) {
  const activeTier = useImmersionTier()

  return (
    <div
      data-theater-shell
      data-immersion={activeTier}
      className="nx-space-atmosphere fixed inset-0 z-0 flex flex-col overflow-y-auto bg-[var(--nx-space-bg)] text-[var(--nx-text-primary)]"
    >
      {/* Layer 0 (z-0): 3D 剧场画布视口 */}
      {background3D}

      {/* Layer 1 (z-10): 语义化 DOM 内容区，保持 pointer-events-auto */}
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pb-12 pt-20 pointer-events-auto md:pt-24">
        {children}
      </div>
    </div>
  )
}

export default TheaterShell
