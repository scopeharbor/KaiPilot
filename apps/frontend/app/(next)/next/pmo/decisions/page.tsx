'use client'

import * as React from 'react'
import { Suspense } from 'react'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { PmoDecisionWorkspace } from '@/components/next/pmo/decisions/PmoDecisionWorkspace'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * PMO 决策工作台队列路由（/next/pmo/decisions，
 * v3-ui-next-pmo-domain W6 · tasks 6.1，spec「决策工作台队列与议题建立」）。
 *
 * - 页面级门禁：`pmo_decision:view`（后端 DecisionWorkbenchPolicy 同串入口）——
 *   无权限渲染受限横幅（data-permission-fallback）且工作台不挂载、决策队列接口零请求（RL-06）；
 * - 组织上下文取有效租户（selectEffectiveOrganizationId），未水合渲染「请先选择组织」
 *   引导态且零查询（hooks 内部 enabled: orgId !== null 双保险）；
 * - useSearchParams 以 <Suspense> 包裹（App Router 静态预渲染边界）；
 * - 建卡入口按 `pmo_decision:manage` 显隐；队列状态/分页全部经 URL 过滤串契约
 *   （parseDecisionUrlFilters/serializeDecisionUrlFilters）驱动。
 */
export default function PmoDecisionsPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require={['pmo_decision:view']}
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看 PMO 决策工作台的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 pmo_decision:view 权限。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-org-no-organization
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            决策工作台需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : (
        <Suspense
          fallback={
            <div
              data-pmo-decisions-loading
              role="status"
              aria-busy="true"
              className="flex min-h-[70vh] items-center justify-center text-xs text-[var(--nx-text-muted)]"
            >
              正在打开决策工作台…
            </div>
          }
        >
          <PmoDecisionWorkspace />
        </Suspense>
      )}
    </PermissionGuard>
  )
}
