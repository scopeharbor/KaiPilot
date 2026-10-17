'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.2/9.3 —— 目录受控动作统一确认对话框。
 *
 * approve / disable / restore / rollback 四个目录管理动作的确认闭环（语义与旧轨
 * DirectoryActionDialog 同源，RL-06 三红线原样保留）：
 * 1. **目录条目 ≠ 安装实例**：本对话框显式区分「本次改目录条目」与「组织内已安装
 *    实例保持不变」；禁用/回滚只影响目录可发现性/推荐指针，绝不自动停用实例；
 * 2. **提交 ≠ 生效**：创建后停在「已提交，等待审批」——不自动串联审批与确认；
 *    审批完成只是可确认，最终确认按钮独立且需要一次性句柄；
 * 3. **阻断项存在即不可提交**：回滚预览列出 blocking findings 时提交按钮禁用，
 *    并逐条说明（与后端同源判定，前端只复述）。
 *
 * 权限门：动作入口（批准/停止分发/恢复送审/回滚）按 plugin_registry:review|manage|
 * rollback 由父级渲染（无权限不渲染、不以 disabled 暗示）；本对话框内的「审批」步骤
 * 按 plugin_change_request:approve、「确认凭据」步骤按 plugin_change_request:manage
 * 显隐——后端仍为最终安全边界。
 */
import * as React from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import {
  useConfirmDirectoryChange,
  useCreateDirectoryChange,
  useDirectoryRollbackPreview,
} from '@/hooks/use-plugin-directory'
import { approvePluginChangeRequest, issueConfirmHandle } from '@/lib/api/plugin-change-requests'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { usePermissions } from '@/hooks/use-permissions'
import type { DirectoryChangeAction, DirectoryReleaseStatus } from '@/lib/api/plugin-directory'
import {
  DIRECTORY_ACTION_DESCRIPTIONS,
  DIRECTORY_ACTION_SUBMIT_LABELS,
  DIRECTORY_ACTION_TITLES,
  directoryReleaseStatusMetaOf,
  directoryRollbackBlockingLabel,
} from '@/lib/next/org-plugin/org-plugin-adapter'

const chipClass =
  'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] leading-none'

export interface PluginReleaseActionDialogProps {
  action: DirectoryChangeAction
  releaseId: string
  pluginIdentity: string
  version: string
  status: DirectoryReleaseStatus
  onClose: () => void
}

type Phase = 'compose' | 'submitted' | 'applied'

function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-[var(--nx-text-muted)]">{label}</span>
      <span className="font-mono">
        <span className="text-[var(--nx-text-muted)] line-through">{before}</span>
        <span className="mx-1.5 text-[var(--nx-text-muted)]">→</span>
        <span className="text-[var(--nx-text-primary)]">{after}</span>
      </span>
    </div>
  )
}

function shortDigest(value: string | null): string {
  if (!value) return '—'
  return value.length > 14 ? `${value.slice(0, 14)}…` : value
}

