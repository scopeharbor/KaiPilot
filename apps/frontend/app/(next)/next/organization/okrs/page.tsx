'use client'

import * as React from 'react'
import { ShieldAlert, Target } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { OkrWorkbench } from '@/components/next/org-okr/OkrWorkbench'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * OKR 层级管理路由（/next/organization/okrs，
 * v3-ui-next-org-portfolio-domains W2 · tasks 2.5，
 * spec「OKR 层级管理与达成仪表盘（幽灵守卫修复）」）。
 *
 * - 准入门禁：`PermissionGuard(require=['org:view','portfolio:view'])`（任一即可，
 *   与 OkrPolicy 视图口径一致）；**禁止沿用旧轨未登记权限 `okr:view`**（后端中央
 *   权限注册表不存在该权限、/auth/me 永不下发 → 旧页守卫恒拒——Design Decision 3
 *   幽灵守卫修复）——无两权限渲染受限横幅且工作台不挂载、/okrs 系列接口零请求；
 * - 组织 ID 一律取自 JWT 有效租户上下文（selectEffectiveOrganizationId），URL 不含
 *   organizationId；未选择组织渲染「请先选择组织」引导态且零查询（RL-05）；
 * - PROJECT_MANAGER 无 org:view 时经持有的 portfolio:view 任一集合兜底准入。
 */
export default function OrganizationOkrsPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

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
            你没有查看组织 OKR 的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 org:view 或 portfolio:view 权限方可查看 OKR 层级管理。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      {organizationId === null ? (
        <div
          data-org-no-organization
          className="flex min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 text-center"
        >
          <Target className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            OKR 层级管理需要有效租户上下文。请先切换到组织工作区后重试。
          </p>
        </div>
      ) : (
        <OkrWorkbench organizationId={organizationId} />
      )}
    </PermissionGuard>
  )
}
