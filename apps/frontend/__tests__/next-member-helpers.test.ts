/**
 * v3-ui-next-resource-team-domains W2 · tasks 2.2 —— 成员域工具函数单元测试
 * （纯函数，零 DOM 依赖）。
 *
 * 覆盖（design §3.2/§3.3 / tasks 2.1）：
 * - memberInviteSchema：合法邮箱（含 RFC 5322 无 TLD 域、别名 +tag）放行；
 *   非法格式 / 空邮箱 / 空白邮箱拦截并给出精确提示；角色缺失、空串、非正数
 *   一律「请选择项目角色」阻断；
 * - 唯一拥有者保护判定：单一 Owner 时目标 Owner 行返回 true（移除阻断），
 *   多 Owner 时返回 false，非 Owner 行恒为 false；
 * - 角色标签映射：系统角色名 → 简体中文标签，未知自定义角色回退原名；
 * - 头像缩写 / 展示名 / 加入时间格式化等渲染辅助函数。
 */
import { describe, expect, test } from 'vitest'
import type { ProjectMember } from '@/lib/api/projects'
import {
  countProjectOwners,
  formatMemberJoinedAt,
  isMemberRoleAssignable,
  isMemberSoleOwner,
  isProjectOwnerRole,
  isSelfProjectOwner,
  memberDisplayName,
  memberInitials,
  memberInviteSchema,
  memberRoleLabel,
} from '@/lib/next/members/member-helpers'

function makeRole(id: number, name: string) {
  return {
    id,
    projectId: 42,
    name,
    description: null,
    permissions: [] as string[],
    isSystem: true,
  }
}

let nextMemberId = 100
function makeMember(
  userId: number,
  roleName: string | null,
  overrides: Partial<ProjectMember> = {},
): ProjectMember {
  const role = roleName ? makeRole(roleName === 'Project Owner' ? 1 : 2, roleName) : null
  return {
    id: nextMemberId++,
    projectId: 42,
    userId,
    projectRoleId: role?.id ?? null,
    isActive: true,
    user: {
      id: userId,
      fullName: `成员${userId}`,
      email: `user${userId}@aiproj.internal`,
      initials: `U${userId}`,
      isActive: true,
    },
    projectRole: role ?? undefined,
    createdAt: '2026-08-01T08:30:00.000Z',
    updatedAt: '2026-08-01T08:30:00.000Z',
    ...overrides,
  }
}

describe('memberInviteSchema：邮箱格式校验（RFC 5322）', () => {
  test('合法邮箱 + 已选角色 → 校验通过并归一 projectRoleId 为数字', () => {
    const result = memberInviteSchema.safeParse({
      email: 'developer@aiproj.internal',
      projectRoleId: '3',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('developer@aiproj.internal')
      expect(result.data.projectRoleId).toBe(3)
    }
  })

  test('RFC 5322 合法形态放行：+tag 别名、无 TLD 单标签域、点分多级域', () => {
    expect(
      memberInviteSchema.safeParse({ email: 'first.last+tag@sub.example.co', projectRoleId: 2 })
        .success,
    ).toBe(true)
    expect(memberInviteSchema.safeParse({ email: 'pm@internal', projectRoleId: 2 }).success).toBe(
      true,
    )
    expect(
      memberInviteSchema.safeParse({ email: 'aiproj@example.com.cn', projectRoleId: 2 }).success,
    ).toBe(true)
  })

  test('非法邮箱格式 → 提示「请输入有效的邮箱地址」并阻断', () => {
    for (const email of [
      'invalid-email-address',
      'missing-at-sign',
      'no-local@',
      '@no-domain.com',
      'two@@at.com',
      'sp ace@example.com',
    ]) {
      const result = memberInviteSchema.safeParse({ email, projectRoleId: 2 })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('请输入有效的邮箱地址')
      }
    }
  })

  test('空邮箱 / 纯空白邮箱 → 提示「请输入成员邮箱」', () => {
    for (const email of ['', '   ']) {
      const result = memberInviteSchema.safeParse({ email, projectRoleId: 2 })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('请输入成员邮箱')
      }
    }
  })

  test('邮箱两侧空白自动 trim 后放行', () => {
    const result = memberInviteSchema.safeParse({
      email: '  developer@aiproj.internal  ',
      projectRoleId: 2,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.email).toBe('developer@aiproj.internal')
  })
})

describe('memberInviteSchema：projectRoleId 必填校验', () => {
  test('角色缺失（undefined / 空串）→ 提示「请选择项目角色」', () => {
    const missing = memberInviteSchema.safeParse({ email: 'dev@aiproj.internal' })
    expect(missing.success).toBe(false)
    if (!missing.success) {
      expect(missing.error.issues[0]?.message).toBe('请选择项目角色')
    }
    const empty = memberInviteSchema.safeParse({ email: 'dev@aiproj.internal', projectRoleId: '' })
    expect(empty.success).toBe(false)
    if (!empty.success) {
      expect(empty.error.issues[0]?.message).toBe('请选择项目角色')
    }
  })

  test('角色为 0 / 负数 / 非数字 → 一律「请选择项目角色」阻断', () => {
    for (const projectRoleId of [0, -1, 'abc']) {
      const result = memberInviteSchema.safeParse({ email: 'dev@aiproj.internal', projectRoleId })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('请选择项目角色')
      }
    }
  })

  test('邮箱与角色同时非法 → 邮箱语义优先于角色错误', () => {
    const result = memberInviteSchema.safeParse({ email: '', projectRoleId: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('email')
    }
  })
})

