import type { QueryClient } from '@tanstack/react-query'
import { calendarKeys } from '@/lib/api/calendar'
import { projectKeys } from '@/lib/api/projects'
import { taskKeys } from '@/lib/api/tasks'
import { milestoneKeys } from '@/lib/api/milestones'
import { wbsKeys } from '@/lib/api/wbs'

/**
 * 任务写入后的唯一缓存失效入口。后续视图只需沿用 taskKeys.views 前缀。
 */
export async function invalidateTaskQueries(queryClient: QueryClient, projectId: number) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.details(projectId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.recycleBins(projectId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.views(projectId) }),
    // Calendar（含 deadline 与 schedule 两种模式）
    queryClient.invalidateQueries({ queryKey: calendarKeys.lists(projectId) }),
    // 里程碑（里程碑日期更新影响 Calendar schedule 模式）
    queryClient.invalidateQueries({ queryKey: milestoneKeys.lists(projectId) }),
    // 项目摘要 / 看板 / 甘特 / WBS
    queryClient.invalidateQueries({ queryKey: projectKeys.dashboard(projectId) }),
    queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) }),
    queryClient.invalidateQueries({ queryKey: ['kanban', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['gantt', projectId] }),
    // WBS 工作包状态 / 日期 / 进度由任务聚合，任务一变就要重取
    queryClient.invalidateQueries({ queryKey: wbsKeys.tree(projectId) }),
    // 全域时间主轴跨项目刻度档 (v3-ui-next-batch3-global-convergence W3)
    queryClient.invalidateQueries({ queryKey: ['global-timeline'] }),
    // 跨项目任务 HUD 与个人工作桶 (v3-ui-next-batch3-global-convergence)
    queryClient.invalidateQueries({ queryKey: ['cross-project-tasks'] }),
    // 「我的日历」（跨项目，日历第 3 批）
    queryClient.invalidateQueries({ queryKey: ['my-calendar'] }),
  ])
}

/**
 * 里程碑写入后的缓存失效。
 */
export async function invalidateMilestoneQueries(queryClient: QueryClient, projectId: number) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: milestoneKeys.lists(projectId) }),
    queryClient.invalidateQueries({ queryKey: milestoneKeys.details() }),
    // Calendar schedule 模式缓存
    queryClient.invalidateQueries({ queryKey: calendarKeys.lists(projectId) }),
    // 甘特（里程碑在甘特定位）
    queryClient.invalidateQueries({ queryKey: ['gantt', projectId] }),
    queryClient.invalidateQueries({ queryKey: projectKeys.dashboard(projectId) }),
    // 全域时间主轴跨项目刻度档 (v3-ui-next-batch3-global-convergence W3)
    queryClient.invalidateQueries({ queryKey: ['global-timeline'] }),
  ])
}
