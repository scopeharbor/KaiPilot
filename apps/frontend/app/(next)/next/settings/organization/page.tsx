'use client'

import { Building2, ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { OrgSettingsWorkspace } from '@/components/next/settings/organization/OrgSettingsWorkspace'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * 组织设置页（/next/settings/organization，v3-ui-next-settings-admin-domains W2 ·
 * tasks 2.5，spec「组织设置与成员治理」/ design D-ORG + D-PERM）。
 *
 * - 准入 `org:view`（PermissionGuard，体验层；后端 RBAC 仍是唯一边界）：无权限渲染
 *   受限横幅且工作区不挂载、`organizations`/`members` 接口**零请求**（RL-06）；
 * - **组织隔离（RL-05）**：组织 ID 一律取自 JWT 有效租户上下文
 *   （`selectEffectiveOrganizationId`），页面**不读任何** `?organizationId=` /
 *   `?orgId=` 查询参数，路由也没有组织路径段——跨组织探测面为零；组织切换走既有
 *   账户级 organization-selection 入口，不复制到设置空间；
 * - 未选择组织：渲染中性引导态且零查询（工作区不挂载）；
 * - 深层子路由坐标回显由 W9 `space-breadcrumbs.ts` 前缀规则承接
 *   （`/next/settings/... · 设置空间`），本页不注册自定义面包屑。
 */
export function OrganizationSettingsPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require="org:view"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有查看组织设置的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 org:view 权限方可查看组织资料与成员底册。请联系组织管理员授予权限。
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
            组织设置需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : (
        <OrgSettingsWorkspace organizationId={organizationId} />
      )}
    </PermissionGuard>
  )
}

export default OrganizationSettingsPage
