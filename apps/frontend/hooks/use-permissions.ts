'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectKeys, projectMembersApi } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'

/**
 * 项目权限作用域：项目工作面内挂载，组件内的 `usePermissions()` 会把「本项目有效权限」
 * （组织 ∩ 项目 + 项目角色下放的管理权限）并入组织级 JWT claims。
 * 组织级 claims 不含项目角色——单独用会把项目经理误判成普通成员（只能拖自己的卡）。
 */
const ProjectPermissionContext = React.createContext<ReadonlySet<string> | null>(null)

export function ProjectPermissionScope({
  projectId,
  children,
}: {
  projectId: number
  children: React.ReactNode
}) {
  const query = useQuery({
    queryKey: projectKeys.myPermissions(projectId),
    queryFn: () => projectMembersApi.myPermissions(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
    staleTime: 60_000,
  })
  const value = React.useMemo(
    () => (query.data ? new Set(query.data.permissions) : null),
    [query.data],
  )
  return React.createElement(ProjectPermissionContext.Provider, { value }, children)
}

/**
 * 权限 Hook（任务 9.3）：读取当前会话权限声明并提供判断辅助。
 * **仅用于展示层**，一切安全判定以服务端为准。
 */
export function usePermissions() {
  const permissions = useAuthStore((s) => s.permissions)
  const hasOrgPermission = useAuthStore((s) => s.hasPermission)
  const projectPermissions = React.useContext(ProjectPermissionContext)

  const hasPermission = (permission: string) =>
    hasOrgPermission(permission) || (projectPermissions?.has(permission) ?? false)

  return {
    permissions,
    /** 是否具备某权限。 */
    can: hasPermission,
    /** `can` 的同义别名，便于与 auth store 的命名保持一致。 */
    hasPermission,
    /** 是否具备任一权限。 */
    canAny: (list: string[]) => list.some(hasPermission),
    /** 是否具备全部权限。 */
    canAll: (list: string[]) => list.every(hasPermission),
  }
}
