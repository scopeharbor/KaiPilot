'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.5 —— 插件策略包管理动作门禁 hook。
 *
 * 后端 PluginPolicyBundlePolicy.canManage 语义：组织成员表中当前组织成员角色为
 * owner/admin（owner/admin 经规范化后即 org_admin）。前端镜像该角色判定，并以既有
 * 权限码（org:manage / plugin_change_request:approve，均只授予组织管理员）辅助
 * 收敛——避免「按钮可见但必然 403」与「按钮隐藏但后端放行」的双向漂移。
 * 仅供展示层使用；安全边界始终在后端 Policy。
 */
import { useAuthStore, selectEffectiveOrganizationId } from '@/stores/auth-store'
import { usePermissions } from '@/hooks/use-permissions'

/** 规范化组织角色（后端 roles.ts canonicalizeOrgRole：owner/admin → org_admin）。 */
const OWNER_ADMIN_ROLES = new Set(['owner', 'admin', 'org_admin'])

export function usePolicyBundleManageGate(): boolean {
  const user = useAuthStore((state) => state.user)
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const { can } = usePermissions()

  const membership = user?.organizations.find((org) => org.id === organizationId)
  const roleOwnerAdmin = membership !== undefined && OWNER_ADMIN_ROLES.has(membership.role)

  return roleOwnerAdmin || can('org:manage') || can('plugin_change_request:approve')
}

export default usePolicyBundleManageGate