export function PluginReleaseActionDialog({
  action,
  releaseId,
  pluginIdentity,
  version,
  status,
  onClose,
}: PluginReleaseActionDialogProps) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const { can } = usePermissions()
  const [phase, setPhase] = React.useState<Phase>('compose')
  const [requestUid, setRequestUid] = React.useState<string | null>(null)
  const [approvalRequired, setApprovalRequired] = React.useState(true)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [handleIssued, setHandleIssued] = React.useState<string | null>(null)
  const [approving, setApproving] = React.useState(false)
  const [issuing, setIssuing] = React.useState(false)

  const statusMeta = directoryReleaseStatusMetaOf(status)
  const canApproveChange = can('plugin_change_request:approve')
  const canManageChange = can('plugin_change_request:manage')

  const createChange = useCreateDirectoryChange()
  const confirmChange = useConfirmDirectoryChange()
  const rollbackPreview = useDirectoryRollbackPreview(releaseId, action === 'rollback')

  const blockingFindings = React.useMemo(
    () => (action === 'rollback' ? (rollbackPreview.data?.blockingFindings ?? []) : []),
    [action, rollbackPreview.data],
  )
  const previewFailed = action === 'rollback' && Boolean(rollbackPreview.error)
  const previewLoading = action === 'rollback' && rollbackPreview.isLoading
  const submitDisabled =
    createChange.isPending || blockingFindings.length > 0 || previewFailed || previewLoading
  const dialogRef = React.useRef<HTMLDivElement | null>(null)

  // 弹窗由父级条件渲染（挂载即打开）；在途写请求期间与遮罩层 /「取消」按钮同判据：
  // Escape 不关闭。
  useDialogA11y({
    ref: dialogRef,
    open: true,
    onClose: resetAndClose,
    canClose: () => !(createChange.isPending || approving || issuing),
  })

  function resetAndClose() {
    setPhase('compose')
    setRequestUid(null)
    setErrorMessage(null)
    setHandleIssued(null)
    setApproving(false)
    setIssuing(false)
    onClose()
  }

  function describeError(error: unknown): string {
    const code = (error as { code?: string })?.code
    if (code === 'plugin-change-self-approval-denied') {
      return '不能审批自己发起的申请，请由另一位管理员审批。'
    }
    if (code === 'plugin-change-stale') {
      return '目录条目在此期间发生变化，请关闭后重新发起。'
    }
    if (code === 'plugin-change-already-decided') {
      return '该申请已处理完毕，无需重复确认。'
    }
    return (error as { message?: string })?.message ?? '操作失败，请稍后重试。'
  }

  async function handleSubmit() {
    if (organizationId === null) return
    setErrorMessage(null)
    try {
      const created = await createChange.mutateAsync({ releaseId, action })
      setRequestUid(created.data.requestUid)
      setApprovalRequired(created.data.approvalRequired)
      setPhase('submitted')
    } catch (error) {
      setErrorMessage(describeError(error))
    }
  }

  /** 审批（maker-checker）：由**另一位**有审批权（plugin_change_request:approve）的管理员点击。 */
  async function handleApprove() {
    if (!requestUid || organizationId === null) return
    setErrorMessage(null)
    setApproving(true)
    try {
      await approvePluginChangeRequest(organizationId, requestUid, `approve:${requestUid}`)
      const issued = await issueConfirmHandle(organizationId, requestUid)
      setHandleIssued(issued.data.handle)
    } catch (error) {
      setErrorMessage(describeError(error))
    } finally {
      setApproving(false)
    }
  }

  /** 非审批必需时直接签发一次性确认凭据（plugin_change_request:manage）。 */
  async function handleIssueHandle() {
    if (!requestUid || organizationId === null) return
    setErrorMessage(null)
    setIssuing(true)
    try {
      const issued = await issueConfirmHandle(organizationId, requestUid)
      setHandleIssued(issued.data.handle)
    } catch (error) {
      setErrorMessage(describeError(error))
    } finally {
      setIssuing(false)
    }
  }

  async function handleConfirm() {
    if (!requestUid || !handleIssued || organizationId === null) return
    setErrorMessage(null)
    try {
      await confirmChange.mutateAsync({ requestUid, handle: handleIssued })
      setPhase('applied')
    } catch (error) {
      setErrorMessage(describeError(error))
    }
  }

  return (
    <div data-plugin-action-dialog className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="关闭确认弹窗"
        tabIndex={-1}
        onClick={createChange.isPending || approving || issuing ? undefined : resetAndClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={DIRECTORY_ACTION_TITLES[action]}
        className="absolute left-1/2 top-1/2 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center gap-2.5 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <ShieldAlert className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
            {DIRECTORY_ACTION_TITLES[action]}
          </h3>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[12px] leading-relaxed text-[var(--nx-text-secondary)]">
            {DIRECTORY_ACTION_DESCRIPTIONS[action]}
          </p>

          {/* 目录条目（本次动作的对象） */}
          <section
            aria-label="目录条目（本次动作的对象）"
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
          >
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
              目录条目（本次动作的对象）
            </h4>
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {statusMeta ? (
                  <span
                    data-plugin-action-target-status={status}
                    className={cn(chipClass, statusMeta.chipClass)}
                  >
                    {statusMeta.label}
                  </span>
                ) : null}
                <span className="truncate font-mono text-[13px] text-[var(--nx-text-primary)]">
                  {pluginIdentity}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[13px] text-[var(--nx-text-secondary)]">
                v{version}
              </span>
            </div>
          </section>

          {/* 回滚差异（纯读预览） */}
          {action === 'rollback' ? (
            previewLoading ? (
              <div
                aria-busy="true"
                className="space-y-1.5 rounded-sm border border-[var(--nx-border-hairline)] p-3"
              >
                <div className="h-3 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
                <div className="h-3 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
                <div className="h-3 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" aria-hidden />
              </div>
            ) : previewFailed || !rollbackPreview.data ? (
              <p
                role="alert"
                data-plugin-rollback-preview-failed
                className="rounded-sm border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[11px] text-[var(--nx-status-danger)]"
              >
                无法为该目标版本生成回滚预览，请返回目录重新选择。
              </p>
            ) : (
              <section
                aria-label="回滚差异"
                className="space-y-1.5 rounded-sm border border-[var(--nx-border-hairline)] p-3"
              >
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
                  回滚差异（当前 → 目标）
                </h4>
                <DiffRow
                  label="推荐版本"
                  before={`v${rollbackPreview.data.currentVersion}`}
                  after={`v${rollbackPreview.data.targetVersion}`}
                />
                <DiffRow
                  label="清单摘要"
                  before={shortDigest(rollbackPreview.data.manifestDigestBefore)}
                  after={shortDigest(rollbackPreview.data.manifestDigestAfter)}
                />
                <DiffRow
                  label="制品摘要"
                  before={shortDigest(rollbackPreview.data.packageDigestBefore)}
                  after={shortDigest(rollbackPreview.data.packageDigestAfter)}
                />
                <DiffRow
                  label="兼容性摘要"
                  before={shortDigest(rollbackPreview.data.compatibilityDigestBefore)}
                  after={shortDigest(rollbackPreview.data.compatibilityDigestAfter)}
                />
                <div className="pt-1 text-[11px]">
                  <span className="text-[var(--nx-text-muted)]">权限差异</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {rollbackPreview.data.permissionDelta.added.length === 0 &&
                    rollbackPreview.data.permissionDelta.removed.length === 0 ? (
                      <span className="text-[var(--nx-text-muted)]">无净变化</span>
                    ) : (
                      <>
                        {rollbackPreview.data.permissionDelta.added.map((key) => (
                          <span
                            key={`add-${key}`}
                            className={cn(
                              chipClass,
                              'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]',
                            )}
                          >
                            新增 {key}
                          </span>
                        ))}
                        {rollbackPreview.data.permissionDelta.removed.map((key) => (
                          <span
                            key={`del-${key}`}
                            className={cn(
                              chipClass,
                              'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
                            )}
                          >
                            移除 {key}
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </section>
            )
          ) : null}

          {/* 阻断项（存在即不可提交，只复述后端判定） */}
          {blockingFindings.length > 0 ? (
            <div
              role="alert"
              data-plugin-rollback-blocking
              className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.08)] px-3 py-2.5"
            >
              <p className="mb-1 text-[11px] font-semibold text-[var(--nx-status-danger)]">
                存在阻断项，无法提交回滚：
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-[11px] text-[var(--nx-status-danger)]">
                {blockingFindings.map((code) => (
                  <li key={code}>{directoryRollbackBlockingLabel(code)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 已提交阶段提示 */}
          {phase === 'submitted' ? (
            <div
              role="status"
              data-plugin-action-status
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
            >
              <p className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                申请已提交（{requestUid}），
                <strong className="text-[var(--nx-text-primary)]">尚未生效</strong>。
                {approvalRequired
                  ? '需由另一位管理员审批，再由持有管理权限者完成最终确认后才会改动目录。'
                  : '需由持有管理权限者完成最终确认后才会改动目录。'}
              </p>
              {handleIssued ? (
                <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
                  已签发一次性确认凭据，仅可使用一次；离开本页需重新发起。
                </p>
              ) : null}
            </div>
          ) : null}

          {phase === 'applied' ? (
            <div
              role="status"
              data-plugin-action-applied
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
            >
              <p className="text-[11px] text-[var(--nx-text-secondary)]">
                已生效。目录条目已更新；已安装实例未发生任何改动。
              </p>
            </div>
          ) : null}

          {errorMessage ? (
            <p
              role="alert"
              aria-label="目录动作失败"
              data-plugin-action-error
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            data-plugin-action-cancel
            onClick={resetAndClose}
            disabled={createChange.isPending || approving || issuing}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            {phase === 'applied' ? '关闭' : '取消'}
          </button>

          {phase === 'compose' ? (
            <button
              type="button"
              data-plugin-action-submit
              disabled={submitDisabled}
              onClick={() => void handleSubmit()}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md border px-4 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                action === 'disable' || action === 'rollback'
                  ? 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)] hover:border-[var(--nx-status-danger)]'
                  : 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]',
              )}
            >
              {createChange.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : null}
              {createChange.isPending ? '提交中…' : DIRECTORY_ACTION_SUBMIT_LABELS[action]}
            </button>
          ) : null}

          {phase === 'submitted' && !handleIssued && approvalRequired && canApproveChange ? (
            <button
              type="button"
              data-plugin-action-approve
              disabled={approving}
              onClick={() => void handleApprove()}
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
            >
              {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {approving ? '审批中…' : '由另一位管理员审批'}
            </button>
          ) : null}

          {phase === 'submitted' && !handleIssued && !approvalRequired && canManageChange ? (
            <button
              type="button"
              data-plugin-action-issue-handle
              disabled={issuing}
              onClick={() => void handleIssueHandle()}
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
            >
              {issuing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {issuing ? '签发中…' : '获取一次性确认凭据'}
            </button>
          ) : null}

          {phase === 'submitted' && !handleIssued && approvalRequired && !canApproveChange ? (
            <span className="text-[11px] text-[var(--nx-text-muted)]">
              需由另一位具备审批权限的管理员完成审批与确认
            </span>
          ) : null}

          {phase === 'submitted' && handleIssued ? (
            <button
              type="button"
              data-plugin-action-confirm
              disabled={confirmChange.isPending}
              onClick={() => void handleConfirm()}
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
            >
              {confirmChange.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : null}
              {confirmChange.isPending ? '确认中…' : '最终确认并生效'}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  )
}

export default PluginReleaseActionDialog
