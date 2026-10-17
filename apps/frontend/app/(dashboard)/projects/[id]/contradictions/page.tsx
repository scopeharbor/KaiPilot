'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, RefreshCw, Sparkles, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useConfirmTrizContradiction,
  useDismissTrizContradiction,
  useExplainTrizContradiction,
  useRefreshTrizContradictions,
  useTrizContradictions,
} from '@/hooks/use-triz-contradictions'
import type { ContradictionDTO } from '@/lib/api/triz-contradictions'
import { cn } from '@/lib/utils'

const severityLabel: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

const statusLabel: Record<string, string> = {
  draft: '待确认',
  confirmed: '已确认',
  dismissed: '已忽略',
  superseded: '已取代',
}

export default function ProjectContradictionsPage() {
  const projectId = Number(useParams().id)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const list = useTrizContradictions(projectId, { perPage: 50 })
  const refresh = useRefreshTrizContradictions(projectId)
  const confirm = useConfirmTrizContradiction(projectId)
  const dismiss = useDismissTrizContradiction(projectId)
  const explain = useExplainTrizContradiction(projectId)

  const items = list.data?.data ?? []
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  )

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 lg:px-10">
      <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Sparkles className="h-4 w-4 text-ai" aria-hidden="true" />
            <span>TRIZ 矛盾模型</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-heading">项目矛盾</h1>
          <p className="mt-1 max-w-3xl text-sm text-foreground">
            查看规则派生的「改善项 ↔ 恶化项」对立信号，并在人工复核后确认或忽略。
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="w-full md:w-auto"
        >
          <RefreshCw className={cn('h-4 w-4', refresh.isPending && 'animate-spin')} />
          刷新矛盾
        </Button>
      </header>

      {list.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_1fr]">
          <Skeleton className="h-[360px] rounded-lg" />
          <Skeleton className="h-[360px] rounded-lg" />
        </div>
      ) : items.length === 0 ? (
        <section className="rounded-lg border border-border bg-surface p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-muted" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-heading">暂无派生矛盾</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-foreground">
            当前项目还没有可展示的矛盾信号。刷新会只读收集项目事实并运行确定性规则，不会触发 AI
            或修改项目数据。
          </p>
        </section>
      ) : (
        <section className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_1fr]">
          <div className="rounded-lg border border-border bg-background">
            <div className="border-b border-border px-4 py-3 text-sm font-medium text-heading">
              矛盾列表
            </div>
            <div className="divide-y divide-border">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-surface focus-visible:shadow-focus',
                    selected?.id === item.id && 'bg-primary-50',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium text-heading">{item.title}</span>
                    <SeverityBadge severity={item.severity} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{item.type === 'technical' ? '技术矛盾' : '物理矛盾'}</span>
                    <span>{statusLabel[item.status] ?? item.status}</span>
                    {item.stale ? <span className="text-warning">已过期</span> : null}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selected ? (
            <ContradictionDetail
              item={selected}
              onConfirm={() => confirm.mutate(selected.id)}
              onDismiss={() =>
                dismiss.mutate({ contradictionId: selected.id, reason: '人工复核后暂不成立' })
              }
              onExplain={() => explain.mutate({ contradictionId: selected.id })}
              busy={confirm.isPending || dismiss.isPending || explain.isPending}
            />
          ) : null}
        </section>
      )}
    </main>
  )
}

function ContradictionDetail({
  item,
  onConfirm,
  onDismiss,
  onExplain,
  busy,
}: {
  item: ContradictionDTO
  onConfirm: () => void
  onDismiss: () => void
  onExplain: () => void
  busy: boolean
}) {
  return (
    <article className="rounded-lg border border-border bg-background p-5">
      <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={item.severity} />
            <span className="rounded-full bg-surface px-2 py-1 text-xs text-muted">
              {statusLabel[item.status] ?? item.status}
            </span>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.02em] text-heading">
            {item.title}
          </h2>
          <p className="mt-1 text-sm text-muted">
            规则 {item.ruleId} · 置信度 {Math.round(item.confidence * 100)}%
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onExplain} disabled={busy}>
            <Sparkles className="h-4 w-4 text-ai" />
            AI 解释
          </Button>
          <Button type="button" variant="secondary" onClick={onDismiss} disabled={busy}>
            <XCircle className="h-4 w-4" />
            忽略
          </Button>
          <Button type="button" variant="primary" onClick={onConfirm} disabled={busy}>
            <CheckCircle2 className="h-4 w-4" />
            确认
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold text-heading">参数对立</h3>
          <dl className="mt-3 grid gap-2 text-sm">
            <InfoRow
              label="改善项"
              value={item.improvingParameterKey ?? item.parameterKey ?? '-'}
            />
            <InfoRow
              label="恶化项"
              value={item.worseningParameterKey ?? item.requirementB ?? '-'}
            />
            <InfoRow label="改善方向" value={item.improvingDirection ?? item.requirementA ?? '-'} />
            <InfoRow label="恶化方向" value={item.worseningDirection ?? item.requirementB ?? '-'} />
          </dl>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-heading">候选原理</h3>
          <div className="mt-3 space-y-3">
            {item.suggestedPrinciples.length === 0 ? (
              <p className="text-sm text-muted">暂无确定性候选原理。</p>
            ) : (
              item.suggestedPrinciples.map((principle) => (
                <div key={principle.principleId} className="rounded-md bg-surface p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-heading">{principle.name}</span>
                    <span className="text-xs text-muted">
                      {Math.round(principle.relevance * 100)}%
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{principle.advice}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="mt-5">
        <h3 className="text-sm font-semibold text-heading">低敏证据</h3>
        <div className="mt-3 divide-y divide-border rounded-md border border-border">
          {item.evidence.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">暂无可展示证据。</p>
          ) : (
            item.evidence.map((evidence, index) => (
              <div
                key={`${evidence.entityType}-${evidence.entityId}-${index}`}
                className="px-3 py-3"
              >
                <div className="text-sm font-medium text-heading">{evidence.title}</div>
                <div className="mt-1 text-sm text-muted">{evidence.detail}</div>
              </div>
            ))
          )}
        </div>
      </section>

      {item.aiExplanation ? (
        <section className="mt-5 rounded-lg border border-ai/20 bg-ai-bg p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-heading">
            <Sparkles className="h-4 w-4 text-ai" aria-hidden="true" />
            AI 解释草稿
          </div>
          <p className="mt-2 text-sm text-foreground">{item.aiExplanation.narrative}</p>
          {item.aiExplanation.isFallback ? (
            <p className="mt-2 text-xs text-warning">{item.aiExplanation.degradedReason}</p>
          ) : null}
        </section>
      ) : null}
    </article>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-heading">{value}</dd>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-1 text-xs font-medium',
        severity === 'critical' && 'bg-danger-bg text-danger',
        severity === 'high' && 'bg-warning-bg text-warning',
        severity === 'medium' && 'bg-info-bg text-info',
        severity === 'low' && 'bg-success-bg text-success',
      )}
    >
      {severityLabel[severity] ?? severity}
    </span>
  )
}
