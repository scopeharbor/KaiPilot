'use client'

/**
 * v3-knowledge-memory-operating-layer —— 运营层视图（可复用组件）。
 *
 * 同时被两处渲染：`/knowledge?view=operations`（spec 要求的增量入口）与别名
 * 路由 `/knowledge/operations`。抽成组件而不是各写一份，避免两条入口行为漂移。
 *
 * 行为（spec §5）：
 * - flag off 时只显示「未启用」占位；不挂载任何 hook、不发请求；
 * - flag on 时：summary 卡 + 筛选 + 队列 + detail drawer；
 * - URL state 与浏览器历史双向绑定（`useOperatingUrlState`）；
 * - 既有 `/knowledge` 四层浏览与创作入口保持不变。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { usePermissions } from '@/hooks/use-permissions'
import { useOrganizationId } from '@/hooks/use-organization-id'
import {
  operatingUrlStateToQuery,
  useKnowledgeMemoryOperatingSummary,
  useOperatingUrlState,
  useOperatingInvalidation,
  useOperatingRefresh,
} from '@/hooks/use-knowledge-memory-operating'
import { OperatingSummaryCard } from './OperatingSummaryCard'
import { OperatingQueueList } from './OperatingQueueList'
import { OperatingDetailDrawer } from './OperatingDetailDrawer'
import {
  KNOWLEDGE_MEMORY_OPERATING_KINDS,
  KNOWLEDGE_MEMORY_OPERATING_SCOPES,
  KNOWLEDGE_MEMORY_OPERATING_STATUSES,
  type KnowledgeMemoryOperatingKind,
  type KnowledgeMemoryOperatingScope,
  type KnowledgeMemoryOperatingStatus,
  type KnowledgeMemoryScopedRef,
} from '@aiproj/types'

/** 前端 feature flag stub（与后端 env 共享同一名称；运行时再校验） */
const FLAG_OFF_NOTICE = !(
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED === 'true'
)

const ATTENTION_FACETS: readonly KnowledgeMemoryOperatingStatus[] = [
  'needs_review',
  'stale_or_unconfirmed',
  'conflict',
  'provenance_gap',
  'synthetic_eval_only',
  'retention_attention',
  'retrieval_gap',
  'degraded',
]

export function KnowledgeOperationsView() {
  const { can } = usePermissions()
  const canView = can('knowledge_memory_operating:view')
  const orgIdRaw = useOrganizationId()
  const organizationId = useMemo(() => (orgIdRaw ? Number(orgIdRaw) : null), [orgIdRaw])

  const url = useOperatingUrlState()
  const query = useMemo(() => operatingUrlStateToQuery(url.state), [url.state])

  const enabled = !FLAG_OFF_NOTICE && canView && organizationId !== null
  const summary = useKnowledgeMemoryOperatingSummary({ organizationId, enabled })
  const refreshOperating = useOperatingRefresh()
  const invalidateAfterOwningMutation = useOperatingInvalidation()

  const [selected, setSelected] = useState<KnowledgeMemoryScopedRef | null>(
    url.state.selected ?? null,
  )

  // 同步 URL → 本地 selected（处理外部 selected 改变）
  useEffect(() => {
    if (url.state.selected?.ref !== selected?.ref || url.state.selected?.kind !== selected?.kind) {
      setSelected(url.state.selected ?? null)
    }
    // 仅在 URL 中的 selected 变化时同步；selected 本地态刻意不入依赖，
    // 否则本地 setSelected 会立刻触发回写循环。
  }, [url.state.selected?.ref, url.state.selected?.kind])

  const handleSelect = useCallback(
    (scopedRef: KnowledgeMemoryScopedRef) => {
      setSelected(scopedRef)
      url.setState({ selected: scopedRef })
    },
    [url],
  )

  const handleCloseDrawer = useCallback(() => {
    setSelected(null)
    // 清掉 selected 但保留 filters（spec §5.12 安全替代位置）
    const next: typeof url.state = { ...url.state, view: 'operations' }
    delete (next as { selected?: unknown }).selected
    url.setState(next as Partial<typeof url.state>)
  }, [url])

  const handleStale = useCallback(() => {
    refreshOperating(organizationId)
  }, [refreshOperating, organizationId])

  if (!canView) {
    return (
      <EmptyState
        title="知识与记忆运营"
        description="您没有查看权限（需要 knowledge_memory_operating:view）。"
      />
    )
  }

  if (FLAG_OFF_NOTICE) {
    return <FeatureOffCard />
  }

  return (
    <div className="min-w-0 space-y-6 p-3 sm:p-6" data-testid="knowledge-memory-operating-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">知识与记忆运营</h1>
          <p className="text-sm text-muted-foreground mt-1">
            跨四层知识、Copilot 记忆、Skill 草稿与上下文观测的运营入口；写入仍由 owning capability
            接管。
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => url.reset()} data-testid="reset-filters">
          清除筛选
        </Button>
      </div>

      {/* summary */}
      {summary.data?.data && <OperatingSummaryCard summary={summary.data.data} />}
      {summary.error && !summary.data && (
        <Card>
          <CardContent>
            <div className="text-sm py-6 text-center text-muted-foreground">
              summary 暂不可用，但 list/detail 仍可访问。
            </div>
          </CardContent>
        </Card>
      )}

      {/* filter bar */}
      <OperatingFilterBar
        attention={url.state.attention}
        kind={url.state.kind}
        scope={url.state.scope}
        status={url.state.status}
        onChange={(next) => url.setState(next)}
        page={url.state.page ?? query.page ?? 1}
        perPage={url.state.perPage ?? query.perPage ?? 20}
        sort={url.state.sort ?? 'attentionPriority'}
        order={url.state.order ?? 'desc'}
        onPageChange={(p) => url.setState({ page: p })}
        onPerPageChange={(n) => url.setState({ perPage: n, page: 1 })}
        onSortChange={(s, o) => url.setState({ sort: s, order: o, page: 1 })}
      />

      {/* queue */}
      <OperatingQueueList
        organizationId={organizationId}
        urlState={{ ...url.state, page: url.state.page ?? query.page ?? 1 }}
        enabled={enabled}
        onSelect={handleSelect}
        selectedRef={selected}
        onLaneRetry={() => refreshOperating(organizationId)}
      />

      {/* detail drawer */}
      {selected && (
        <OperatingDetailDrawer
          scopedRef={selected}
          organizationId={organizationId}
          open
          onClose={handleCloseDrawer}
          onStale={handleStale}
          onOwningMutated={(input) => invalidateAfterOwningMutation({ organizationId, ...input })}
        />
      )}
    </div>
  )
}

