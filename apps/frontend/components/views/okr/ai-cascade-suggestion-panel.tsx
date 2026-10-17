'use client'

// AI 级联建议预览面板（v3-okr-cascade-and-alignment §5.6）。
// 明确标注「仅预览/草稿」，AI 建议必须经显式确认才落库。

import { useState } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import type {
  OkrAiCascadeSuggestionRequest,
  OkrAiCascadeSuggestionResponse,
  OkrAiDraftObjective,
  OkrConfidenceLevel,
} from '@aiproj/types'

const CONFIDENCE_LABELS: Record<OkrConfidenceLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
}

export interface AiCascadeSuggestionPanelProps {
  organizationId: number
  cycleId: number
  open: boolean
  onClose: () => void
  onApplySuggestion: (items: OkrAiDraftObjective[]) => void
  mutation: UseMutationResult<OkrAiCascadeSuggestionResponse, Error, OkrAiCascadeSuggestionRequest>
}

export function AiCascadeSuggestionPanel({
  cycleId,
  open,
  onClose,
  onApplySuggestion,
  mutation,
}: AiCascadeSuggestionPanelProps) {
  const [sourceObjectiveId, setSourceObjectiveId] = useState<number>(0)
  const [depth, setDepth] = useState(2)
  const [suggestions, setSuggestions] = useState<OkrAiDraftObjective[] | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  if (!open) return null

  async function handleGenerate() {
    setSubmitError(null)
    setSuggestions(null)
    try {
      // 契约字段是 objectiveId（可选），没有 sourceObjectiveId / depth。
      const result = await mutation.mutateAsync({
        cycleId,
        objectiveId: sourceObjectiveId || undefined,
      })
      setSuggestions(result.cascadeCandidates ?? [])
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'AI 建议生成失败')
    }
  }

  function handleApply() {
    if (suggestions) {
      onApplySuggestion(suggestions)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
      data-testid="ai-cascade-suggestion-panel"
    >
      <div className="bg-background rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">AI 级联建议</h2>
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
              ⚠ 仅预览 — AI 建议不会自动落库
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 输入 */}
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">源目标 ID (0 = 全部)</label>
            <input
              type="number"
              className="border rounded px-3 py-1.5 text-sm w-full"
              value={sourceObjectiveId}
              onChange={(e) => setSourceObjectiveId(Number(e.target.value))}
              min={0}
            />
          </div>
          <div className="w-24">
            <label className="text-xs text-muted-foreground block mb-1">深度</label>
            <input
              type="number"
              className="border rounded px-3 py-1.5 text-sm w-full"
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              min={1}
              max={5}
            />
          </div>
          <button
            className="px-4 py-1.5 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
            onClick={handleGenerate}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? '生成中...' : '生成建议'}
          </button>
        </div>

        {/* 错误 */}
        {(submitError || mutation.error) && (
          <div className="bg-destructive/10 text-destructive p-3 rounded text-sm">
            {submitError || (mutation.error as Error).message}
          </div>
        )}

        {/* 提示：AI 仅预览 */}
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800">
          💡 AI 生成的级联建议仅供参考。所有建议需要您审核确认后才会创建为正式 OKR 目标。
          此面板仅作预览用途，不会自动修改任何数据。
        </div>

        {/* 空态 */}
        {!mutation.isPending && !suggestions && !submitError && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            点击"生成建议"获取 AI 推荐的级联与对齐方案。
          </div>
        )}

        {/* 加载态 */}
        {mutation.isPending && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            正在分析目标结构并生成级联建议...
          </div>
        )}

        {/* 建议列表 */}
        {suggestions && suggestions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            AI 未发现需要级联的项目。当前目标结构似乎已完整覆盖。
          </div>
        )}

        {suggestions && suggestions.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">建议的级联目标 ({suggestions.length})</h3>
            {suggestions.map((item, i) => (
              <div key={i} className="border rounded p-3">
                <div className="text-sm font-medium">{item.title ?? `建议 #${i + 1}`}</div>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {item.scope && (
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {item.scope}
                    </span>
                  )}
                  {item.confidence && (
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {/* confidence 是 low|medium|high 字面量，不是 0-1 概率：
                          原先按 Math.round(confidence * 100) 渲染只会得到 NaN% */}
                      置信度: {CONFIDENCE_LABELS[item.confidence] ?? item.confidence}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* warnings 挂在响应顶层而非每条候选上：原先按 item.warnings 渲染永远为空 */}
            {(mutation.data?.warnings?.length ?? 0) > 0 && (
              <div className="mt-1 text-xs text-amber-600">
                {mutation.data!.warnings.map((w, j) => (
                  <div key={j}>⚠ {w.message}</div>
                ))}
              </div>
            )}

            {/* 采纳按钮 */}
            <button
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
              onClick={handleApply}
            >
              采纳建议并进入确认流程
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
