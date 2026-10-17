import type { OrganizationMember } from '@/lib/api-client'

/**
 * 组织成员域展示辅助（v3-ui-next-settings-admin-domains W2 · tasks 2.2）。
 *
 * - `ORG_ROLE_LABELS` 与旧轨 `/settings/profile`（`app/(dashboard)/settings/profile/page.tsx`）
 *   的 `ORG_ROLE_LABELS` 取值逐字对齐（owner/admin/member/viewer → 所有者/管理员/成员/只读），
 *   保证新轨组织设置的令牌语义与既有页面一致（RL-04 同一数据模型、同一标签语义）；
 * - `ORG_MEMBER_ROLE_LABELS` 是 `OrganizationMember['role']` 的**穷尽**映射：新增服务端角色
 *   取值会在编译期暴露，而不是静默渲染原始英文码（中文原生红线）；
 * - `formatMemberJoinedAt`：后端 `memberDto.createdAt` 是 ISO 时间戳，按 UTC 日历日
 *   确定性格式化（本地时区会因运行环境漂移，测试与截图均不稳定）；
 * - `readMemberCreatedAt`：`lib/api-client` 的 `OrganizationMember` DTO 类型未声明
 *   `createdAt`，但后端确实返回该字段（`app/types/dto.ts` `memberDto`）。这里做一次
 *   结构化窄读 + 缺失防御，避免为单个展示字段去改共享 DTO 类型。
 */

/** 组织角色 → 中文标签（与旧轨 ORG_ROLE_LABELS 逐字对齐）。 */
export const ORG_ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

/** 组织角色穷尽映射（新增角色取值时编译期报错）。 */
export const ORG_MEMBER_ROLE_LABELS: Record<OrganizationMember['role'], string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

/** 角色标签解析：未知取值回退原码（不崩、不吞）。 */
export function orgRoleLabel(role: string): string {
  return ORG_ROLE_LABELS[role] ?? role
}

/** 成员展示名：姓名 → 邮箱 → 「用户 #id」。 */
export function orgMemberDisplayName(member: OrganizationMember): string {
  return member.user?.fullName || member.user?.email || `用户 ${member.userId}`
}

/** 成员头像缩写（姓名/邮箱首字符大写）。 */
export function orgMemberInitials(member: OrganizationMember): string {
  return orgMemberDisplayName(member).slice(0, 1).toUpperCase()
}

/** 结构化窄读后端 `createdAt`（DTO 类型未声明该字段，缺失/非法一律 null）。 */
export function readMemberCreatedAt(member: OrganizationMember): string | null {
  const value = (member as { createdAt?: unknown }).createdAt
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 加入时间确定性格式化（UTC 日历日 YYYY-MM-DD，缺失显示占位符）。 */
export function formatMemberJoinedAt(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 组织成员底册查询键（与旧轨 `['organizations', id, 'members']` 同源）。 */
export function orgMembersQueryKey(organizationId: number): readonly unknown[] {
  return ['organizations', organizationId, 'members']
}
