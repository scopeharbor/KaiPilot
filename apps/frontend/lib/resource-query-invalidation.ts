import type { QueryClient } from '@tanstack/react-query'
import { calendarKeys } from '@/lib/api/calendar'
import { ganttScheduleKeys } from '@/lib/api/gantt-scheduling'
import { kanbanKeys } from '@/lib/api/kanban'
import { projectKeys } from '@/lib/api/projects'
import {
  allocationKeys,
  availabilityKeys,
  requirementKeys,
  resourceKeys,
  resourcePlanningKeys,
} from '@/lib/api/resources'
import { taskKeys } from '@/lib/api/tasks'
import { wbsKeys } from '@/lib/api/wbs'

/**
 * 资源写入后的统一缓存失效入口。
 *
 * 资源需求/分配/可用性会影响资源工作台，也会改变任务详情、项目 Dashboard
 * 和多视图中的资源摘要提示；这里集中维护跨视图刷新范围。
 */
export async function invalidateResourceQueries(queryClient: QueryClient, projectId: number) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: resourceKeys.all }),
    queryClient.invalidateQueries({ queryKey: allocationKeys.all }),
    queryClient.invalidateQueries({ queryKey: requirementKeys.lists(projectId) }),
    queryClient.invalidateQueries({ queryKey: resourcePlanningKeys.all }),
    queryClient.invalidateQueries({ queryKey: availabilityKeys.all }),
    queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.details(projectId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.views(projectId) }),
    queryClient.invalidateQueries({ queryKey: calendarKeys.lists(projectId) }),
    queryClient.invalidateQueries({ queryKey: kanbanKeys.columns(projectId) }),
    queryClient.invalidateQueries({ queryKey: wbsKeys.tree(projectId) }),
    queryClient.invalidateQueries({ queryKey: ['gantt', projectId] }),
    queryClient.invalidateQueries({ queryKey: ganttScheduleKeys.project(projectId) }),
    queryClient.invalidateQueries({ queryKey: projectKeys.dashboard(projectId) }),
    queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
  ])
}
