'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { AlertTriangle, ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BiRiskHeatmapCell, BiRiskHeatmapDimensionKey } from '@aiproj/types'
import { riskLevelDisplayLabel } from './BiRiskHeatmapGrid'

interface BiRiskHeatmapTopListProps {
  cells: BiRiskHeatmapCell[]
  metricLabels: Record<string, string>
  dimensionLabels: Record<string, string>
  columnDimension?: BiRiskHeatmapDimensionKey
  onSelectCell: (cell: BiRiskHeatmapCell) => void
}

export function BiRiskHeatmapTopList({
  cells,
  columnDimension,
  onSelectCell,
}: BiRiskHeatmapTopListProps) {
  // 取前 10 个高风险 cell
  const topCells = [...cells]
    .filter((c) => c.riskLevel === 'critical' || c.riskLevel === 'high')
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)

  const columnLabel = (cell: BiRiskHeatmapCell): string =>
    columnDimension === 'risk_level' ? riskLevelDisplayLabel(cell.columnLabel) : cell.columnLabel

  if (topCells.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Top 风险单元</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2" role="list" aria-label="高风险单元列表">
          {topCells.map((cell, idx) => {
            const riskColor =
              cell.riskLevel === 'critical'
                ? 'text-red-600'
                : cell.riskLevel === 'high'
                  ? 'text-orange-500'
                  : 'text-gray-500'

            const deltaIcon =
              cell.delta === null ? null : cell.delta > 0 ? (
                <TrendingUp className="h-3 w-3 text-red-500" />
              ) : cell.delta < 0 ? (
                <TrendingDown className="h-3 w-3 text-green-500" />
              ) : (
                <Minus className="h-3 w-3 text-gray-400" />
              )

            return (
              <li key={`${cell.rowKey}-${cell.columnKey}-${idx}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md p-3 text-left transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                  onClick={() => onSelectCell(cell)}
                  aria-label={`${cell.rowLabel} × ${columnLabel(cell)}：风险评分 ${cell.score.toFixed(2)}`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className={cn('text-xs font-bold', riskColor)}>#{idx + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {cell.rowLabel} × {columnLabel(cell)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {cell.count} 个风险 · 置信度 {Math.round(cell.confidence * 100)}%
                        {cell.warnings.length > 0 && (
                          <span className="ml-1 inline-flex items-center text-yellow-600">
                            <AlertTriangle className="mr-0.5 h-3 w-3" />
                            {cell.warnings.length} 个警告
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {deltaIcon && (
                      <span className="flex items-center gap-0.5 text-xs">
                        {deltaIcon}
                        {cell.delta !== null && Math.abs(cell.delta).toFixed(2)}
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        cell.riskLevel === 'critical' &&
                          'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
                        cell.riskLevel === 'high' &&
                          'border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
                      )}
                    >
                      {cell.score.toFixed(2)}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
