import type { Metadata } from 'next'
import { AiM0Sandbox } from '@/components/dev/ai-m0/AiM0Sandbox'

/**
 * `/dev/ai-m0` —— AI 结构化输出 M0 沙箱（ai-structured-output-poc，抛弃型 UI + 留存契约）。
 *
 * 与 gantt-m0 一样置于 dashboard 路由组之外、无 AppShell，与真实产品导航隔离；
 * API 仍要求认证与 ai:connection:manage，避免组织 key 被越权消耗。
 * 达标后本路由与 sandbox 组件移除，仅：
 *   - `lib/ai-m0/*`（schema/sse-buffer/measure）；
 *   - `packages/types` 中 AIMarker/AiProjectDraft 契约；
 *   - `components/dev/ai-m0/DraftReviewPanel.tsx` 骨架，作为 T037 「AI 反幻觉草案审查」的种子；
 * 留存到主线。
 */
export const metadata: Metadata = {
  title: 'AI 结构化输出 M0 沙箱',
  robots: { index: false, follow: false },
}

export default function AiM0Page() {
  return <AiM0Sandbox />
}
