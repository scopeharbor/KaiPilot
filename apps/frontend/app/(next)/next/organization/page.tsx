'use client'

import * as React from 'react'
import { Building2, ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { OrgOverviewLayoutEditor } from '@/components/next/org-overview/OrgOverviewLayoutEditor'
import { OrgOverviewWorkspace } from '@/components/next/org-overview/OrgOverviewWorkspace'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * 组织概览工作台路由（/next/organization，
 * v3-ui-next-org-portfolio-domains W1 · tasks 1.7）。
 *
 * - 组织 ID 一律取自 JWT 有效租户上下文（`selectEffectiveOrganizationId`），
 *   URL 不含 organizationId（RL-05：前端绝不把 URL 参数当组织事实源）；
 * - 准入门禁：`PermissionGuard(require=['org:view','portfolio:view'])`（任一即可，
 *   与 OrganizationDashboardPolicy 视图口径一致）——无权限渲染受限横幅且工作台
 *   不挂载、底层 dashboard/layouts 接口零请求（RL-06）；
 * - 未选择组织：渲染「请先选择组织」引导态且零查询（hooks enabled 恒 false）；
 * - 授权态装配 `OrgOverviewWorkspace` 与 `OrgOverviewLayoutEditor`（抽屉形态，
 *   打开状态由本页持有，保存/重置成功后自动关闭并刷新布局缓存）。
 */
export function OrgOverviewPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const [editorOpen, setEditorOpen] = React.useState(false)

  return (
    <PermissionGuard
      require={['org:view', 'portfolio:view']}
      mode="any"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看组织概览的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 org:view 或 portfolio:view 权限方可查看组织概览。请联系组织管理员授予权限。
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
            组织概览需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <OrgOverviewWorkspace onOpenLayoutEditor={() => setEditorOpen(true)} />
          <OrgOverviewLayoutEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
        </div>
      )}
    </PermissionGuard>
  )
}

export default OrgOverviewPage
