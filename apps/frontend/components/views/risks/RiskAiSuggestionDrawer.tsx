'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { BrandLoader } from '@/components/ui/BrandLogo'
import { Button } from '@/components/ui/Button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/Sheet'
import {
  useTriggerAiSuggestions,
  useAcceptAiSuggestion,
  useRejectAiSuggestion,
} from '@/hooks/use-risk-ai-suggestions'
import { useRiskViewStore } from '@/stores/risk-view-store'
import type { RiskAiSuggestion } from '@/lib/api/risks'

const CATEGORY_LABELS: Record<string, string> = {
  technical: '技术',
  schedule: '进度',
  cost: '成本',
  resource: '资源',
  external: '外部',
  organizational: '组织',
  legal: '法律',
  other: '其他',
}

interface RiskAiSuggestionDrawerProps {
  projectId: number
  open: boolean
  onClose: () => void
}

export function RiskAiSuggestionDrawer({ projectId, open, onClose }: RiskAiSuggestionDrawerProps) {
  const [suggestions, setSuggestions] = useState<RiskAiSuggestion[]>([])
  const [batchId, setBatchId] = useState<string | null>(null)

  const triggerMutation = useTriggerAiSuggestions(projectId)
  const acceptMutation = useAcceptAiSuggestion(projectId)
  const rejectMutation = useRejectAiSuggestion(projectId)
  const {
    acceptedSuggestionIds,
    rejectedSuggestionIds,
    markAccepted,
    markRejected,
    resetSuggestions,
  } = useRiskViewStore()

  const handleTrigger = async () => {
    resetSuggestions()
    const result = await triggerMutation.mutateAsync()
    setSuggestions(result.data.suggestions)
    setBatchId(result.data.suggestionBatchId)
  }

  const handleAccept = async (suggestion: RiskAiSuggestion, modifiedByUser = false) => {
    await acceptMutation.mutateAsync({
      title: suggestion.title,
      description: suggestion.description,
      category: suggestion.category,
      probability: suggestion.probability,
      impact: suggestion.impact,
      mitigation: suggestion.suggestedMitigation,
      aiMarker: suggestion.aiMarker,
      suggestionBatchId: suggestion.suggestionBatchId,
      modifiedByUser,
    })
    markAccepted(suggestion.suggestionBatchId)
  }

  const handleReject = async (suggestion: RiskAiSuggestion) => {
    if (batchId) {
      await rejectMutation.mutateAsync(batchId)
    }
    markRejected(suggestion.suggestionBatchId)
  }

  const handleAcceptAll = async () => {
    for (const s of suggestions) {
      if (
        !acceptedSuggestionIds.has(s.suggestionBatchId) &&
        !rejectedSuggestionIds.has(s.suggestionBatchId)
      ) {
        await handleAccept(s)
      }
    }
  }

  const handleRejectAll = async () => {
    for (const s of suggestions) {
      if (
        !acceptedSuggestionIds.has(s.suggestionBatchId) &&
        !rejectedSuggestionIds.has(s.suggestionBatchId)
      ) {
        await handleReject(s)
      }
    }
  }

  const pendingCount = suggestions.filter(
    (s) =>
      !acceptedSuggestionIds.has(s.suggestionBatchId) &&
      !rejectedSuggestionIds.has(s.suggestionBatchId),
  ).length

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>AI 风险建议</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* 触发按钮 */}
          <Button onClick={handleTrigger} disabled={triggerMutation.isPending} className="w-full">
            {triggerMutation.isPending ? '生成中...' : 'AI 建议风险'}
          </Button>

          {triggerMutation.isPending ? (
            <div
              className="rounded-[var(--radius-lg)] border border-primary-200 bg-surface px-4 py-6"
              aria-busy="true"
            >
              <BrandLoader size={56} label="AI 正在识别项目风险建议…" />
            </div>
          ) : null}

          {/* 建议列表 */}
          {suggestions.length > 0 && (
            <>
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>
                  {pendingCount} 条待处理 / 共 {suggestions.length} 条建议
                </span>
                <div className="flex gap-2">
                  {pendingCount > 0 && (
                    <>
                      <Button variant="outline" size="sm" onClick={handleAcceptAll}>
                        全部采纳
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleRejectAll}>
                        全部拒绝
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                {suggestions.map((suggestion, idx) => {
                  const isAccepted = acceptedSuggestionIds.has(suggestion.suggestionBatchId)
                  const isRejected = rejectedSuggestionIds.has(suggestion.suggestionBatchId)
                  const isHandled = isAccepted || isRejected

                  return (
                    <div
                      key={idx}
                      className={`p-4 rounded-lg border transition-opacity ${
                        isHandled ? 'opacity-50' : 'border-border'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900 truncate">
                              {suggestion.title}
                            </span>
                            <Badge variant="outline">{CATEGORY_LABELS[suggestion.category]}</Badge>
                            {isAccepted && <Badge variant="success">已采纳</Badge>}
                            {isRejected && <Badge variant="neutral">已拒绝</Badge>}
                          </div>

                          <p className="text-sm text-gray-600 line-clamp-2 mb-2">
                            {suggestion.description}
                          </p>

                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>概率 {suggestion.probability}</span>
                            <span>影响 {suggestion.impact}</span>
                            <span>得分 {suggestion.probability * suggestion.impact}</span>
                          </div>

                          {suggestion.suggestedMitigation && (
                            <div className="mt-2 text-xs text-gray-500">
                              缓解：{suggestion.suggestedMitigation}
                            </div>
                          )}

                          {/* AIMarker */}
                          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                            <Badge variant="ai" className="text-[10px]">
                              置信度 {Math.round(suggestion.aiMarker.confidence * 100)}%
                            </Badge>
                            <span>{suggestion.aiMarker.reason}</span>
                          </div>
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      {!isHandled && (
                        <div className="flex gap-2 mt-3">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => handleAccept(suggestion)}
                            disabled={acceptMutation.isPending}
                          >
                            采纳
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAccept(suggestion, true)}
                            disabled={acceptMutation.isPending}
                          >
                            修改后采纳
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleReject(suggestion)}
                            disabled={rejectMutation.isPending}
                          >
                            拒绝
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* 空状态 */}
          {suggestions.length === 0 && !triggerMutation.isPending && (
            <div className="text-center py-8 text-gray-400 text-sm">
              点击上方按钮获取 AI 风险建议
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
