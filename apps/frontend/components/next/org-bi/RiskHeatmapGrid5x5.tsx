'use client'

import * as React from 'react'
import { AlertTriangle, EyeOff } from 'lucide-react'
import type {
  BiRiskHeatmapCell,
  BiRiskHeatmapDimensionKey,
  BiRiskHeatmapMetricKey,
} from '@aiproj/types'
import { isBiRiskHeatmapRedacted } from '@aiproj/types'
import { cn } from '@/lib/utils'
import {
  BI_HEAT_LEVEL_META,
  biHeatLevelMeta,
  biRiskHeatmapDimensionLabel,
  biRiskHeatmapMetricLabel,
} from '@/lib/next/org-bi/org-bi-adapter'

/**
 * BI 风险热力 DOM 网格（v3-ui-next-org-portfolio-domains W3 · tasks 3.6）。
 *
 * - 语义搬移旧轨 5×5 网格为暗黑 DOM 表格：行=rowDimension、列=columnDimension，
 *   单元格同时以「风险等级色阶（--nx-status-* 等令牌）」与「中文等级/计数文字」
 *   双通道传达（WCAG AA：不单靠颜色）；
 * - 确定性渲染：行/列按响应序稳定排列；risk_level 轴按键序规范化；
 * - 脱敏单元只呈现「不可见」中性态（EyeOff + 无数值文本），零猜测（RL-05）；
 * - 纯只读：点击仅唤起上层摘要抽屉，零写请求（RL-01）。
 */

/** risk_level 轴规范键序（5 级概率×影响矩阵语义的列键序）。 */
export const RISK_LEVEL_AXIS_ORDER = ['critical', 'high', 'medium', 'low', 'none'] as const

/** 轴键 → 中文标签（双通道文字的兜底；单元格等级标签另有 BI_HEAT_LEVEL_META）。 */
export const HEAT_AXIS_LABELS: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  none: '无',
  insufficient_data: '数据不足',
}

export function heatAxisLabel(key: string): string {
  return HEAT_AXIS_LABELS[key] ?? key
}

/** 网格列键排序：risk_level 轴按 5 级键序，其余保持响应出现序。 */
export function orderHeatAxisKeys(keys: string[], dimension: BiRiskHeatmapDimensionKey): string[] {
  if (dimension !== 'risk_level') return keys
  const canonical: readonly string[] = RISK_LEVEL_AXIS_ORDER.filter((key) => keys.includes(key))
  const leftovers = keys.filter((key) => !canonical.includes(key))
  return [...canonical, ...leftovers]
}

export interface RiskHeatmapGrid5x5Props {
  cells: BiRiskHeatmapCell[]
  metricKey: BiRiskHeatmapMetricKey
  rowDimension: BiRiskHeatmapDimensionKey
  columnDimension: BiRiskHeatmapDimensionKey
  onCellClick: (cell: BiRiskHeatmapCell) => void
}

