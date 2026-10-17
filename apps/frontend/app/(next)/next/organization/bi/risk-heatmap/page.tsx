'use client'

import { PermissionGuard } from '@/components/PermissionGuard'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { RiskHeatmapWorkspace } from '@/components/next/org-bi/RiskHeatmapWorkspace'
import { OrgBiGuideState, OrgBiPermissionFallback } from '../org-bi-guide'

/**
 * 组织 BI 风险热力图路由（/next/organization/bi/risk-heatmap，
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.8）。
 *
 * - 准入门禁：`org:view` / `portfolio:view` 任一即可（与后端
 *   BiRiskHeatmapPolicy 入口一致）；无权限受限横幅且零请求（RL-06）；
 * - 只读分析镜头：工作台内全部交互（筛选/翻页/抽屉）零写请求（RL-01）；
 * - 未选择组织 → 引导态零查询；组织 ID 只取自 JWT 有效租户上下文。
 */
export default function OrgBiRiskHeatmapPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require={['org:view', 'portfolio:view']}
      mode="any"
      fallback={<OrgBiPermissionFallback domainLabel="BI 风险热力图" />}
    >
      {organizationId === null ? (
        <OrgBiGuideState domainLabel="BI 风险热力图" />
      ) : (
        <RiskHeatmapWorkspace organizationId={organizationId} />
      )}
    </PermissionGuard>
  )
}
