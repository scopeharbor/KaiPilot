'use client'

import { useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useListCrossProjectAllocationDrafts,
  useCrossProjectAllocationDraft,
  useCreateCrossProjectAllocationDraft,
  useUpdateCrossProjectAllocationItems,
  usePreviewCrossProjectAllocationDraft,
  useConfirmCrossProjectAllocationDraft,
  useApplyCrossProjectAllocationDraft,
  useCancelCrossProjectAllocationDraft,
} from '@/hooks/use-cross-project-resource-allocation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { AlertCircle, AlertTriangle, Check, Clock, EyeOff, List, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CrossProjectAllocationDraftDetail } from '@aiproj/types'

export default function CrossProjectResourceAllocationPage() {
  useRouter()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissions()

  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const draftIdParam = searchParams.get('draft')
  const effectiveDraftId = draftIdParam ? Number(draftIdParam) : selectedDraftId

  // ── 权限检查 ──
  const canView = hasPermission('resource:view')
  const canManage = hasPermission('resource:manage')

  // ── 草案列表 ──
  const draftsQuery = useListCrossProjectAllocationDrafts()
  const drafts = draftsQuery.data?.data ?? []
  const draftsMeta = draftsQuery.data?.meta

  // ── 当前草案详情 ──
  const draftQuery = useCrossProjectAllocationDraft(effectiveDraftId)

  // ── Mutations ──
  const createDraft = useCreateCrossProjectAllocationDraft()
  useUpdateCrossProjectAllocationItems()
  const previewDraft = usePreviewCrossProjectAllocationDraft()
  const confirmDraft = useConfirmCrossProjectAllocationDraft()
  const applyDraft = useApplyCrossProjectAllocationDraft()
  const cancelDraft = useCancelCrossProjectAllocationDraft()

  const handleCreateDraft = async () => {
    try {
      const result = await createDraft.mutateAsync({
        name: `调配方案 ${new Date().toLocaleDateString('zh-CN')}`,
        projectIds: [],
        dateWindow: {
          from: new Date().toISOString().slice(0, 10),
          to: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
        },
      })
      setSelectedDraftId(Number(result.id))
    } catch {
      setError('创建草案失败')
    }
  }

  const handlePreview = async (draftId: number) => {
    try {
      await previewDraft.mutateAsync(draftId)
    } catch {
      setError('预览生成失败')
    }
  }

  const handleConfirm = async (draftId: number) => {
    try {
      await confirmDraft.mutateAsync({
        draftId,
        body: { idempotencyKey: `confirm-${Date.now()}` },
      })
    } catch {
      setError('确认失败')
    }
  }

  const handleApply = async (draftId: number) => {
    try {
      await applyDraft.mutateAsync({
        draftId,
        body: { idempotencyKey: `apply-${Date.now()}` },
      })
    } catch {
      setError('应用失败')
    }
  }

  const handleCancel = async (draftId: number) => {
    try {
      await cancelDraft.mutateAsync(draftId)
    } catch {
      setError('取消失败')
    }
  }

  // ── 加载状态 ──
  if (draftsQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // ── 权限受限 ──
  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="danger">
          <EyeOff className="h-4 w-4" />
          <AlertDescription>无权查看跨项目资源调配</AlertDescription>
        </Alert>
      </div>
    )
  }

  // ── 空态 ──
  if (!drafts.length) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">跨项目资源调配</h1>
          {canManage && (
            <Button onClick={handleCreateDraft} disabled={createDraft.isPending}>
              <Zap className="mr-2 h-4 w-4" />
              新建调配草案
            </Button>
          )}
        </div>
        <EmptyState
          icon={List}
          title="暂无调配草案"
          description="创建调配草案以开始跨项目资源分配"
        />
      </div>
    )
  }

  // ── 草案列表视图 ──
  return (
    <div className="p-6 space-y-4">
      {error && (
        <Alert variant="danger" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">跨项目资源调配</h1>
        {canManage && (
          <Button onClick={handleCreateDraft} disabled={createDraft.isPending}>
            <Zap className="mr-2 h-4 w-4" />
            新建调配草案
          </Button>
        )}
      </div>

      {/* 草案列表 */}
      <div className="grid gap-4">
        {drafts.map((draft) => (
          <Card
            key={draft.id}
            className={cn(
              'cursor-pointer transition-colors hover:border-primary',
              effectiveDraftId === Number(draft.id) && 'border-primary',
            )}
            onClick={() => setSelectedDraftId(Number(draft.id))}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{draft.name}</CardTitle>
              <StatusBadge status={draft.status} />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(draft.createdAt).toLocaleDateString('zh-CN')}
                </span>
                <span>项目数: {draft.queryShape?.projectIds?.length ?? 0}</span>
                {draft.warnings.length > 0 && (
                  <span className="flex items-center gap-1 text-amber-500">
                    <AlertTriangle className="h-3 w-3" />
                    {draft.warnings.length} 个警告
                  </span>
                )}
              </div>
              {/* 操作按钮 */}
              <div className="mt-3 flex gap-2">
                {canManage && draft.status === 'draft' && (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePreview(Number(draft.id))
                    }}
                  >
                    预览
                  </Button>
                )}
                {canManage && draft.status === 'previewed' && (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleConfirm(Number(draft.id))
                    }}
                  >
                    确认
                  </Button>
                )}
                {canManage && draft.status === 'confirmed' && (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleApply(Number(draft.id))
                    }}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    应用
                  </Button>
                )}
                {canManage && !['applied', 'cancelled', 'expired'].includes(draft.status) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCancel(Number(draft.id))
                    }}
                  >
                    <X className="mr-1 h-3 w-3" />
                    取消
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 分页 */}
      {draftsMeta && draftsMeta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>
            第 {draftsMeta.page}/{draftsMeta.totalPages} 页
          </span>
          <span>共 {draftsMeta.total} 条</span>
        </div>
      )}

      {/* 草案详情面板 */}
      {draftQuery.isLoading && <Skeleton className="h-48 w-full" />}
      {draftQuery.data && (
        <DraftDetailPanel draft={draftQuery.data} onClose={() => setSelectedDraftId(null)} />
      )}
    </div>
  )
}

