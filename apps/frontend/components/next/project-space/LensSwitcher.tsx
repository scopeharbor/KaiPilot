'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * 标准镜头切换器（v3-ui-next-project-space design Decision 7 / spec「镜头切换器预留与置灰」、
 * v3-ui-next-gantt-lens spec「镜头切换器点亮」、v3-ui-next-remaining-lenses spec「LensSwitcher
 * 全量点亮与路由 URL 双向绑定」）。
 *
 * - 六项镜头与空间地图坐标白名单对齐：看板 / 甘特图 / WBS / 列表 / 日历 / 时间线全部 available；
 * - coming-soon 置灰态、cursor-not-allowed 与「即将上线」Tooltip 已随 B4/B5 批次点亮彻底移除；
 * - 激活镜头：--nx-workspace-surface 高亮背景 + 底部 --nx-workspace-blue 指示条；
 * - 点击任意选项派发 `onSelect(option.id)`（URL ?lens= 双向绑定由装配方 ProjectSpaceContainer 收口）；
 * - RL-14 确定性渲染：镜头清单为纯静态白名单。
 */

export type ProjectSpaceLensId = 'kanban' | 'gantt' | 'wbs' | 'list' | 'calendar' | 'timeline'
export type ProjectSpaceLensStatus = 'available'

export interface LensSwitcherOption {
  id: ProjectSpaceLensId
  label: string
  status: ProjectSpaceLensStatus
}

export const LENS_SWITCHER_OPTIONS: readonly LensSwitcherOption[] = [
  { id: 'kanban', label: '看板', status: 'available' },
  { id: 'gantt', label: '甘特图', status: 'available' },
  { id: 'wbs', label: 'WBS', status: 'available' },
  { id: 'list', label: '列表', status: 'available' },
  { id: 'calendar', label: '日历', status: 'available' },
  { id: 'timeline', label: '时间线', status: 'available' },
]

export interface LensSwitcherProps {
  /** 当前激活镜头（默认看板）。 */
  activeLensId?: ProjectSpaceLensId
  /** 点击任一镜头选项时回调。 */
  onSelect?: (id: ProjectSpaceLensId) => void
}

export function LensSwitcher({ activeLensId = 'kanban', onSelect }: LensSwitcherProps) {
  return (
    <div
      data-lens-switcher
      role="group"
      aria-label="镜头切换器"
      className="flex max-w-full flex-wrap items-center gap-0.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-0.5"
    >
      {LENS_SWITCHER_OPTIONS.map((option) => {
        const active = option.id === activeLensId
        return (
          <button
            key={option.id}
            type="button"
            data-lens-trigger={option.id}
            data-lens-option={option.id}
            data-lens-status={option.status}
            aria-pressed={active || undefined}
            tabIndex={0}
            onClick={() => onSelect?.(option.id)}
            className={cn(
              'relative h-11 px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] sm:h-8',
              active
                ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]'
                : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
            )}
          >
            {option.label}
            {active ? (
              <span
                data-lens-active-indicator
                className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--nx-workspace-blue)]"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export default LensSwitcher
