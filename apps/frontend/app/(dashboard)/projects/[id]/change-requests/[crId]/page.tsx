'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import dynamic from 'next/dynamic'
import PermissionGuard from '@/components/PermissionGuard'
import { usePermissions } from '@/hooks/use-permissions'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { CommentThread } from '@/components/views/comments/CommentThread'
import {
  changeRequestKeys,
  getChangeRequest,
  submitChangeRequest,
  approveChangeRequest,
  rejectChangeRequest,
  returnChangeRequest,
  markImplementedChangeRequest,
  closeChangeRequest,
  cancelChangeRequest,
  getAiImpactSuggestions,
  type ChangeRequest,
  type ChangeRequestStatus,
  type ChangeRequestType,
  type ChangeRequestPriority,
  type ChangeRequestImpactSummary,
} from '@/lib/api/change-requests'

const ChangeImpactPanel = dynamic(
  () => import('@/components/views/change-requests/ChangeImpactPanel'),
  { ssr: false, loading: () => <Skeleton className="h-48 w-full" /> },
)

const STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  under_review: '审核中',
  approved: '已批准',
  rejected: '已拒绝',
  returned: '退回修改',
  implemented: '已实施',
  closed: '已关闭',
  cancelled: '已取消',
}

const TYPE_LABELS: Record<ChangeRequestType, string> = {
  scope: '范围',
  schedule: '进度',
  cost: '成本',
  resource: '资源',
  quality: '质量',
  risk: '风险',
  other: '其他',
}

const PRIORITY_LABELS: Record<ChangeRequestPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}

