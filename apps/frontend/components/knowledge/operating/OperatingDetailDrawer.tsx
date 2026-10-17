'use client'

/**
 * v3-knowledge-memory-operating-layer —— Detail Drawer。
 *
 * 行为（spec §5.9 / §5.13）：
 * - 打开：按 selected scopedRef 拉 detail（kind + ref 重新解析 visibility / current state）；
 * - 渲染 kind-specific 证据（§5.10 严格不渲染领域正文）+ 4 surface tab；
 * - close-without-write：关闭只是关 drawer，**绝不**改变任何 owning 状态；
 * - 删除/失权/stale：服务端返回 null → drawer 渲染「不可用」状态而非缓存内容；
 * - 不弹全局 modal：detail 是局部 drawer，错误 lane 可独立 retry（§5.13）。
 */
import { useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import {
  describeOperatingError,
  useKnowledgeMemoryOperatingDetail,
} from '@/hooks/use-knowledge-memory-operating'
import { OwningSurfaceHost } from './KnowledgeMemoryOwningSurfaceHost'
import {
  OperatingL3Watermarks,
  OperatingMemoryInferenceBadge,
  OperatingPriorityBadge,
  OperatingSafeLabels,
  OperatingSkillMethodologyBadge,
  OperatingStatusBadge,
} from './OperatingStatusBadge'
import type {
  KnowledgeMemoryOperatingKind,
  KnowledgeMemoryOperatingSurface,
  KnowledgeMemoryScopedRef,
} from '@aiproj/types'

export function OperatingDetailDrawer({
  scopedRef,
  organizationId,
  open,
  onClose,
  onStale,
  onOwningMutated,
}: {
  scopedRef: KnowledgeMemoryScopedRef | null
  organizationId: number | null
  open: boolean
  onClose: () => void
  onStale?: () => void
  /** owning 写入成功后回调（只在成功时触发，取消/关闭/失败都不触发）。 */
  onOwningMutated?: (input: {
    surface: KnowledgeMemoryOperatingSurface
    kind: KnowledgeMemoryOperatingKind
    ref: string
  }) => void
}) {
  const kind = scopedRef?.kind ?? null
  const ref = scopedRef?.ref ?? null

  const { data, isLoading, error, refetch } = useKnowledgeMemoryOperatingDetail({
    organizationId,
    kind,
    ref,
    enabled: open && scopedRef !== null,
  })

  useEffect(() => {
    // 关闭时只重置 UI 状态；不调用任何 owning API
  }, [scopedRef])

  if (!open || !scopedRef) return null

  return (
    <div
      className="fixed inset-y-0 right-0 w-[min(640px,90vw)] bg-background border-l shadow-lg z-30 overflow-y-auto"
      role="dialog"
      aria-label="operating-detail"
      data-testid="operating-detail-drawer"
    >
      <div className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">kind · ref</p>
            <p className="font-mono text-sm">
              {scopedRef.kind}:{scopedRef.ref}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState
            error={describeOperatingError(error)}
            onRetry={() => refetch()}
            onClose={onClose}
          />
        ) : !data?.data ? (
          <NotFoundState scopedRef={scopedRef} onClose={onClose} />
        ) : (
          <DetailBody
            detail={data.data}
            organizationId={organizationId}
            onClose={onClose}
            onStale={onStale}
            onOwningMutated={onOwningMutated}
          />
        )}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex justify-center py-12" aria-label="detail-loading">
      <LoadingSpinner />
    </div>
  )
}

