'use client'

import { Building2, ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { PmoTrafficLightWorkspace } from '@/components/next/pmo/traffic-light/PmoTrafficLightWorkspace'

/**
 * PMO 红绿灯报告路由（/next/pmo/traffic-light，v3-ui-next-pmo-domain W2 ·
 * tasks 2.1，迁移台账 #8：旧 `/pmo/traffic-light`）。
 *
 * - 组织层页面（无 projectId）：门禁 `portfolio:view`（镜像后端 policy 与旧页），
 *   无权限渲染受限横幅（data-permission-fallback）并物理阻断工作台与数据请求
 *   （RL-06）；服务端为最终裁判；
 * - 组织上下文取 auth store 有效租户上下文；orgId 未水合渲染「请先选择组织」
 *   引导态且零请求（Decision 2 / RL-05 中性文案）；
 * - 复核（POST /pmo/traffic-light/:projectId/review）仅 `portfolio:manage`
 *   入口可见，人工二次确认后提交（RL-01 零自动写）。
 */

/** 无 portfolio:view 的受限横幅（与项目级页面守卫同探针契约）。 */
function PmoTrafficLightPermissionFallback() {
  return (
    <div
      data-permission-fallback
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
    >
      <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
        你没有查看红绿灯报告的权限
      </h3>
      <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
        请联系组织管理员授予 portfolio:view 权限。
      </p>
    </div>
  )
}

/** 未选择组织的中性引导态（零数据请求）。 */
function PmoTrafficLightGuideState() {
  return (
    <div
      data-org-guide-state
      className="flex flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
    >
      <Building2 className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
      <p className="text-sm font-medium text-[var(--nx-text-primary)]">请先选择组织</p>
      <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
        组织级红绿灯报告数据来自当前租户上下文。请先从右上角切换或选择组织后再访问本页。
      </p>
    </div>
  )
}

export default function PmoTrafficLightPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard require={['portfolio:view']} fallback={<PmoTrafficLightPermissionFallback />}>
      {organizationId === null ? <PmoTrafficLightGuideState /> : <PmoTrafficLightWorkspace />}
    </PermissionGuard>
  )
}
