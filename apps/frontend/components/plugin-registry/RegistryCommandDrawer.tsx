'use client'

/**
 * v3-plugin-private-registry-lifecycle — 差异确认 drawer（task 8.5）。
 *
 * 登记/送审/审批/弃用/撤回统一走 preview → 人工确认 → confirm：
 * - 展示低敏 diff 与影响范围（不回显包体/manifest/secret）；
 * - **maker-checker**：送审人自己不能批准/拒绝——按钮禁用 + 文案说明，
 *   同时明确「服务端仍会再判一次」（前端隐藏不是授权，spec §权限分离）；
 * - preview 过期（TTL）或 stale（状态版本变化）时要求**重新预览**，不允许拿旧 handle 提交；
 * - 服务端拒绝时把错误码对应的中文说明显示出来，不吞错；
 * - 二次点击不重复提交（提交中禁用）。
 */

import * as React from 'react'
import { AlertTriangle, Loader2, ShieldAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import type { RegistryCommandPreview } from '@/lib/api/plugin-registry'

export type RegistryDrawerAction =
  | 'create-release'
  | 'submit-for-review'
  | 'approve'
  | 'reject'
  | 'deprecate'
  | 'undeprecate'
  | 'withdraw'
  | 'restore-request'

/** 动作 → 中文标题（审阅导向措辞，不使用「自动执行」类表述）。 */
export const REGISTRY_ACTION_LABELS: Record<RegistryDrawerAction, string> = {
  'create-release': '登记版本',
  'submit-for-review': '提交审核',
  approve: '批准发布',
  reject: '拒绝发布',
  deprecate: '标记弃用',
  undeprecate: '取消弃用',
  withdraw: '撤回版本',
  'restore-request': '申请恢复',
}

/** 服务端错误码 → 中文说明（不泄露目标存在性细节）。 */
export const REGISTRY_ERROR_MESSAGES: Record<string, string> = {
  'registry-preview-expired': '预览已过期，请重新预览后再确认。',
  'registry-preview-stale': '目标版本在预览后发生了变化，请重新预览。',
  'registry-preview-replayed': '该预览已被使用过，请重新预览。',
  'registry-preview-target-mismatch': '预览目标与当前版本不一致，请重新预览。',
  'registry-maker-checker-violation': '审批人不能是本次请求的发起人。',
  'registry-illegal-status-transition': '当前状态不允许该操作。',
  'registry-release-not-found': '目标版本不存在。',
  'registry-confirm-channel-unavailable': '确认通道尚未接入，本次未执行任何写入。',
}

export interface RegistryCommandDrawerProps {
  open: boolean
  action: RegistryDrawerAction
  preview: RegistryCommandPreview | null
  /** 预览生成中。 */
  previewing?: boolean
  /** 确认提交中。 */
  submitting?: boolean
  /** 当前操作者标识（与 preview.actorRef 比对以判定自批）。 */
  currentActorRef: string
  /** 本次请求的发起人（送审人）标识。 */
  submitterRef?: string | null
  /** 预览是否已失效（TTL 过期或状态版本变化）。 */
  stale?: boolean
  /** 服务端返回的错误码。 */
  errorCode?: string | null
  onConfirm: () => void
  onRePreview: () => void
  onClose: () => void
}

export function RegistryCommandDrawer({
  open,
  action,
  preview,
  previewing = false,
  submitting = false,
  currentActorRef,
  submitterRef,
  stale = false,
  errorCode,
  onConfirm,
  onRePreview,
  onClose,
}: RegistryCommandDrawerProps) {
  if (!open) return null

  const isApprovalAction = action === 'approve' || action === 'reject'
  // maker-checker：审批类动作的确认者不得等于送审人
  const selfApproval = isApprovalAction && Boolean(submitterRef) && submitterRef === currentActorRef
  const blocked = selfApproval || stale || previewing || !preview
  const errorMessage = errorCode
    ? (REGISTRY_ERROR_MESSAGES[errorCode] ?? '服务端拒绝了本次操作。')
    : null

  return (
    <aside
      data-registry-drawer
      role="dialog"
      aria-modal="true"
      aria-label={`${REGISTRY_ACTION_LABELS[action]}确认`}
      className="fixed inset-y-0 right-0 z-[var(--z-modal)] flex w-full flex-col border-l border-border bg-gray-0 md:w-[520px]"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="min-w-0 truncate text-sm font-medium text-gray-800">
          {REGISTRY_ACTION_LABELS[action]}
        </h2>
        <button
          type="button"
          data-registry-drawer-close
          aria-label="关闭"
          onClick={onClose}
          className={cn(
            'ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-gray-500 hover:bg-gray-100',
            focusRing,
          )}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {previewing && (
          <p className="flex items-center gap-2 text-xs text-gray-500" data-registry-previewing>
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            正在生成差异预览…
          </p>
        )}

        {!previewing && preview && (
          <>
            <section className="mb-4">
              <h3 className="mb-1 text-xs font-medium text-gray-500">差异</h3>
              <pre
                data-registry-diff
                className="whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-border bg-surface p-3 text-xs text-gray-700"
              >
                {preview.diff}
              </pre>
            </section>

            <section className="mb-4">
              <h3 className="mb-1 text-xs font-medium text-gray-500">影响范围</h3>
              <ul data-registry-impact className="flex flex-col gap-1">
                {preview.impactSummary.length === 0 ? (
                  <li className="text-xs text-gray-400">无组织内安装实例受影响。</li>
                ) : (
                  preview.impactSummary.map((item) => (
                    <li key={item} className="break-words text-xs text-gray-700">
                      {item}
                    </li>
                  ))
                )}
              </ul>
            </section>
          </>
        )}

        {stale && (
          <p
            data-registry-stale
            className="mb-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-warning-bg p-2 text-xs text-warning"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            目标版本在预览后发生了变化，请重新预览后再确认。
          </p>
        )}

        {selfApproval && (
          <p
            data-registry-maker-checker
            className="mb-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2 p-2 text-xs text-gray-600"
          >
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
            审批人不能是本次请求的发起人。此处已禁用，服务端也会再次校验。
          </p>
        )}

        {errorMessage && (
          <p
            data-registry-error
            role="alert"
            className="mb-3 rounded-[var(--radius-md)] border border-danger bg-danger-bg p-2 text-xs text-danger"
          >
            {errorMessage}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
        {stale && (
          <button
            type="button"
            data-registry-repreview
            onClick={onRePreview}
            className={cn(
              'rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100',
              focusRing,
            )}
          >
            重新预览
          </button>
        )}
        <button
          type="button"
          data-registry-cancel
          onClick={onClose}
          className={cn(
            'rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100',
            focusRing,
          )}
        >
          取消
        </button>
        <button
          type="button"
          data-registry-confirm
          onClick={onConfirm}
          disabled={blocked || submitting}
          className={cn(
            'rounded-[var(--radius-md)] bg-[var(--primary-500)] px-3 py-1.5 text-xs text-white disabled:opacity-40',
            focusRing,
          )}
        >
          {submitting ? '提交中…' : `确认${REGISTRY_ACTION_LABELS[action]}`}
        </button>
      </footer>
    </aside>
  )
}