function FeatureOffCard() {
  return (
    <div
      className="min-w-0 break-words p-3 [overflow-wrap:anywhere] sm:p-6"
      data-testid="feature-off"
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">知识与记忆运营（未启用）</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            feature flag <code>NEXT_PUBLIC_KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED</code> =
            false。运营层不挂载。
          </p>
          <p>
            既有 <code>/knowledge</code>、<code>/copilot/memory</code>、Compiler Skill
            创作与上下文观测入口保持原样。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function OperatingFilterBar({
  attention,
  kind,
  scope,
  status,
  onChange,
  page,
  perPage,
  sort,
  order,
  onPageChange,
  onPerPageChange,
  onSortChange,
}: {
  attention: KnowledgeMemoryOperatingStatus | undefined
  kind: KnowledgeMemoryOperatingKind | undefined
  scope: KnowledgeMemoryOperatingScope | undefined
  status: KnowledgeMemoryOperatingStatus | undefined
  onChange: (next: Partial<import('@aiproj/types').OperatingUrlState>) => void
  page: number
  perPage: number
  sort: 'attentionPriority' | 'attentionAt' | 'kind' | 'scopedRef'
  order: 'desc' | 'asc'
  onPageChange: (p: number) => void
  onPerPageChange: (n: number) => void
  onSortChange: (
    s: 'attentionPriority' | 'attentionAt' | 'kind' | 'scopedRef',
    o: 'desc' | 'asc',
  ) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">筛选与排序</CardTitle>
        <p className="text-xs text-muted-foreground">
          URL state 自动同步；前/后向按钮可恢复。flag off 时不发起任何请求。
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">kind：</span>
            <select
              value={kind ?? ''}
              onChange={(e) =>
                onChange({
                  kind: e.target.value
                    ? (e.target.value as KnowledgeMemoryOperatingKind)
                    : undefined,
                  page: 1,
                })
              }
              className="rounded border px-1.5 py-0.5 text-xs bg-background"
            >
              <option value="">全部</option>
              {KNOWLEDGE_MEMORY_OPERATING_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">scope：</span>
            <select
              value={scope ?? ''}
              onChange={(e) =>
                onChange({
                  scope: e.target.value
                    ? (e.target.value as KnowledgeMemoryOperatingScope)
                    : undefined,
                  page: 1,
                })
              }
              className="rounded border px-1.5 py-0.5 text-xs bg-background"
            >
              <option value="">全部</option>
              {KNOWLEDGE_MEMORY_OPERATING_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">status：</span>
            <select
              value={status ?? ''}
              onChange={(e) =>
                onChange({
                  status: e.target.value
                    ? (e.target.value as KnowledgeMemoryOperatingStatus)
                    : undefined,
                  page: 1,
                })
              }
              className="rounded border px-1.5 py-0.5 text-xs bg-background"
            >
              <option value="">全部</option>
              {KNOWLEDGE_MEMORY_OPERATING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">attention：</span>
            <select
              value={attention ?? ''}
              onChange={(e) =>
                onChange({
                  attention: e.target.value
                    ? (e.target.value as KnowledgeMemoryOperatingStatus)
                    : undefined,
                  page: 1,
                })
              }
              className="rounded border px-1.5 py-0.5 text-xs bg-background"
            >
              <option value="">全部</option>
              {ATTENTION_FACETS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">sort：</span>
            <select
              value={sort}
              onChange={(e) =>
                onSortChange(
                  e.target.value as 'attentionPriority' | 'attentionAt' | 'kind' | 'scopedRef',
                  order,
                )
              }
              className="rounded border px-1.5 py-0.5 text-xs bg-background"
            >
              <option value="attentionPriority">attention priority</option>
              <option value="attentionAt">attention time</option>
              <option value="kind">kind</option>
              <option value="scopedRef">scopedRef</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">order：</span>
            <select
              value={order}
              onChange={(e) => onSortChange(sort, e.target.value as 'desc' | 'asc')}
              className="rounded border px-1.5 py-0.5 text-xs bg-background"
            >
              <option value="desc">desc</option>
              <option value="asc">asc</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">perPage：</span>
            <select
              value={String(perPage)}
              onChange={(e) => onPerPageChange(Number(e.target.value))}
              className="rounded border px-1.5 py-0.5 text-xs bg-background"
            >
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <div className="ml-auto flex items-center gap-1.5">
            <Badge variant="outline">page {page}</Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
            >
              上一页
            </Button>
            <Button size="sm" variant="outline" onClick={() => onPageChange(page + 1)}>
              下一页
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
