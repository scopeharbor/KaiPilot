'use client'

import * as React from 'react'
import { RotateCcw } from 'lucide-react'
import { useRiskMatrix } from '@/hooks/use-risk-matrix'
import type { RiskMatrixCell } from '@/lib/api/risks'
import { cn } from '@/lib/utils'
import {
  RISK_LEVEL_SHORT_LABELS,
  RISK_SCALE_LABELS,
  RISK_TONE_LABELS,
  riskExposureTone,
  type RiskCellRef,
  type RiskTone,
} from './risk-meta'

/**
 * 5×5 风险概率-影响度矩阵热力图（v3-ui-next-chart-gallery tasks 4.1）。
 *
 * - 对接既有端点 GET /projects/:projectId/risks/matrix（固有敞口 basis=inherent）；
 * - 横轴冲击度 1-5（左→右递增），纵轴发生概率 1-5（顶→底递减），
 *   按敞口分值（概率 × 影响）映射低危（绿/蓝）、中危（黄）、高危（红）三色区带；
 * - 格内数字标明落入该格的风险条目数；单元格支持点击选中/再次点击取消，
 *   供上层镜头联动过滤登记底册（选中状态由父层持有）；
 * - 三态齐全：加载骨架 / 空数据（25 格零计数仍呈现网格） / 错误卡 + 重试；
 * - 仅发起 GET，点击为纯前端状态，零写请求（RL-01）。
 */

/** 色带 → 单元格辅助样式（令牌背景为 rgba 透明度展开，色值即 --nx-status-*）。 */
const TONE_BG: Record<RiskTone, string> = {
  low: 'rgba(16, 185, 129, 0.10)',
  medium: 'rgba(245, 158, 11, 0.12)',
  high: 'rgba(239, 68, 68, 0.16)',
}

const TONE_TEXT: Record<RiskTone, string> = {
  low: 'text-[var(--nx-status-success)]',
  medium: 'text-[var(--nx-status-warning)]',
  high: 'text-[var(--nx-status-danger)]',
}

/** 单元格 aria 名（测试与无障碍共用契约）：概率 4 · 影响 5 · 高危 · 2 条风险 */
export function riskCellAriaLabel(cell: { probability: number; impact: number; count: number }) {
  return `概率 ${cell.probability} · 影响 ${cell.impact} · ${RISK_TONE_LABELS[riskExposureTone(cell.probability, cell.impact)]} · ${cell.count} 条风险`
}

export interface RiskMatrixHeatmapProps {
  projectId: number
  /** 当前联动选中的单元格；null = 未筛选 */
  selectedCell: RiskCellRef | null
  /** 单元格点击回调：传入命中格；再次点击同一格时传 null（取消筛选） */
  onSelectCell: (cell: RiskCellRef | null) => void
}

