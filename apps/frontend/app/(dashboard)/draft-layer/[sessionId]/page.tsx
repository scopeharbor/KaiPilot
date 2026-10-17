'use client'

/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer 审查页面（task 10.2-10.7）。
 *
 * 展示 Draft Layer 审查体验：来源摘要、Preview、Diff、变更决策、dry-run、apply。
 */
import { DraftLayerReviewPanel } from '@/components/ai-copilot/DraftLayerReviewPanel'
import { PermissionGuard } from '@/components/PermissionGuard'
import { useParams } from 'next/navigation'

export default function DraftLayerReviewPage() {
  const params = useParams()
  const sessionId = Number(params.sessionId)

  if (isNaN(sessionId)) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-destructive">无效的草案 ID</p>
      </div>
    )
  }

  return (
    <PermissionGuard require="ai:trigger" fallback={null}>
      <div className="mx-auto max-w-4xl py-6">
        <h1 className="mb-6 text-2xl font-bold">AI 草案审查</h1>
        <DraftLayerReviewPanel sessionId={sessionId} />
      </div>
    </PermissionGuard>
  )
}
