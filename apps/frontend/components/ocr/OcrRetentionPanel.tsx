'use client'

import React, { useState } from 'react'
import {
  useOcrRetentionPolicy,
  useOcrRetentionStatus,
  useOcrAcceptedExtractionRetentionSummaries,
  useOcrRetentionHolds,
  useOcrCleanupPreview,
  useOcrCleanupExecute,
  useSetOcrRetentionHold,
  useReleaseOcrRetentionHold,
  useUpdateOcrRetentionPolicy,
} from '@/hooks/use-ocr-retention'
import type {
  OcrRetentionCategoryPolicy,
  OcrRetentionExpiryAction,
  OcrRetentionSensitivityCategory,
  OcrRetentionLifecycleState,
  OcrRetentionRecordKind,
  OcrRetentionHoldReasonCode,
  OcrCleanupPreviewResponse,
} from '@aiproj/types'
import {
  OCR_RETENTION_EXPIRY_ACTIONS,
  OCR_RETENTION_HOLD_REASON_CODES,
  OCR_RETENTION_HOLD_NOTE_MAX_LENGTH,
  OCR_RETENTION_SYSTEM_BOUNDS,
} from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge, type BadgeProps } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Textarea } from '@/components/ui/Textarea'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog'

interface OcrRetentionPanelProps {
  projectId: number
  readOnly?: boolean
}

// ── 生命周期状态 → 语义色映射 ──
// 值必须落在 Badge 的 variant 联合内：写成 Record<_, string> 会让下方
// <Badge variant={LIFECYCLE_COLORS[...]}> 拿到宽化的 string 而编译不过。
type BadgeVariant = NonNullable<BadgeProps['variant']>

const LIFECYCLE_COLORS: Record<OcrRetentionLifecycleState, BadgeVariant> = {
  active: 'info',
  reviewable: 'neutral',
  accepted: 'success',
  superseded: 'warning',
  expired: 'danger',
  purge_pending: 'danger',
  purged: 'outline',
  hold_blocked: 'warning',
}

const LIFECYCLE_LABELS: Record<OcrRetentionLifecycleState, string> = {
  active: '活跃',
  reviewable: '可审查',
  accepted: '已接受',
  superseded: '已替代',
  expired: '已过期',
  purge_pending: '待清理',
  purged: '已清理',
  hold_blocked: 'Hold 封锁',
}

const HOLD_REASON_LABELS: Record<OcrRetentionHoldReasonCode, string> = {
  review_in_progress: '审查进行中',
  dispute_resolution: '争议处理',
  audit_request: '审计要求',
  administrative: '管理原因',
  other: '其他',
}

const CATEGORY_LABELS: Record<OcrRetentionSensitivityCategory, string> = {
  job_metadata: '作业元数据',
  page_state: '页面状态',
  candidate_text: '候选正文',
  candidate_metadata: '候选元数据',
  accepted_extraction_text: '已接受提取正文',
  accepted_extraction_metadata: '已接受提取元数据',
  provider_summary: '服务商摘要',
  audit_metadata: '审计元数据',
  tombstone: '墓碑记录',
}

const EXPIRY_ACTION_LABELS: Record<OcrRetentionExpiryAction, string> = {
  expire: '标记过期',
  redact: '脱敏',
  purge: '清除',
}

/** 保留天数是否落在系统边界内（整数）。 */
export function isRetentionDaysInBounds(days: number): boolean {
  return (
    Number.isInteger(days) &&
    days >= OCR_RETENTION_SYSTEM_BOUNDS.minDays &&
    days <= OCR_RETENTION_SYSTEM_BOUNDS.maxDays
  )
}

const RECORD_KIND_LABELS: Record<OcrRetentionRecordKind, string> = {
  job: '作业',
  page: '页面',
  candidate: '候选',
  accepted_extraction: '已接受提取',
}

