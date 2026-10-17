'use client'

import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { OrgAuditLogsWorkspace } from '@/components/next/settings/audit/OrgAuditLogsWorkspace'

/**
 * 组织审计日志页（/next/settings/audit-logs，v3-ui-next-settings-admin-domains W2 ·
 * tasks 2.7，spec「组织审计日志检索」/ design D-PERM 权限矩阵）。
 *
 * - 准入 `audit:view`（PermissionGuard，体验层；后端 `AuditLogPolicy` + 路由权限表
 *   `audit_logs.index` → `audit:view` 是唯一边界）：无权限渲染受限横幅且工作区不挂载、
 *   `/audit-logs` 接口**零请求**（RL-06）；
 * - 组织范围由服务端按会话租户解析（`ctx.tenant.organizationId`），页面不传也不接受
 *   任何 organizationId 参数（RL-05 跨租户枚举面为零）；
 * - 只读页：无任何写入口，导出/详情保持既有端点门（本页不额外提供写动作）。
 */
export function OrgAuditLogsPage() {
  return (
    <PermissionGuard
      require="audit:view"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            没有查看审计日志的权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            需要 audit:view 权限方可检索本组织审计流水。请联系组织管理员授予权限。
          </p>
        </div>
      }
    >
      <OrgAuditLogsWorkspace />
    </PermissionGuard>
  )
}

export default OrgAuditLogsPage
