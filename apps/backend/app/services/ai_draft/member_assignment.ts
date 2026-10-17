/**
 * 导入时的人员分配（2026-09-27）：审查页把草案里的角色对应到组织成员，导入时把任务指派给真人。
 *
 * - 任务负责人提示为「成员#id」（输入框 @ 的成员）时直接指派该成员；
 * - 否则按任务角色（assigneeRoleIds 优先，其次 assigneeHint 分段）找到分配给该角色的成员，
 *   在其中挑当前已分配工作量（工作日合计）最少的人，保证同角色多人时负载均衡；
 * - 只接受本组织的在职成员，其余 userId 静默忽略；被指派的成员自动加入项目（项目成员角色）。
 */

import type { ProjectDraft } from '@aiproj/types'
import { canonicalRole } from './resource_plan.ts'

export interface RoleAssignment {
  role: string
  userIds: number[]
}

const MEMBER_CODE = /成员#(\d+)/u
const ROLE_SEPARATOR = /[、,，/;；+]+/u

function normalizeRole(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/(组|团队|工程师)$/u, '')
    .toLowerCase()
}

function taskRoles(task: ProjectDraft['tasks'][number]): string[] {
  const ids = task.assigneeRoleIds?.value
  if (Array.isArray(ids) && ids.length > 0) return ids
  return (task.assigneeHint.value ?? '')
    .split(ROLE_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * 计算每个草案任务的负责人 userId（纯函数，便于测试）。
 * allowedUserIds 为本组织在职成员；不在其中的指派一律忽略。
 */
export function planTaskAssignees(
  draft: ProjectDraft,
  assignments: readonly RoleAssignment[],
  allowedUserIds: ReadonlySet<number>,
): Map<string, number> {
  const byRole = new Map<string, number[]>()
  for (const assignment of assignments) {
    const users = assignment.userIds.filter((id) => allowedUserIds.has(id))
    if (users.length > 0) byRole.set(normalizeRole(assignment.role), users)
  }
  const load = new Map<number, number>()
  const result = new Map<string, number>()
  for (const task of draft.tasks) {
    const hint = task.assigneeHint.value ?? ''
    const code = MEMBER_CODE.exec(hint)
    if (code && allowedUserIds.has(Number(code[1]))) {
      const userId = Number(code[1])
      result.set(task.id, userId)
      load.set(userId, (load.get(userId) ?? 0) + (Number(task.durationDays.value) || 1))
      continue
    }
    // 同一角色族的不同写法（「后端」「后端开发」「后端开发工程师」）归到审查页分配的那个角色上。
    const assignmentRoster = assignments.map((item) => ({ role: item.role, headcount: 1 }))
    for (const role of taskRoles(task)) {
      const candidates =
        byRole.get(normalizeRole(role)) ??
        byRole.get(normalizeRole(canonicalRole(role, assignmentRoster)))
      if (!candidates) continue
      const userId = [...candidates].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0]
      result.set(task.id, userId)
      load.set(userId, (load.get(userId) ?? 0) + (Number(task.durationDays.value) || 1))
      break
    }
  }
  return result
}
