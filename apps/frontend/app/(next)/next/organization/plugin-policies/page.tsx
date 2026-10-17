'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.7 —— 组织插件策略新轨路由
 * （/next/organization/plugin-policies）。
 *
 * 准入（与后端 plugin_install:view 同口径）：plugin_install:view。
 * - 无该权限（或未选择组织）整页不渲染、零业务请求——不暴露入口存在性（RL-05/RL-06）；
 * - copy/activate 管理动作发起权（组织 owner/admin）由工作台内 usePolicyBundleManageGate
 *   判定（后端 PluginPolicyBundlePolicy.canManage 同口径），无权限物理不渲染。
 */
import { useAuthStore, selectEffectiveOrganizationId } from '@/stores/auth-store'
import { usePermissions } from '@/hooks/use-permissions'
import { PluginPolicyWorkspace } from '@/components/next/org-plugin/PluginPolicyWorkspace'

export default function NextOrgPluginPoliciesPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const { can } = usePermissions()

  if (organizationId === null || !can('plugin_install:view')) {
    return null
  }

  return <PluginPolicyWorkspace />
}