// ── 状态徽章 ──
function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    draft: '草案',
    previewed: '已预览',
    confirmed: '已确认',
    applied: '已应用',
    cancelled: '已取消',
    expired: '已过期',
    failed: '失败',
  }
  const colors: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    previewed: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    confirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    applied: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    cancelled: 'bg-gray-100 text-gray-500',
    expired: 'bg-orange-100 text-orange-600',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium',
        colors[status] ?? 'bg-gray-100',
      )}
    >
      {labels[status] ?? status}
    </span>
  )
}

// ── 草案详情面板 ──
function DraftDetailPanel({
  draft,
  onClose,
}: {
  draft: CrossProjectAllocationDraftDetail
  onClose: () => void
}) {
  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">
          {draft.name} <StatusBadge status={draft.status} />
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Items */}
        {draft.items.length === 0 ? (
          <EmptyState icon={List} title="暂无调配项" description="请添加调配项" />
        ) : (
          <div className="space-y-2">
            {draft.items.map((item) => (
              <Card key={item.id} className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">
                      {item.itemType === 'allocate'
                        ? '分配'
                        : item.itemType === 'reallocate'
                          ? '重新分配'
                          : item.itemType === 'remove'
                            ? '移除'
                            : '资源映射'}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      目标项目 #{item.demand?.targetProjectId ?? 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{item.allocationPercent}%</span>
                    {(item.conflicts ?? []).length > 0 && (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                    {item.applied && <Check className="h-4 w-4 text-green-500" />}
                  </div>
                </div>
                {item.demand?.requiredSkillTags?.length > 0 && (
                  <div className="mt-1 flex gap-1">
                    {item.demand.requiredSkillTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Confirmation */}
        {draft.confirmation && (
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <p>确认时间: {new Date(draft.confirmation.confirmedAt).toLocaleString('zh-CN')}</p>
            <p>预览哈希: {draft.confirmation.previewHash}</p>
          </div>
        )}

        {/* Apply Result */}
        {draft.applyResult && (
          <div
            className={cn(
              'rounded-lg p-3 text-xs',
              draft.applyResult.status === 'success'
                ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                : draft.applyResult.status === 'partial'
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
            )}
          >
            <p className="font-medium">应用结果: {draft.applyResult.status}</p>
            <p>应用时间: {new Date(draft.applyResult.appliedAt).toLocaleString('zh-CN')}</p>
            <p>项目结果数: {draft.applyResult.itemResults.length}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