const IMPACT_LABELS: Record<string, string> = {
  scope: '范围影响',
  schedule: '进度影响',
  resources: '资源影响',
  cost: '成本影响',
  risks: '风险',
  assumptions: '假设',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

export default function ChangeRequestDetailPage() {
  const { id, crId } = useParams<{ id: string; crId: string }>()
  const projectId = Number(id)
  return (
    <PermissionGuard
      require="change_request:create"
      fallback={<Alert className="my-8">无权查看变更请求</Alert>}
    >
      <ChangeRequestDetailContent projectId={projectId} changeRequestId={Number(crId)} />
    </PermissionGuard>
  )
}

function ChangeRequestDetailContent({
  projectId,
  changeRequestId,
}: {
  projectId: number
  changeRequestId: number
}) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const [decisionReason, setDecisionReason] = useState('')
  const [conditions, setConditions] = useState('')
  // 审批时是否引用当前影响分析快照 + 过期继续使用理由（§8.5）
  const [referenceAnalysis, setReferenceAnalysis] = useState(true)
  const [confirmStaleReason, setConfirmStaleReason] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: changeRequestKeys.detail(changeRequestId),
    queryFn: () => getChangeRequest(changeRequestId),
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: changeRequestKeys.all })
  }

  const submit = useMutation({
    mutationFn: () => submitChangeRequest(changeRequestId),
    onSuccess: () => {
      invalidateAll()
      setDecisionReason('')
    },
  })

  const approve = useMutation({
    mutationFn: (vars?: { impactAnalysisId?: number | null; confirmStaleReason?: string | null }) =>
      approveChangeRequest(changeRequestId, {
        decisionReason,
        conditions,
        impactAnalysisId: vars?.impactAnalysisId ?? null,
        confirmStaleReason: vars?.confirmStaleReason ?? null,
      }),
    onSuccess: () => {
      invalidateAll()
      setDecisionReason('')
      setConditions('')
      setConfirmStaleReason('')
    },
  })

  const reject = useMutation({
    mutationFn: (vars?: { impactAnalysisId?: number | null; confirmStaleReason?: string | null }) =>
      rejectChangeRequest(changeRequestId, {
        decisionReason,
        impactAnalysisId: vars?.impactAnalysisId ?? null,
        confirmStaleReason: vars?.confirmStaleReason ?? null,
      }),
    onSuccess: () => {
      invalidateAll()
      setDecisionReason('')
      setConfirmStaleReason('')
    },
  })

  const returnForRevision = useMutation({
    mutationFn: () => returnChangeRequest(changeRequestId, { decisionReason }),
    onSuccess: () => {
      invalidateAll()
      setDecisionReason('')
    },
  })

  const markImpl = useMutation({
    mutationFn: () => markImplementedChangeRequest(changeRequestId),
    onSuccess: invalidateAll,
  })

  const close = useMutation({
    mutationFn: () => closeChangeRequest(changeRequestId),
    onSuccess: invalidateAll,
  })

  const cancel = useMutation({
    mutationFn: () => cancelChangeRequest(changeRequestId),
    onSuccess: invalidateAll,
  })

  if (error) return <Alert className="my-8">加载变更请求失败</Alert>

  const cr: ChangeRequest | undefined = data?.data

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}/change-requests`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回变更请求列表
      </Link>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : !cr ? (
        <Alert>变更请求不存在</Alert>
      ) : (
        <>
          {/* 标题区 */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{cr.title}</h1>
              <p className="text-sm text-muted-foreground">
                {cr.crCode} · {TYPE_LABELS[cr.changeType]} · {PRIORITY_LABELS[cr.priority]} ·{' '}
                {STATUS_LABELS[cr.status]}
              </p>
            </div>
          </div>

          {/* 基本信息 */}
          <Card>
            <CardHeader>
              <CardTitle>基本信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">描述：</span>
                {cr.description || '-'}
              </div>
              <div>
                <span className="text-muted-foreground">创建时间：</span>
                {formatDate(cr.createdAt)}
              </div>
              <div>
                <span className="text-muted-foreground">提交时间：</span>
                {formatDate(cr.submittedAt)}
              </div>
              <div>
                <span className="text-muted-foreground">审批时间：</span>
                {formatDate(cr.approvedAt)}
              </div>
              <div>
                <span className="text-muted-foreground">决策原因：</span>
                {cr.decisionReason || '-'}
              </div>
              <div>
                <span className="text-muted-foreground">条件：</span>
                {cr.conditions || '-'}
              </div>
            </CardContent>
          </Card>

          {/* 影响摘要 */}
          {cr.impactSummary && (
            <Card>
              <CardHeader>
                <CardTitle>影响摘要</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {Object.entries(IMPACT_LABELS).map(([key, label]) => {
                  const value = (cr.impactSummary as ChangeRequestImpactSummary)?.[
                    key as keyof ChangeRequestImpactSummary
                  ]
                  return value ? (
                    <div key={key}>
                      <span className="text-muted-foreground">{label}：</span>
                      {value}
                    </div>
                  ) : null
                })}
                {!Object.values(cr.impactSummary).some(Boolean) && (
                  <div className="text-muted-foreground">暂无影响摘要</div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 影响分析面板 */}
          <ChangeImpactPanel
            projectId={projectId}
            changeRequestId={changeRequestId}
            hasCreatePermission={can('change_impact:view')}
            hasManagePermission={can('change_impact:manage')}
            currentAnalysisId={cr.currentImpactAnalysisId}
          />

          {/* 操作区 */}
          <Card>
            <CardHeader>
              <CardTitle>操作</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {/* 提交 */}
                {(cr.status === 'draft' || cr.status === 'returned') && (
                  <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
                    提交审批
                  </Button>
                )}

                {/* AI 影响分析（草稿/退回状态） */}
                {(cr.status === 'draft' || cr.status === 'returned') && (
                  <Button
                    onClick={async () => {
                      try {
                        const result = await getAiImpactSuggestions(changeRequestId)
                        alert(
                          `AI 建议（待确认）：\n\n范围：${result.data.suggestions.scope}\n进度：${result.data.suggestions.schedule}\n资源：${result.data.suggestions.resources}\n成本：${result.data.suggestions.cost}\n风险：${result.data.suggestions.risks}\n\n置信度：${(result.data.confidence * 100).toFixed(0)}%\n来源：${result.data.source}\n假设：${result.data.assumptions.join('；')}\n\n⚠️ AI 建议仅供参考，需人工确认后才可保存。`,
                        )
                      } catch {
                        alert('AI 影响分析失败，请稍后重试。')
                      }
                    }}
                    variant="outline"
                  >
                    AI 影响分析
                  </Button>
                )}

                {/* 审批动作 */}
                {(cr.status === 'submitted' || cr.status === 'under_review') && (
                  <>
                    <Button
                      onClick={() =>
                        approve.mutate({
                          impactAnalysisId:
                            referenceAnalysis && cr.currentImpactAnalysisId
                              ? cr.currentImpactAnalysisId
                              : null,
                          confirmStaleReason: confirmStaleReason.trim() || null,
                        })
                      }
                      disabled={approve.isPending}
                      variant="primary"
                    >
                      批准
                    </Button>
                    <Button
                      onClick={() =>
                        reject.mutate({
                          impactAnalysisId:
                            referenceAnalysis && cr.currentImpactAnalysisId
                              ? cr.currentImpactAnalysisId
                              : null,
                          confirmStaleReason: confirmStaleReason.trim() || null,
                        })
                      }
                      disabled={reject.isPending}
                      variant="danger"
                    >
                      拒绝
                    </Button>
                    <Button
                      onClick={() => returnForRevision.mutate()}
                      disabled={returnForRevision.isPending}
                      variant="outline"
                    >
                      退回修改
                    </Button>
                  </>
                )}

                {/* 标记实施 */}
                {cr.status === 'approved' && (
                  <Button onClick={() => markImpl.mutate()} disabled={markImpl.isPending}>
                    标记已实施
                  </Button>
                )}

                {/* 关闭 */}
                {cr.status === 'implemented' && (
                  <Button onClick={() => close.mutate()} disabled={close.isPending}>
                    关闭
                  </Button>
                )}

                {/* 取消 */}
                {['draft', 'submitted', 'returned'].includes(cr.status) && (
                  <Button
                    onClick={() => cancel.mutate()}
                    disabled={cancel.isPending}
                    variant="outline"
                  >
                    取消
                  </Button>
                )}
              </div>

              {/* 审批意见输入 */}
              {(cr.status === 'submitted' || cr.status === 'under_review') && (
                <div className="space-y-2">
                  <textarea
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    placeholder="审批意见（可选）"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    rows={3}
                  />
                  <input
                    value={conditions}
                    onChange={(e) => setConditions(e.target.value)}
                    placeholder="批准条件（有条件批准时填写）"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />

                  {/* 审批引用影响分析（§8.5）：仅在已有当前分析时展示 */}
                  {cr.currentImpactAnalysisId ? (
                    <div className="space-y-2 rounded-md border border-dashed p-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={referenceAnalysis}
                          onChange={(e) => setReferenceAnalysis(e.target.checked)}
                        />
                        <span>
                          审批时引用当前影响分析快照（#{cr.currentImpactAnalysisId}）作为决策证据
                        </span>
                      </label>
                      {referenceAnalysis && (
                        <input
                          value={confirmStaleReason}
                          onChange={(e) => setConfirmStaleReason(e.target.value)}
                          placeholder="若分析已过期，填写确认继续使用的理由（否则将阻止审批）"
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        />
                      )}
                      <p className="text-xs text-muted-foreground">
                        引用仅作为审批证据留存，不会自动修改任务、依赖、资源或基线。
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      当前变更请求尚无影响分析快照，可在上方面板生成后再引用。
                    </p>
                  )}
                </div>
              )}

              {/* 错误提示 */}
              {(submit.isError ||
                approve.isError ||
                reject.isError ||
                returnForRevision.isError ||
                markImpl.isError ||
                close.isError ||
                cancel.isError) && (
                <Alert variant="danger">操作失败，请检查权限或状态后重试。</Alert>
              )}
            </CardContent>
          </Card>

          {/* V2 评论区 */}
          <Card>
            <CardHeader>
              <CardTitle>评论</CardTitle>
            </CardHeader>
            <CardContent>
              <CommentThread
                projectId={projectId}
                entityType="change_request"
                entityId={changeRequestId}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
