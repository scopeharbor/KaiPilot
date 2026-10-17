'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.5 —— 策略激活闭环对话框。
 *
 * copy（复制为组织副本）/ enable（启用版本）/ disable（停用版本）写路径统一走
 * 「影响预览 → 统一变更请求 → 审批 → 最终确认」闭环（RL-06）：
 * - 提交 ≠ 生效：copy/activation 请求发出后只进入统一变更流（未生效），影响摘要
 *   （roles/operations/permissions/新增-移除目标）经 GET /plugin-policy-bundles/
 *   changes/:requestUid/impact 只读呈现；
 * - 审批（maker-checker，plugin_change_request:approve）与一次性确认凭据
 *   （plugin_change_request:manage）为独立人工步骤，按钮按权限显隐，后端为最终边界；
 * - 管理动作入口本身（发起本闭环）由 usePolicyBundleManageGate（组织 owner/admin）
 *   在父级控制，本组件不再重复判定发起权。
 */
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ShieldCheck } from 'lucide-react'
import {
  changePluginPolicyActivation,
  copyPluginPolicy,
  getPluginPolicyChangeImpact,
  pluginPolicyKeys,
  type PolicyImpactSummaryDto,
} from '@/lib/api/plugin-policy-bundles'
import {
  approvePluginChangeRequest,
  confirmPluginChangeRequest,
  issueConfirmHandle,
  pluginChangeRequestKeys,
} from '@/lib/api/plugin-change-requests'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { usePermissions } from '@/hooks/use-permissions'
import {
  POLICY_ACTIVATION_STEP_LABELS,
  changeRequestStateLabel,
  policyActionLabel,
} from '@/lib/next/org-plugin/org-plugin-adapter'
import type { PolicyActivationIntent } from './PolicyBundleList'

export interface PolicyActivationFlowProps {
  intent: PolicyActivationIntent
  onClose: () => void
}

function shortUid(uid: string): string {
  return uid.length > 10 ? `${uid.slice(0, 10)}…` : uid
}

function describeError(error: unknown): string {
  const code = (error as { code?: string })?.code
  if (code === 'plugin-change-self-approval-denied') {
    return '不能审批自己发起的申请，请由另一位管理员审批。'
  }
  if (code === 'plugin-change-stale') {
    return '策略包在此期间发生变化，请关闭后重新发起。'
  }
  if (code === 'plugin-change-already-decided') {
    return '该申请已处理完毕，无需重复确认。'
  }
  return (error as { message?: string })?.message ?? '操作失败，请稍后重试。'
}

