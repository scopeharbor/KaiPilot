import type { ProjectMember } from '@/lib/api/projects'

const PROJECT_ROLE_LABEL: Record<string, string> = {
  'Project Owner': '项目所有者',
  'Project Manager': '项目经理',
  Member: '成员',
  'External Collaborator': '外部协作者',
  'Read-only Observer': '只读观察者',
}

/** 项目角色中文名。 */
export function projectRoleLabel(name: string | null | undefined): string | null {
  if (!name) return null
  return PROJECT_ROLE_LABEL[name] ?? name
}

function memberName(member: ProjectMember): string {
  return member.user?.fullName?.trim() || member.user?.email || `成员 #${member.userId}`
}

/**
 * 指派下拉的成员选项文本：「王浩然 · 后端开发 · 5 项未完成」。
 * 只显示姓名时，PM 分不清谁是后端、谁是测试，也看不出谁已经很忙。
 */
export function memberOptionLabel(member: ProjectMember): string {
  const parts = [memberName(member)]
  const role = member.primaryRoleHint || projectRoleLabel(member.projectRole?.name)
  if (role) parts.push(role)
  if (member.workload) parts.push(`${member.workload.openTaskCount} 项未完成`)
  return parts.join(' · ')
}

/** 指派下拉排序：按岗位分组，同岗位内负载轻的在前，便于就近挑人。 */
export function sortMembersForAssign(members: readonly ProjectMember[]): ProjectMember[] {
  return [...members].sort((a, b) => {
    const ra = a.primaryRoleHint || projectRoleLabel(a.projectRole?.name) || ''
    const rb = b.primaryRoleHint || projectRoleLabel(b.projectRole?.name) || ''
    if (ra !== rb) return ra.localeCompare(rb, 'zh-Hans-CN')
    const la = a.workload?.openTaskCount ?? 0
    const lb = b.workload?.openTaskCount ?? 0
    if (la !== lb) return la - lb
    return memberName(a).localeCompare(memberName(b), 'zh-Hans-CN')
  })
}
