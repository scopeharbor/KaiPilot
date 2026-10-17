'use client'

// OKR Dashboard 页面级组件群（v3-okr-dashboard §5.5–5.6）。
//
// 仅只读展示，无 mutation。所有点击 target 都来自后端下发的 authorized descriptor，
// 未授权时不渲染跳转，避免暗中泄露隐藏资源存在。

import * as React from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Clock, EyeOff, TrendingDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import type {
  OkrDashboardAttentionItem,
  OkrDashboardCycleContext,
  OkrDashboardEvidenceFreshness,
  OkrDashboardMetric,
  OkrDashboardSummary,
  OkrDashboardTarget,
  OkrDashboardWarning,
  OkrDashboardAlignmentHealth,
  OkrDashboardBackflowSummary,
} from '@aiproj/types'
import {
  OKR_ATTENTION_REASON_LABELS,
  OKR_METRIC_LABELS,
  OKR_STATUS_LABELS,
  OKR_WARNING_LABELS,
  formatOkrMetricValue,
  formatRelativeTime,
  isMetricRedacted,
  resolveBackflowState,
  selectOkrKpiStrip,
  staleSources,
} from '@/lib/okr-dashboard-ui'

// ─── KPI Strip ───────────────────────────────────────────────────────────────

export function OkrKpiStrip({ summary }: { summary: OkrDashboardSummary | undefined }) {
  const kpis = selectOkrKpiStrip(summary)
  if (kpis.length === 0) {
    return (
      <div data-testid="okr-kpi-strip-empty" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    )
  }
  return (
    <div data-testid="okr-kpi-strip" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {kpis.map((metric) => (
        <OkrKpiCard key={metric.key} metric={metric} />
      ))}
    </div>
  )
}

function OkrKpiCard({ metric }: { metric: OkrDashboardMetric }) {
  const redacted = isMetricRedacted(metric)
  return (
    <StatCard
      label={OKR_METRIC_LABELS[metric.key] ?? metric.key}
      value={redacted ? '--' : formatOkrMetricValue(metric)}
      hint={redacted ? '数据不可见' : undefined}
      data-testid={`okr-kpi-${metric.key}`}
    />
  )
}

// ─── Cycle context header ────────────────────────────────────────────────────