export function RiskMatrixHeatmap({
  projectId,
  selectedCell,
  onSelectCell,
}: RiskMatrixHeatmapProps) {
  const { data, isLoading, isError, isFetching, refetch } = useRiskMatrix(projectId, 'inherent')
  const cells = React.useMemo(() => data?.data?.cells ?? [], [data])

  const cellMap = React.useMemo(() => {
    const map = new Map<string, RiskMatrixCell>()
    for (const cell of cells) map.set(`${cell.probability}-${cell.impact}`, cell)
    return map
  }, [cells])

  const totalRisks = React.useMemo(() => cells.reduce((sum, cell) => sum + cell.count, 0), [cells])

  const handleCellClick = React.useCallback(
    (probability: number, impact: number) => {
      if (
        selectedCell &&
        selectedCell.probability === probability &&
        selectedCell.impact === impact
      ) {
        onSelectCell(null)
        return
      }
      onSelectCell({ probability, impact })
    },
    [selectedCell, onSelectCell],
  )

  return (
    <section
      data-risk-matrix
      aria-busy={isLoading || isFetching}
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
            5×5 风险敞口热力矩阵
          </h3>
          <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
            固有敞口 · 概率 × 影响
          </span>
          <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
            共 {totalRisks} 条风险
          </span>
        </div>
        {/* 三色区带图例（文案标签，不单靠颜色区分——WCAG AA） */}
        <div className="flex items-center gap-3 text-[11px] text-[var(--nx-text-secondary)]">
          {(['low', 'medium', 'high'] as const).map((tone) => (
            <span key={tone} className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-[2px] border border-[var(--nx-border-hairline)]"
                style={{ backgroundColor: TONE_BG[tone] }}
              />
              {RISK_TONE_LABELS[tone]}
            </span>
          ))}
        </div>
      </div>

      {isError && cells.length === 0 ? (
        <div
          role="alert"
          aria-label="风险矩阵加载错误"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
        >
          <p className="text-sm text-[var(--nx-text-secondary)]">风险矩阵加载失败，请稍后重试</p>
          <button
            type="button"
            data-risk-matrix-retry
            onClick={() => void refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            重新加载
          </button>
        </div>
      ) : isLoading && cells.length === 0 ? (
        <div data-risk-matrix-skeleton aria-label="矩阵加载中" className="flex flex-col gap-1">
          {[5, 4, 3, 2, 1].map((probability) => (
            <div key={probability} className="flex gap-1">
              {[1, 2, 3, 4, 5].map((impact) => (
                <div
                  key={`${probability}-${impact}`}
                  className="h-14 flex-1 animate-pulse rounded-[4px] bg-[var(--nx-bg-1)]"
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1" aria-label="风险概率-影响度矩阵">
            <caption className="sr-only">
              纵轴为发生概率（1-5 级，自顶向下递减），横轴为冲击度（1-5 级，自左向右递增）；
              单元格色带：低危（绿）、中危（黄）、高危（红）。
            </caption>
            <thead>
              <tr>
                <th scope="col" className="p-0" aria-hidden />
                {[1, 2, 3, 4, 5].map((impact) => (
                  <th
                    key={impact}
                    scope="col"
                    className="min-w-14 pb-1 text-center text-[10px] font-medium text-[var(--nx-text-muted)]"
                  >
                    影响 {RISK_SCALE_LABELS[impact - 1]}
                    <span className="ml-1 font-mono">{impact}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[5, 4, 3, 2, 1].map((probability) => (
                <tr key={probability}>
                  <th
                    scope="row"
                    className="pr-1 text-right text-[10px] font-medium text-[var(--nx-text-muted)]"
                  >
                    概率 {RISK_SCALE_LABELS[probability - 1]}
                    <span className="ml-1 font-mono">{probability}</span>
                  </th>
                  {[1, 2, 3, 4, 5].map((impact) => {
                    const cell = cellMap.get(`${probability}-${impact}`)
                    const count = cell?.count ?? 0
                    const tone = riskExposureTone(probability, impact)
                    const selected =
                      selectedCell?.probability === probability && selectedCell.impact === impact
                    return (
                      <td key={`${probability}-${impact}`} className="p-0">
                        <button
                          type="button"
                          data-risk-cell={`${probability}-${impact}`}
                          data-risk-cell-tone={tone}
                          data-risk-cell-count={count}
                          data-risk-cell-selected={selected || undefined}
                          aria-pressed={selected}
                          aria-label={riskCellAriaLabel({ probability, impact, count })}
                          title={`概率 ${RISK_LEVEL_SHORT_LABELS[probability - 1]} · 影响 ${RISK_LEVEL_SHORT_LABELS[impact - 1]}：${count} 条风险（点击筛选登记表）`}
                          onClick={() => handleCellClick(probability, impact)}
                          className={cn(
                            'flex h-14 min-w-14 flex-col items-center justify-center gap-0.5 rounded-[4px] border text-[10px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                            selected
                              ? 'border-[var(--nx-accent)] ring-1 ring-[var(--nx-accent)]'
                              : 'border-[var(--nx-border-hairline)] hover:border-[var(--nx-border-focus)]',
                            count > 0 ? TONE_TEXT[tone] : 'text-[var(--nx-text-muted)] opacity-60',
                          )}
                          style={count > 0 ? { backgroundColor: TONE_BG[tone] } : undefined}
                        >
                          <span className="font-mono text-sm">{count}</span>
                          <span aria-hidden className="text-[9px] opacity-70">
                            {RISK_TONE_LABELS[tone]}
                          </span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default RiskMatrixHeatmap
