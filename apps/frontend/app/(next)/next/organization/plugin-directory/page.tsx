'use client'

/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.4 —— 组织插件目录新轨路由
 * （/next/organization/plugin-directory）。
 *
 * 准入（与后端 PluginRegistryPolicy.canView 同口径）：plugin_registry:view。
 * - 无该权限（或未选择组织）整页不渲染、零业务请求——不暴露入口存在性（RL-05/RL-06）；
 * - 动作级权限（plugin_registry:review|manage|rollback）不在此判断，由工作台内按
 *   「无权限动作不渲染、不以 disabled 暗示」纪律渲染；
 * - 数据 100% 复用既有 use-plugin-directory hooks（组织隔离由租户上下文 + query key
 *   组织前缀保证，跨组织不可达）。
 */
import { useAuthStore, selectEffectiveOrganizationId } from '@/stores/auth-store'
import { usePermissions } from '@/hooks/use-permissions'
import { PluginDirectoryWorkspace } from '@/components/next/org-plugin/PluginDirectoryWorkspace'

export default function NextOrgPluginDirectoryPage() {
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const { can } = usePermissions()

  if (organizationId === null || !can('plugin_registry:view')) {
    return null
  }

  return <PluginDirectoryWorkspace />
}
