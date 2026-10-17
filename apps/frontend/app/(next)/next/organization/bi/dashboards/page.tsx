'use client'

import { PermissionGuard } from '@/components/PermissionGuard'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { BiDashboardsWorkspace } from '@/components/next/org-bi/BiDashboardsWorkspace'
import { OrgBiGuideState, OrgBiPermissionFallback } from '../org-bi-guide'

/**
 * 组织 BI 仪表盘路由（/next/organization/bi/dashboards，
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.5）。
 *
 * - 准入门禁：PermissionGuard(require=['org:view','portfolio:view'], mode='any')
 *   ——任一即可，与后端 BiDashboardPolicy 组织成员基底对齐；无权限受限横幅
 *   且工作台零请求（RL-06）；
 * - 组织 ID 一律取 auth store 有效租户上下文（selectEffectiveOrganizationId）；
 *   未选择组织时渲染引导态且零查询（旧页同款语义）；
 * - 组织级/全域页面：URL 不含 organizationId，跨租户引用由后端中性 404 收口。
 */
export default function OrgBiDashboardsPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require={['org:view', 'portfolio:view']}
      mode="any"
      fallback={<OrgBiPermissionFallback domainLabel="BI 仪表盘" />}
    >
      {organizationId === null ? (
        <OrgBiGuideState domainLabel="BI 仪表盘" />
      ) : (
        <BiDashboardsWorkspace organizationId={organizationId} />
      )}
    </PermissionGuard>
  )
}
