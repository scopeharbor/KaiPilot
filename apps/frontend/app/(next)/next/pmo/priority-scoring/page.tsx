'use client'

import { Building2, ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { PmoPriorityScoringWorkspace } from '@/components/next/pmo/priority-scoring/PmoPriorityScoringWorkspace'

/**
 * PMO 优先级评分路由（/next/pmo/priority-scoring，
 * v3-ui-next-pmo-domain W4 · tasks 4.1，spec「PMO 优先级评分只读工作台」）。
 *
 * - 页面级门禁：`portfolio:view`（镜像后端 portfolio_dashboard/priority-scoring
 *   只读端点准入）；无权限渲染受限横幅（data-permission-fallback）且工作台不挂载、
 *   全部数据接口零请求（RL-06）；
 * - 组织上下文从会话取 `selectEffectiveOrganizationId`；orgId 未水合渲染
 *   「请先选择组织」引导态且零请求（RL-05）；
 * - 纯只读工作台：过滤/排序/分页/明细抽屉全部只读查询，零写请求（RL-01）。
 */
export default function PmoPriorityScoringPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require="portfolio:view"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看优先级评分的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 portfolio:view 权限方可查看组合优先级评分。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-org-no-organization
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <Building2 className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            优先级评分是组织级组合工作台，需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : (
        <PmoPriorityScoringWorkspace />
      )}
    </PermissionGuard>
  )
}
