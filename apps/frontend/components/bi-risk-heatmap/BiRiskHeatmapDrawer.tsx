'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/Sheet'
import { AlertTriangle, AlertCircle, ArrowRight, EyeOff, Info, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isBiRiskHeatmapRedacted } from '@aiproj/types'
import type { BiRiskHeatmapCell, BiRiskHeatmapQueryShape } from '@aiproj/types'

interface BiRiskHeatmapDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cell: BiRiskHeatmapCell | null
  metricLabels: Record<string, string>
  dimensionLabels: Record<string, string>
  queryShape?: BiRiskHeatmapQueryShape | null
}

export function BiRiskHeatmapDrawer({
  open,
  onOpenChange,
  cell,
  metricLabels,
  queryShape,
}: BiRiskHeatmapDrawerProps) {
  if (!cell) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>风险热力详情</SheetTitle>
            <SheetDescription>请选择一个热力单元查看详情。</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )
  }

  const redacted = isBiRiskHeatmapRedacted(cell.redactionState)
  const metricLabel = metricLabels[queryShape?.metricKey ?? ''] ?? queryShape?.metricKey ?? ''

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-lg">
            {cell.rowLabel} × {cell.columnLabel}
          </SheetTitle>
          <SheetDescription>
            {metricLabel} 热力单元详情
            {queryShape && (
              <span className="block text-xs">
                查询窗口：{queryShape.window} · {new Date().toLocaleString()}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* 风险等级与评分 */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">风险等级</span>
              <Badge
                variant="outline"
                className={cn(
                  cell.riskLevel === 'critical' &&
                    'border-red-500 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-400',
                  cell.riskLevel === 'high' &&
                    'border-orange-500 bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-400',
                  cell.riskLevel === 'medium' &&
                    'border-yellow-500 bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-400',
                  cell.riskLevel === 'low' &&
                    'border-green-500 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-400',
                  cell.riskLevel === 'insufficient_data' &&
                    'border-gray-300 bg-gray-100 text-gray-600',
                )}
              >
                {cell.riskLevel === 'critical'
                  ? '严重'
                  : cell.riskLevel === 'high'
                    ? '高'
                    : cell.riskLevel === 'medium'
                      ? '中'
                      : cell.riskLevel === 'low'
                        ? '低'
                        : '数据不足'}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">评分</span>
              <span className="text-lg font-bold">{cell.score.toFixed(4)}</span>
            </div>
          </div>

          {/* 统计 */}
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted p-3">
            <div className="text-center">
              <p className="text-2xl font-bold">{cell.count}</p>
              <p className="text-xs text-muted-foreground">风险数量</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{cell.sampleCount}</p>
              <p className="text-xs text-muted-foreground">样本数</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{Math.round(cell.confidence * 100)}%</p>
              <p className="text-xs text-muted-foreground">置信度</p>
            </div>
          </div>

          {/* Delta */}
          {cell.delta !== null && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">变化量</span>
              <span
                className={cn(
                  'text-sm font-medium',
                  cell.delta > 0
                    ? 'text-red-600'
                    : cell.delta < 0
                      ? 'text-green-600'
                      : 'text-gray-500',
                )}
              >
                {cell.delta > 0 ? '+' : ''}
                {cell.delta.toFixed(4)}
              </span>
            </div>
          )}

          {/* 脱敏状态 */}
          {redacted && (
            <div className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
              <EyeOff className="h-4 w-4" />
              <span>部分数据已脱敏——您当前角色无法查看完整风险信息。</span>
            </div>
          )}

          {/* Warnings */}
          {cell.warnings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-1">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                数据质量警告
              </h3>
              <ul className="space-y-1">
                {cell.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md bg-yellow-50 p-2 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"
                  >
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Contributors */}
          {cell.contributors.length > 0 && !redacted && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">主要贡献来源</h3>
              <ul className="space-y-1.5">
                {cell.contributors.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-md bg-muted p-2 text-sm"
                  >
                    <span>{c.label}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {Math.round(c.contributionWeight * 100)}%
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Evidence Refs */}
          {cell.evidenceRefs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-1">
                <Info className="h-4 w-4 text-blue-500" />
                证据来源
              </h3>
              <ul className="space-y-1">
                {cell.evidenceRefs.map((ref, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-md bg-blue-50 p-2 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                  >
                    <span>{ref.label}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {ref.kind}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Drilldown Targets */}
          {cell.drilldownTargets.length > 0 && !redacted && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium flex items-center gap-1">
                <Shield className="h-4 w-4 text-green-500" />
                安全下钻
              </h3>
              <p className="text-xs text-muted-foreground">
                以下链接会跳转到对应能力页面，目标页面将进行二次授权检查。
              </p>
              <ul className="space-y-1">
                {cell.drilldownTargets.map((t, i) => (
                  <li key={i}>
                    {t.route ? (
                      <Link
                        href={t.route}
                        className="flex items-center justify-between rounded-md border p-2 text-sm transition-colors hover:bg-muted"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span>{t.label}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    ) : (
                      <span className="flex items-center gap-2 rounded-md bg-muted p-2 text-sm text-muted-foreground">
                        {t.label}（无可跳转链接）
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Advisory Note */}
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
            <p className="font-medium">顾问提示</p>
            <p className="mt-1">
              本热力分析结果基于确定性规则计算，仅供辅助判断。所有处置操作需在目标能力页面经人工确认后执行。
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
