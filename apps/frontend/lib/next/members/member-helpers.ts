import { z } from 'zod'
import type { ProjectMember, ProjectRole } from '@/lib/api/projects'

/**
 * 成员域纯函数工具与校验契约（v3-ui-next-resource-team-domains W2 · tasks 2.1，
 * design §3「成员管理域架构设计」）。
 *
 * - 项目角色展示标签映射：后端系统角色名（start/rbac/roles.ts `ProjectRoleName`）
 *   → 简体中文标签，未知自定义角色回退原名；
 * - 唯一拥有者保护纯函数：目标成员为拥有者且项目 Owner 计数 <= 1 时阻断移除，
 *   杜绝项目陷入无主状态（design §3.2）；
 * - `memberInviteSchema`：邀请成员表单校验契约——RFC 5322 邮箱正则 + 项目角色
 *   必填（zod v4 `required_error` 语义下统一以 `error`/coerce 配置表达）。
 */

/** 系统角色名（与后端 ProjectRoleName 对齐，字符串比较必须精确匹配）。 */
export const PROJECT_ROLE_OWNER_NAME = 'Project Owner'
export const PROJECT_ROLE_MANAGER_NAME = 'Project Manager'
export const PROJECT_ROLE_MEMBER_NAME = 'Member'
export const PROJECT_ROLE_EXTERNAL_COLLABORATOR_NAME = 'External Collaborator'
export const PROJECT_ROLE_READONLY_OBSERVER_NAME = 'Read-only Observer'

/** 项目角色展示标签映射（系统角色 → 简体中文；与角色模板 description 对齐）。 */
export const PROJECT_ROLE_LABELS: Readonly<Record<string, string>> = {
  [PROJECT_ROLE_OWNER_NAME]: '拥有者',
  [PROJECT_ROLE_MANAGER_NAME]: '项目经理',
  [PROJECT_ROLE_MEMBER_NAME]: '成员',
  [PROJECT_ROLE_EXTERNAL_COLLABORATOR_NAME]: '外部协作者',
  [PROJECT_ROLE_READONLY_OBSERVER_NAME]: '只读观察者',
}

/** 角色名 → 展示标签；未识别（自定义角色）回退原名，空角色回退占位文案。 */
export function memberRoleLabel(roleName: string | null | undefined, fallback = '未分配'): string {
  if (!roleName) return fallback
  return PROJECT_ROLE_LABELS[roleName] ?? roleName
}

/** 是否为项目拥有者角色（系统角色名精确匹配，design §3.2 拥有者判定基准）。 */
export function isProjectOwnerRole(roleName: string | null | undefined): boolean {
  return roleName === PROJECT_ROLE_OWNER_NAME
}

/** 该角色是否可经普通角色调整/邀请直接授予（拥有者只能经所有权转让产生）。 */
export function isMemberRoleAssignable(
  role: Pick<ProjectRole, 'name'> | null | undefined,
): boolean {
  if (!role) return false
  return !isProjectOwnerRole(role.name)
}

/** 统计项目拥有者数量（拥有者 = 系统角色名精确匹配，design §3.2）。 */
export function countProjectOwners(members: readonly ProjectMember[]): number {
  return members.reduce(
    (count, member) => count + (isProjectOwnerRole(member.projectRole?.name) ? 1 : 0),
    0,
  )
}

/**
 * 唯一拥有者移除阻断判定：目标成员为拥有者且全项目仅此一位拥有者时返回 true，
 * 该成员行的「移出项目」按钮必须物理置灰禁用（tasks 2.1 / design §3.2）。
 */
export function isMemberSoleOwner(
  member: ProjectMember,
  members: readonly ProjectMember[],
): boolean {
  if (!isProjectOwnerRole(member.projectRole?.name)) return false
  return countProjectOwners(members) <= 1
}

/** 当前登录用户是否为项目拥有者（按成员底册 self 行角色判定）。 */
export function isSelfProjectOwner(
  members: readonly ProjectMember[],
  currentUserId: number | null | undefined,
): boolean {
  if (currentUserId === null || currentUserId === undefined) return false
  const self = members.find((member) => member.userId === currentUserId)
  return isProjectOwnerRole(self?.projectRole?.name)
}

/** 成员展示名（姓名 → 邮箱 → 兜底占位）。 */
export function memberDisplayName(member: ProjectMember): string {
  return member.user?.fullName || member.user?.email || `用户 ${member.userId}`
}

/** 成员头像缩写（优先服务端 initials，其次姓名首字，最后邮箱首字符）。 */
export function memberInitials(member: ProjectMember): string {
  if (member.user?.initials) return member.user.initials
  const name = memberDisplayName(member)
  return name.slice(0, 1).toUpperCase()
}

/** 加入时间确定性格式化（UTC 日历日 YYYY-MM-DD，缺失显示占位符）。 */
export function formatMemberJoinedAt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * RFC 5322 邮箱格式正则（tasks 2.1）：local-part 允许点分原子与常见可打印特殊字符，
 * domain 为点分标签（每个标签以字母/数字起止、可含连字符），不要求 TLD。
 */
export const RFC5322_EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/**
 * 邀请成员表单校验契约（design §3.3）。
 *
 * - email：必填（提示「请输入成员邮箱」）+ RFC 5322 格式校验（提示
 *   「请输入有效的邮箱地址」）；zod v4 同一字符串管线会并发产出全部违规，
 *   消费方取 `issues[0]` 即为语义优先的首条错误；
 * - projectRoleId：HTML 下拉单选原始值为字符串，经 `z.coerce.number` 归一；
 *   缺失 / 空串 / 非正数统一拦截「请选择项目角色」并阻断提交。
 */
export const memberInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, '请输入成员邮箱')
    .regex(RFC5322_EMAIL_PATTERN, '请输入有效的邮箱地址'),
  projectRoleId: z.coerce.number({ error: '请选择项目角色' }).positive('请选择项目角色'),
})

export type MemberInviteValues = z.infer<typeof memberInviteSchema>
