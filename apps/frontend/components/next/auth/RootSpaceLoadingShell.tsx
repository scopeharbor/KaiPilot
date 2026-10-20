'use client'

import * as React from 'react'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import type { ImmersionTier } from '@/stores/next-track-store'
import { cn } from '@/lib/utils'

export interface RootSpaceLoadingShellProps {
  /** 手动覆盖沉浸档位（未提供时消费 useImmersionTier） */
  immersionTier?: ImmersionTier
  /** 自定义容器类名 */
  className?: string
  /** 自定义加载提示文案，默认「正在进入开项 KaiPilot…」 */
  label?: string
}

/**
 * 根路径 BrandLoader 深空加载态外壳组件（v3-ui-next-batch2-auth-shell-assimilation W1 · tasks 1.3 / spec next-auth-shell-assimilation）。
 *
 * - 消费 `[data-next-track]` 作用域与 `--nx-space-bg`（`#040508`）深空黑底，文字消费 `--nx-text-secondary`；
 * - 居中挂载 `BrandLoader size={64}`，展示确定性文案「正在进入开项 KaiPilot…」；
 * - 无障碍：外壳容器标注 `aria-busy="true"`，内层 BrandLoader 具备 `role="status"` 与 `aria-live="polite"`；
 * - 沉浸阶梯降级：精确档（`precise`）纯平降级，移除 `.nx-space-atmosphere` 渐变发光伪元素；
 * - 视觉铁律（RL-15）：严格零 3D / 零 WebGL / 零 Canvas 节点。
 */
export function RootSpaceLoadingShell({
  immersionTier: explicitTier,
  className,
  label = '正在进入开项 KaiPilot…',
}: RootSpaceLoadingShellProps) {
  const hookTier = useImmersionTier()
  const tier = explicitTier ?? hookTier
  const isPrecise = tier === 'precise'

  return (
    <main
      data-next-track
      data-root-space-loading
      data-immersion={tier}
      aria-busy="true"
      className={cn(
        'flex min-h-screen items-center justify-center px-8 text-center bg-[var(--nx-space-bg)] text-[var(--nx-text-secondary)]',
        !isPrecise && 'nx-space-atmosphere',
        className,
      )}
    >
      <BrandLoader size={64} label={label} />
    </main>
  )
}

export default RootSpaceLoadingShell
