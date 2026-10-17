/**
 * v3-ocr-provider-observability-cost-controls — OCR provider 观测面板组件。
 *
 * 在 OCR 作业/审查面展示 provider 健康、成本、限流状态与警告。
 * 只读上下文，不提供 run/retry/apply 按钮。
 */

'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { AlertTriangle, CheckCircle, Clock, DollarSign, XCircle } from 'lucide-react'
import { useOcrProviderObservabilitySummary } from '@/hooks/use-ocr-provider-observability'
import type {
  OcrCostStatus,
  OcrBudgetDecisionStatus,
  OcrRateLimitDecisionStatus,
} from '@aiproj/types'

// --------------- 状态→中文标签映射 ---------------

const COST_STATUS_LABELS: Record<OcrCostStatus, string> = {
  estimated: '已估算',
  fallback_estimate: '粗略估算',
  cost_unknown: '成本未知',
  unavailable: '不可用',
  zero: '零成本',
}

const BUDGET_STATUS_LABELS: Record<OcrBudgetDecisionStatus, string> = {
  allowed: '预算正常',
  soft_warning: '预算预警',
  hard_blocked: '预算阻断',
  unknown: '未知',
}

const RATE_LIMIT_STATUS_LABELS: Record<OcrRateLimitDecisionStatus, string> = {
  allowed: '频率正常',
  wait: '等待中',
  queued: '排队中',
  blocked: '频率超限',
}

const COST_STATUS_VARIANTS: Record<OcrCostStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  estimated: 'success',
  fallback_estimate: 'warning',
  cost_unknown: 'warning',
  unavailable: 'neutral',
  zero: 'success',
}

// unknown 用 neutral，故值域要含 neutral——原先漏了它才需要 as any
const BUDGET_WARNING_VARIANTS: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  allowed: 'success',
  soft_warning: 'warning',
  hard_blocked: 'danger',
  unknown: 'neutral',
}

const RATE_VARIANTS: Record<string, 'success' | 'warning' | 'danger'> = {
  allowed: 'success',
  wait: 'warning',
  queued: 'warning',
  blocked: 'danger',
}

function formatCost(cost: number | null | undefined, currency?: string | null): string {
  if (cost == null) return '—'
  return `$${cost.toFixed(6)} ${currency ?? 'USD'}`
}

function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ===========================================================================
// OcrProviderObservabilityPanel
// ===========================================================================

export interface OcrProviderObservabilityPanelProps {
  projectId: number | string
  className?: string
}

export function OcrProviderObservabilityPanel({
  projectId,
  className,
}: OcrProviderObservabilityPanelProps) {
  const { data, isLoading, isError, error } = useOcrProviderObservabilitySummary(projectId)

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    )
  }

  if (isError || !data) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-sm">Provider 观测</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {isError && (error as Error)?.message
              ? `数据加载失败: ${(error as Error).message}`
              : '暂无 provider 观测数据'}
          </p>
        </CardContent>
      </Card>
    )
  }

  // API 返回统一 `{ data }` 信封；用 as any 剥壳会把整棵取数树退化成 any，
  // 后面所有按状态码索引常量表的地方就都失去类型校验。
  const summary = data.data

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Provider 观测
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm">
          {/* Provider/Model */}
          {summary.providerRefs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {summary.providerRefs.map((ref, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {ref.provider} / {ref.model}
                </Badge>
              ))}
            </div>
          )}

          {/* 统计 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-green-600" />
              <span>成功 {summary.succeededAttempts}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5 text-red-600" />
              <span>失败 {summary.failedAttempts}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span>延迟 {formatLatency(summary.totalLatencyMs)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <span>成本 {formatCost(summary.totalEstimatedCost, summary.currency)}</span>
            </div>
          </div>

          {/* 状态标签 */}
          <div className="flex flex-wrap gap-2">
            <Badge variant={COST_STATUS_VARIANTS[summary.costStatus] ?? 'neutral'}>
              成本: {COST_STATUS_LABELS[summary.costStatus]}
            </Badge>
            <Badge variant={BUDGET_WARNING_VARIANTS[summary.budgetStatus] ?? 'neutral'}>
              预算: {BUDGET_STATUS_LABELS[summary.budgetStatus]}
            </Badge>
            <Badge variant={RATE_VARIANTS[summary.rateLimitStatus] ?? 'neutral'}>
              频率: {RATE_LIMIT_STATUS_LABELS[summary.rateLimitStatus]}
            </Badge>
          </div>

          {/* 警告信息 */}
          {summary.warningCodes.length > 0 && (
            <div className="flex items-start gap-1.5 text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="text-xs">{summary.warningCodes.join(' · ')}</span>
            </div>
          )}

          {/* 错误分类 */}
          {Object.keys(summary.errorCategories).length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {Object.entries(summary.errorCategories).map(([category, count]) => (
                <div key={category} className="flex justify-between">
                  <span>{category}</span>
                  <span>{count} 次</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** 读权限退化包装（用于没有管理权限的用户）。 */
export function OcrProviderObservabilityReadOnly({
  projectId,
  className,
}: OcrProviderObservabilityPanelProps) {
  return <OcrProviderObservabilityPanel projectId={projectId} className={className} />
}
