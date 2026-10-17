'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Crown, Loader2, ShieldAlert, Trash2, X } from 'lucide-react'
import { organizationsApi, type Organization, type OrganizationMember } from '@/lib/api-client'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import { ORGANIZATIONS_QUERY_ROOT, orgApiErrorMessage, orgProfileKey } from './OrgProfileForm'

/**
 * 组织危险操作区（v3-ui-next-settings-admin-domains W2 · tasks 2.1，
 * spec「组织设置与成员治理」段 3 / design「敏感写操作二次确认与审计矩阵」）。
 *
 * - 转交所有权：`org:manage` 可见，阻断式弹窗明示「转交后当前所有者自动变为管理员」，
 *   确认后走既有显式端点 `POST /organizations/:id/transfer-owner`
 *   （后端 `organizations_controller.transfer` 仍以「仅组织所有者可转交」为最终边界，
 *   前端只做可见性与确认，不绕过任何服务端校验 —— RL-11）；
 * - 删除组织：**仅** `system:admin` 可见（后端路由门同样是 system:admin），
 *   要求输入组织名称逐字确认 + 不可恢复警示，成功后失效组织缓存并跳转角色首页；
 * - 两个动作失败一律回显服务端 `ApiError.message` 原文（orgApiErrorMessage），
 *   弹窗保持打开允许修正重试，禁止静默失败。
 */

export interface OrgDangerZoneProps {
  organization: Organization
  /** 组织成员底册（转让目标候选；未就绪时转交入口禁用）。 */
  members: OrganizationMember[]
  className?: string
}

type DialogKind = 'transfer' | 'delete' | null

