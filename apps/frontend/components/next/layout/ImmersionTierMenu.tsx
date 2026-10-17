'use client'

import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useNextTrackStore, type ImmersionTier } from '@/stores/next-track-store'

/**
 * 沉浸档位切换器（v3-ui-next-shell-space-map D1 顶栏 Actions Group / spec「沉浸档位切换交互」）。
 *
 * - 三档分段控件：沉浸（immersive）/ 轻量（light）/ 精确（precise）；
 * - 点击写入 `next-track-store.immersionTier`（zustand persist 自动落 localStorage，
 *   key `aiproj-next-track`），`useImmersionTier` 随即把生效档位同步到
 *   `<html data-immersion>`（root DOM 节点）；
 * - 当前有效档位以 `aria-pressed` + 高亮样式回显。
 */
const TIERS: ReadonlyArray<{ value: ImmersionTier; label: string }> = [
  { value: 'immersive', label: '沉浸' },
  { value: 'light', label: '轻量' },
  { value: 'precise', label: '精确' },
]

export function ImmersionTierMenu() {
  const activeTier = useImmersionTier()
  const setImmersionTier = useNextTrackStore((state) => state.setImmersionTier)

  return (
    <div
      role="group"
      aria-label="沉浸档位切换"
      className="flex items-center gap-0.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-0.5"
    >
      {TIERS.map((tier) => {
        const isActive = activeTier === tier.value
        return (
          <button
            key={tier.value}
            type="button"
            data-immersion-tier={tier.value}
            aria-pressed={isActive}
            onClick={() => setImmersionTier(tier.value)}
            className={
              isActive
                ? 'rounded-[4px] bg-[var(--nx-bg-0)] px-2.5 py-1 text-xs font-medium text-[var(--nx-accent)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]'
                : 'rounded-[4px] px-2.5 py-1 text-xs text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]'
            }
          >
            {tier.label}
          </button>
        )
      })}
    </div>
  )
}