function ErrorState({
  error,
  onRetry,
  onClose,
}: {
  error: { code: string; message: string }
  onRetry: () => void
  onClose: () => void
}) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm py-8 text-center space-y-2">
          <Badge variant="danger">{error.code}</Badge>
          <div className="text-muted-foreground">{error.message}</div>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={onRetry}>
              重试
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function NotFoundState({
  scopedRef,
  onClose,
}: {
  scopedRef: KnowledgeMemoryScopedRef
  onClose: () => void
}) {
  return (
    <Card>
      <CardContent>
        <div className="text-sm py-8 text-center space-y-2" data-testid="detail-not-found">
          <Badge variant="info">不可用</Badge>
          <p className="text-muted-foreground">
            对象{' '}
            <code>
              {scopedRef.kind}:{scopedRef.ref}
            </code>{' '}
            在当前权限下不可见， 或已删除 / 跨租 / 已不再 current。
          </p>
          <p className="text-[11px] text-muted-foreground">
            关闭抽屉不会改变任何数据；URL 中的 selected 已被清除，安全 filters 保留。
          </p>
          <Button size="sm" variant="outline" onClick={onClose}>
            关闭
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailBody({
  detail,
  organizationId,
  onClose,
  onStale,
  onOwningMutated,
}: {
  detail: import('@aiproj/types').KnowledgeMemoryOperatingDetail
  organizationId: number | null
  onClose: () => void
  onStale?: () => void
  onOwningMutated?: (input: {
    surface: import('@aiproj/types').KnowledgeMemoryOperatingSurface
    kind: import('@aiproj/types').KnowledgeMemoryOperatingKind
    ref: string
  }) => void
}) {
  const item = detail.item
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-1.5">
            <span>{itemTitle(item)}</span>
            <OperatingStatusBadge status={item.status} />
            <OperatingPriorityBadge priority={item.priority} />
            {item.kind === 'knowledge_item' && <OperatingL3Watermarks knowledge={item} />}
            {item.kind === 'copilot_memory' && <OperatingMemoryInferenceBadge memory={item} />}
            {item.kind === 'skill_knowledge_draft' && (
              <OperatingSkillMethodologyBadge draft={item} />
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            ref: {item.scopedRef.kind}:{item.scopedRef.ref} · updatedAt: {item.updatedAt} · 取数:{' '}
            {detail.fetchedAt}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <KindSpecificEvidence item={item} />
          <OperatingSafeLabels item={item} />
          <AttentionBasis item={item} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Owning surface handoff</CardTitle>
        </CardHeader>
        <CardContent>
          <OwningSurfaceHost
            detail={detail}
            organizationId={organizationId}
            onClose={onClose}
            onMutated={(surface) =>
              onOwningMutated?.({
                surface,
                kind: item.kind,
                ref: item.scopedRef.ref,
              })
            }
          />
        </CardContent>
      </Card>
      {onStale && (
        <div className="text-right text-xs">
          <button
            type="button"
            className="text-primary underline"
            onClick={onStale}
            data-testid="detail-refresh-stale"
          >
            重新核对（处置完成后）
          </button>
        </div>
      )}
    </>
  )
}

function itemTitle(item: import('@aiproj/types').KnowledgeMemoryOperatingItem): string {
  if (item.kind === 'knowledge_item') return item.title
  if (item.kind === 'copilot_memory') return `${item.memoryScope} memory · ${item.statusDetail}`
  if (item.kind === 'skill_knowledge_draft') return `${item.skillName} · draft ${item.draftStatus}`
  return `${item.retrievalKind} · ${item.queryCategory}`
}

function KindSpecificEvidence({
  item,
}: {
  item: import('@aiproj/types').KnowledgeMemoryOperatingItem
}) {
  if (item.kind === 'knowledge_item') {
    return (
      <div className="space-y-1">
        <div>
          <span className="text-muted-foreground">layer：</span>
          {item.layer}
        </div>
        <div>
          <span className="text-muted-foreground">lifecycle：</span>
          {item.lifecycle}
        </div>
        <div>
          <span className="text-muted-foreground">provenance 数：</span>
          {item.provenance.length}
        </div>
        <div>
          <span className="text-muted-foreground">review 数：</span>
          {item.reviewCount}
        </div>
      </div>
    )
  }
  if (item.kind === 'copilot_memory') {
    return (
      <div className="space-y-1">
        <div>
          <span className="text-muted-foreground">scope：</span>
          {item.memoryScope}
        </div>
        <div>
          <span className="text-muted-foreground">statusDetail：</span>
          {item.statusDetail}
        </div>
        <div>
          <span className="text-muted-foreground">summary byte size：</span>
          {item.summaryByteSize}（不返回正文）
        </div>
        <div>
          <span className="text-muted-foreground">basis 数：</span>
          {item.basisCount}
        </div>
        <div>
          <span className="text-muted-foreground">confidence source：</span>
          {item.confidenceSource}
        </div>
        <div>
          <span className="text-muted-foreground">live-fact 冲突：</span>
          {item.hasLiveFactConflict ? '是（memory 不得覆盖实时事实）' : '否'}
        </div>
      </div>
    )
  }
  if (item.kind === 'skill_knowledge_draft') {
    return (
      <div className="space-y-1">
        <div>
          <span className="text-muted-foreground">skill：</span>
          {item.skillName} (id={item.skillId})
        </div>
        <div>
          <span className="text-muted-foreground">draft：</span>
          {item.draftStatus}
        </div>
        <div>
          <span className="text-muted-foreground">base version：</span>
          {item.baseVersion}
        </div>
        <div>
          <span className="text-muted-foreground">current version：</span>
          {item.currentVersion}
        </div>
        <div>
          <span className="text-muted-foreground">base-stale：</span>
          {item.baseStale ? '是（commit handoff 需重新 preview）' : '否'}
        </div>
        <div>
          <span className="text-muted-foreground">plugin provenance：</span>
          {item.pluginProvenance.kind === 'core'
            ? 'core'
            : `plugin=${item.pluginProvenance.pluginId} · ${item.pluginProvenance.skillIdentity}${
                item.pluginProvenance.disabled ? ' · disabled' : ''
              }${item.pluginProvenance.uninstalled ? ' · uninstalled' : ''}`}
        </div>
        <div>
          <span className="text-muted-foreground">section 数：</span>
          {item.sectionCount}
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div>
        <span className="text-muted-foreground">retrieval kind：</span>
        {item.retrievalKind}
      </div>
      <div>
        <span className="text-muted-foreground">query category：</span>
        {item.queryCategory}
      </div>
      <div>
        <span className="text-muted-foreground">window：</span>
        {item.windowStart} → {item.windowEnd}
      </div>
      <div>
        <span className="text-muted-foreground">sample count：</span>
        {item.sampleCount}
      </div>
      <div>
        <span className="text-muted-foreground">zero-result rate：</span>
        {item.zeroResultRate.toFixed(2)}
      </div>
      <div>
        <span className="text-muted-foreground">permission excluded：</span>
        {item.permissionExcludedCount}
      </div>
      <div>
        <span className="text-muted-foreground">truncated / degraded：</span>
        {item.truncated ? '是' : '否'} / {item.degraded ? '是' : '否'}
      </div>
    </div>
  )
}

function AttentionBasis({ item }: { item: import('@aiproj/types').KnowledgeMemoryOperatingItem }) {
  return (
    <div className="rounded border bg-muted/30 p-2 text-xs space-y-1">
      <div>
        <span className="text-muted-foreground">reasonCode：</span>
        <code>{item.attentionBasis.reasonCode}</code>
      </div>
      {item.attentionBasis.note && (
        <div>
          <span className="text-muted-foreground">note：</span>
          {item.attentionBasis.note}
        </div>
      )}
      {item.attentionBasis.basisRefs.length > 0 && (
        <div>
          <span className="text-muted-foreground">basis refs：</span>
          {item.attentionBasis.basisRefs.slice(0, 3).map((r) => (
            <code key={r} className="ml-1 text-[10px]">
              {r}
            </code>
          ))}
        </div>
      )}
    </div>
  )
}