export function PolicyActivationFlow({ intent, onClose }: PolicyActivationFlowProps) {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const [phase, setPhase] = React.useState<'compose' | 'submitted' | 'applied'>('compose')
  const [createdSummary, setCreatedSummary] = React.useState<PolicyImpactSummaryDto | null>(null)
  const [requestUid, setRequestUid] = React.useState<string | null>(null)
  const [handleIssued, setHandleIssued] = React.useState<string | null>(null)
  const [approvedByMe, setApprovedByMe] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const canApproveChange = can('plugin_change_request:approve')
  const canManageChange = can('plugin_change_request:manage')

  const isCopy = intent.kind === 'copy'
  const title = isCopy
    ? `复制模板「${intent.titleZh}」为组织副本`
    : intent.kind === 'enable'
      ? `启用策略版本 ${intent.bundleId} v${intent.version}`
      : `停用策略版本 ${intent.bundleId} v${intent.version}`
  const submitLabel = isCopy ? '提交复制申请' : `提交${policyActionLabel(intent.kind)}申请`

  // 发起变更（202：进入统一变更流，尚未生效）
  const createMutation = useMutation({
    mutationFn: () => {
      if (organizationId === null) return Promise.reject(new Error('缺少组织上下文'))
      if (intent.kind === 'copy') {
        return copyPluginPolicy(organizationId, intent.templateId)
      }
      return changePluginPolicyActivation(organizationId, intent.bundleId, {
        action: intent.kind,
        version: intent.version,
      })
    },
    onSuccess: (result) => {
      setCreatedSummary(result.data.summary)
      setRequestUid(result.data.requestUid)
      setPhase('submitted')
    },
    onError: (error: Error) => setErrorMessage(describeError(error)),
  })

  // 影响摘要（只读；携带 state/approvalRequired/approvedBy）
  const impactQuery = useQuery({
    queryKey: [...pluginPolicyKeys.all, 'impact', String(organizationId ?? 0), requestUid ?? ''],
    queryFn: () => getPluginPolicyChangeImpact(organizationId!, requestUid!),
    enabled: organizationId !== null && requestUid !== null,
    retry: false,
  })
  const impact = impactQuery.data?.data

  // maker-checker 审批（plugin_change_request:approve；服务层拒绝自审）
  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!requestUid || organizationId === null) throw new Error('缺少变更请求上下文')
      await approvePluginChangeRequest(organizationId, requestUid, `approve:${requestUid}`)
      setApprovedByMe(true)
      await queryClient.invalidateQueries({
        queryKey: [...pluginPolicyKeys.all, 'impact'],
      })
    },
    onError: (error: Error) => setErrorMessage(describeError(error)),
  })

  // 签发一次性确认凭据（plugin_change_request:manage）
  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!requestUid || organizationId === null) throw new Error('缺少变更请求上下文')
      const issued = await issueConfirmHandle(organizationId, requestUid)
      setHandleIssued(issued.data.handle)
    },
    onError: (error: Error) => setErrorMessage(describeError(error)),
  })

  // 最终确认并生效
  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!requestUid || !handleIssued || organizationId === null) {
        throw new Error('缺少确认上下文')
      }
      await confirmPluginChangeRequest(organizationId, requestUid, handleIssued)
      await queryClient.invalidateQueries({ queryKey: pluginPolicyKeys.all })
      await queryClient.invalidateQueries({ queryKey: pluginChangeRequestKeys.all })
      setPhase('applied')
    },
    onError: (error: Error) => setErrorMessage(describeError(error)),
  })

  const approvalRequired = impact?.approvalRequired ?? true
  const alreadyApproved = Boolean(impact?.approvedBy) || approvedByMe
  const busy =
    createMutation.isPending ||
    approveMutation.isPending ||
    issueMutation.isPending ||
    confirmMutation.isPending
  const impactLoading = phase === 'submitted' && impactQuery.isLoading
  const dialogRef = React.useRef<HTMLDivElement | null>(null)

  // 弹窗由父级条件渲染（挂载即打开）；在途写请求期间与遮罩层 /「取消」按钮同判据。
  useDialogA11y({
    ref: dialogRef,
    open: true,
    onClose: resetAndClose,
    canClose: () => !busy,
  })

  function resetAndClose() {
    setPhase('compose')
    setCreatedSummary(null)
    setRequestUid(null)
    setHandleIssued(null)
    setApprovedByMe(false)
    setErrorMessage(null)
    onClose()
  }

  const pendingImpact = impact ?? (createdSummary ? { summary: createdSummary } : null)

  return (
    <div data-policy-activation-dialog className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="关闭确认弹窗"
        tabIndex={-1}
        onClick={busy ? undefined : resetAndClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={title}
        className="absolute left-1/2 top-1/2 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center gap-2.5 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <ShieldCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[12px] leading-relaxed text-[var(--nx-text-secondary)]">
            {isCopy
              ? '从内置模板创建组织策略副本。副本先进入统一变更请求（未生效），经影响预览、审批与最终确认后才会成为组织副本。'
              : '切换组织策略的激活版本。激活变更先进入统一变更请求（未生效），经影响预览、审批与最终确认后才会生效。'}
          </p>

          {phase === 'submitted' ? (
            <div
              data-policy-flow-impact
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
              aria-busy={impactLoading}
            >
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
                影响预览（只读）· 统一变更请求 {requestUid ? shortUid(requestUid) : ''}
              </h4>
              {impactLoading ? (
                <div className="space-y-1.5" aria-hidden>
                  <div className="h-3 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
                  <div className="h-3 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
                  <div className="h-3 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
                </div>
              ) : impactQuery.isError ? (
                <p
                  role="alert"
                  data-policy-flow-impact-error
                  className="text-[11px] text-[var(--nx-text-muted)]"
                >
                  影响摘要暂不可用，请关闭后重新发起。
                </p>
              ) : pendingImpact ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-[var(--nx-text-secondary)]">
                      动作：{policyActionLabel(pendingImpact.summary.action)}
                    </span>
                    {impact ? (
                      <>
                        <span data-policy-flow-state className="text-[var(--nx-text-secondary)]">
                          状态：{changeRequestStateLabel(impact.state)}
                        </span>
                        <span
                          data-policy-flow-approval-required
                          className="text-[var(--nx-text-secondary)]"
                        >
                          审批{impact.approvalRequired ? '必需' : '非必需'}
                        </span>
                        {impact.approvedBy ? (
                          <span className="text-[var(--nx-text-secondary)]">
                            审批人 {impact.approvedBy}
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-4">
                    <div>
                      <dt className="text-[var(--nx-text-muted)]">受影响角色</dt>
                      <dd data-policy-impact-roles className="text-[var(--nx-text-primary)]">
                        {pendingImpact.summary.rolesAffected.join('、') || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--nx-text-muted)]">受影响操作</dt>
                      <dd className="text-[var(--nx-text-primary)]">
                        {pendingImpact.summary.operationsAffected.join('、') || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--nx-text-muted)]">受影响权限</dt>
                      <dd className="text-[var(--nx-text-primary)]">
                        {pendingImpact.summary.permissionKeysAffected.join('、') || '—'}
                      </dd>
                    </div>
                    <div className="flex gap-3">
                      <div>
                        <dt className="text-[var(--nx-text-muted)]">新增目标</dt>
                        <dd className="text-[var(--nx-text-primary)]">
                          {pendingImpact.summary.addedTargets}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--nx-text-muted)]">移除目标</dt>
                        <dd className="text-[var(--nx-text-primary)]">
                          {pendingImpact.summary.removedTargets}
                        </dd>
                      </div>
                    </div>
                  </dl>
                  <p
                    data-policy-flow-not-effective
                    className="rounded-sm border border-dashed border-[var(--nx-border-hairline)] px-2 py-1.5 text-[11px] text-[var(--nx-text-muted)]"
                  >
                    已提交但<strong className="text-[var(--nx-text-primary)]">尚未生效</strong>
                    {approvalRequired
                      ? '；需经另一位管理员审批并由持有管理权限者最终确认。'
                      : '；需由持有管理权限者最终确认。'}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {phase === 'applied' ? (
            <div
              role="status"
              data-policy-flow-applied
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3"
            >
              <p className="text-[11px] text-[var(--nx-text-secondary)]">
                已生效。策略底册与激活状态已更新。
              </p>
            </div>
          ) : null}

          {errorMessage ? (
            <p
              role="alert"
              aria-label="策略变更失败"
              data-policy-flow-error
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <button
            type="button"
            data-policy-flow-cancel
            onClick={resetAndClose}
            disabled={busy}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            {phase === 'applied' ? '关闭' : '取消'}
          </button>

          {phase === 'compose' ? (
            <button
              type="button"
              data-policy-flow-submit
              disabled={createMutation.isPending}
              onClick={() => void createMutation.mutateAsync().catch(() => undefined)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : null}
              {createMutation.isPending ? '提交中…' : submitLabel}
            </button>
          ) : null}

          {phase === 'submitted' && !handleIssued && approvalRequired && !alreadyApproved ? (
            canApproveChange ? (
              <button
                type="button"
                data-policy-flow-approve
                disabled={approveMutation.isPending || impactLoading}
                onClick={() => void approveMutation.mutateAsync().catch(() => undefined)}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                {approveMutation.isPending ? '审批中…' : POLICY_ACTIVATION_STEP_LABELS.approve}
              </button>
            ) : (
              <span className="text-[11px] text-[var(--nx-text-muted)]">
                需由另一位具备审批权限的管理员完成审批与确认
              </span>
            )
          ) : null}

          {phase === 'submitted' && !handleIssued && (approvalRequired ? alreadyApproved : true) ? (
            canManageChange ? (
              <button
                type="button"
                data-policy-flow-issue-handle
                disabled={issueMutation.isPending || impactLoading}
                onClick={() => void issueMutation.mutateAsync().catch(() => undefined)}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
              >
                {issueMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                {issueMutation.isPending ? '签发中…' : '获取一次性确认凭据'}
              </button>
            ) : (
              <span className="text-[11px] text-[var(--nx-text-muted)]">
                需由持有管理权限者完成最终确认
              </span>
            )
          ) : null}

          {phase === 'submitted' && handleIssued ? (
            <button
              type="button"
              data-policy-flow-confirm
              disabled={confirmMutation.isPending}
              onClick={() => void confirmMutation.mutateAsync().catch(() => undefined)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
            >
              {confirmMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : null}
              {confirmMutation.isPending ? '确认中…' : POLICY_ACTIVATION_STEP_LABELS.confirm}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  )
}

export default PolicyActivationFlow
