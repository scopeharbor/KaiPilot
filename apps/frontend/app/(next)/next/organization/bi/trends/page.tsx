'use client'

import { PermissionGuard } from '@/components/PermissionGuard'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { TrendsWorkspace } from '@/components/next/org-bi/TrendsWorkspace'
import { OrgBiGuideState, OrgBiPermissionFallback } from '../org-bi-guide'

/**
 * 组织 BI 趋势分析路由（/next/organization/bi/trends，
 * v3-ui-next-org-portfolio-domains W3 · tasks 3.11）。
 *
 * - 准入门禁：`org:view` / `portfolio:view` 任一即可（与后端
 *   BiTrendAnalysisPolicy 入口一致）；无权限受限横幅且零请求（RL-06）；
 * - 只读分析镜头：指标切换/时段/粒度/开关全部只触发 GET 重查（RL-01）；
 * - 未选择组织 → 引导态零查询；组织 ID 只取自 JWT 有效租户上下文。
 */
export default function OrgBiTrendsPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)

  return (
    <PermissionGuard
      require={['org:view', 'portfolio:view']}
      mode="any"
      fallback={<OrgBiPermissionFallback domainLabel="BI 趋势分析" />}
    >
      {organizationId === null ? (
        <OrgBiGuideState domainLabel="BI 趋势分析" />
      ) : (
        <TrendsWorkspace organizationId={organizationId} />
      )}
    </PermissionGuard>
  )
}
