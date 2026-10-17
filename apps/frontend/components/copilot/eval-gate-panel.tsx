/**
 * v3-copilot-custom-agent-eval-gate — 门禁报告面板（§6.4 P1）
 *
 * 展示门禁结论：判定状态、逐项得分、失败项标识、依赖指纹、benchmark 来源。
 * 权限感知：仅显示当前用户可见的信息。
 */
'use client'

import { useMemo } from 'react'
import {
  EVAL_GATE_VERDICT_LABELS,
  EVAL_GATE_INVALIDATION_REASON_LABELS,
  type EvalGateVerdictRecord,
  type EvalGateItemScore,
} from '@aiproj/types'

// ── 判定状态颜色映射 ──────────────────────────────────────────────────────

const VERDICT_STYLES: Record<string, { bg: string; text: string; badge: string }> = {
  pass: {
    bg: 'bg-green-50 border-green-200',
    text: 'text-green-800',
    badge: 'bg-green-100 text-green-700',
  },
  fail: {
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-800',
    badge: 'bg-red-100 text-red-700',
  },
  unavailable: {
    bg: 'bg-yellow-50 border-yellow-200',
    text: 'text-yellow-800',
    badge: 'bg-yellow-100 text-yellow-700',
  },
  invalidated: {
    bg: 'bg-orange-50 border-orange-200',
    text: 'text-orange-800',
    badge: 'bg-orange-100 text-orange-700',
  },
}

// ── 组件 ──────────────────────────────────────────────────────────────────

export interface EvalGatePanelProps {
  /** 门禁结论记录。 */
  verdict: EvalGateVerdictRecord
  /** 是否为创建者（创建者可看到更多信息）。 */
  isCreator?: boolean
}

const DEFAULT_STYLE = {
  bg: 'bg-yellow-50 border-yellow-200',
  text: 'text-yellow-800',
  badge: 'bg-yellow-100 text-yellow-700',
}

export function EvalGatePanel({ verdict, isCreator = false }: EvalGatePanelProps) {
  const styles = VERDICT_STYLES[verdict.verdict] ?? DEFAULT_STYLE
  const verdictLabel = EVAL_GATE_VERDICT_LABELS[verdict.verdict] ?? verdict.verdict

  const avgScore = useMemo(() => {
    if (verdict.itemScores.length === 0) return null
    return verdict.itemScores.reduce((sum, item) => sum + item.score, 0) / verdict.itemScores.length
  }, [verdict.itemScores])

  return (
    <div className={`rounded-lg border p-4 ${styles.bg}`}>
      {/* 标题行 */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`text-sm font-semibold ${styles.text}`}>评测门禁</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles.badge}`}>
          {verdictLabel}
        </span>
      </div>

      {/* 元信息 */}
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          <span className="font-medium">助手版本:</span> {verdict.definitionVersion}
        </div>
        <div>
          <span className="font-medium">数据集:</span> {verdict.datasetVersion}
        </div>
        <div>
          <span className="font-medium">Benchmark:</span>{' '}
          <span className={verdict.benchmarkSource === 'L3' ? 'text-orange-600' : ''}>
            {verdict.benchmarkSource === 'L3' ? 'L3 Synthetic' : 'Fixture'}
          </span>
        </div>
        <div>
          <span className="font-medium">评分器:</span> {verdict.scorerVersion}
        </div>
      </div>

      {/* 失效原因（仅 invalidated 状态显示） */}
      {verdict.verdict === 'invalidated' && verdict.invalidationReason && (
        <div className="mb-3 rounded border border-orange-200 bg-orange-50 p-2 text-xs text-orange-700">
          <span className="font-medium">失效原因:</span>{' '}
          {EVAL_GATE_INVALIDATION_REASON_LABELS[verdict.invalidationReason] ??
            verdict.invalidationReason}
        </div>
      )}

      {/* 平均分 */}
      {avgScore !== null && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-muted-foreground">综合得分</div>
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full ${
                  avgScore >= 0.7
                    ? 'bg-green-500'
                    : avgScore >= 0.5
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${Math.min(avgScore * 100, 100)}%` }}
              />
            </div>
            <span className={`text-sm font-semibold ${styles.text}`}>
              {(avgScore * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* 逐项得分 */}
      {verdict.itemScores.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-muted-foreground">评测项明细</div>
          <div className="space-y-1">
            {verdict.itemScores.map((item) => (
              <ItemScoreRow key={item.itemId} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* 失败项快速定位 */}
      {verdict.failingItemIds.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          <span className="font-medium">未达标项:</span> {verdict.failingItemIds.join(', ')}
        </div>
      )}

      {/* 依赖指纹（创建者可见） */}
      {isCreator && (
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium">依赖指纹:</span>{' '}
          <code className="break-all font-mono text-[10px]">
            {verdict.dependencyFingerprint.slice(0, 16)}…
          </code>
        </div>
      )}
    </div>
  )
}

// ── 评测项行 ──────────────────────────────────────────────────────────────

function ItemScoreRow({ item }: { item: EvalGateItemScore }) {
  const scoreColor =
    item.score >= 0.7 ? 'text-green-600' : item.score >= 0.5 ? 'text-yellow-600' : 'text-red-600'
  const barColor =
    item.score >= 0.7 ? 'bg-green-500' : item.score >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 truncate text-muted-foreground">{item.itemName}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${Math.min(item.score * 100, 100)}%` }}
        />
      </div>
      <span className={`w-10 text-right font-medium ${scoreColor}`}>
        {(item.score * 100).toFixed(0)}%
      </span>
      {item.failed && (
        <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-600">未达标</span>
      )}
    </div>
  )
}
