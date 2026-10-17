'use client'

import * as React from 'react'
import { Users } from 'lucide-react'
import type { ProjectDraft } from '@aiproj/types'
import { useOrganizationMembers } from '@/hooks/use-organization-members'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const ROLE_SEPARATOR = /[、,，/;；+]+/u
const MEMBER_CODE = /^成员#\d+$/u

/** 草案里出现的角色：资源建议 + 任务负责人角色，按任务工作量（工作日合计）降序。 */
export function draftRoles(
  draft: ProjectDraft,
): Array<{ role: string; workdays: number; headcount: number | null }> {
  const workdays = new Map<string, number>()
  for (const task of draft.tasks) {
    const ids = task.assigneeRoleIds?.value
    const roles =
      Array.isArray(ids) && ids.length > 0
        ? ids
        : (task.assigneeHint.value ?? '').split(ROLE_SEPARATOR).map((part) => part.trim())
    for (const role of roles) {
      if (!role || MEMBER_CODE.test(role)) continue
      workdays.set(role, (workdays.get(role) ?? 0) + (Number(task.durationDays.value) || 0))
    }
  }
  const headcount = new Map(
    draft.resourceHints.map((hint) => [hint.role.value, Number(hint.headcount.value) || null]),
  )
  for (const role of headcount.keys()) if (!workdays.has(role)) workdays.set(role, 0)
  return [...workdays.entries()]
    .map(([role, days]) => ({ role, workdays: days, headcount: headcount.get(role) ?? null }))
    .sort((a, b) => b.workdays - a.workdays)
}

/**
 * 人员分配（D：成员入口二）：把草案角色对应到组织成员，导入时按角色负载均衡把任务指派给真人。
 * 不分配也能导入（任务保留角色提示，导入后再指派）。
 */
export function NextDraftMemberAssignment({ draft }: { draft: ProjectDraft }) {
  const organizationId = useAiProjectDraftStore((state) => state.organizationId)
  const roleAssignments = useAiDraftConfirmStore((state) => state.roleAssignments)
  const roles = React.useMemo(() => draftRoles(draft), [draft])
  const members = useOrganizationMembers(organizationId)
  const active = members.filter((member) => member.user?.isActive !== false)

  // 输入框里「@陈立峰 负责架构」：预先把他选进对应角色（用户可改）。只在该角色还没分配时预填一次。
  const context = useAiProjectDraftStore((state) => state.context)
  const mentioned = useAiProjectDraftStore((state) => state.mentionedMembers)
  React.useEffect(() => {
    if (!context || mentioned.length === 0) return
    const text = [context.rawInput, String(context.resolvedFields.teamSize?.value ?? '')].join('\n')
    const current = useAiDraftConfirmStore.getState().roleAssignments
    for (const member of mentioned) {
      const match = new RegExp(
        `成员#${member.userId}\\s*(?:负责|担任|做|作为)?\\s*([\\u3400-\\u9fffA-Za-z]{1,8})`,
        'u',
      ).exec(text)
      const keyword = match?.[1]
      if (!keyword) continue
      const role = roles.find(
        (item) => item.role.includes(keyword.slice(0, 2)) || keyword.includes(item.role),
      )?.role
      if (role && !current[role]?.length) {
        useAiDraftConfirmStore.getState().setRoleAssignment(role, [member.userId])
      }
    }
  }, [context, mentioned, roles])

  if (roles.length === 0) return null

  // 按人去重：同一个人担任多个角色只算一人（原先按角色累加，1 人 4 个角色显示「已分配 4 人」）
  const assignedCount = new Set(Object.values(roleAssignments).flat()).size

  return (
    <section
      data-member-assignment
      aria-label="人员分配"
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
    >
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)]">
        <Users className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
        人员分配 {assignedCount > 0 ? `· 已分配 ${assignedCount} 人` : ''}
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
        为每个角色选择组织成员，导入时按工作量把该角色的任务均衡指派给他们；可以不选，导入后再指派。
      </p>
      <ul className="mt-2 space-y-2">
        {roles.slice(0, 20).map(({ role, workdays, headcount }) => {
          const selected = roleAssignments[role] ?? []
          return (
            <li key={role} data-assignment-role={role}>
              <p className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="font-medium text-[var(--nx-text-primary)]">{role}</span>
                <span className="text-[var(--nx-text-muted)]">
                  {workdays > 0 ? `${workdays} 人天` : '持续型工作 · 不计人天'}
                  {headcount ? ` · 建议 ${headcount} 人` : ''}
                </span>
              </p>
              <div
                role="group"
                aria-label={`${role} 的成员`}
                className="mt-1 max-h-24 overflow-y-auto rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1 py-0.5"
              >
                {active.map((member) => {
                  const checked = selected.includes(member.userId)
                  return (
                    <label
                      key={member.userId}
                      className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-[var(--nx-text-primary)] hover:bg-[var(--nx-bg-2)]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          useAiDraftConfirmStore
                            .getState()
                            .setRoleAssignment(
                              role,
                              checked
                                ? selected.filter((id) => id !== member.userId)
                                : [...selected, member.userId],
                            )
                        }
                        className="h-3 w-3 shrink-0 accent-[var(--nx-accent)]"
                      />
                      <span className="truncate">
                        {member.user?.fullName || member.user?.email || `用户 ${member.userId}`}
                      </span>
                    </label>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
