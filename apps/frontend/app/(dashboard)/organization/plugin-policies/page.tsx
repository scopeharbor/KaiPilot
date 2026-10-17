'use client'

/**
 * v3-plugin-policy-bundles —— 组织插件策略包管理页（任务 4.1）。
 * 权限不足时组件内部整体不渲染（动作完全隐藏）。
 */
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import { PluginPolicyManager } from '@/components/plugin-policy/PluginPolicyManager'
import { usePermissions } from '@/hooks/use-permissions'

export default function OrganizationPluginPoliciesPage() {
  const organizationId = useCurrentOrganizationId()
  const { hasPermission } = usePermissions()
  // 无插件查看权限的组织成员：整页不渲染（不暴露入口存在性）
  if (organizationId === null || !hasPermission('plugin_install:view')) {
    return null
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold tracking-tight">组织插件策略</h1>
      <PluginPolicyManager organizationId={organizationId} />
    </div>
  )
}
