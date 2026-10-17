'use client'

import {
  useRecommendationDetail,
  useGenerateAiExplanation,
  useApproveAiExplanation,
  useRejectAiExplanation,
  useUpdateRecommendationStatus,
} from '@/lib/api/use-recommendations'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Separator } from '@/components/ui/Separator'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/Alert'
import { ScrollArea } from '@/components/ui/ScrollArea'
import { toast } from '@/components/ui/Toast'
import {
  RECOMMENDATION_SEVERITY_LABELS,
  RECOMMENDATION_SOURCE_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  recommendationSeverityScore,
} from '@aiproj/types'
import type { RecommendationRecord } from '@aiproj/types'

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  info: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
}

interface Props {
  projectId: number
  recId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RecommendationDetailDrawer({ projectId, recId, open, onOpenChange }: Props) {
  const { data: record, isLoading, error } = useRecommendationDetail(projectId, recId ?? 0)

  const generateMutation = useGenerateAiExplanation(projectId)
  const approveMutation = useApproveAiExplanation(projectId)
  const rejectMutation = useRejectAiExplanation(projectId)
  const statusMutation = useUpdateRecommendationStatus(projectId)

  const handleGenerateAi = () => {
    if (!recId) return
    generateMutation.mutate(recId, {
      onSuccess: () => toast({ title: 'AI 解释已生成', description: '请审阅后确认或驳回' }),
      onError: () => toast({ title: '生成失败', description: 'AI 解释生成异常', variant: 'error' }),
    })
  }

  const handleApproveAi = () => {
    if (!recId) return
    approveMutation.mutate(
      { recId },
      {
        onSuccess: () => toast({ title: 'AI 解释已确认' }),
      },
    )
  }

  const handleRejectAi = () => {
    if (!recId) return
    rejectMutation.mutate(
      { recId, reason: '需要人工复核' },
      {
        onSuccess: () => toast({ title: 'AI 解释已驳回' }),
      },
    )
  }

  const handleAccept = () => {
    if (!recId) return
    statusMutation.mutate(
      { recId, status: 'accepted' },
      {
        onSuccess: () => toast({ title: '推荐已采纳' }),
      },
    )
  }

  const handleDismiss = () => {
    if (!recId) return
    statusMutation.mutate(
      { recId, status: 'dismissed', reason: '用户手动忽略' },
      {
        onSuccess: () => toast({ title: '推荐已忽略' }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>推荐详情</DialogTitle>
          <DialogClose />
        </DialogHeader>
        <ScrollArea className="pr-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : error ? (
            <Alert variant="danger">
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>无法加载推荐详情，请稍后重试</AlertDescription>
            </Alert>
          ) : record ? (
            <DetailContent
              record={record}
              onGenerateAi={handleGenerateAi}
              onApproveAi={handleApproveAi}
              onRejectAi={handleRejectAi}
              onAccept={handleAccept}
              onDismiss={handleDismiss}
              aiPending={
                generateMutation.isPending || approveMutation.isPending || rejectMutation.isPending
              }
              statusPending={statusMutation.isPending}
            />
          ) : null}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function DetailContent({
  record,
  onGenerateAi,
  onApproveAi,
  onRejectAi,
  onAccept,
  onDismiss,
  aiPending,
  statusPending,
}: {
  record: RecommendationRecord
  onGenerateAi: () => void
  onApproveAi: () => void
  onRejectAi: () => void
  onAccept: () => void
  onDismiss: () => void
  aiPending: boolean
  statusPending: boolean
}) {
  const severityScore = recommendationSeverityScore(record.severity)
  const isPending = record.status === 'new' || record.status === 'reviewing'

  return (
    <div className="space-y-4">
      {/* 标题与状态 */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{record.title}</h3>
          <div className="flex gap-2 flex-wrap">
            <Badge className={severityColors[record.severity]}>
              {RECOMMENDATION_SEVERITY_LABELS[record.severity]}（{severityScore}分）
            </Badge>
            <Badge variant="outline">{RECOMMENDATION_STATUS_LABELS[record.status]}</Badge>
            <Badge variant="neutral">{RECOMMENDATION_SOURCE_LABELS[record.sourceType]}</Badge>
          </div>
        </div>
      </div>

      {/* 优先级与置信度 */}
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">优先级分</span>
          <p className="font-mono font-semibold">{record.priority}</p>
        </div>
        <div>
          <span className="text-muted-foreground">置信度</span>
          <p className="capitalize">{record.confidence}</p>
        </div>
        {record.expiresAt && (
          <div>
            <span className="text-muted-foreground">过期</span>
            <p>{new Date(record.expiresAt).toLocaleDateString('zh-CN')}</p>
          </div>
        )}
      </div>

      <Separator />

      {/* 摘要 */}
      <div>
        <h4 className="font-medium mb-1">摘要</h4>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{record.summary}</p>
      </div>

      {/* 建议操作 */}
      {record.recommendedAction && (
        <div>
          <h4 className="font-medium mb-1">建议操作</h4>
          <p className="text-sm text-muted-foreground">{record.recommendedAction}</p>
        </div>
      )}

      {/* 目标引用 */}
      {record.targetRef && (
        <div>
          <h4 className="font-medium mb-1">来源目标</h4>
          <p className="text-sm text-muted-foreground">
            {record.targetRef.entityType} /{' '}
            {record.targetRef.displayName ?? `#${record.targetRef.entityId}`}
          </p>
        </div>
      )}

      {/* 证据引用 */}
      {record.evidenceRefs && record.evidenceRefs.length > 0 && (
        <div>
          <h4 className="font-medium mb-1">证据引用（{record.evidenceRefs.length}条）</h4>
          <ul className="text-sm space-y-1">
            {record.evidenceRefs.map((ref, i) => (
              <li key={i} className="text-muted-foreground flex items-center gap-2">
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{ref.entityType}</span>
                <span>{ref.displaySummary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI 解释 */}
      {record.aiMetadata && (
        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">AI 解释</h4>
            <Badge
              variant={
                record.aiMetadata.status === 'approved'
                  ? 'success'
                  : record.aiMetadata.status === 'rejected'
                    ? 'danger'
                    : 'neutral'
              }
            >
              {record.aiMetadata.status === 'approved'
                ? '已确认'
                : record.aiMetadata.status === 'rejected'
                  ? '已驳回'
                  : '待审'}
            </Badge>
          </div>
          {record.aiMetadata.narrative && (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {record.aiMetadata.narrative}
            </p>
          )}
          {record.aiMetadata.focusPoints.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">关注点</p>
              <ul className="text-sm list-disc list-inside">
                {record.aiMetadata.focusPoints.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {record.aiMetadata.assumptions.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">假设</p>
              <ul className="text-sm list-disc list-inside">
                {record.aiMetadata.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {record.aiMetadata.status === 'pending' && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={onApproveAi} disabled={aiPending}>
                确认
              </Button>
              <Button size="sm" variant="outline" onClick={onRejectAi} disabled={aiPending}>
                驳回
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Warning */}
      {record.warnings && record.warnings.length > 0 && (
        <Alert>
          <AlertTitle>注意事项</AlertTitle>
          <AlertDescription>
            <ul className="text-sm list-disc list-inside">
              {record.warnings.map((w, i) => (
                <li key={i}>
                  {w.message}
                  {w.blocking && '（阻塞）'}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      {/* 操作按钮 */}
      <div className="flex gap-2 flex-wrap">
        {isPending && (
          <>
            <Button size="sm" onClick={onAccept} disabled={statusPending}>
              采纳
            </Button>
            <Button size="sm" variant="outline" onClick={onDismiss} disabled={statusPending}>
              忽略
            </Button>
          </>
        )}
        {!record.aiMetadata && (
          <Button size="sm" variant="secondary" onClick={onGenerateAi} disabled={aiPending}>
            生成 AI 解释
          </Button>
        )}
      </div>

      {/* 元信息 */}
      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>
          创建者 #{record.createdBy} · {new Date(record.createdAt).toLocaleString('zh-CN')}
        </p>
        {record.handledBy && (
          <p>
            处理者 #{record.handledBy} ·{' '}
            {record.handledAt ? new Date(record.handledAt).toLocaleString('zh-CN') : ''}
          </p>
        )}
        {record.stale && (
          <p className="text-amber-600">已过期：{record.staleReason ?? '未知原因'}</p>
        )}
      </div>
    </div>
  )
}
