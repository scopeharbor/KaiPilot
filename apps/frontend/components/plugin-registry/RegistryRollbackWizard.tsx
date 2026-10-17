'use client'

/**
 * v3-plugin-private-registry-lifecycle — 回滚向导（task 8.7）。
 *
 * 默认行为：**只切推荐指针**，不动任何已安装实例。
 * 安装实例必须**逐项显式勾选**才会进入回滚计划——不提供「自动全组织降级」，
 * 因为那会让一次点击静默改变全组织运行时。
 *
 * 每个实例展示 prepare / apply / compensate / degraded 四态；
 * 部分失败时 degraded 实例单独列出并保留补偿入口，不把整体标成成功。
 * 取消不写入；未授权时整个向导不渲染（前端隐藏只是 UX，服务端仍是安全边界）。
 */

import * as React from 'react'
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

export type RollbackStepStatus =
  'pending' | 'prepare' | 'apply' | 'compensate' | 'degraded' | 'done'

export const ROLLBACK_STATUS_LABELS: Record<RollbackStepStatus, string> = {
  pending: '待处理',
  prepare: '准备中',
  apply: '应用中',
  compensate: '补偿中',
  degraded: '降级待处理',
  done: '已完成',
}

export interface RollbackInstance {
  readonly instanceId: string
  readonly displayName: string
  readonly currentVersion: string
  readonly status: RollbackStepStatus
  /** 失败说明（degraded 时可读的中文原因）。 */
  readonly detail?: string
}

export interface RegistryRollbackWizardProps {
  open: boolean
  /** 是否具备 rollback 权限；无权限则不渲染（服务端仍会拒绝）。 */
  authorized: boolean
  pluginIdentity: string
  /** 回滚目标版本。 */
  targetVersion: string
  /** 组织内安装实例。 */
  instances: readonly RollbackInstance[]
  /** 预览差异文本（低敏）。 */
  previewDiff?: string | null
  submitting?: boolean
  onPreview: (instanceIds: readonly string[]) => void
  onConfirm: (instanceIds: readonly string[]) => void
  onClose: () => void
}

export function RegistryRollbackWizard({
  open,
  authorized,
  pluginIdentity,
  targetVersion,
  instances,
  previewDiff,
  submitting = false,
  onPreview,
  onConfirm,
  onClose,
}: RegistryRollbackWizardProps) {
  // 默认空集合 = 只切推荐指针，不动任何实例
  const [selected, setSelected] = React.useState<readonly string[]>([])

  if (!open || !authorized) return null

  const degraded = instances.filter((i) => i.status === 'degraded')

  function toggle(instanceId: string) {
    setSelected((prev) =>
      prev.includes(instanceId) ? prev.filter((id) => id !== instanceId) : [...prev, instanceId],
    )
  }

  return (
    <div
      data-rollback-wizard
      role="dialog"
      aria-modal="true"
      aria-label="回滚向导"
      className="fixed inset-y-0 right-0 z-[var(--z-modal)] flex w-full flex-col border-l border-border bg-gray-0 md:w-[560px]"
    >
      <header className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-gray-800">回滚 {pluginIdentity}</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          回滚到 {targetVersion}。默认只切换推荐指针，已安装实例保持不变。
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p data-rollback-default-note className="mb-3 text-xs text-gray-600">
          需要同时降级实例时，请**逐项勾选**——没有「自动全组织降级」选项。
        </p>

        <section className="mb-4">
          <h3 className="mb-1 text-xs font-medium text-gray-500">安装实例</h3>
          {instances.length === 0 ? (
            <p data-rollback-no-instances className="text-xs text-gray-400">
              本组织没有该插件的安装实例，回滚只影响推荐指针。
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {instances.map((instance) => (
                <li
                  key={instance.instanceId}
                  data-rollback-instance
                  className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border p-2"
                >
                  <input
                    type="checkbox"
                    id={`rollback-${instance.instanceId}`}
                    data-rollback-instance-checkbox
                    checked={selected.includes(instance.instanceId)}
                    onChange={() => toggle(instance.instanceId)}
                    className={cn('mt-0.5 shrink-0', focusRing)}
                  />
                  <label
                    htmlFor={`rollback-${instance.instanceId}`}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <span className="block break-words text-xs text-gray-700">
                      {instance.displayName}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      当前 {instance.currentVersion}
                    </span>
                  </label>
                  <span
                    data-rollback-instance-status
                    className="shrink-0 text-[11px] text-gray-500"
                  >
                    <StatusIcon status={instance.status} />
                    {ROLLBACK_STATUS_LABELS[instance.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {previewDiff && (
          <section className="mb-4">
            <h3 className="mb-1 text-xs font-medium text-gray-500">回滚差异</h3>
            <pre
              data-rollback-diff
              className="whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-border bg-surface p-3 text-xs text-gray-700"
            >
              {previewDiff}
            </pre>
          </section>
        )}

        {degraded.length > 0 && (
          <section
            data-rollback-degraded
            className="rounded-[var(--radius-md)] border border-warning bg-warning-bg p-2"
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              部分实例处于降级待处理状态
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {degraded.map((instance) => (
                <li key={instance.instanceId} className="break-words text-[11px] text-warning">
                  {instance.displayName}：{instance.detail ?? '需要人工补偿'}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          data-rollback-cancel
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
          data-rollback-preview
          onClick={() => onPreview(selected)}
          className={cn(
            'rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100',
            focusRing,
          )}
        >
          预览差异
        </button>
        <button
          type="button"
          data-rollback-confirm
          onClick={() => onConfirm(selected)}
          disabled={submitting}
          className={cn(
            'rounded-[var(--radius-md)] bg-[var(--primary-500)] px-3 py-1.5 text-xs text-white disabled:opacity-40',
            focusRing,
          )}
        >
          {submitting
            ? '提交中…'
            : selected.length === 0
              ? '仅切换推荐指针'
              : `回滚并降级 ${selected.length} 个实例`}
        </button>
      </footer>
    </div>
  )
}

function StatusIcon({ status }: { status: RollbackStepStatus }) {
  if (status === 'done') {
    return <CheckCircle2 className="mr-1 inline h-3 w-3 text-success" aria-hidden />
  }
  if (status === 'degraded') {
    return <XCircle className="mr-1 inline h-3 w-3 text-warning" aria-hidden />
  }
  if (status === 'prepare' || status === 'apply' || status === 'compensate') {
    return (
      <Loader2
        className="mr-1 inline h-3 w-3 animate-spin text-gray-400 motion-reduce:animate-none"
        aria-hidden
      />
    )
  }
  return null
}
