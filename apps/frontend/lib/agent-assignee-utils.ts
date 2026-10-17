/**
 * Agent-assignee 过滤与计数工具函数（v3-copilot-agent-as-assignee）。
 *
 * 规则（proposal §2）：
 * - Agent 负责人不出现在资源负载计算中
 * - Agent 负责人不计入参与人数量
 * - Agent 负责人不出现在审批人选择器中
 */

import type { Task } from '@/lib/api/tasks'
import type { AssigneeType } from '@/types/agent-assignee'

/**
 * 从任务列表中过滤掉 agent 负责的任务（用于资源负载计算）。
 * Agent 只「出方案」不「执行工作」，不消耗人力工时。
 */
export function filterTasksForHumanLoad(tasks: Task[]): Task[] {
  return tasks.filter((task) => task.assigneeType !== 'agent')
}

/**
 * 计算排除 agent 后的人类参与人数量。
 * 用于项目统计、任务列表参与人数等场景。
 */
export function countHumanParticipants(tasks: Task[]): number {
  const humanIds = new Set<number>()
  for (const task of filterTasksForHumanLoad(tasks)) {
    if (task.assigneeId !== null) {
      humanIds.add(task.assigneeId)
    }
  }
  return humanIds.size
}

/**
 * 从成员列表中过滤掉 agent 类型的条目（用于审批人选择器）。
 * 审批必须由人类完成，AI 只出方案。
 */
export function filterMembersForApproverPicker<T extends { assigneeType?: AssigneeType }>(
  members: T[],
): T[] {
  return members.filter((member) => member.assigneeType !== 'agent')
}

/**
 * 计算人类工时（排除 agent 分配的任务）。
 * 用于资源负载视图的工时统计。
 */
export function sumHumanEstimatedHours(tasks: Task[]): number {
  return filterTasksForHumanLoad(tasks).reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0)
}
