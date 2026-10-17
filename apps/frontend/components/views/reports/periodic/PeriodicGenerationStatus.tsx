'use client'

import type { ComponentType } from 'react'
import { Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'

/**
 * PeriodicGenerationStatus —— AI 周期报表生成任务状态展示。
 *
 * 显示 queued/running/succeeded/failed 状态与图标、代费摘要、重试按钮。
 */

export interface CostSummary {
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  estimatedCost: number
  latencyMs: number
  budgetVerdict: 'passed' | 'hard_blocked' | 'soft_warning'
}

export interface PeriodicGenerationStatusProps {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | null
  costSummary: CostSummary | null
  isLoading: boolean
  error: Error | null
  onRetry?: () => void
  isRetrying?: boolean
}

const STATUS_CONFIG: Record<
  string,
  { icon: ComponentType<{ className?: string }>; label: string; color: string; bg: string }
> = {
  queued: {
    icon: Clock,
    label: '排队中',
    color: 'text-info',
    bg: 'bg-info-bg',
  },
  running: {
    icon: Loader2,
    label: '生成中',
    color: 'text-primary-500',
    bg: 'bg-primary-50',
  },
  succeeded: {
    icon: CheckCircle2,
    label: '生成完成',
    color: 'text-success',
    bg: 'bg-success-bg',
  },
  failed: {
    icon: XCircle,
    label: '生成失败',
    color: 'text-danger',
    bg: 'bg-danger-bg',
  },
  cancelled: {
    icon: XCircle,
    label: '已取消',
    color: 'text-gray-500',
    bg: 'bg-gray-100',
  },
}

function formatCost(cost: number): string {
  if (cost < 0.001) return '$<0.001'
  return `$${cost.toFixed(4)}`
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function PeriodicGenerationStatus({
  status,
  costSummary,
  isLoading,
  error,
  onRetry,
  isRetrying = false,
}: PeriodicGenerationStatusProps) {
  // 加载态
  if (isLoading) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-white p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
    )
  }

  // 错误态（无 status 但有错误）
  if (error && !status) {
    return (
      <div className="rounded-lg border border-border bg-white p-4">
        <div className="flex items-center gap-2 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>{error.message}</span>
        </div>
        {onRetry && (
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={onRetry} loading={isRetrying}>
              <RefreshCw className="mr-1 h-4 w-4" />
              重试
            </Button>
          </div>
        )}
      </div>
    )
  }

  // 空态
  if (!status) {
    return (
      <div className="rounded-lg border border-border bg-white p-4">
        <p className="text-sm text-gray-500">暂无生成任务</p>
      </div>
    )
  }

  const cfg = STATUS_CONFIG[status]
  if (!cfg) return null

  return (
    <div className={cn('rounded-lg border border-border p-4', cfg.bg)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <cfg.icon
            className={cn('h-5 w-5', status === 'running' && 'animate-spin', cfg.color)}
            aria-hidden
          />
          <span className={cn('text-sm font-medium', cfg.color)}>{cfg.label}</span>
        </div>

        {/* 失败/取消时显示重试按钮 */}
        {(status === 'failed' || status === 'cancelled') && onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} loading={isRetrying}>
            <RefreshCw className="mr-1 h-4 w-4" />
            重试
          </Button>
        )}
      </div>

      {/* 代费摘要 */}
      {costSummary && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-600">
          <Badge variant="outline">{costSummary.model}</Badge>
          <span>输入：{formatTokens(costSummary.promptTokens)} tokens</span>
          <span>输出：{formatTokens(costSummary.completionTokens)} tokens</span>
          <span>费用：{formatCost(costSummary.estimatedCost)}</span>
          <span>延迟：{formatLatency(costSummary.latencyMs)}</span>
          {costSummary.budgetVerdict === 'hard_blocked' && (
            <span className="text-danger">预算超限</span>
          )}
          {costSummary.budgetVerdict === 'soft_warning' && (
            <span className="text-warning">预算警告</span>
          )}
        </div>
      )}
    </div>
  )
}