export default function OcrRetentionPanel({ projectId, readOnly = false }: OcrRetentionPanelProps) {
  const [showCleanupDialog, setShowCleanupDialog] = useState(false)
  const [cleanupPreview, setCleanupPreview] = useState<OcrCleanupPreviewResponse | null>(null)
  const [cleanupConfirmChecked, setCleanupConfirmChecked] = useState(false)
  const [showHoldDialog, setShowHoldDialog] = useState(false)
  const [holdNote, setHoldNote] = useState('')
  const [holdReason, setHoldReason] = useState<OcrRetentionHoldReasonCode>('review_in_progress')

  const { data: policy, isLoading: policyLoading } = useOcrRetentionPolicy(projectId)
  const { data: status, isLoading: statusLoading } = useOcrRetentionStatus(projectId)
  const { data: extractions } = useOcrAcceptedExtractionRetentionSummaries(projectId)
  const { data: holds } = useOcrRetentionHolds(projectId)

  const [showPolicyDialog, setShowPolicyDialog] = useState(false)
  const [policyDraft, setPolicyDraft] = useState<OcrRetentionCategoryPolicy[]>([])
  const updatePolicyMutation = useUpdateOcrRetentionPolicy(projectId)
  const previewMutation = useOcrCleanupPreview(projectId)
  const executeMutation = useOcrCleanupExecute(projectId)
  const setHoldMutation = useSetOcrRetentionHold(projectId)
  const releaseHoldMutation = useReleaseOcrRetentionHold(projectId)

  const isLoading = policyLoading || statusLoading

  if (isLoading) {
    return (
      <Card className="p-4 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </Card>
    )
  }

  const policyData = policy?.data
  const statusData = status?.data
  const allowedActions = statusData?.allowedActions ?? []

  const canView = allowedActions.includes('view_status')
  // readOnly 由外层容器传入（如只读嵌入场景），与后端 allowedActions 取交集：
  // 后端放行也要尊重容器的只读约束，避免面板在只读上下文里仍能触发写操作。
  const canManage =
    !readOnly &&
    (allowedActions.includes('update_policy') || allowedActions.includes('execute_cleanup'))
  const canHold = !readOnly && allowedActions.includes('set_hold')
  const canEditPolicy = !readOnly && allowedActions.includes('update_policy')
  const draftValid = policyDraft.every((c) => isRetentionDaysInBounds(c.retentionDays))

  const openPolicyEditor = () => {
    setPolicyDraft((policy?.data?.categories ?? []).map((c) => ({ ...c })))
    updatePolicyMutation.reset()
    setShowPolicyDialog(true)
  }

  const updateDraft = (
    category: OcrRetentionSensitivityCategory,
    patch: Partial<OcrRetentionCategoryPolicy>,
  ) => {
    setPolicyDraft((prev) => prev.map((c) => (c.category === category ? { ...c, ...patch } : c)))
  }

  const handleSavePolicy = async () => {
    if (!draftValid) return
    await updatePolicyMutation.mutateAsync({ categories: policyDraft })
    setShowPolicyDialog(false)
  }

  if (!canView) {
    return (
      <Alert variant="warning">
        <AlertDescription>无权查看 OCR 保留治理信息</AlertDescription>
      </Alert>
    )
  }

  const handlePreviewCleanup = async () => {
    const result = await previewMutation.mutateAsync({})
    setCleanupPreview(result.data)
    setShowCleanupDialog(true)
    setCleanupConfirmChecked(false)
  }

  const handleExecuteCleanup = async () => {
    if (!cleanupPreview) return
    const runKey = `run-${Date.now()}-${projectId}`
    await executeMutation.mutateAsync({
      previewHash: cleanupPreview.previewHash,
      runKey,
      confirm: true,
    })
    setShowCleanupDialog(false)
    setCleanupPreview(null)
  }

  const handleSetHold = async () => {
    await setHoldMutation.mutateAsync({
      scopeKind: 'project',
      scopeRef: `project:${projectId}`,
      reasonCode: holdReason,
      note: holdNote || null,
    })
    setShowHoldDialog(false)
    setHoldNote('')
    setHoldReason('review_in_progress')
  }

  return (
    <div className="space-y-4">
      {/* 保留状态摘要 */}
      <Card className="p-4">
        <h3 className="font-semibold text-lg mb-3">OCR 保留治理</h3>

        {statusData && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {Object.entries(statusData.counts).map(([state, count]) => (
              <div key={state} className="text-center">
                <Badge variant={LIFECYCLE_COLORS[state as OcrRetentionLifecycleState] ?? 'neutral'}>
                  {LIFECYCLE_LABELS[state as OcrRetentionLifecycleState] ?? state}
                </Badge>
                <p className="text-2xl font-bold mt-1">{count}</p>
              </div>
            ))}
          </div>
        )}

        {/* 即将过期警告 */}
        {statusData && statusData.expiringSoon > 0 && (
          <Alert variant="warning" className="mb-3">
            <AlertDescription>
              {statusData.expiringSoon} 条 OCR 记录将在 7 天内过期
            </AlertDescription>
          </Alert>
        )}

        {/* Hold 指示器 */}
        {statusData && statusData.holdActiveCount > 0 && (
          <Badge variant="warning" className="mb-3">
            活跃 Hold：{statusData.holdActiveCount}
          </Badge>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviewCleanup}
                disabled={previewMutation.isPending}
              >
                {previewMutation.isPending ? '预览中...' : '预览清理'}
              </Button>
              {cleanupPreview && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowCleanupDialog(true)}
                  disabled={executeMutation.isPending}
                >
                  查看清理结果
                </Button>
              )}
            </>
          )}
          {canHold && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHoldDialog(true)}
              disabled={setHoldMutation.isPending}
            >
              设置 Hold
            </Button>
          )}
        </div>
      </Card>

      {/* 保留策略信息 */}
      {policyData && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="font-medium">保留策略</h4>
            {canEditPolicy && (
              <Button variant="outline" size="sm" onClick={openPolicyEditor}>
                编辑策略
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-2">
            来源：
            {policyData.source === 'system'
              ? '系统默认'
              : policyData.source === 'organization'
                ? '组织'
                : '项目'}
          </p>
          <div className="text-xs text-muted-foreground space-y-1">
            {policyData.categories.slice(0, 5).map((cat) => (
              <div key={cat.category} className="flex justify-between">
                <span>{CATEGORY_LABELS[cat.category] ?? cat.category}</span>
                <span>
                  {cat.retentionDays} 天 →{' '}
                  {EXPIRY_ACTION_LABELS[cat.actionAfterExpiry] ?? cat.actionAfterExpiry}
                </span>
              </div>
            ))}
            {policyData.categories.length > 5 && (
              <p className="text-muted-foreground">
                ...还有 {policyData.categories.length - 5} 个分类
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Accepted Extraction 历史 */}
      {extractions?.data && extractions.data.length > 0 && (
        <Card className="p-4">
          <h4 className="font-medium mb-2">已接受提取保留摘要</h4>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {extractions.data.slice(0, 5).map((ext) => (
              <div
                key={ext.extractionId}
                className="flex items-center justify-between text-sm border-b pb-1"
              >
                <span className="font-mono text-xs">#{ext.extractionId}</span>
                <Badge variant={LIFECYCLE_COLORS[ext.lifecycleState] ?? 'neutral'}>
                  {LIFECYCLE_LABELS[ext.lifecycleState] ?? ext.lifecycleState}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {ext.status === 'current' ? '当前' : '已替代'}
                </span>
                {!ext.textAvailable && <Badge variant="danger">已脱敏</Badge>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Active Holds */}
      {holds?.data && holds.data.length > 0 && (
        <Card className="p-4">
          <h4 className="font-medium mb-2">活跃 Hold</h4>
          <div className="space-y-2">
            {holds.data
              .filter((h) => h.status === 'active')
              .map((hold) => (
                <div
                  key={hold.holdId}
                  className="flex items-center justify-between text-sm border-b pb-1"
                >
                  <div>
                    <span className="font-mono text-xs">#{hold.holdId}</span>
                    <span className="ml-2 text-muted-foreground">{hold.reasonCode}</span>
                    {hold.note && <span className="ml-2 text-xs">— {hold.note}</span>}
                  </div>
                  {canHold && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => releaseHoldMutation.mutateAsync({ holdId: hold.holdId })}
                      disabled={releaseHoldMutation.isPending}
                    >
                      释放
                    </Button>
                  )}
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* 保留策略编辑：分类 × 保留天数 × 到期动作，天数受系统边界约束 */}
      <Dialog open={showPolicyDialog} onOpenChange={setShowPolicyDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑保留策略</DialogTitle>
            <DialogDescription>
              保存后作为本项目覆盖策略生效。保留天数范围 {OCR_RETENTION_SYSTEM_BOUNDS.minDays}–
              {OCR_RETENTION_SYSTEM_BOUNDS.maxDays} 天；清理仍需预览并确认后才会执行。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2" data-testid="ocr-policy-editor">
            {policyDraft.map((cat) => {
              const invalid = !isRetentionDaysInBounds(cat.retentionDays)
              return (
                <div
                  key={cat.category}
                  className="grid grid-cols-[1fr_6rem_7rem] items-center gap-2"
                >
                  <span className="text-sm">{CATEGORY_LABELS[cat.category] ?? cat.category}</span>
                  <input
                    type="number"
                    aria-label={`${CATEGORY_LABELS[cat.category] ?? cat.category}保留天数`}
                    aria-invalid={invalid}
                    min={OCR_RETENTION_SYSTEM_BOUNDS.minDays}
                    max={OCR_RETENTION_SYSTEM_BOUNDS.maxDays}
                    className={`rounded-[var(--radius-sm)] border bg-transparent px-2 py-1 text-sm ${invalid ? 'border-red-500' : 'border-border'}`}
                    value={Number.isNaN(cat.retentionDays) ? '' : cat.retentionDays}
                    onChange={(e) =>
                      updateDraft(cat.category, { retentionDays: e.target.valueAsNumber })
                    }
                  />
                  <select
                    aria-label={`${CATEGORY_LABELS[cat.category] ?? cat.category}到期动作`}
                    className="rounded-[var(--radius-sm)] border border-border bg-transparent px-2 py-1 text-sm"
                    value={cat.actionAfterExpiry}
                    onChange={(e) =>
                      updateDraft(cat.category, {
                        actionAfterExpiry: e.target.value as OcrRetentionExpiryAction,
                      })
                    }
                  >
                    {OCR_RETENTION_EXPIRY_ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {EXPIRY_ACTION_LABELS[action]}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
            {!draftValid && (
              <p className="text-xs text-red-600">
                存在超出范围或非整数的保留天数，请修正后再保存。
              </p>
            )}
            {updatePolicyMutation.isError && (
              <Alert variant="danger">
                <AlertDescription>
                  保存失败：
                  {updatePolicyMutation.error instanceof Error
                    ? updatePolicyMutation.error.message
                    : '请稍后重试'}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPolicyDialog(false)}>
              取消
            </Button>
            <Button
              onClick={handleSavePolicy}
              disabled={!draftValid || updatePolicyMutation.isPending}
            >
              {updatePolicyMutation.isPending ? '保存中...' : '保存策略'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 设置 Hold 对话框：原因为枚举（低敏），备注有界 */}
      <Dialog open={showHoldDialog} onOpenChange={setShowHoldDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>设置保留 Hold</DialogTitle>
            <DialogDescription>
              Hold 生效期间，本项目的 OCR 记录不会被清理流程回收。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="hold-reason" className="text-sm font-medium">
                原因
              </label>
              <select
                id="hold-reason"
                className="w-full rounded-[var(--radius-sm)] border border-border bg-transparent px-2 py-1.5 text-sm"
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value as OcrRetentionHoldReasonCode)}
              >
                {OCR_RETENTION_HOLD_REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {HOLD_REASON_LABELS[code]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="hold-note" className="text-sm font-medium">
                备注（可选）
              </label>
              <Textarea
                id="hold-note"
                rows={3}
                maxLength={OCR_RETENTION_HOLD_NOTE_MAX_LENGTH}
                value={holdNote}
                onChange={(e) => setHoldNote(e.target.value)}
                placeholder="补充说明，勿填写 OCR 正文内容"
              />
              <p className="text-xs text-muted-foreground">
                {holdNote.length}/{OCR_RETENTION_HOLD_NOTE_MAX_LENGTH}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHoldDialog(false)}>
              取消
            </Button>
            <Button onClick={handleSetHold} disabled={setHoldMutation.isPending}>
              {setHoldMutation.isPending ? '提交中...' : '确认设置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cleanup Preview Dialog */}
      <Dialog open={showCleanupDialog} onOpenChange={setShowCleanupDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>清理预览</DialogTitle>
            <DialogDescription>
              以下 OCR 记录符合清理条件。清理操作不可逆，请确认。
            </DialogDescription>
          </DialogHeader>

          {cleanupPreview && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span>符合条件：{cleanupPreview.eligible.length}</span>
                <span>被阻止：{cleanupPreview.blocked.length}</span>
                <span>计划 Tombstone：{cleanupPreview.plannedTombstones}</span>
              </div>

              {cleanupPreview.eligible.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium">可清理记录</p>
                  {cleanupPreview.eligible.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm border-b pb-1">
                      <Badge variant="neutral">
                        {RECORD_KIND_LABELS[item.recordKind] ?? item.recordKind}
                      </Badge>
                      <span className="font-mono text-xs">#{item.recordId}</span>
                      <Badge variant="info">{item.plannedAction}</Badge>
                    </div>
                  ))}
                </div>
              )}

              {cleanupPreview.blocked.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium text-muted-foreground">被阻止的记录</p>
                  {cleanupPreview.blocked.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm border-b pb-1 text-muted-foreground"
                    >
                      <Badge variant="outline">
                        {RECORD_KIND_LABELS[item.recordKind] ?? item.recordKind}
                      </Badge>
                      <span className="font-mono text-xs">#{item.recordId}</span>
                      <span className="text-xs">{item.blockedReason}</span>
                    </div>
                  ))}
                </div>
              )}

              {cleanupPreview.truncated && (
                <Alert variant="warning">
                  <AlertDescription>结果已截断。请缩小筛选条件。</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center gap-2 mt-4">
                <Checkbox
                  id="cleanup-confirm"
                  checked={cleanupConfirmChecked}
                  onCheckedChange={(checked) => setCleanupConfirmChecked(!!checked)}
                />
                <label htmlFor="cleanup-confirm" className="text-sm">
                  我确认要执行清理操作（不可逆）
                </label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCleanupDialog(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={handleExecuteCleanup}
              disabled={!cleanupConfirmChecked || executeMutation.isPending}
            >
              {executeMutation.isPending ? '执行中...' : '确认清理'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
