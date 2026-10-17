'use client'

import * as React from 'react'
import {
  FileText,
  Calendar,
  User,
  FolderGit2,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet'
import type { ChangeImpactAnalysis, ChangeRequest } from '@/lib/api/change-requests'
import {
  CR_PRIORITY_LABELS,
  CR_PRIORITY_TONES,
  CR_STATUS_LABELS,
  CR_STATUS_TONES,
  CR_TYPE_LABELS,
  formatCrDate,
} from '@/components/next/change-requests/cr-meta'
import { PmoChangeImpactPenetrationPanel } from './PmoChangeImpactPenetrationPanel'
import { PmoChangeRbacGuard } from './PmoChangeRbacGuard'
import { PmoChangeDecisionDialog } from './PmoChangeDecisionDialog'
import type { PmoDecisionActionType } from './PmoChangeDecisionReasonForm'
import { cn } from '@/lib/utils'

export interface PmoChangeApprovalDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  changeRequest?: (ChangeRequest & { projectName?: string; projectKey?: string }) | null
  cr?: (ChangeRequest & { projectName?: string; projectKey?: string }) | null
  projectId?: number
  impactAnalysis?: ChangeImpactAnalysis | null
  onSuccess?: () => void
}

/**
 * PMO 变更审查与审批决策抽屉组件（W4 · tasks 4.1 / design Decision 3）。
 *
 * 核心特性：
 * 1. 暗黑仪器风侧滑面板（max-w-2xl）；
 * 2. 展示变更基础元数据、详细描述与动因说明；
 * 3. 六维影响分析快照（范围/进度/资源/成本/风险/假设）与柱状指标展示；
 * 4. 分析快照过期（isStale）时的琥珀色警告标记；
 * 5. 决策理由文本域与附加条件输入；
 * 6. RBAC 权限精准守卫（change_request:approve），无权物理隐藏写按钮；
 * 7. 唤起 PmoChangeDecisionDialog 两阶段人工二次确认弹窗（RL-01）。
 */
