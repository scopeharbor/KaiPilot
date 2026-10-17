'use client'

import type { ReactNode } from 'react'
import { useParams } from 'next/navigation'
import { ProjectPermissionScope } from '@/hooks/use-permissions'
import { useRealtime } from '@/hooks/use-realtime'

/**
 * 新轨项目路由公共作用域：
 * - 项目权限（项目经理等项目角色的管理权限）；
 * - 加入项目实时频道：他人拖卡片 / 改状态 / 批量指派后，看板、甘特、WBS、列表自动刷新。
 */
export function ProjectRouteScope({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>()
  const projectId = Number(params?.id)
  useRealtime(Number.isFinite(projectId) && projectId > 0 ? projectId : undefined)
  return <ProjectPermissionScope projectId={projectId}>{children}</ProjectPermissionScope>
}
