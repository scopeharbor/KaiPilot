/**
 * v3-plugin-policy-bundles —— 组织插件策略包管理组件（任务 4.1/4.2）。
 *
 * - 三内置模板卡片（简体中文说明）+ 组织副本列表 + 当前激活徽标
 * - 权限不足动作完全隐藏（无 manage 权限不渲染复制/启停按钮）
 * - 影响摘要面板：角色 × 操作/权限矩阵 + 新增/移除计数（有界、低敏）
 * - 失败反馈 alert、可访问性语义（region/aria-label/table caption）、
 *   主题/密度经既有 CSS 变量与 data-density 容器天然兼容
 */
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermissions } from '@/hooks/use-permissions'
import {
  listPluginPolicies,
  copyPluginPolicy,
  changePluginPolicyActivation,
  getPluginPolicyChangeImpact,
  type PolicyImpactSummaryDto,
} from '@/lib/api/plugin-policy-bundles'

export interface PluginPolicyManagerProps {
  organizationId: string | number
}

const ACTION_ZH: Record<PolicyImpactSummaryDto['action'], string> = {
  copy: '复制',
  enable: '启用',
  disable: '停用',
  upgrade: '升级',
}

/** 影响摘要展示（纯组件；供主面板与测试复用）。 */
export function PolicyImpactSummaryPanel({
  summary,
  state,
  approvalRequired,
  approvedBy,
}: {
  summary: PolicyImpactSummaryDto
  state: string
  approvalRequired: boolean
  approvedBy: string | null
}): React.ReactElement {
  return (
    <div
      role="region"
      aria-label="变更影响摘要"
      data-testid="policy-impact-panel"
      className="rounded border border-border p-3"
    >
      <h3 className="text-sm font-medium">最近一次请求的影响摘要</h3>
      <p className="mt-1 text-xs">
        动作：{ACTION_ZH[summary.action]} · 状态：{state} · 审批
        {approvalRequired ? '必需' : '非必需'}
        {approvedBy ? `（审批人 ${approvedBy}）` : ''}
        。确认前现有决策保持不变。
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" aria-label="影响矩阵">
        <div>
          <dt>受影响角色</dt>
          <dd data-testid="policy-impact-roles">{summary.rolesAffected.join('、') || '—'}</dd>
        </div>
        <div>
          <dt>受影响操作</dt>
          <dd>{summary.operationsAffected.join('、') || '—'}</dd>
        </div>
        <div>
          <dt>新增目标</dt>
          <dd>{summary.addedTargets}</dd>
        </div>
        <div>
          <dt>移除目标</dt>
          <dd>{summary.removedTargets}</dd>
        </div>
      </dl>
    </div>
  )
}

