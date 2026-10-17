'use client'

import { AlertTriangle, ChevronRight, ExternalLink, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ResourceGapEntry } from '@aiproj/types'
import { RESOURCE_GAP_SEVERITY_LABELS, RESOURCE_GAP_REASON_LABELS } from '@aiproj/types'

/**
 * 缺口原因解释卡片（v3-resource-gap-analysis §8.3）。
 *
 * 显示 top-N 原因码中文文案、低敏 evidence 引用、跳转到既有写入链路的 CTA（不承担写入）。
 */
export function GapExplanationCard({
  gap,
  onViewExplanation,
  onDrillDown,
}: {
  gap: ResourceGapEntry
  onViewExplanation?: (gapId: string) => void
  onDrillDown?: (gapId: string, sourceCapability: string) => void
}) {
  const severityColor = {
    critical: 'text-red-600 dark:text-red-400',
    high: 'text-orange-600 dark:text-orange-400',
    medium: 'text-yellow-600 dark:text-yellow-400',
    low: 'text-blue-600 dark:text-blue-400',
    none: 'text-gray-500',
  }[gap.severity]

  const severityBg = {
    critical: 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800',
    high: 'bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800',
    medium: 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800',
    low: 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800',
    none: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700',
  }[gap.severity]

  return (
    <div className={cn('rounded-lg border p-4', severityBg)}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className={cn('h-5 w-5', severityColor)} />
          <span className={cn('text-sm font-semibold', severityColor)}>
            {RESOURCE_GAP_SEVERITY_LABELS[gap.severity]}缺口
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {gap.dimensionLabel} · {Math.round(gap.gapHours)}h
        </span>
      </div>

      {/* Dimension Info */}
      <div className="mb-3 text-sm">
        <span className="font-medium">{gap.dimensionLabel}</span>
        <span className="mx-1 text-muted-foreground">→</span>
        <span>
          {gap.gapHours}h 缺口 / {gap.demandHours}h 需求
        </span>
      </div>

      {/* Reasons */}
      {gap.reasons.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">缺口原因</span>
          {gap.reasons.slice(0, 3).map((reason) => (
            <div key={reason.code} className="flex items-start gap-1.5 text-sm">
              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-current opacity-60" />
              <span>{RESOURCE_GAP_REASON_LABELS[reason.code]}</span>
            </div>
          ))}
        </div>
      )}

      {/* Action Links */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
        {onViewExplanation && (
          <button
            onClick={() => onViewExplanation(gap.gapId)}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            查看详细解释
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
        {onDrillDown && (
          <button
            onClick={() => onDrillDown(gap.gapId, 'resource-registry-and-allocation')}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            钻取来源数据
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Redacted */}
      {gap.redacted && (
        <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldAlert className="h-3 w-3" />
          部分数据已脱敏
        </div>
      )}
    </div>
  )
}

/**
 * 状态 UI 组件：空态 / 权限受限 / 降级 / 错误（v3-resource-gap-analysis §8.4）。
 */
export function GapStatusBanner({
  status,
}: {
  status: 'empty' | 'forbidden' | 'degraded' | 'error' | 'loading'
}) {
  const config = {
    empty: {
      icon: AlertTriangle,
      title: '暂无缺口数据',
      description: '当前组织在所选时间窗口内未检测到资源缺口。',
      className: 'bg-muted text-muted-foreground',
    },
    forbidden: {
      icon: ShieldAlert,
      title: '权限受限',
      description: '您没有查看此组织资源缺口分析的权限。',
      className: 'bg-yellow-50 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300',
    },
    degraded: {
      icon: AlertTriangle,
      title: '部分数据降级',
      description: '部分上游能力不可用，缺口分析结果可能不完整。',
      className: 'bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300',
    },
    error: {
      icon: AlertTriangle,
      title: '加载失败',
      description: '无法加载缺口分析数据，请稍后重试。',
      className: 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300',
    },
    loading: {
      icon: AlertTriangle,
      title: '加载中...',
      description: '',
      className: 'bg-muted text-muted-foreground',
    },
  }[status]

  const Icon = config.icon

  return (
    <div className={cn('flex items-start gap-3 rounded-lg border p-4', config.className)}>
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium">{config.title}</p>
        {config.description && <p className="text-xs opacity-80 mt-0.5">{config.description}</p>}
      </div>
    </div>
  )
}