export function RiskHeatmapGrid5x5({
  cells,
  metricKey,
  rowDimension,
  columnDimension,
  onCellClick,
}: RiskHeatmapGrid5x5Props) {
  const rowKeys = orderHeatAxisKeys([...new Set(cells.map((cell) => cell.rowKey))], rowDimension)
  const columnKeys = orderHeatAxisKeys(
    [...new Set(cells.map((cell) => cell.columnKey))],
    columnDimension,
  )

  // 行/列展示名优先取服务端 cell 标签（实体名），risk_level 轴回落本地中文键名。
  const rowLabelByKey = new Map<string, string>()
  const columnLabelByKey = new Map<string, string>()
  for (const cell of cells) {
    if (!rowLabelByKey.has(cell.rowKey)) rowLabelByKey.set(cell.rowKey, cell.rowLabel)
    if (!columnLabelByKey.has(cell.columnKey)) {
      columnLabelByKey.set(cell.columnKey, cell.columnLabel)
    }
  }
  const rowDisplayLabel = (key: string) => rowLabelByKey.get(key) ?? heatAxisLabel(key)
  const columnDisplayLabel = (key: string) =>
    columnDimension === 'risk_level'
      ? heatAxisLabel(key)
      : (columnLabelByKey.get(key) ?? heatAxisLabel(key))

  const cellMap = React.useMemo(() => {
    const map = new Map<string, BiRiskHeatmapCell>()
    for (const cell of cells) map.set(`${cell.rowKey}::${cell.columnKey}`, cell)
    return map
  }, [cells])

  const rowLabel = biRiskHeatmapDimensionLabel(rowDimension)
  const columnLabel = biRiskHeatmapDimensionLabel(columnDimension)
  const metricLabel = biRiskHeatmapMetricLabel(metricKey)

  return (
    <section
      data-bi-heat-grid
      className="overflow-x-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-[var(--nx-text-secondary)]">
          {metricLabel} · 行={rowLabel} · 列={columnLabel}
        </h3>
        {/* 图例：色 + 文案双通道 */}
        <div data-bi-heat-legend className="flex flex-wrap items-center gap-3 text-[11px]">
          {(['critical', 'high', 'medium', 'low', 'insufficient_data'] as const).map((level) => {
            const meta = BI_HEAT_LEVEL_META[level]
            return (
              <span
                key={level}
                className="flex items-center gap-1.5 text-[var(--nx-text-secondary)]"
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-[2px] border border-[var(--nx-border-hairline)]"
                  style={{ backgroundColor: meta.bg }}
                />
                {meta.label}
              </span>
            )
          })}
        </div>
      </div>

      <table
        role="grid"
        aria-label={`风险热力图：${metricLabel}，${rowLabel}×${columnLabel}`}
        className="w-full border-collapse text-xs"
      >
        <caption className="sr-only">
          每行是一个{rowLabel}，每列是一个{columnLabel}；单元格以颜色与文字双通道展示风险等级与计数
        </caption>
        <thead>
          <tr>
            <th scope="col" className="p-1 text-left font-medium text-[var(--nx-text-muted)]">
              {rowLabel} ＼ {columnLabel}
            </th>
            {columnKeys.map((columnKey) => (
              <th
                key={columnKey}
                scope="col"
                className="p-1 text-center font-medium text-[var(--nx-text-muted)]"
              >
                {columnDisplayLabel(columnKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((rowKey) => (
            <tr key={rowKey}>
              <th
                scope="row"
                className="whitespace-nowrap p-1 text-left font-medium text-[var(--nx-text-secondary)]"
              >
                {rowDisplayLabel(rowKey)}
              </th>
              {columnKeys.map((columnKey) => {
                const cell = cellMap.get(`${rowKey}::${columnKey}`)
                if (!cell) {
                  return (
                    <td key={columnKey} className="p-0.5 text-center text-[var(--nx-text-muted)]">
                      —
                    </td>
                  )
                }
                return <HeatCell key={columnKey} cell={cell} onSelect={onCellClick} />
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function HeatCell({
  cell,
  onSelect,
}: {
  cell: BiRiskHeatmapCell
  onSelect: (cell: BiRiskHeatmapCell) => void
}) {
  const meta = biHeatLevelMeta(cell.riskLevel)
  const redacted = isBiRiskHeatmapRedacted(cell.redactionState)
  const ariaLabel = redacted
    ? `${cell.rowLabel} × ${cell.columnLabel}：数据不可见（权限受限）`
    : `${cell.rowLabel} × ${cell.columnLabel}：${meta.label}，${cell.count} 个风险`

  return (
    <td className="p-0.5">
      <button
        type="button"
        data-bi-heat-cell
        data-bi-heat-level={cell.riskLevel}
        data-bi-heat-redacted={redacted || undefined}
        onClick={() => onSelect(cell)}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={cn(
          'flex h-14 min-w-20 w-full flex-col items-center justify-center gap-0.5 rounded-[4px] border text-[10px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
          redacted
            ? 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]'
            : 'hover:border-[var(--nx-border-focus)]',
        )}
        style={
          redacted
            ? { backgroundColor: 'rgba(255, 255, 255, 0.02)' }
            : { backgroundColor: meta.bg, borderColor: meta.border }
        }
      >
        {redacted ? (
          <>
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
            <span className="mt-0.5">不可见</span>
          </>
        ) : (
          <>
            <span className="text-sm font-bold" style={{ color: meta.token }}>
              {meta.label}
            </span>
            <span className="text-[var(--nx-text-secondary)]">{cell.count} 个</span>
            {cell.warnings.length > 0 ? (
              <AlertTriangle
                className="h-3 w-3 opacity-80"
                style={{ color: meta.token }}
                aria-hidden
              />
            ) : null}
          </>
        )}
      </button>
    </td>
  )
}

export default RiskHeatmapGrid5x5
