import type { Metadata } from 'next'
import { GanttM0Sandbox } from '@/components/dev/gantt-m0/GanttM0Sandbox'

/**
 * `/dev/gantt-m0` —— 甘特图 M0 性能验证沙箱（gantt-performance-poc，抛弃型）。
 *
 * 刻意置于 dashboard 路由组之外：无鉴权、无 AppShell，与真实甘特 Tab（T018 归属）隔离。
 * 达标后本路由与 A/B 实验渲染代码移除，仅 `lib/gantt-m0` 的数据集生成器与测量夹具留存。
 */
export const metadata: Metadata = {
  title: '甘特图 M0 性能沙箱',
  robots: { index: false, follow: false },
}

export default function GanttM0Page() {
  return <GanttM0Sandbox />
}
