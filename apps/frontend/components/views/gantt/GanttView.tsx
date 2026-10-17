'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { BrandLoader } from '@/components/ui/BrandLogo'
import type { GanttChart } from './core/GanttChart'

/**
 * 甘特根组件（task 1.4）。渲染核较重且强依赖浏览器（Canvas/滚动/测量），
 * 用 `next/dynamic` + `ssr: false` 客户端懒加载，避免 SSR 首屏阻塞与 hydration 抖动。
 */
const GanttChartLazy = dynamic(() => import('./core/GanttChart').then((m) => m.GanttChart), {
  ssr: false,
  loading: () => (
    <div className="flex h-full flex-col gap-4 p-3" aria-busy="true">
      <BrandLoader size={56} label="正在载入甘特图视图…" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-full w-full flex-1" />
    </div>
  ),
})

export type GanttViewProps = ComponentProps<typeof GanttChart>

export function GanttView(props: GanttViewProps) {
  return <GanttChartLazy {...props} />
}

export default GanttView
