/**
 * OKR AI Draft Preview UI 组件（v3-okr-hierarchy-management tasks 6.9）。
 *
 * 展示 AI 生成的 OKR 草案：assumptions、source refs、warnings、objectives with KRs、风险提示、
 * diff 选择接受和人工确认。
 */

'use client'

import { useState } from 'react'
import type {
  OkrAiDraftResponse,
  OkrAiDraftObjective,
  OkrAiDraftConfirmationRequest,
} from '@aiproj/types'
import { cn } from '@/lib/utils'

export interface OkrAiDraftPreviewProps {
  draft: OkrAiDraftResponse
  loading?: boolean
  error?: string | null
  onConfirm?: (input: OkrAiDraftConfirmationRequest) => Promise<void>
  onCancel?: () => void
  organizationId: number
}

export function OkrAiDraftPreview({
  draft,
  loading,
  error,
  onConfirm,
  onCancel,
  organizationId,
}: OkrAiDraftPreviewProps) {
  const [selectedObjectives, setSelectedObjectives] = useState<Set<number>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="p-6 text-center text-muted-foreground" data-testid="okr-ai-draft-loading">
        AI 正在生成 OKR 草案...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center text-destructive" data-testid="okr-ai-draft-error">
        AI 草案生成失败：{error}
      </div>
    )
  }

  function toggleObjective(index: number) {
    const next = new Set(selectedObjectives)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelectedObjectives(next)
  }

  async function handleConfirm() {
    if (!onConfirm) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const accepted = draft.objectives
        .filter((_, i) => selectedObjectives.has(i))
        .flatMap((obj: OkrAiDraftObjective) => [
          {
            kind: 'objective' as const,
            data: { title: obj.title, description: obj.description, scope: obj.scope },
          },
          ...obj.keyResults.map((kr) => ({
            kind: 'key_result' as const,
            data: {
              title: kr.title,
              description: kr.description,
              measurementType: kr.measurementType,
              baselineValue: kr.baselineValue,
              targetValue: kr.targetValue,
            },
          })),
        ])
      await onConfirm({ draftId: `draft-${organizationId}-${Date.now()}`, accepted })
    } catch (err: unknown) {
      setConfirmError(err instanceof Error ? err.message : '确认失败')
    } finally {
      setConfirming(false)
    }
  }

  const confidenceLabels: Record<string, string> = { high: '高', medium: '中', low: '低' }

  return (
    <div className="border rounded-lg p-4 space-y-4" data-testid="okr-ai-draft-preview">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">AI OKR 草案预览</h3>
        <span
          className={cn(
            'text-xs px-2 py-1 rounded',
            draft.confidence === 'high'
              ? 'bg-green-100 text-green-700'
              : draft.confidence === 'medium'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-red-100 text-red-700',
          )}
        >
          置信度: {confidenceLabels[draft.confidence]}
        </span>
      </div>

      {/* Assumptions */}
      {draft.assumptions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-1">假设</h4>
          <ul className="text-xs text-muted-foreground space-y-1">
            {draft.assumptions.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Source Refs */}
      {draft.sourceRefs.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-1">数据来源</h4>
          <div className="flex gap-1 flex-wrap">
            {draft.sourceRefs.map((ref, i) => (
              <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded">
                {ref}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {draft.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
          {draft.warnings.map((w, i) => (
            <div key={i}>{w.message}</div>
          ))}
        </div>
      )}

      {/* Objectives */}
      <div>
        <h4 className="text-sm font-medium mb-2">建议的目标与关键结果</h4>
        <div className="space-y-3">
          {draft.objectives.map((obj, i) => (
            <div
              key={i}
              className={cn(
                'border rounded p-3 cursor-pointer transition-colors',
                selectedObjectives.has(i) ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
              )}
              onClick={() => toggleObjective(i)}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedObjectives.has(i)}
                  onChange={() => {}}
                  className="pointer-events-none"
                />
                <span className="font-medium text-sm">{obj.title}</span>
                <span className="text-xs text-muted-foreground">[{obj.scope}]</span>
                <span
                  className={cn(
                    'text-xs',
                    obj.confidence === 'high'
                      ? 'text-green-600'
                      : obj.confidence === 'medium'
                        ? 'text-amber-600'
                        : 'text-red-600',
                  )}
                >
                  {confidenceLabels[obj.confidence]}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{obj.description}</p>
              {obj.keyResults.length > 0 && (
                <div className="mt-2 space-y-1">
                  {obj.keyResults.map((kr, j) => (
                    <div key={j} className="text-xs flex items-center gap-2 pl-4">
                      <span className="w-2 h-2 rounded-full bg-primary/30 inline-block" />
                      <span>{kr.title}</span>
                      <span className="text-muted-foreground">
                        {kr.baselineValue} → {kr.targetValue} ({kr.measurementType})
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {obj.alignment && (
                <div className="text-xs text-muted-foreground mt-1 pl-4">
                  ↳ 对齐到: {obj.alignment.parentObjectiveTitle} — {obj.alignment.rationale}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Risks */}
      {draft.risks.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-1">风险提示</h4>
          <div className="space-y-1">
            {draft.risks.map((r, i) => (
              <div
                key={i}
                className={cn(
                  'text-xs p-2 rounded',
                  r.severity === 'high'
                    ? 'bg-red-50 text-red-700'
                    : r.severity === 'medium'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-blue-50 text-blue-700',
                )}
              >
                <strong>{r.severity.toUpperCase()}</strong>: {r.message} — {r.suggestion}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm Error */}
      {confirmError && (
        <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">{confirmError}</div>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end pt-2 border-t">
        {onCancel && (
          <button
            className="px-4 py-2 border rounded text-sm hover:bg-muted"
            onClick={onCancel}
            disabled={confirming}
          >
            取消
          </button>
        )}
        {onConfirm && (
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
            onClick={handleConfirm}
            disabled={confirming || selectedObjectives.size === 0}
          >
            {confirming ? '确认中...' : `确认接受 (${selectedObjectives.size})`}
          </button>
        )}
      </div>
    </div>
  )
}