describe('唯一拥有者保护纯函数（design §3.2）', () => {
  const owner = makeMember(1, 'Project Owner')
  const manager = makeMember(2, 'Project Manager')
  const member = makeMember(3, 'Member')

  test('单一 Owner 项目：Owner 行返回 true（移除阻断），非 Owner 行返回 false', () => {
    const roster = [owner, manager, member]
    expect(isMemberSoleOwner(owner, roster)).toBe(true)
    expect(isMemberSoleOwner(manager, roster)).toBe(false)
    expect(isMemberSoleOwner(member, roster)).toBe(false)
    expect(countProjectOwners(roster)).toBe(1)
  })

  test('多 Owner 项目：Owner 行返回 false（不阻断），计数为 2', () => {
    const secondOwner = makeMember(4, 'Project Owner', {
      user: {
        id: 4,
        fullName: '成员4',
        email: 'user4@aiproj.internal',
        initials: 'U4',
        isActive: true,
      },
    })
    const roster = [owner, secondOwner, member]
    expect(isMemberSoleOwner(owner, roster)).toBe(false)
    expect(isMemberSoleOwner(secondOwner, roster)).toBe(false)
    expect(countProjectOwners(roster)).toBe(2)
  })

  test('无角色成员 / 空底册边界：不阻断', () => {
    const noRole = makeMember(5, null)
    expect(isMemberSoleOwner(noRole, [noRole])).toBe(false)
    expect(countProjectOwners([])).toBe(0)
    expect(isMemberSoleOwner(owner, [])).toBe(true) // 目标 Owner 但底册为空 → 防御性阻断
  })

  test('isSelfProjectOwner：按当前用户 self 行角色判定', () => {
    expect(isSelfProjectOwner([owner, member], 1)).toBe(true)
    expect(isSelfProjectOwner([owner, member], 2)).toBe(false)
    expect(isSelfProjectOwner([owner, member], null)).toBe(false)
    expect(isSelfProjectOwner([owner, member], 99)).toBe(false)
  })

  test('isProjectOwnerRole 仅精确匹配系统名 Project Owner', () => {
    expect(isProjectOwnerRole('Project Owner')).toBe(true)
    expect(isProjectOwnerRole('owner')).toBe(false)
    expect(isProjectOwnerRole('Project Manager')).toBe(false)
    expect(isProjectOwnerRole(null)).toBe(false)
  })
})

describe('角色展示标签映射与渲染辅助', () => {
  test('系统角色名映射简体中文标签', () => {
    expect(memberRoleLabel('Project Owner')).toBe('拥有者')
    expect(memberRoleLabel('Project Manager')).toBe('项目经理')
    expect(memberRoleLabel('Member')).toBe('成员')
    expect(memberRoleLabel('External Collaborator')).toBe('外部协作者')
    expect(memberRoleLabel('Read-only Observer')).toBe('只读观察者')
  })

  test('未知自定义角色回退原名；空角色显示占位「未分配」', () => {
    expect(memberRoleLabel('首席架构师')).toBe('首席架构师')
    expect(memberRoleLabel(null)).toBe('未分配')
    expect(memberRoleLabel(undefined)).toBe('未分配')
    expect(memberRoleLabel(undefined, '—')).toBe('—')
  })

  test('isMemberRoleAssignable：拥有者角色不可经常规调整授予', () => {
    expect(isMemberRoleAssignable(makeRole(1, 'Project Owner'))).toBe(false)
    expect(isMemberRoleAssignable(makeRole(2, 'Project Manager'))).toBe(true)
    expect(isMemberRoleAssignable(makeRole(3, 'Member'))).toBe(true)
    expect(isMemberRoleAssignable(null)).toBe(false)
  })

  test('展示名 / 头像缩写 / 加入时间确定性格式化', () => {
    const full = makeMember(7, 'Member')
    expect(memberDisplayName(full)).toBe('成员7')
    expect(memberInitials(full)).toBe('U7')

    const emailOnly = makeMember(8, 'Member', {
      user: { id: 8, fullName: null, email: 'dev@aiproj.internal', initials: '', isActive: true },
    })
    expect(memberDisplayName(emailOnly)).toBe('dev@aiproj.internal')
    expect(memberInitials(emailOnly)).toBe('D')

    const noUser = makeMember(9, 'Member', { user: undefined })
    expect(memberDisplayName(noUser)).toBe('用户 9')

    expect(formatMemberJoinedAt('2026-08-01T08:30:00.000Z')).toBe('2026-08-01')
    expect(formatMemberJoinedAt(null)).toBe('—')
    expect(formatMemberJoinedAt(undefined)).toBe('—')
    expect(formatMemberJoinedAt('not-a-date')).toBe('—')
  })
})
