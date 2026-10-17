'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { tasksApi, taskKeys, type PaginatedTasks } from '@/lib/api/tasks'
import { dependenciesApi, dependencyKeys } from '@/lib/api/dependencies'
import { buildGanttModelFromApi } from '@/lib/gantt/model-from-api'
import type { GanttModel } from '@/lib/gantt/types'
import { projectsApi, projectKeys, type Project } from '@/lib/api/projects'
import { milestonesApi, milestoneKeys } from '@/lib/api/milestones'

/** V1 单项目任务上限 ~1000（WBS 上限），一次拉满即可。 */
const GANTT_TASK_PAGE_SIZE = 100
const GANTT_TASK_MAX_PAGES = 10

export async function loadGanttTasks(projectId: number): Promise<PaginatedTasks> {
  const firstPage = await tasksApi.list(projectId, {
    page: 1,
    perPage: GANTT_TASK_PAGE_SIZE,
  })
  const pageCount = Math.min(firstPage.meta.totalPages, GANTT_TASK_MAX_PAGES)

  if (pageCount <= 1) return firstPage

  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      tasksApi.list(projectId, {
        page: index + 2,
        perPage: GANTT_TASK_PAGE_SIZE,
      }),
    ),
  )

  return {
    data: [firstPage, ...remainingPages].flatMap((page) => page.data),
    meta: firstPage.meta,
  }
}

/**
 * 拉取并组装某项目的甘特渲染模型（task 2.1）。tasks + 项目级 dependencies 两查询并行，
 * 由 `buildGanttModelFromApi` 组装（组织隔离在服务端保证）。数据未就绪返回 `model=null`。
 */
export function useProjectGanttModel(projectId: number): {
  model: GanttModel | null
  project: Project | null
  isLoading: boolean
  isError: boolean
  error: unknown
} {
  const projectQuery = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
  const tasksQuery = useQuery({
    queryKey: taskKeys.view(projectId, 'gantt', {
      page: 1,
      perPage: GANTT_TASK_PAGE_SIZE,
    }),
    queryFn: () => loadGanttTasks(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
  const depsQuery = useQuery({
    queryKey: dependencyKeys.project(projectId),
    queryFn: () => dependenciesApi.listByProject(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })
  const milestonesQuery = useQuery({
    queryKey: milestoneKeys.list(projectId, {}),
    queryFn: () => milestonesApi.list(projectId),
    enabled: Number.isFinite(projectId) && projectId > 0,
  })

  const model = useMemo(() => {
    if (!tasksQuery.data || !depsQuery.data || !milestonesQuery.data) return null
    return buildGanttModelFromApi(
      tasksQuery.data.data,
      depsQuery.data,
      projectQuery.data?.settings ?? null,
      milestonesQuery.data.data,
    )
  }, [tasksQuery.data, depsQuery.data, milestonesQuery.data, projectQuery.data])

  return {
    model,
    project: projectQuery.data ?? null,
    isLoading:
      projectQuery.isLoading ||
      tasksQuery.isLoading ||
      depsQuery.isLoading ||
      milestonesQuery.isLoading,
    isError:
      projectQuery.isError || tasksQuery.isError || depsQuery.isError || milestonesQuery.isError,
    error: projectQuery.error ?? tasksQuery.error ?? depsQuery.error ?? milestonesQuery.error,
  }
}