export function PluginPolicyManager({ organizationId }: PluginPolicyManagerProps) {
  const { hasPermission } = usePermissions()
  const canView = hasPermission('plugin_install:view')
  const canManage = hasPermission('plugin_install:manage') || hasPermission('org:manage')
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [impactRequestUid, setImpactRequestUid] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ['plugin-policy-bundles', 'list', String(organizationId)],
    queryFn: () => listPluginPolicies(organizationId),
    enabled: canView,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['plugin-policy-bundles'] })

  const copyMutation = useMutation({
    mutationFn: (templateId: string) => copyPluginPolicy(organizationId, templateId),
    onSuccess: (res) => {
      setError(null)
      setImpactRequestUid(res.data.requestUid)
      void invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })
  const activationMutation = useMutation({
    mutationFn: (args: { bundleId: string; action: 'enable' | 'disable'; version: number }) =>
      changePluginPolicyActivation(organizationId, args.bundleId, {
        action: args.action,
        version: args.version,
      }),
    onSuccess: (res) => {
      setError(null)
      setImpactRequestUid(res.data.requestUid)
      void invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const impactQuery = useQuery({
    queryKey: ['plugin-policy-bundles', 'impact', String(organizationId), impactRequestUid],
    queryFn: () => getPluginPolicyChangeImpact(organizationId, impactRequestUid!),
    enabled: impactRequestUid != null,
  })

  if (!canView) return null

  const data = listQuery.data?.data

  return (
    <section
      data-testid="plugin-policy-manager"
      aria-label="插件策略包"
      className="space-y-4 rounded-md border border-border bg-surface p-4 text-fg"
      data-density="comfortable"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">插件策略包</h2>
        {data?.activation ? (
          <span
            role="status"
            aria-label={`当前激活 ${data.activation.status === 'active' ? '生效中' : '已停用'}，修订 r${data.activation.revision}`}
            className="rounded-full border border-border px-2 py-0.5 text-xs"
          >
            {data.activation.status === 'active'
              ? `生效中 · ${data.activation.bundleId} v${data.activation.activeVersion}`
              : '已停用'}
          </span>
        ) : (
          <span role="status" aria-label="未启用组织策略" className="text-xs opacity-60">
            未启用组织策略
          </span>
        )}
      </header>

      {listQuery.isError && (
        <div role="alert" className="rounded border border-danger/40 bg-danger/10 p-2 text-sm">
          策略加载失败：{(listQuery.error as Error).message}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded border border-danger/40 bg-danger/10 p-2 text-sm">
          操作失败：{error}
        </div>
      )}

      {/* 内置模板 */}
      <div aria-label="内置模板" className="grid gap-3 sm:grid-cols-3">
        {(data?.templates ?? []).map((t) => (
          <article
            key={t.templateId}
            className="rounded border border-border p-3"
            aria-label={t.titleZh}
          >
            <h3 className="text-sm font-medium">{t.titleZh}</h3>
            <p className="mt-1 text-xs leading-5 opacity-80">{t.descriptionZh}</p>
            {canManage && (
              <button
                type="button"
                className="mt-2 rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                disabled={copyMutation.isPending}
                onClick={() => copyMutation.mutate(t.templateId)}
                aria-label={`从模板${t.titleZh}创建组织副本`}
              >
                复制为组织副本
              </button>
            )}
          </article>
        ))}
      </div>

      {/* 组织副本 */}
      <table className="w-full text-sm" aria-label="组织副本列表">
        <caption className="sr-only">组织策略副本版本列表</caption>
        <thead>
          <tr className="text-left opacity-70">
            <th scope="col">副本</th>
            <th scope="col">版本</th>
            <th scope="col">来源模板</th>
            <th scope="col">摘要 digest</th>
            {canManage && <th scope="col">操作</th>}
          </tr>
        </thead>
        <tbody>
          {(data?.orgCopies ?? []).map((c) => (
            <tr key={`${c.bundleId}@${c.version}`} className="border-t border-border">
              <td>{c.bundleId}</td>
              <td>v{c.version}</td>
              <td>{c.sourceTemplateId}</td>
              <td className="font-mono text-xs">{c.documentDigest}</td>
              {canManage && (
                <td>
                  {data?.activation &&
                  data.activation.bundleId === c.bundleId &&
                  data.activation.status === 'active' ? (
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50"
                      disabled={activationMutation.isPending}
                      onClick={() =>
                        activationMutation.mutate({
                          bundleId: c.bundleId,
                          action: 'disable',
                          version: c.version,
                        })
                      }
                      aria-label={`停用 ${c.bundleId} v${c.version}`}
                    >
                      停用
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50"
                      disabled={activationMutation.isPending}
                      onClick={() =>
                        activationMutation.mutate({
                          bundleId: c.bundleId,
                          action: 'enable',
                          version: c.version,
                        })
                      }
                      aria-label={`启用 ${c.bundleId} v${c.version}`}
                    >
                      启用
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 影响摘要 */}
      {impactRequestUid && (
        <div aria-busy={impactQuery.isFetching}>
          {impactQuery.isLoading && <p className="text-xs opacity-70">加载中…</p>}
          {impactQuery.isError && (
            <div role="alert" className="rounded border border-danger/40 bg-danger/10 p-2 text-xs">
              影响摘要加载失败：{(impactQuery.error as Error).message}
            </div>
          )}
          {impactQuery.data?.data.summary && (
            <PolicyImpactSummaryPanel
              summary={impactQuery.data.data.summary}
              state={impactQuery.data.data.state}
              approvalRequired={impactQuery.data.data.approvalRequired}
              approvedBy={impactQuery.data.data.approvedBy}
            />
          )}
        </div>
      )}

      <p className="text-xs opacity-60">
        说明：策略只会收紧既有 RBAC 权限；写操作需经统一变更流审批并由发起人确认后才会生效。
      </p>
    </section>
  )
}
