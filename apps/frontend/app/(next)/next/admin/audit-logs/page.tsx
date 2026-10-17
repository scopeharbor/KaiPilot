'use client'

import { PermissionGuard } from '@/components/PermissionGuard'
import { GlobalAuditLogsWorkspace } from '@/components/next/admin/audit/GlobalAuditLogsWorkspace'

/**
 * 全局审计日志控制台新轨路由（/next/admin/audit-logs，
 * v3-ui-next-settings-admin-domains W6 · tasks 6.7，
 * spec「管理后台门户与平台治理控制台」Requirement 2）。
 *
 * - 准入：`PermissionGuard(require=['system:admin'])`；无权限时 fallback 挂载
 *   工作区自身的准入收口（受限横幅 `data-permission-fallback`，0 请求，RL-06）；
 * - 平台级控制台：只读展示跨全部组织的全局操作流水，无写入口。
 */
export default function NextAdminAuditLogsPage() {
  return (
    <PermissionGuard require="system:admin" fallback={<GlobalAuditLogsWorkspace />}>
      <GlobalAuditLogsWorkspace />
    </PermissionGuard>
  )
}
