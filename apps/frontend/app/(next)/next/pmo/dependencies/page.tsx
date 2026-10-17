'use client'

import { Building2, GitBranch } from 'lucide-react'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { PmoDependenciesWorkspace } from '@/components/next/pmo/dependencies/PmoDependenciesWorkspace'

/**
 * 跨项目依赖路由（/next/pmo/dependencies，v3-ui-next-pmo-domain W7 · tasks 7.1，
 * 迁移台账 #4：旧 `/pmo/dependencies`）。
 *
 * - **不做权限硬断**（Design D5 门禁裁决）：查看准入 = 组织成员（orgId 水合即放行），
 *   服务端 `MultiProjectDependencyPolicy` 按项目可见性脱敏，废弃旧页 legacy 权限串
 *   （dependency.view / dependency.manage / pmo）；管理写操作以 `portfolio:manage`
 *   代理 org-admin 在容器内显隐，服务端 isOrgAdmin 终裁；
 * - 组织上下文取 auth store 有效租户上下文；orgId 未水合渲染「请先选择组织」引导态
 *   且零请求（RL-05 / RL-06）；
 * - 组织层页面：URL 无 organizationId，跨组织引用由后端中性 404/403 收口。
 */

/** 未选择组织的中性引导态（零数据请求）。 */
function PmoDependenciesGuideState() {
  return (
    <div
      data-org-guide-state
      className="flex flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
    >
      <Building2 className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
      <p className="text-sm font-medium text-[var(--nx-text-primary)]">请先选择组织</p>
      <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
        跨项目依赖数据来自当前租户上下文。请先从右上角切换或选择组织后再访问本页。
      </p>
    </div>
  )
}

export default function PmoDependenciesPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <div data-pmo-deps-page className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-[11px] text-[var(--nx-text-muted)]">
        <GitBranch className="h-3.5 w-3.5" aria-hidden />
        组合层 · 跨项目依赖（组织级）
      </div>
      {organizationId === null ? <PmoDependenciesGuideState /> : null}
      {organizationId !== null ? (
        <PmoDependenciesWorkspace organizationId={organizationId} />
      ) : null}
    </div>
  )
}
