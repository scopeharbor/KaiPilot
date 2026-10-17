'use client'

import type { RcclLoopListItem } from '@/lib/api/resource-capacity-loops'
import {
  granularityLabelOf,
  loopNextActionHint,
  loopStateMeta,
  loopWindowLabel,
} from '@/lib/next/org-loops/org-loops-adapter'

/**
 * 容量闭环列表行卡片（v3-ui-next-org-portfolio-domains W6 · tasks 6.2）。
 *
 * 纯呈现组件：标题 + 状态徽标（双通道：语义色 + 中文标签）+ 窗口/粒度 +
 * 「下一步」提示 + 修订号；行本身的可点击包裹（Link → 详情页）由父级
 * CapacityLoopList 提供，本卡零导航、零数据请求。
 */
export interface CapacityLoopRowCardProps {
  loop: RcclLoopListItem
}

export function CapacityLoopRowCard({ loop }: CapacityLoopRowCardProps) {
  const meta = loopStateMeta(loop.state)
  return (
    <div
      data-rccl-row-card
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[var(--nx-text-primary)]">{loop.title}</span>
          <span
            data-rccl-state-chip
            data-state={loop.state}
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] ${meta.chipClass}`}
          >
            {meta.label}
          </span>
        </div>
        <p data-rccl-window className="mt-1 truncate text-xs text-[var(--nx-text-muted)]">
          窗口 {loopWindowLabel(loop.windowStart, loop.windowEnd)} ·{' '}
          {granularityLabelOf(loop.granularity)}粒度
        </p>
        <p data-rccl-hint className="mt-0.5 truncate text-xs text-[var(--nx-text-secondary)]">
          {loopNextActionHint(loop.state)}
        </p>
      </div>
      <span
        data-rccl-revision
        className="shrink-0 font-mono text-[11px] text-[var(--nx-text-muted)]"
      >
        修订 v{loop.revision}
      </span>
    </div>
  )
}

export default CapacityLoopRowCard
