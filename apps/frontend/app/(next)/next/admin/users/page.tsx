'use client'

import { PermissionGuard } from '@/components/PermissionGuard'
import { UsersAdminWorkspace } from '@/components/next/admin/users/UsersAdminWorkspace'

/**
 * 用户管理控制台新轨路由（/next/admin/users，
 * v3-ui-next-settings-admin-domains W6 · tasks 6.5，
 * spec「管理后台门户与平台治理控制台」Requirement 4）。
 *
 * - 准入：`PermissionGuard(require=['system:admin'])`；无权限时 fallback 挂载
 *   工作区自身的准入收口（受限横幅 `data-permission-fallback`，0 请求，RL-06）；
 * - 平台级控制台：无特定组织上下文绑定，由平台系统管理员全局维护；
 * - 敏感操作（启用/禁用、管理员重置他人 2FA）在工作区内二次确认并如实回显错误。
 */
export default function NextAdminUsersPage() {
  return (
    <PermissionGuard require="system:admin" fallback={<UsersAdminWorkspace />}>
      <UsersAdminWorkspace />
    </PermissionGuard>
  )
}
