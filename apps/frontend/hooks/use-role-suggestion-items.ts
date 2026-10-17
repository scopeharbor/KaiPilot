/**
 * 角色首页建议卡数据 hook：按角色桶拉取真实只读数据源并派生卡片模型。
 *
 * - admin/pm/observer：组织 Dashboard 摘要（admin 另加审计近 7 日统计）；
 * - member：项目列表 → 逐项目我的任务（assigneeId=本人）fan-out 聚合
 *   （今日到期/进行中/阻塞）；
 * - unknown：导引卡为静态真实提示，零查询。
 *
 * 纪律：全部 GET 只读；组织未选择时零请求；加载/失败如实映射到「…/暂缺」。
 */

'use client'

import * as React from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import type { OrganizationDashboardSummary } from '@aiproj/types'
import { auditLogKeys, auditLogsApi } from '@/lib/api/audit-logs'
import {
  fetchOrganizationDashboard,
  organizationDashboardKeys,
} from '@/lib/api/organization-dashboard'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import { taskKeys, tasksApi } from '@/lib/api/tasks'
import type { RoleBucket } from '@/lib/next/role-bucket'
import {
  buildRoleSuggestionCards,
  type RoleSuggestionCardModel,
} from '@/lib/next/role-suggestion-metrics'
import { useAuthStore } from '@/stores/auth-store'

/** 我的任务聚合：到期（endDate ≤ 今日且未完成）、进行中、阻塞。 */
export function aggregateMyTasks(
  taskLists: Array<{ data?: Array<{ endDate?: string | null; status?: string }> } | undefined>,
  todayIso: string,
): { dueToday: number; inProgress: number; blocked: number } {
  let dueToday = 0
  let inProgress = 0
  let blocked = 0
  for (const list of taskLists) {
    for (const task of list?.data ?? []) {
      const status = task.status ?? ''
      if (status === 'in_progress') inProgress += 1
      if (status === 'blocked') blocked += 1
      if (
        task.endDate &&
        task.endDate.slice(0, 10) <= todayIso &&
        status !== 'completed' &&
        status !== 'cancelled'
      ) {
        dueToday += 1
      }
    }
  }
  return { dueToday, inProgress, blocked }
}

export function useRoleSuggestionItems(bucket: RoleBucket): RoleSuggestionCardModel[] {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  const userId = useAuthStore((state) => state.user?.id ?? null)

  const needsDashboard = bucket === 'admin' || bucket === 'pm' || bucket === 'observer'
  const dashboardQuery = useQuery({
    queryKey: organizationDashboardKeys.summary(organizationId, {}),
    queryFn: () => fetchOrganizationDashboard(organizationId ?? 0),
    enabled: needsDashboard && organizationId != null,
    staleTime: 30_000,
  })

  const auditQuery = useQuery({
    queryKey: [...auditLogKeys.all, 'role-home-weekly'],
    queryFn: () => auditLogsApi.stats(),
    enabled: bucket === 'admin' && organizationId != null,
    staleTime: 30_000,
  })

  // member 桶：项目列表 → 逐项目我的任务 fan-out
  const projectsQuery = useQuery({
    queryKey: projectKeys.list(organizationId ?? 0, { perPage: 50 }),
    queryFn: () => projectsApi.list({ perPage: 50 }),
    enabled: bucket === 'member' && organizationId != null && userId != null,
    staleTime: 30_000,
  })
  const projectIds = React.useMemo(
    () => (projectsQuery.data?.data ?? []).map((project) => project.id),
    [projectsQuery.data],
  )
  const myTaskQueries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: [...taskKeys.all, 'role-home-mine', projectId, userId ?? 0] as const,
      queryFn: () => tasksApi.list(projectId, { assigneeId: userId ?? undefined, perPage: 100 }),
      enabled: bucket === 'member' && userId != null,
      staleTime: 30_000,
    })),
  })

  const summary: OrganizationDashboardSummary | null | undefined = needsDashboard
    ? (dashboardQuery.data ?? null)
    : undefined

  const auditWeeklyTotal =
    bucket === 'admin' && auditQuery.data
      ? auditQuery.data.byDay.reduce((sum, day) => sum + day.count, 0)
      : undefined

  const todayIso = new Date().toISOString().slice(0, 10)
  const myTasks =
    bucket === 'member'
      ? aggregateMyTasks(
          myTaskQueries.map((query) => query.data),
          todayIso,
        )
      : undefined

  const loading =
    (needsDashboard && dashboardQuery.isPending) ||
    (bucket === 'admin' && auditQuery.isPending) ||
    (bucket === 'member' &&
      (projectsQuery.isPending || myTaskQueries.some((query) => query.isPending)))
  const error =
    (needsDashboard && dashboardQuery.isError) ||
    (bucket === 'admin' && auditQuery.isError) ||
    (bucket === 'member' && (projectsQuery.isError || myTaskQueries.some((query) => query.isError)))

  return React.useMemo(
    () =>
      buildRoleSuggestionCards(bucket, {
        summary,
        auditWeeklyTotal,
        myTasks,
        loading,
        error,
      }),
    [
      bucket,
      summary,
      auditWeeklyTotal,
      myTasks?.dueToday,
      myTasks?.inProgress,
      myTasks?.blocked,
      loading,
      error,
    ],
  )
}