export function OkrCycleHeader({ cycle }: { cycle: OkrDashboardCycleContext | undefined }) {
  if (!cycle || cycle.cycleId === null) {
    return (
      <div className="text-sm text-muted-foreground" data-testid="okr-cycle-empty">
        暂无当前周期
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-baseline gap-3" data-testid="okr-cycle-header">
      <span className="text-lg font-semibold">{cycle.title ?? '未命名周期'}</span>
      {cycle.status && (
        <Badge variant="outline">{OKR_STATUS_LABELS[cycle.status] ?? cycle.status}</Badge>
      )}
      {cycle.elapsedPercent !== null && (
        <span className="text-sm text-muted-foreground">
          已过 {Math.round(cycle.elapsedPercent)}%
        </span>
      )}
      {cycle.daysRemaining !== null && (
        <span className="text-sm text-muted-foreground">剩余 {cycle.daysRemaining} 天</span>
      )}
    </div>
  )
}

// ─── Progress distribution list ─────────────────────────────────────────────

export function OkrDistributionList({
  slices,
  title,
  testid,
}: {
  slices: { key: string; label: string; count: number; percent: number }[]
  title: string
  testid: string
}) {
  if (slices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title="暂无数据" description="当前周期未生成分布。" />
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2" data-testid={testid}>
          {slices.map((slice) => (
            <li key={slice.key} className="flex items-center justify-between text-sm">
              <span className="truncate">{slice.label}</span>
              <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                {slice.count} · {Math.round(slice.percent)}%
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// ─── Attention list ─────────────────────────────────────────────────────────

export function OkrAttentionTable({ items }: { items: OkrDashboardAttentionItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState title="暂无关注项" description="当前周期没有需要重点关注的目标或关键结果。" />
    )
  }
  return (
    <ul className="divide-y divide-border" data-testid="okr-attention-table">
      {items.map((item) => (
        <li key={`${item.kind}-${item.entityId}`} className="py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant={item.kind === 'objective' ? 'primary' : 'outline'}>
                  {item.kind === 'objective' ? '目标' : '关键结果'}
                </Badge>
                <p className="truncate text-sm font-medium">{item.title}</p>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.reasons.map((r) => (
                  <Badge key={r} variant="neutral" className="text-xs">
                    {OKR_ATTENTION_REASON_LABELS[r] ?? r}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-3 text-sm">
              <span className="tabular-nums text-muted-foreground">
                {Math.round(item.progress)}%
              </span>
              <OkrDrillLink target={item.target} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** 只在 target.authorized=true 时渲染跳转链接，否则展示 EyeOff 提示。 */
function OkrDrillLink({ target }: { target: OkrDashboardTarget | null }) {
  if (!target || !target.authorized) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        aria-label="无权访问"
        data-testid="okr-drill-forbidden"
      >
        <EyeOff className="h-3.5 w-3.5" />
      </span>
    )
  }
  return (
    <Link
      href={target.href}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      data-testid="okr-drill-link"
    >
      查看 <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  )
}

// ─── Alignment health panel ─────────────────────────────────────────────────

export function OkrAlignmentHealthPanel({
  health,
}: {
  health: OkrDashboardAlignmentHealth | undefined
}) {
  if (!health || !health.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">对齐健康度</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title={health?.forbidden ? '无权查看对齐健康度' : '对齐健康度不可用'}
            description={
              health?.forbidden ? '请联系管理员申请权限。' : '当前周期未生成对齐健康度。'
            }
          />
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">对齐健康度</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 text-sm" data-testid="okr-alignment-health">
          <div>
            <dt className="text-muted-foreground">健康度</dt>
            <dd className="tabular-nums font-medium">
              {health.healthScore === null ? '--' : Math.round(health.healthScore)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">孤立目标</dt>
            <dd className="tabular-nums">{health.orphanObjectiveCount ?? '--'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">弱对齐</dt>
            <dd className="tabular-nums">{health.weakAlignmentCount ?? '--'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">最大深度</dt>
            <dd className="tabular-nums">{health.maxDepth ?? '--'}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

// ─── Evidence freshness rail ────────────────────────────────────────────────

export function OkrEvidenceFreshness({
  evidence,
  now,
}: {
  evidence: OkrDashboardEvidenceFreshness | undefined
  now?: number
}) {
  if (!evidence || !evidence.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">证据新鲜度</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title={evidence?.forbidden ? '无权查看证据' : '证据新鲜度不可用'} />
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">证据新鲜度</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm" data-testid="okr-evidence-freshness">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">证据总数</dt>
            <dd className="tabular-nums">{evidence.totalEvidence ?? '--'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">已过期</dt>
            <dd className="tabular-nums">{evidence.staleEvidence ?? '--'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">最近证据</dt>
            <dd>{formatRelativeTime(evidence.freshestAt, now)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">最早证据</dt>
            <dd>{formatRelativeTime(evidence.stalestAt, now)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

// ─── Source freshness rail ──────────────────────────────────────────────────

export function OkrSourceFreshnessList({
  summary,
  now,
}: {
  summary: OkrDashboardSummary | undefined
  now?: number
}) {
  const items = summary?.sourceFreshness ?? []
  if (items.length === 0) return null
  return (
    <ul className="space-y-1 text-xs" data-testid="okr-source-freshness">
      {items.map((f) => (
        <li key={f.source} className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{f.source}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1 tabular-nums',
              f.isStale && 'text-destructive',
            )}
          >
            {f.isStale && <Clock className="h-3 w-3" />}
            {formatRelativeTime(f.lastUpdatedAt, now)}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ─── Warning list ───────────────────────────────────────────────────────────

export function OkrWarningList({ warnings }: { warnings: OkrDashboardWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="space-y-2" data-testid="okr-warnings">
      {warnings.map((w, idx) => (
        <Alert key={`${w.code}-${idx}`} variant="warning">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{OKR_WARNING_LABELS[w.code] ?? w.message}</AlertDescription>
        </Alert>
      ))}
    </div>
  )
}

// ─── Backflow strip ─────────────────────────────────────────────────────────

export function OkrBackflowStrip({ summary }: { summary: OkrDashboardSummary | undefined }) {
  const state = resolveBackflowState(summary)
  const bf: OkrDashboardBackflowSummary | undefined = summary?.backflow
  if (state === 'forbidden') {
    return (
      <div className="text-xs text-muted-foreground" data-testid="okr-backflow-forbidden">
        进度回流：无权查看
      </div>
    )
  }
  if (state === 'unavailable') {
    return (
      <div className="text-xs text-muted-foreground" data-testid="okr-backflow-unavailable">
        进度回流暂不可用
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="okr-backflow-strip">
      <span>
        回流候选：<strong className="tabular-nums">{bf?.candidateCount ?? 0}</strong>
      </span>
      <span>
        冲突：<strong className="tabular-nums">{bf?.conflictCount ?? 0}</strong>
      </span>
      <span>
        过期：<strong className="tabular-nums">{bf?.staleCount ?? 0}</strong>
      </span>
      {bf?.lastRefreshedAt && (
        <span className="text-muted-foreground">
          最后刷新 {formatRelativeTime(bf.lastRefreshedAt)}
        </span>
      )}
    </div>
  )
}

// ─── Stale rail ─────────────────────────────────────────────────────────────

export function OkrStaleRail({ summary }: { summary: OkrDashboardSummary | undefined }) {
  const stale = staleSources(summary)
  if (stale.length === 0) return null
  return (
    <Alert variant="warning" data-testid="okr-stale-rail">
      <TrendingDown className="h-4 w-4" />
      <AlertDescription>以下来源已过期：{stale.map((s) => s.source).join('、')}</AlertDescription>
    </Alert>
  )
}
