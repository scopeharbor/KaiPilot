'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.5 —— 插件策略工作台总装。
 *
 * 组织插件策略包（/next/organization/plugin-policies）Layer 2 暗黑仪器感工作台：
 * - 消费既有 /plugin-policy-bundles 端点（listPluginPolicies，query key 组织隔离），
 *   呈现模板底册 / 组织副本 / 激活状态（PolicyBundleList）；
 * - copy/activate 管理动作发起权 = 组织 owner/admin（usePolicyBundleManageGate，
 *   后端 PluginPolicyBundlePolicy.canManage 同口径），无管理权限物理不渲染；
 * - 动作统一走 PolicyActivationFlow「影响预览 → 统一变更请求 → 审批 → 最终确认」
 *   闭环（RL-06）；激活影响只读展示；
 * - 三态：列表骨架 / 语义空态 / 错误重试。
 */
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { listPluginPolicies, pluginPolicyKeys } from '@/lib/api/plugin-policy-bundles'
import { useAuthStore, selectEffectiveOrganizationId } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { PolicyBundleList, type PolicyActivationIntent } from './PolicyBundleList'
import { PolicyActivationFlow } from './PolicyActivationFlow'
import { usePolicyBundleManageGate } from './usePolicyBundleManageGate'

export function PluginPolicyWorkspace() {
  const tier = useImmersionTier()
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const canManage = usePolicyBundleManageGate()
  const [intent, setIntent] = React.useState<PolicyActivationIntent | null>(null)

  const listQuery = useQuery({
    queryKey: pluginPolicyKeys.list(organizationId ?? 0),
    queryFn: () => listPluginPolicies(organizationId!),
    enabled: organizationId !== null,
  })

  const listData = listQuery.data?.data
  const templates = listData?.templates ?? []
  const orgCopies = listData?.orgCopies ?? []
  const activation = listData?.activation ?? null

  const busy = listQuery.isLoading || listQuery.isFetching

  const intentKey = intent
    ? intent.kind === 'copy'
      ? `copy:${intent.templateId}`
      : `${intent.kind}:${intent.bundleId}@${intent.version}`
    : null

  return (
    <div
      data-policy-workspace
      aria-busy={busy}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <ShieldCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">插件策略</h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              组织插件策略包底册 · 模板 / 副本 / 激活版本 · 管理动作须经审批与最终确认后生效
            </p>
          </div>
        </div>
        <button
          type="button"
          data-policy-refresh
          aria-label="刷新插件策略"
          onClick={() => void listQuery.refetch()}
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          刷新
        </button>
      </header>

      {/* 三态主体 */}
      {listQuery.isLoading ? (
        <div
          data-policy-skeleton
          role="status"
          aria-label="正在加载插件策略"
          aria-busy="true"
          className="space-y-1.5"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-md bg-[var(--nx-bg-1)]"
              aria-hidden
            />
          ))}
        </div>
      ) : listQuery.isError ? (
        <div
          role="alert"
          aria-label="插件策略加载错误"
          data-policy-error
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">插件策略加载失败</p>
          <button
            type="button"
            data-policy-retry
            onClick={() => void listQuery.refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新加载
          </button>
        </div>
      ) : (
        <PolicyBundleList
          templates={templates}
          orgCopies={orgCopies}
          activation={activation}
          canManage={canManage}
          busy={busy || intent !== null}
          onIntent={(next) => setIntent(next)}
        />
      )}

      <p className="text-[11px] text-[var(--nx-text-muted)]">
        说明：策略只会收紧既有 RBAC 权限；写操作需经统一变更流审批并由发起人确认后才会生效。
      </p>

      {/* 激活闭环对话框（key 随意图变化强制重置步骤状态） */}
      {intent && intentKey ? (
        <PolicyActivationFlow key={intentKey} intent={intent} onClose={() => setIntent(null)} />
      ) : null}
    </div>
  )
}

export default PluginPolicyWorkspace
