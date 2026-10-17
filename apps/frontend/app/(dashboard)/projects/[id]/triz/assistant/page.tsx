'use client'

// @aiproj/frontend — V3 AI-TRIZ 助手审查 UI 页面
// v3-ai-triz-assistant / tasks §7.1
//
// 项目级路由：/projects/[id]/triz/assistant

import dynamic from 'next/dynamic'

const TrizAssistantPanel = dynamic(() => import('@/components/views/triz/triz-assistant-panel'), {
  ssr: false,
})

export default function TrizAssistantPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h2 className="text-lg font-semibold">AI-TRIZ 助手</h2>
          <p className="text-xs text-muted-foreground">确定性 TRIZ 工具路由 · 只建议，不自动执行</p>
        </div>
      </div>
      <TrizAssistantPanel />
    </div>
  )
}
