'use client'

/**
 * 空间地图场景状态自适应 Hook
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §2 (域/恒星/环绕体), §3 (双向状态契约)
 * - design.md Decision 3, Decision 4, Decision 5
 * - tasks.md 2.3
 * - RL-05 (组织隔离): 自动绑定有效租户上下文 selectEffectiveOrganizationId
 * - RL-06 (副作用边界): 纯受控派生，组件卸载完整清理
 */

import * as React from 'react'
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query'
import { projectsApi, projectKeys, type Project } from '@/lib/api/projects'
import {
  organizationSignalsApi,
  organizationSignalKeys,
  type ProjectSignal,
} from '@/lib/api/organization-signals'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { PRESET_SPACE_COORDINATES, type SpaceCoordinate } from '@/lib/next/space-coordinates'
import {
  computeGalaxyLayout,
  type GalaxyLayoutResult,
  GALAXY_SECTORS,
  type GalaxySector,
} from './spacemap-galaxy-layout'
import { mapProjectToStarVisualState, type StarVisualState } from './spacemap-state-mapper'

export interface UseSpaceMapSceneStateOptions {
  /** 外部直接注入的项目（单元测试或受控外部传入） */
  projects?: Project[]
  /** 外部直接注入的雷达信号 */
  signals?: ProjectSignal[]
  /** 空间坐标白名单集合，默认使用 PRESET_SPACE_COORDINATES */
  coordinates?: readonly SpaceCoordinate[]
  /** 当前检索词（驱动高亮/虚化） */
  query?: string
  /** 当前选中聚焦的项目 ID */
  selectedId?: number | null
}

export interface UseSpaceMapSceneStateReturn {
  projects: Project[]
  signals: ProjectSignal[]
  coordinates: readonly SpaceCoordinate[]
  layout: GalaxyLayoutResult
  sectors: GalaxySector[]
  stars: StarVisualState[]
  activeStar: StarVisualState | null
  activeProject: Project | null
  isLoading: boolean
  matchedCount: number
  totalCount: number
}

export function useSpaceMapSceneState(
  options: UseSpaceMapSceneStateOptions = {},
): UseSpaceMapSceneStateReturn {
  const {
    projects: propProjects,
    signals: propSignals,
    coordinates = PRESET_SPACE_COORDINATES,
    query = '',
    selectedId = null,
  } = options

  const user = useAuthStore((state) => state.user)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const orgId = selectEffectiveOrganizationId({ currentOrganizationId, user }) ?? 0

  const hasQueryClient = Boolean(React.useContext(QueryClientContext))
  const fallbackClientRef = React.useRef<QueryClient | null>(null)
  if (!hasQueryClient && !fallbackClientRef.current) {
    fallbackClientRef.current = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    })
  }
  const effectiveClient = hasQueryClient ? undefined : fallbackClientRef.current!

  // 1. 项目数据加载（若无外部传入）
  const { data: projectsQueryData, isLoading: isProjectsLoading } = useQuery(
    {
      queryKey: projectKeys.list(orgId, { perPage: 100 }),
      queryFn: () => projectsApi.list({ perPage: 100 }),
      enabled: hasQueryClient && propProjects === undefined && orgId > 0,
    },
    effectiveClient,
  )

  // 2. 组织级雷达信号加载（若无外部传入）
  const { data: signalsQueryData, isLoading: isSignalsLoading } = useQuery(
    {
      queryKey: organizationSignalKeys.list(orgId, { perPage: 100 }),
      queryFn: () => organizationSignalsApi.list(orgId, { perPage: 100 }),
      enabled: hasQueryClient && propSignals === undefined && orgId > 0,
    },
    effectiveClient,
  )

  const effectiveProjects = React.useMemo(() => {
    if (propProjects !== undefined) return propProjects
    return projectsQueryData?.data ?? []
  }, [propProjects, projectsQueryData])

  const effectiveSignals = React.useMemo(() => {
    if (propSignals !== undefined) return propSignals
    return signalsQueryData?.data ?? []
  }, [propSignals, signalsQueryData])

  // 3. 计算 3D 拓扑布局 (耗时 < 3ms，RL-14 确定性纯函数)
  const layout = React.useMemo(() => {
    return computeGalaxyLayout(effectiveProjects, coordinates)
  }, [effectiveProjects, coordinates])

  // 4. 驱动派生恒星三维视觉参数 (State-Driven)
  const stars = React.useMemo(() => {
    return effectiveProjects.map((project) => {
      const node = layout.starMap.get(project.id)
      const position = node?.position ?? [0, 0, 0]
      return mapProjectToStarVisualState(project, {
        position,
        signals: effectiveSignals,
        query,
        selectedId,
      })
    })
  }, [effectiveProjects, layout.starMap, effectiveSignals, query, selectedId])

  const activeStar = React.useMemo(() => {
    if (!selectedId) return null
    return stars.find((s) => s.projectId === selectedId) ?? null
  }, [selectedId, stars])

  const activeProject = React.useMemo(() => {
    if (!selectedId) return null
    return effectiveProjects.find((p) => p.id === selectedId) ?? null
  }, [selectedId, effectiveProjects])

  const matchedCount = React.useMemo(() => {
    return stars.filter((s) => s.isMatch).length
  }, [stars])

  return {
    projects: effectiveProjects,
    signals: effectiveSignals,
    coordinates,
    layout,
    sectors: Object.values(GALAXY_SECTORS),
    stars,
    activeStar,
    activeProject,
    isLoading:
      (propProjects === undefined && isProjectsLoading) ||
      (propSignals === undefined && isSignalsLoading),
    matchedCount,
    totalCount: stars.length,
  }
}
