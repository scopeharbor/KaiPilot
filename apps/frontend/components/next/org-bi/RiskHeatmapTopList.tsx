'use client'

import { ArrowDownRight, ArrowUpRight, ChevronRight, EyeOff } from 'lucide-react'
import type { BiRiskHeatmapCell } from '@aiproj/types'
import { isBiRiskHeatmapRedacted } from '@aiproj/types'
import { cn } from '@/lib/utils'
import { biHeatLevelMeta, formatBiMetricNumber } from '@/lib/next/org-bi/org-bi-adapter'

/**
 * BI 风险 Top 榜（v3-ui-next-org-portfolio-domains W3 · tasks 3.6）。
 *
 * - 取当前查询结果中风险分值最高的单元（按 score 降序稳定排列，红黄风险优先见）；
 * - 每行双通道回显：等级徽标（色阶令牌 + 中文文案）＋ 行×列实体名 + 分值/计数/
 *   变化量（带符号）；脱敏单元以「不可见」中性态占位，不出现任何数值文本（RL-05）；
 * - 点击行唤起上层摘要抽屉；纯只读（RL-01）。
 */
export const RISK_TOP_LIST_LIMIT = 8

export interface RiskHeatmapTopListProps {
  cells: BiRiskHeatmapCell[]
  onSelectCell: (cell: BiRiskHeatmapCell) => void
}

export function RiskHeatmapTopList({ cells, onSelectCell }: RiskHeatmapTopListProps) {
  const ranked = [...cells]
    .sort((a, b) => {
      const byScore = b.score - a.score
      return byScore !== 0 ? byScore : b.count - a.count
    })
    .slice(0, RISK_TOP_LIST_LIMIT)

  if (ranked.length === 0) return null

  return (
    <section
      data-bi-heat-top-list
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-[var(--nx-text-secondary)]">风险 Top 榜</h3>
        <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
          按风险分值排序 · 共 {ranked.length} 项
        </span>
      </div>
      <ol className="divide-y divide-[var(--nx-border-hairline)]" aria-label="风险 Top 榜列表">
        {ranked.map((cell, index) => {
          const meta = biHeatLevelMeta(cell.riskLevel)
          const redacted = isBiRiskHeatmapRedacted(cell.redactionState)
          const title = `${cell.rowLabel} × ${cell.columnLabel}`
          return (
            <li key={`${cell.rowKey}::${cell.columnKey}`}>
              <button
                type="button"
                data-bi-heat-top-item
                data-bi-heat-level={cell.riskLevel}
                data-bi-heat-redacted={redacted || undefined}
                onClick={() => onSelectCell(cell)}
                aria-label={`${title}：${meta.label} 风险单元`}
                className="flex w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-[var(--nx-bg-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
              >
                <span className="w-5 shrink-0 text-center font-mono text-[11px] text-[var(--nx-text-muted)]">
                  {index + 1}
                </span>
                <span
                  data-bi-heat-top-badge
                  className="inline-flex h-6 w-14 shrink-0 items-center justify-center rounded-[4px] border text-[11px] font-medium"
                  style={{
                    color: redacted ? 'var(--nx-text-muted)' : meta.token,
                    backgroundColor: redacted ? 'transparent' : meta.bg,
                    borderColor: redacted ? 'var(--nx-border-hairline)' : meta.border,
                  }}
                >
                  {redacted ? '不可见' : meta.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--nx-text-primary)]">
                  {title}
                </span>
                {redacted ? (
                  <EyeOff
                    className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
                    aria-hidden
                  />
                ) : (
                  <span className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                    <span className="text-[var(--nx-text-primary)]">
                      {formatBiMetricNumber(cell.score, 2)}
                    </span>
                    <span className="text-[var(--nx-text-muted)]">{cell.count} 个</span>
                    {cell.delta !== null ? (
                      <span
                        data-bi-heat-top-delta
                        className={cn(
                          'inline-flex items-center gap-0.5',
                          cell.delta > 0
                            ? 'text-[var(--nx-status-danger)]'
                            : 'text-[var(--nx-status-success)]',
                        )}
                      >
                        {cell.delta > 0 ? (
                          <ArrowUpRight className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowDownRight className="h-3 w-3" aria-hidden />
                        )}
                        {formatBiMetricNumber(Math.abs(cell.delta), 2)}
                      </span>
                    ) : null}
                  </span>
                )}
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
                  aria-hidden
                />
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default RiskHeatmapTopList
