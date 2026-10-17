'use client'

import { PermissionGuard } from '@/components/PermissionGuard'
import { CompilerRoutingWorkspace } from '@/components/next/admin/compiler-routing/CompilerRoutingWorkspace'

/**
 * 编译器路由管理新轨路由（/next/admin/compiler-routing，
 * v3-ui-next-settings-admin-domains W7 · tasks 7.6）。
 *
 * - 准入：`PermissionGuard(require=['ai:compiler:routing:view'])`——与后端
 *   `CompilerRoutingPolicy.canViewRouting` 同口径；无权限时 fallback 挂载工作区
 *   自身的准入收口（free 档企业版锁定占位 / 付费档中性受限横幅），两种形态都
 *   零数据请求（RL-06）；
 * - 规则编排写门（`ai:compiler:routing:manage`）在工作区内判定，无权限物理不渲染编辑器；
 * - 加载骨架 / 语义空态 / 错误重试三态由工作区组件提供。
 */
export default function NextAdminCompilerRoutingPage() {
  return (
    <PermissionGuard require="ai:compiler:routing:view" fallback={<CompilerRoutingWorkspace />}>
      <CompilerRoutingWorkspace />
    </PermissionGuard>
  )
}
