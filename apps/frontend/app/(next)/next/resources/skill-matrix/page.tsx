'use client'

import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { SkillMatrixWorkspace } from '@/components/next/org-skill-matrix/SkillMatrixWorkspace'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/**
 * 技能矩阵新轨路由（/next/resources/skill-matrix，
 * v3-ui-next-org-portfolio-domains W8 · tasks 8.4）。
 *
 * 组织级/全局视窗（无 projectId 上下文）：
 * - 组织 ID 一律取自 auth 有效租户上下文（selectEffectiveOrganizationId），未选择
 *   组织时渲染引导态且**零查询**（修复旧轨 `orgId ?? 1` 静默兜底缺陷）；
 * - 页守卫 = 后端 ResourceSkillMatrixPolicy 列级明细门并集
 *   `resource:view`/`portfolio:view`/`ai:compiler:skill:view`（任一即可，design
 *   Decision 7）：无权限渲染受限横幅，工作台与一切矩阵接口零请求（RL-06）；
 * - 技能明细列级脱敏（skill 明细/资源事实）由后端 policy 逐列裁决，前端零猜测。
 */
export default function ResourceSkillMatrixNextPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  if (organizationId === null) {
    return (
      <div
        data-org-guidance
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-8 py-14 text-center"
      >
        <ShieldAlert className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
        <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">请先选择组织</h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          技能矩阵为组织级全局视图，需要有效组织租户上下文。请先在组织切换器中完成选择。
        </p>
      </div>
    )
  }

  return (
    <PermissionGuard
      require={['resource:view', 'portfolio:view', 'ai:compiler:skill:view']}
      mode="any"
      fallback={
        <div
          data-skill-matrix-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            你没有访问技能矩阵的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 resource:view / portfolio:view / ai:compiler:skill:view
            任一权限。请联系组织管理员授权。
          </p>
        </div>
      }
    >
      <SkillMatrixWorkspace organizationId={organizationId} />
    </PermissionGuard>
  )
}
