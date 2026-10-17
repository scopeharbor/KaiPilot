'use client'

import type { ReactNode } from 'react'
import { usePermissions } from '@/hooks/use-permissions'

export interface PermissionGuardProps {
  /** 所需权限（单个或多个）。 */
  require: string | string[]
  /** 多权限时的匹配模式：'all'（默认，需全部）| 'any'（任一即可）。 */
  mode?: 'all' | 'any'
  /** 无权限时的降级内容（默认不渲染）。 */
  fallback?: ReactNode
  children: ReactNode
}

/**
 * 权限门控组件（任务 9.3，design D11）。
 *
 * 按当前会话权限声明控制子内容的展示/降级。**仅展示层控制，非安全边界**——
 * 所有敏感操作仍由服务端 RBAC 判定；前端隐藏只为体验，不能替代后端授权。
 */
export function PermissionGuard({
  require,
  mode = 'all',
  fallback = null,
  children,
}: PermissionGuardProps) {
  const { can, canAny, canAll } = usePermissions()

  const list = Array.isArray(require) ? require : [require]
  const allowed = list.length === 1 ? can(list[0]!) : mode === 'any' ? canAny(list) : canAll(list)

  return <>{allowed ? children : fallback}</>
}

export default PermissionGuard
