'use client'

import { AdminLandingHub } from '@/components/next/admin/AdminLandingHub'

/**
 * 管理后台门户路由（/next/admin，v3-ui-next-settings-admin-domains W6 · tasks 6.3，
 * spec「管理后台门户与平台治理控制台」Requirement 1 + design D-ADM / D-HUB）。
 *
 * - 薄壳：准入门禁与权限收敛单点收敛在 `AdminLandingHub`（沿 `admin-consoles.ts`
 *   静态白名单 + `filterAdminConsoles`），避免页面与组件两处维护同一份权限口径；
 * - 无任何控制台 view 权限（`system:admin` / `ai_quality_cost_console:view` /
 *   `ai:compiler:routing:view` / `release_trust_center:view` 均不命中）时，门户渲染
 *   **中性受限页**：不渲染任何控制台名称、不泄露清单存在性，且零业务请求
 *   （D-ADM / RL-05 / RL-06：门户不订阅任何服务端态）；
 * - 门户为台账外净新增页（旧轨无 `/admin` 索引页），承担 D4「管理员 → 治理控制台」
 *   新轨落点，以及空间地图 `admin` 坐标 / AI `navigate_to_space(admin)` 的落地面。
 */
export default function NextAdminPortalPage() {
  return <AdminLandingHub />
}
