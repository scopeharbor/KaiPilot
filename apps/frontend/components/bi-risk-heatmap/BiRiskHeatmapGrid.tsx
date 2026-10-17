'use client'

import { Card } from '@/components/ui/Card'
import { AlertTriangle, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  BiRiskHeatmapCell,
  BiRiskHeatmapMetricKey,
  BiRiskHeatmapDimensionKey,
} from '@aiproj/types'
import { isBiRiskHeatmapRedacted } from '@aiproj/types'

// ─── 风险等级颜色映射 ────────────────────────────────────────────────────────

const RISK_LEVEL_COLORS: Record<string, string> = {
  critical: 'bg-red-600 hover:bg-red-700',
  high: 'bg-orange-500 hover:bg-orange-600',
  medium: 'bg-yellow-400 hover:bg-yellow-500',
  low: 'bg-green-400 hover:bg-green-500',
  insufficient_data: 'bg-gray-300 hover:bg-gray-400',
}

const RISK_LEVEL_TEXT: Record<string, string> = {
  critical: 'text-white',
  high: 'text-white',
  medium: 'text-black',
  low: 'text-black',
  insufficient_data: 'text-gray-500',
}

const RISK_LEVEL_LABELS: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  insufficient_data: '数据不足',
}

/** 风险等级枚举值 → 中文标签（列维度为 risk_level 时用于网格表头与 Top 列表） */
export function riskLevelDisplayLabel(value: string): string {
  return RISK_LEVEL_LABELS[value] ?? value
}

interface BiRiskHeatmapGridProps {
  cells: BiRiskHeatmapCell[]
  metricKey: BiRiskHeatmapMetricKey
  metricLabels: Record<string, string>
  dimensionLabels: Record<string, string>
  rowDimension: BiRiskHeatmapDimensionKey
  columnDimension: BiRiskHeatmapDimensionKey
  onCellClick: (cell: BiRiskHeatmapCell) => void
}

export function BiRiskHeatmapGrid({
  cells,
  metricKey,
  metricLabels,
  dimensionLabels,
  rowDimension,
  columnDimension,
  onCellClick,
}: BiRiskHeatmapGridProps) {
  // 获取唯一行列值
  const rowKeys = [...new Set(cells.map((c) => c.rowKey))]
  const colKeys = [...new Set(cells.map((c) => c.columnKey))]

  const rowLabel = dimensionLabels[rowDimension] ?? rowDimension
  const colLabel = dimensionLabels[columnDimension] ?? columnDimension
  const metricLabel = metricLabels[metricKey] ?? metricKey

  // 构建查找表
  const cellMap = new Map<string, BiRiskHeatmapCell>()
  for (const cell of cells) {
    cellMap.set(`${cell.rowKey}::${cell.columnKey}`, cell)
  }

  return (
    <Card className="overflow-x-auto">
      <div className="p-4">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          {metricLabel} · 行={rowLabel} · 列={colLabel}
        </h2>

        {/* 可访问表格摘要（屏幕阅读器友好） */}
        <table
          className="w-full border-collapse text-xs"
          role="grid"
          aria-label={`风险热力图：${metricLabel}，${rowLabel}×${colLabel}`}
        >
          <caption className="sr-only">
            风险热力图表格：每行是一个{rowLabel}，每列是一个{colLabel}，单元格显示风险等级和评分
          </caption>
          <thead>
            <tr>
              <th className="p-2 text-left font-medium text-muted-foreground" scope="col">
                {rowLabel}
              </th>
              {colKeys.map((ck) => {
                const label = cells.find((c) => c.columnKey === ck)?.columnLabel ?? ck
                const display =
                  columnDimension === 'risk_level' ? riskLevelDisplayLabel(label) : label
                return (
                  <th
                    key={ck}
                    className="p-2 text-center font-medium text-muted-foreground"
                    scope="col"
                  >
                    {display}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rowKeys.map((rk) => {
              const label = cells.find((c) => c.rowKey === rk)?.rowLabel ?? rk
              return (
                <tr key={rk}>
                  <td className="whitespace-nowrap p-2 font-medium">{label}</td>
                  {colKeys.map((ck) => {
                    const cell = cellMap.get(`${rk}::${ck}`)
                    if (!cell) {
                      return (
                        <td key={ck} className="p-1 text-center">
                          <span className="text-gray-300">—</span>
                        </td>
                      )
                    }

                    const redacted = isBiRiskHeatmapRedacted(cell.redactionState)
                    const colorClass = redacted
                      ? 'bg-gray-200 text-gray-400'
                      : (RISK_LEVEL_COLORS[cell.riskLevel] ?? 'bg-gray-200')
                    const textClass = redacted
                      ? 'text-gray-400'
                      : (RISK_LEVEL_TEXT[cell.riskLevel] ?? 'text-gray-700')

                    return (
                      <td key={ck} className="p-1">
                        <button
                          type="button"
                          className={cn(
                            'flex h-16 w-24 flex-col items-center justify-center rounded-md transition-colors',
                            colorClass,
                            textClass,
                            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                          )}
                          onClick={() => onCellClick(cell)}
                          aria-label={`${label} × ${cell.columnLabel}：${RISK_LEVEL_LABELS[cell.riskLevel] ?? cell.riskLevel}，评分 ${cell.score.toFixed(2)}，${cell.count} 个风险`}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onCellClick(cell)
                            }
                          }}
                        >
                          {redacted ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <>
                              <span className="text-lg font-bold">
                                {RISK_LEVEL_LABELS[cell.riskLevel] ?? '?'}
                              </span>
                              <span className="mt-0.5 text-[10px] opacity-80">{cell.count} 个</span>
                              {cell.warnings.length > 0 && (
                                <AlertTriangle className="mt-0.5 h-3 w-3 opacity-70" />
                              )}
                            </>
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
