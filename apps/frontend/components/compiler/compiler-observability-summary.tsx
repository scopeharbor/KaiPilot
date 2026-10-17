'use client'

import { useQuery } from '@tanstack/react-query'
import { compilerApi } from '@/lib/api/compiler'
import { COMPILER_QUERY_KEYS } from '@/lib/api/compiler-query-keys'
import type { ObservabilitySummary } from '@aiproj/compiler-spec'

/**
 * CompilerObservabilitySummary —— 只读 Compiler 运行可观测摘要。
 *
 * 展示估算成本、token、耗时、重试、模型分布、缓存、预算状态。
 * 使用"估算成本/模型调用消耗"文案，禁止呈现为财务账单。
 * 硬预算阻断时展示阻断原因，不提供绕过按钮。
 *
 * 覆盖状态：
 * - loading: 骨架屏
 * - error: 错误提示
 * - empty: 无数据
 * - soft warning: 软预算告警
 * - hard blocked: 硬预算阻断
 */
export function CompilerObservabilitySummary({ runId }: { runId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: COMPILER_QUERY_KEYS.observabilitySummary(runId),
    queryFn: () => compilerApi.getObservabilitySummary(runId),
    retry: 1,
    // runId<=0（未指定运行）不请求后端：runs/0 会 400，页面应显示
    // 「暂无可观测数据」空态而非「无法加载可观测摘要」错误框。
    enabled: runId > 0,
  })

  const summary: ObservabilitySummary | undefined = data?.data

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="rounded-lg border p-4 animate-pulse space-y-3">
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="h-3 w-48 bg-muted rounded" />
        <div className="h-3 w-40 bg-muted rounded" />
      </div>
    )
  }

  // ── Error ──
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 p-4 text-sm text-muted-foreground">
        无法加载可观测摘要
      </div>
    )
  }

  // ── Empty ──
  if (!summary) {
    return <div className="rounded-lg border p-4 text-sm text-muted-foreground">暂无可观测数据</div>
  }

  const isHardBlocked = summary.budgetStatus === 'hard_exceeded'
  const isSoftWarning = summary.budgetStatus === 'soft_exceeded'

  // ── Budget Status ──
  const budgetBadge = isHardBlocked
    ? { label: '预算已超限', className: 'bg-destructive/10 text-destructive border-destructive/30' }
    : isSoftWarning
      ? { label: '预算警告', className: 'bg-warning/10 text-warning border-warning/30' }
      : summary.budgetStatus
        ? { label: '预算正常', className: 'bg-success/10 text-success border-success/30' }
        : null

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">编译器运行摘要</h3>
        {budgetBadge && (
          <span className={`text-xs px-2 py-0.5 rounded-full border ${budgetBadge.className}`}>
            {budgetBadge.label}
          </span>
        )}
      </div>

      {/* 硬预算阻断 */}
      {isHardBlocked && summary.budgetWarnings && summary.budgetWarnings.length > 0 && (
        <div className="bg-destructive/5 border border-destructive/20 rounded p-3 text-sm space-y-1">
          <p className="font-medium text-destructive text-xs uppercase tracking-wide">预算阻断</p>
          {summary.budgetWarnings.map((w, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {w}
            </p>
          ))}
          {/* 不提供绕过按钮 —— 红线要求 */}
        </div>
      )}

      {/* 软预算告警 */}
      {isSoftWarning && summary.budgetWarnings && summary.budgetWarnings.length > 0 && (
        <div className="bg-warning/5 border border-warning/20 rounded p-3 text-sm space-y-1">
          <p className="font-medium text-warning text-xs uppercase tracking-wide">预算警告</p>
          {summary.budgetWarnings.map((w, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* 统计网格：使用"估算成本/模型调用消耗"文案 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatItem label="估算成本" value={formatCost(summary)} />
        <StatItem label="总 Token" value={formatTokens(summary)} />
        <StatItem label="总耗时" value={formatDuration(summary.totalDurationMs)} />
        <StatItem label="模型调用" value={`${summary.totalLlmCalls ?? 0} 次`} />
      </div>

      {/* 成本细项 */}
      {summary.costSummary && summary.costSummary.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">成本明细</p>
          <div className="text-xs space-y-0.5 text-muted-foreground">
            {summary.costSummary.map((item, i) => (
              <p key={i} className="flex justify-between">
                <span>{item.dimension === 'total' ? '总计' : item.label}</span>
                <span>
                  ≈ {item.estimatedCost.toFixed(6)} {item.currency}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* 模型分布 */}
      {summary.modelBreakdown && summary.modelBreakdown.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">模型调用分布</p>
          <div className="text-xs space-y-0.5 text-muted-foreground">
            {summary.modelBreakdown.map((item, i) => (
              <p key={i} className="flex justify-between">
                <span>
                  {item.provider}/{item.model}
                </span>
                <span>
                  {item.callCount} 次 · ≈ {item.estimatedCost.toFixed(6)}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

function formatCost(summary: ObservabilitySummary): string {
  if (!summary.costSummary || summary.costSummary.length === 0) return '—'
  const total = summary.costSummary.find((c) => c.dimension === 'total')
  if (total) return `≈ ${total.estimatedCost.toFixed(6)} ${total.currency}`
  return '—'
}

function formatTokens(summary: ObservabilitySummary): string {
  if (!summary.tokenSummary || summary.tokenSummary.length === 0) return '—'
  const total = summary.tokenSummary.find((t) => t.dimension === 'total')
  if (total) return total.totalTokens.toLocaleString()
  return '—'
}

function formatDuration(ms: number): string {
  if (!ms || ms === 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60000)
  const sec = Math.round((ms % 60000) / 1000)
  return `${min}m ${sec}s`
}
