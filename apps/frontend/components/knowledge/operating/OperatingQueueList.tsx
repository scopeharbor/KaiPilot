'use client'

/**
 * v3-knowledge-memory-operating-layer —— 统一队列。
 *
 * 行为（spec §5.7 / §5.13）：
 * - 渲染 4 kind 统一行；
 * - 支持 loading / empty / filtered-empty / partial / degraded / error / stale / forbidden
 *   8 状态，**不弹全局 modal**——错误/降级以 lane-level 局部 retry 行内显示；
 * - 翻页由后端 stable sort 决定；UI 仅在 page 变化时通过 onPageChange 回调。
 * - 跨页无重复遗漏由后端保证（§4.6 测试）；UI 不做去重。
 */
import { useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { OperatingItemRow } from './OperatingItemRow'
import {
  describeOperatingError,
  useKnowledgeMemoryOperatingList,
} from '@/hooks/use-knowledge-memory-operating'
import { operatingUrlStateToQuery } from '@/hooks/use-knowledge-memory-operating'
import type {
  KnowledgeMemoryOperatingKind,
  KnowledgeMemoryScopedRef,
  OperatingUrlState,
} from '@aiproj/types'

export interface OperatingQueueListProps {
  organizationId: number | null
  urlState: OperatingUrlState
  enabled: boolean
  onSelect: (scopedRef: KnowledgeMemoryScopedRef) => void
  selectedRef?: KnowledgeMemoryScopedRef | null
  onLaneRetry?: (lane: KnowledgeMemoryOperatingKind) => void
}

export function OperatingQueueList(props: OperatingQueueListProps) {
  const query = operatingUrlStateToQuery(props.urlState)
  const { data, isLoading, isFetching, error, refetch } = useKnowledgeMemoryOperatingList({
    organizationId: props.organizationId,
    query,
    enabled: props.enabled,
  })

  const onSelect = props.onSelect
  const onLaneRetry = props.onLaneRetry
  const handleRetryLane = useCallback(
    (lane: KnowledgeMemoryOperatingKind) => {
      if (onLaneRetry) onLaneRetry(lane)
      else refetch()
    },
    [onLaneRetry, refetch],
  )

  const items = data?.data?.data ?? []
  const meta = data?.data?.meta
  const degradedLanes = new Set(meta?.degradedLanes ?? [])
  const totalLanes = meta?.lanes?.length ?? 0

  if (!props.enabled) {
    return <FeatureOffNotice />
  }

  if (isLoading) {
    return <LoadingState />
  }

  if (error) {
    const e = describeOperatingError(error)
    return (
      <ErrorState
        code={e.code}
        message={e.message}
        onRetry={() => refetch()}
        testId="operating-queue-error"
      />
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        isFiltered={hasAnyFilter(query)}
        total={meta?.total ?? 0}
        degradedLanesCount={degradedLanes.size}
        totalLanes={totalLanes}
        onRetry={() => refetch()}
        onLaneRetry={handleRetryLane}
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          统一队列
          {meta && (
            <span className="text-sm font-normal text-muted-foreground ml-2">
              共 {meta.total} 项 · 第 {meta.page} / {meta.totalPages} 页
              {degradedLanes.size > 0 && (
                <span className="ml-2 text-warning">· {degradedLanes.size} lane degraded</span>
              )}
              {isFetching && <span className="ml-2 text-muted-foreground">· 刷新中…</span>}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Degraded lanes 局部 retry（spec §5.13 不弹全局 modal） */}
        {degradedLanes.size > 0 && (
          <div className="mb-3 space-y-1">
            {Array.from(degradedLanes).map((lane) => (
              <DegradedLaneRow key={lane} lane={lane} onRetry={() => handleRetryLane(lane)} />
            ))}
          </div>
        )}
        <div className="space-y-2" role="list" aria-label="operating-queue">
          {items.map((it) => (
            <OperatingItemRow
              key={`${it.kind}:${it.scopedRef.ref}`}
              item={it}
              selected={
                props.selectedRef?.kind === it.kind && props.selectedRef?.ref === it.scopedRef.ref
              }
              onSelect={onSelect}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function hasAnyFilter(q: ReturnType<typeof operatingUrlStateToQuery>): boolean {
  return Boolean(q.attention || q.kind || q.scope || q.status)
}

function FeatureOffNotice() {
  return (
    <Card>
      <CardContent>
        <div className="text-sm text-muted-foreground py-8 text-center">
          运营层当前未启用（feature flag <code>KNOWLEDGE_MEMORY_OPERATING_LAYER_ENABLED</code> =
          off）。 既有知识库、Copilot 记忆、Skill 知识创作与上下文观测入口保持原样。
        </div>
      </CardContent>
    </Card>
  )
}

function LoadingState() {
  return (
    <Card>
      <CardContent>
        <div className="flex justify-center py-12" aria-label="loading">
          <LoadingSpinner />
        </div>
      </CardContent>
    </Card>
  )
}

function ErrorState({
  code,
  message,
  onRetry,
  testId,
}: {
  code: string
  message: string
  onRetry: () => void
  testId: string
}) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm py-8 text-center space-y-2" data-testid={testId}>
          <Badge variant="danger">错误 · {code}</Badge>
          <div className="text-muted-foreground">{message}</div>
          <Button size="sm" variant="outline" onClick={onRetry}>
            重试
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyState({
  isFiltered,
  total,
  degradedLanesCount,
  totalLanes,
  onRetry,
  onLaneRetry,
}: {
  isFiltered: boolean
  total: number
  degradedLanesCount: number
  totalLanes: number
  onRetry: () => void
  onLaneRetry: (lane: KnowledgeMemoryOperatingKind) => void
}) {
  if (degradedLanesCount > 0) {
    return (
      <Card>
        <CardContent>
          <div className="text-sm py-8 text-center space-y-2">
            <Badge variant="warning">
              partial · {degradedLanesCount}/{totalLanes} lane 降级
            </Badge>
            <div className="text-muted-foreground">
              其它 lane 暂无可显示对象；降级 lane 的 0 不可信。
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <Button size="sm" variant="outline" onClick={onRetry}>
                整体重试
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent>
        <div className="text-sm py-8 text-center space-y-2">
          <Badge variant="info">empty</Badge>
          <div className="text-muted-foreground">
            {isFiltered
              ? '当前筛选条件下无匹配对象。'
              : total === 0
                ? '当前 scope 内无任何可处置对象。'
                : '当前页无对象（请检查筛选条件）。'}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Button size="sm" variant="outline" onClick={onRetry}>
              重试
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onLaneRetry('knowledge_item')}
              aria-label="retry-knowledge-item-lane"
            >
              仅重试 knowledge
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DegradedLaneRow({
  lane,
  onRetry,
}: {
  lane: KnowledgeMemoryOperatingKind
  onRetry: () => void
}) {
  const label: Record<KnowledgeMemoryOperatingKind, string> = {
    knowledge_item: '知识条目',
    copilot_memory: '推断记忆',
    skill_knowledge_draft: 'Skill 知识草稿',
    retrieval_signal: '检索质量信号',
  }
  return (
    <div className="flex items-center gap-2 text-xs rounded border border-warning/40 bg-warning-bg/30 px-2 py-1">
      <Badge variant="warning">degraded</Badge>
      <span className="text-muted-foreground">
        {label[lane]} lane 暂时不可用，未影响其它 lane。
      </span>
      <Button size="sm" variant="ghost" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}
