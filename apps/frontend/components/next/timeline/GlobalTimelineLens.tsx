'use client'

/**
 * 全域时间主轴镜头组件 (GlobalTimelineLens)
 *
 * 为全域时间主轴提供工作面镜头级装配封装：
 * - 集成全域时间主轴 (GlobalTimelineBar)；
 * - 提供宏观交付态势汇总微标；
 * - 支持直接嵌入角色首页工作面或全域刻度档视图。
 */

import * as React from 'react'
import {
  GlobalTimelineBar,
  type GlobalTimelineBarProps,
} from '@/components/next/project-space/GlobalTimelineBar'
import { cn } from '@/lib/utils'

export interface GlobalTimelineLensProps extends GlobalTimelineBarProps {
  /** 镜头标题（可选） */
  title?: string
}

export function GlobalTimelineLens({ title, className, ...rest }: GlobalTimelineLensProps) {
  return (
    <div data-global-timeline-lens className={cn('w-full space-y-3', className)}>
      {title ? (
        <h2 className="text-sm font-semibold tracking-tight text-[var(--nx-text-primary)]">
          {title}
        </h2>
      ) : null}
      <GlobalTimelineBar {...rest} />
    </div>
  )
}

export default GlobalTimelineLens
