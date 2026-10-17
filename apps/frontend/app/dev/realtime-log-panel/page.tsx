import type { Metadata } from 'next'
import { RealtimeLogPanelSandbox } from '@/components/dev/realtime-log-panel/RealtimeLogPanelSandbox'

/**
 * `/dev/realtime-log-panel` —— v2-5-streaming-realtime-log-panel 浏览器核对沙箱（抛弃型）。
 *
 * 刻意置于 dashboard 路由组之外：无鉴权、无 AppShell。用本地定时器模拟日志流，不连真实
 * WebSocket。归档后本路由与 sandbox 可移除，仅 `components/realtime/realtime-log-panel.tsx`、
 * `hooks/use-realtime-log-panel-state.ts`、`lib/realtime/log-buffer.ts` 留存。
 */
export const metadata: Metadata = {
  title: '实时日志面板沙箱',
  robots: { index: false, follow: false },
}

export default function RealtimeLogPanelDevPage() {
  return <RealtimeLogPanelSandbox />
}
