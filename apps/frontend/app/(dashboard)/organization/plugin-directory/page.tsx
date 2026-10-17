'use client'

/**
 * v3-organization-private-plugin-directory —— 组织私有插件目录页（tasks 4.1/4.3）。
 *
 * 权限映射（与后端 PluginRegistryPolicy 一一对应）：
 *   plugin_registry:view     —— 无此权限整页不渲染，不暴露入口存在性
 *   plugin_registry:review   —— 「批准」入口
 *   plugin_registry:manage   —— 「停止分发」「恢复送审」入口与受影响安装清单
 *   plugin_registry:rollback —— 「回滚到此版本」入口
 * 无权限的动作**不渲染**，也不以 disabled 暗示能力存在。
 */
import { PluginDirectoryWorkbench } from '@/components/plugin-registry/PluginDirectoryWorkbench'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import { usePermissions } from '@/hooks/use-permissions'

export default function OrganizationPluginDirectoryPage() {
  const organizationId = useCurrentOrganizationId()
  const { hasPermission } = usePermissions()

  if (organizationId === null || !hasPermission('plugin_registry:view')) {
    return null
  }

  const canApprove = hasPermission('plugin_registry:review')
  const canManage = hasPermission('plugin_registry:manage')
  const canRollback = hasPermission('plugin_registry:rollback')

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold tracking-tight">组织私有插件目录</h1>
      <PluginDirectoryWorkbench
        canManageReview={canApprove || canManage}
        canApprove={canApprove}
        canManage={canManage}
        canRollback={canRollback}
      />
    </div>
  )
}
