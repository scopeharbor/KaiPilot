'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.5 —— 插件策略包底册（模板 + 组织副本）。
 *
 * 组织插件策略包（/next/organization/plugin-policies）的只读底册呈现：
 * - 顶部激活状态徽标（生效中 vX / 已停用 / 未启用组织策略）；
 * - 内置模板卡（titleZh/descriptionZh + 「复制为组织副本」管理动作）；
 * - 组织副本表（bundleId/版本/来源模板/digest + 启用/停用管理动作）；
 * - 管理动作（copy/activation）仅组织 owner/admin 可见（usePolicyBundleManageGate）；
 *   无管理权限时动作**物理不渲染**、写请求零发出（RL-06）；
 * - 模板列表查询三态（骨架/空态/错误重试）由父工作台查询驱动，本组件纯呈现。
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import type {
  PluginPolicyActivationDto,
  PluginPolicyBundleDto,
  PluginPolicyTemplateDto,
} from '@/lib/api/plugin-policy-bundles'
import { policyActivationMetaOf } from '@/lib/next/org-plugin/org-plugin-adapter'

const chipClass =
  'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] leading-none'

export type PolicyActivationIntent =
  | { kind: 'copy'; templateId: string; titleZh: string }
  | { kind: 'enable'; bundleId: string; version: number }
  | { kind: 'disable'; bundleId: string; version: number }

export interface PolicyBundleListProps {
  templates: readonly PluginPolicyTemplateDto[]
  orgCopies: readonly PluginPolicyBundleDto[]
  activation: PluginPolicyActivationDto | null
  canManage: boolean
  busy: boolean
  onIntent: (intent: PolicyActivationIntent) => void
}

export function PolicyBundleList({
  templates,
  orgCopies,
  activation,
  canManage,
  busy,
  onIntent,
}: PolicyBundleListProps) {
  const activationMeta = policyActivationMetaOf(activation?.status)

  return (
    <section aria-label="插件策略包底册" data-policy-bundle-list className="flex flex-col gap-4">
      {/* 激活状态徽标 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          模板与组织副本均只收紧既有 RBAC 权限；管理动作须经审批与最终确认后生效
        </p>
        {activation ? (
          <span
            data-policy-activation-status={activation.status}
            title={activationMeta.description}
            className={cn(chipClass, activationMeta.chipClass)}
          >
            {activation.status === 'active'
              ? `${activationMeta.label} · ${activation.bundleId} v${activation.activeVersion}`
              : activationMeta.label}
          </span>
        ) : (
          <span
            data-policy-activation-none
            role="status"
            aria-label="未启用组织策略"
            className="text-[11px] text-[var(--nx-text-muted)]"
          >
            未启用组织策略
          </span>
        )}
      </div>

      {/* 内置模板 */}
      <div className="flex flex-col gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
          内置模板
        </h3>
        <div className="grid gap-3 sm:grid-cols-3" aria-label="内置模板">
          {templates.map((template) => (
            <article
              key={template.templateId}
              aria-label={template.titleZh}
              className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3.5"
            >
              <h4 className="text-sm font-medium text-[var(--nx-text-primary)]">
                {template.titleZh}
              </h4>
              <p className="flex-1 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                {template.descriptionZh}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                  t{template.templateId} · v{template.templateVersion}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    data-policy-template-copy={template.templateId}
                    disabled={busy}
                    onClick={() =>
                      onIntent({
                        kind: 'copy',
                        templateId: template.templateId,
                        titleZh: template.titleZh,
                      })
                    }
                    className="flex h-7 items-center rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    复制为组织副本
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* 组织副本 */}
      <div className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
          组织副本
        </h3>
        {orgCopies.length === 0 ? (
          <p
            data-policy-copies-empty
            className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-6 text-center text-[11px] text-[var(--nx-text-muted)]"
          >
            尚未从模板复制任何组织策略副本
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--nx-border-hairline)]">
            <table data-policy-copies-table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--nx-border-hairline)]">
                  {['副本', '版本', '来源模板', '文档摘要', canManage ? '操作' : null]
                    .filter((cell): cell is string => cell !== null)
                    .map((header) => (
                      <th
                        key={header}
                        scope="col"
                        className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]"
                      >
                        {header}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {orgCopies.map((copy) => {
                  const isActiveBundle =
                    activation?.status === 'active' && activation.bundleId === copy.bundleId
                  const rowKey = `${copy.bundleId}@${copy.version}`
                  return (
                    <tr
                      key={rowKey}
                      data-policy-bundle-row={rowKey}
                      className="h-9 border-b border-[var(--nx-border-hairline)]/60 transition-colors last:border-b-0 hover:bg-[var(--nx-bg-1)]/60"
                    >
                      <td className="whitespace-nowrap px-3">
                        <span className="font-mono text-[11px] text-[var(--nx-text-primary)]">
                          {copy.bundleId}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3">
                        <span className="font-mono text-[11px] text-[var(--nx-text-secondary)]">
                          v{copy.version}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3">
                        <span className="font-mono text-[11px] text-[var(--nx-text-secondary)]">
                          {copy.sourceTemplateId}
                        </span>
                      </td>
                      <td className="max-w-44 px-3">
                        <span
                          className="block truncate font-mono text-[10px] text-[var(--nx-text-muted)]"
                          title={copy.documentDigest}
                        >
                          {copy.documentDigest}
                        </span>
                      </td>
                      {canManage ? (
                        <td className="whitespace-nowrap px-3">
                          {isActiveBundle ? (
                            <button
                              type="button"
                              data-policy-activation-action="disable"
                              disabled={busy}
                              onClick={() =>
                                onIntent({
                                  kind: 'disable',
                                  bundleId: copy.bundleId,
                                  version: copy.version,
                                })
                              }
                              className="flex h-7 items-center gap-1 rounded-sm border border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.12)] px-2.5 text-[11px] text-[var(--nx-status-danger)] transition-colors hover:border-[var(--nx-status-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              停用
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-policy-activation-action="enable"
                              disabled={busy}
                              onClick={() =>
                                onIntent({
                                  kind: 'enable',
                                  bundleId: copy.bundleId,
                                  version: copy.version,
                                })
                              }
                              className="flex h-7 items-center rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              启用
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default PolicyBundleList