export function PmoChangeApprovalDrawer({
  open,
  onOpenChange,
  changeRequest,
  cr,
  impactAnalysis,
  onSuccess,
}: PmoChangeApprovalDrawerProps) {
  const targetCr = changeRequest ?? cr ?? null

  const [decisionReason, setDecisionReason] = React.useState('')
  const [conditions, setConditions] = React.useState('')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogAction, setDialogAction] = React.useState<PmoDecisionActionType>('approve')

  // 重置表单状态
  React.useEffect(() => {
    if (open) {
      setDecisionReason('')
      setConditions('')
      setDialogOpen(false)
    }
  }, [open, targetCr?.id])

  const openDecisionModal = (action: PmoDecisionActionType) => {
    setDialogAction(action)
    setDialogOpen(true)
  }

  const handleDecisionSuccess = () => {
    onSuccess?.()
    onOpenChange(false)
  }

  const statusTone = targetCr ? (CR_STATUS_TONES[targetCr.status] ?? 'neutral') : 'neutral'
  const priorityTone = targetCr ? (CR_PRIORITY_TONES[targetCr.priority] ?? 'neutral') : 'neutral'

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          data-testid="pmo-change-approval-drawer"
          data-pmo-approval-drawer="true"
          className="w-full sm:max-w-2xl overflow-y-auto border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6 text-[var(--nx-text-primary)]"
        >
          {targetCr ? (
            <div className="flex flex-col gap-5">
              {/* 头部元数据 */}
              <SheetHeader className="gap-2 border-b border-[var(--nx-border-hairline)] pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-testid="drawer-cr-code"
                    className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[var(--nx-bg-1)] border border-[var(--nx-border-hairline)] text-[var(--nx-text-primary)]"
                  >
                    {targetCr.crCode}
                  </span>
                  <span
                    data-testid="drawer-status-badge"
                    className={cn(
                      'text-[11px] px-2 py-0.5 rounded-full font-medium',
                      statusTone === 'success'
                        ? 'bg-[rgba(34,197,94,0.12)] text-[var(--nx-status-success)]'
                        : statusTone === 'danger'
                          ? 'bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)]'
                          : statusTone === 'warning'
                            ? 'bg-[rgba(245,158,11,0.12)] text-[var(--nx-status-warning)]'
                            : 'bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]',
                    )}
                  >
                    {CR_STATUS_LABELS[targetCr.status] ?? targetCr.status}
                  </span>
                  <span
                    data-testid="drawer-priority-badge"
                    className={cn(
                      'text-[11px] px-2 py-0.5 rounded font-mono',
                      priorityTone === 'danger'
                        ? 'border border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]'
                        : priorityTone === 'warning'
                          ? 'border border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]'
                          : 'border border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
                    )}
                  >
                    优先级：{CR_PRIORITY_LABELS[targetCr.priority] ?? targetCr.priority}
                  </span>
                </div>

                <SheetTitle
                  data-testid="drawer-change-title"
                  className="text-base font-semibold leading-normal text-[var(--nx-text-primary)]"
                >
                  {targetCr.title}
                </SheetTitle>
                <SheetDescription className="text-xs text-[var(--nx-text-muted)]">
                  审查跨项目变更详情、核对六维穿透影响快照，并在两阶段人工确认下完成受控审批。
                </SheetDescription>
              </SheetHeader>

              {/* 基础元数据网格 */}
              <div
                data-testid="drawer-metadata-grid"
                className="grid grid-cols-2 gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 text-xs sm:grid-cols-4"
              >
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1 text-[var(--nx-text-muted)]">
                    <FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />
                    所属项目
                  </span>
                  <span
                    data-testid="drawer-project"
                    className="font-medium text-[var(--nx-text-primary)] truncate"
                  >
                    {targetCr.projectName || targetCr.projectKey || `项目 #${targetCr.projectId}`}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1 text-[var(--nx-text-muted)]">
                    <User className="h-3.5 w-3.5" aria-hidden="true" />
                    申请人
                  </span>
                  <span
                    data-testid="drawer-requester"
                    className="font-medium text-[var(--nx-text-primary)]"
                  >
                    {targetCr.requestedBy || targetCr.requesterId
                      ? `申请人 #${targetCr.requestedBy || targetCr.requesterId}`
                      : '系统申请'}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1 text-[var(--nx-text-muted)]">
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    变更类型
                  </span>
                  <span
                    data-testid="drawer-type"
                    className="font-medium text-[var(--nx-text-primary)]"
                  >
                    {CR_TYPE_LABELS[targetCr.changeType] ?? targetCr.changeType}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1 text-[var(--nx-text-muted)]">
                    <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                    提交时间
                  </span>
                  <span
                    data-testid="drawer-submitted-at"
                    className="font-mono text-[var(--nx-text-primary)]"
                  >
                    {formatCrDate(targetCr.submittedAt || targetCr.createdAt)}
                  </span>
                </div>
              </div>

              {/* 详细描述 */}
              <div
                data-testid="drawer-description-section"
                className="flex flex-col gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 text-xs"
              >
                <span className="font-medium text-[var(--nx-text-secondary)]">
                  变更叙述与动因说明
                </span>
                <p
                  data-testid="drawer-description"
                  className="whitespace-pre-wrap leading-relaxed text-[var(--nx-text-primary)]"
                >
                  {targetCr.description?.trim() || '未提供详细叙述。'}
                </p>
              </div>

              {/* 六维影响分析快照面板 */}
              <PmoChangeImpactPenetrationPanel
                impactSummary={targetCr.impactSummary}
                impactAnalysis={impactAnalysis}
                isStale={impactAnalysis?.isStale}
                staleReason={impactAnalysis?.staleReason}
              />

              {/* 决策理由与附加条件录入区 */}
              <div className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 text-xs">
                <span className="font-medium text-[var(--nx-text-secondary)]">决策预录入</span>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="drawer-conditions-input"
                    className="text-[11px] text-[var(--nx-text-muted)]"
                  >
                    附加生效条件（选填）
                  </label>
                  <input
                    id="drawer-conditions-input"
                    type="text"
                    data-testid="drawer-conditions"
                    value={conditions}
                    onChange={(e) => setConditions(e.target.value)}
                    placeholder="输入批准生效的附加约束条件…"
                    className="h-8 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="drawer-reason-input"
                    className="text-[11px] text-[var(--nx-text-muted)]"
                  >
                    决策说明 / 审核意见
                  </label>
                  <textarea
                    id="drawer-reason-input"
                    rows={2}
                    data-testid="drawer-decision-reason"
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    placeholder="预先录入审批说明或驳回意见（驳回/退回需至少 5 个字符）…"
                    className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none resize-y"
                  />
                </div>
              </div>

              {/* 操作区与 RBAC 守卫 */}
              <div className="border-t border-[var(--nx-border-hairline)] pt-3">
                <PmoChangeRbacGuard>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      data-testid="btn-return"
                      onClick={() => openDecisionModal('return')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] px-3 text-xs font-medium text-[var(--nx-status-warning)] transition-colors hover:bg-[rgba(245,158,11,0.16)]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      退回修改
                    </button>
                    <button
                      type="button"
                      data-testid="btn-reject"
                      onClick={() => openDecisionModal('reject')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.08)] px-3 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[rgba(239,68,68,0.16)]"
                    >
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      驳回变更
                    </button>
                    <button
                      type="button"
                      data-testid="btn-approve"
                      onClick={() => openDecisionModal('approve')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--nx-status-success)] px-3.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      批准变更
                    </button>
                  </div>
                </PmoChangeRbacGuard>
              </div>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-[var(--nx-text-muted)]">
              暂无选中的变更请求
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* 二次确认弹窗 */}
      <PmoChangeDecisionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        changeRequest={targetCr}
        action={dialogAction}
        initialReason={decisionReason}
        initialConditions={conditions}
        impactAnalysis={impactAnalysis}
        onSuccess={handleDecisionSuccess}
      />
    </>
  )
}
