import type { Metadata } from 'next'
import { GanttT018Harness } from '@/components/views/gantt/dev/GanttT018Harness'

/**
 * `/dev/gantt-t018` —— 甘特渲染核 T018 性能 harness（task 1.5）。
 *
 * 置于 dashboard 路由组之外：无鉴权、无 AppShell，与真实甘特 Tab 隔离。
 * 渲染**新引擎**（区别于仍留存的 M0 A/B/C yardstick `/dev/gantt-m0`），用于完整图元最差帧复测。
 */
export const metadata: Metadata = {
  title: '甘特 T018 性能 harness',
  robots: { index: false, follow: false },
}

export default function GanttT018Page() {
  return <GanttT018Harness />
}