export function OrgDangerZone({ organization, members, className }: OrgDangerZoneProps) {
  const { can } = usePermissions()
  const router = useRouter()
  const queryClient = useQueryClient()

  const canTransfer = can('org:manage')
  const canDelete = can('system:admin')

  const [dialog, setDialog] = React.useState<DialogKind>(null)
  const [transferTarget, setTransferTarget] = React.useState('')
  const [transferError, setTransferError] = React.useState<string | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = React.useState('')
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const candidates = React.useMemo(
    () => members.filter((member) => member.role !== 'owner'),
    [members],
  )

  const closeDialog = () => {
    if (transfer.isPending || remove.isPending) return
    setDialog(null)
    setTransferTarget('')
    setTransferError(null)
    setDeleteConfirmName('')
    setDeleteError(null)
  }

  const refreshMembers = () => {
    void queryClient.invalidateQueries({ queryKey: [...orgProfileKey(organization.id), 'members'] })
    void queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_QUERY_ROOT })
  }

  const transfer = useMutation({
    mutationFn: (memberId: number) => organizationsApi.transferOwner(organization.id, memberId),
    onSuccess: (result) => {
      setDialog(null)
      setTransferTarget('')
      setTransferError(null)
      queryClient.setQueryData(orgProfileKey(organization.id), result.organization)
      refreshMembers()
    },
    onError: (error) => {
      setTransferError(orgApiErrorMessage(error, '转交组织所有权失败，请稍后重试'))
    },
  })

  const remove = useMutation({
    mutationFn: () => organizationsApi.delete(organization.id),
    onSuccess: () => {
      setDialog(null)
      setDeleteError(null)
      void queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_QUERY_ROOT })
      router.push('/next')
    },
    onError: (error) => {
      setDeleteError(orgApiErrorMessage(error, '删除组织失败，请稍后重试'))
    },
  })

  if (!canTransfer && !canDelete) return null

  const deleteNameMatches = deleteConfirmName.trim() === organization.name

  return (
    <section
      data-org-danger-zone
      className={cn(
        'rounded-lg border border-[rgba(239,68,68,0.35)] bg-[var(--nx-bg-1)] p-4',
        className,
      )}
    >
      <header className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-[var(--nx-status-danger)]" aria-hidden />
        <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">危险操作</h2>
      </header>
      <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
        以下操作影响整个组织，不可撤销，请谨慎执行。
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {canTransfer ? (
          <div
            data-org-danger-transfer
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--nx-text-primary)]">转交组织所有权</p>
              <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                转交后，当前所有者将自动变为管理员，新所有者获得组织最高权限。
              </p>
            </div>
            <button
              type="button"
              data-org-danger-transfer-open
              disabled={candidates.length === 0}
              onClick={() => setDialog('transfer')}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-status-warning)] px-3 text-xs text-[var(--nx-status-warning)] transition-colors hover:bg-[rgba(245,158,11,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Crown className="h-3.5 w-3.5" aria-hidden />
              转交所有权
            </button>
          </div>
        ) : null}

        {canDelete ? (
          <div
            data-org-danger-delete
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--nx-text-primary)]">删除组织</p>
              <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                删除后组织及其全部数据不可恢复，需输入组织名称二次确认。
              </p>
            </div>
            <button
              type="button"
              data-org-danger-delete-open
              onClick={() => setDialog('delete')}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] px-3 text-xs text-[var(--nx-status-danger)] transition-colors hover:bg-[rgba(239,68,68,0.1)]"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              删除组织
            </button>
          </div>
        ) : null}
      </div>

      {dialog === 'transfer' ? (
        <ConfirmShell
          testId="org-danger-transfer-dialog"
          title="转交组织所有权"
          onCancel={closeDialog}
          pending={transfer.isPending}
        >
          <p className="text-[13px] leading-relaxed text-[var(--nx-text-secondary)]">
            新所有者将获得组织最高权限，当前所有者会自动变为管理员。该动作立即生效，
            双方令牌角色版本随之刷新。
          </p>
          <label className="mt-3 block text-[11px] font-medium text-[var(--nx-text-secondary)]">
            新所有者
          </label>
          <select
            data-org-danger-transfer-target
            value={transferTarget}
            disabled={transfer.isPending}
            onChange={(event) => {
              setTransferTarget(event.target.value)
              setTransferError(null)
            }}
            className="mt-1.5 h-9 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-50"
          >
            <option value="">请选择组织成员</option>
            {candidates.map((member) => (
              <option key={member.id} value={String(member.id)}>
                {member.user?.fullName || member.user?.email || `成员 #${member.userId}`}
              </option>
            ))}
          </select>
          {transferError ? (
            <p
              data-org-danger-transfer-error
              role="alert"
              className="mt-2 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {transferError}
            </p>
          ) : null}
          <DialogActions
            pending={transfer.isPending}
            confirmLabel="确认转交"
            confirmTestId="org-danger-transfer-confirm"
            disabled={transferTarget === ''}
            onCancel={closeDialog}
            onConfirm={() => {
              if (transferTarget === '') return
              setTransferError(null)
              transfer.mutate(Number(transferTarget))
            }}
          />
        </ConfirmShell>
      ) : null}

      {dialog === 'delete' ? (
        <ConfirmShell
          testId="org-danger-delete-dialog"
          title="确认删除组织"
          onCancel={closeDialog}
          pending={remove.isPending}
        >
          <p className="flex items-start gap-2 text-[13px] leading-relaxed text-[var(--nx-status-danger)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              将永久删除「{organization.name}」及其全部数据，此操作不可撤销。 请输入组织名称以确认。
            </span>
          </p>
          <label className="mt-3 block text-[11px] font-medium text-[var(--nx-text-secondary)]">
            组织名称
          </label>
          <input
            data-org-danger-delete-confirm-input
            value={deleteConfirmName}
            disabled={remove.isPending}
            placeholder={organization.name}
            onChange={(event) => {
              setDeleteConfirmName(event.target.value)
              setDeleteError(null)
            }}
            className="mt-1.5 h-9 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-status-danger)] focus:outline-none disabled:opacity-50"
          />
          {deleteError ? (
            <p
              data-org-danger-delete-error
              role="alert"
              className="mt-2 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {deleteError}
            </p>
          ) : null}
          <DialogActions
            pending={remove.isPending}
            confirmLabel="永久删除组织"
            confirmTestId="org-danger-delete-confirm"
            disabled={!deleteNameMatches}
            onCancel={closeDialog}
            onConfirm={() => {
              if (!deleteNameMatches) return
              setDeleteError(null)
              remove.mutate()
            }}
          />
        </ConfirmShell>
      ) : null}
    </section>
  )
}

/** 阻断式弹窗外壳（遮罩 + 居中面板 + Esc 取消）。 */
function ConfirmShell({
  testId,
  title,
  pending,
  onCancel,
  children,
}: {
  testId: string
  title: string
  pending: boolean
  onCancel: () => void
  children: React.ReactNode
}) {
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div data-org-confirm-overlay className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="关闭确认弹窗"
        tabIndex={-1}
        disabled={pending}
        onClick={onCancel}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60 disabled:cursor-not-allowed"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={pending}
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function DialogActions({
  pending,
  disabled,
  confirmLabel,
  confirmTestId,
  onCancel,
  onConfirm,
}: {
  pending: boolean
  disabled: boolean
  confirmLabel: string
  confirmTestId: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <footer className="mt-4 flex items-center justify-end gap-2">
      <button
        type="button"
        data-org-confirm-cancel
        disabled={pending}
        onClick={onCancel}
        className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
      >
        取消
      </button>
      <button
        type="button"
        data-testid={confirmTestId}
        disabled={pending || disabled}
        onClick={onConfirm}
        className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.12)] px-4 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[rgba(239,68,68,0.2)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        )}
        {confirmLabel}
      </button>
    </footer>
  )
}

export default OrgDangerZone
