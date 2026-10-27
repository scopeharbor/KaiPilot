/**
 * v3-llm-wiki-memory-foundation —— 权限矩阵：6 角色 × 4 空间 × 读 / 审阅 / 提交。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import WikiAccessService from '#services/wiki_memory/wiki_access_service'
import { ProjectRoleName } from '#start/rbac/roles'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import { createUser, useAuthDatabase } from '../auth/_helpers.js'
import { buildWorld } from './_wiki_helpers.js'

type Expect = [read: boolean, review: boolean, propose: boolean]

test.group('记忆维基 · 权限矩阵', (group) => {
  useAuthDatabase(group)

  test('六种角色在四种空间的读 / 审阅 / 提交判定', async ({ assert }) => {
    const w = await buildWorld()
    const superAdmin = await createUser({ isSuperAdmin: true })
    // 外部协作者：不在组织成员表，只在项目里有外部协作者角色
    const external = await createUser()
    const role = await ProjectRole.create({
      projectId: w.project.id,
      name: ProjectRoleName.EXTERNAL_COLLABORATOR,
      description: '外部',
      permissions: [] as never,
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: w.project.id,
      userId: external.id,
      projectRoleId: role.id,
      isActive: true,
    })
    // 部门：项目经理所在部门
    const [deptRow] = await db
      .table('departments')
      .insert({
        organization_id: w.org.id,
        name: '交付部',
        code: 'D1',
        leader_id: null,
        sort_order: 0,
        path: '/1',
        depth: 0,
        created_by: w.admin.id,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
    const deptId = Number(typeof deptRow === 'object' ? (deptRow as { id: number }).id : deptRow)
    await db
      .from('organization_members')
      .where('user_id', w.pm.id)
      .update({ department_id: deptId })

    const access = await app.container.make(WikiAccessService)
    const org = w.org.id
    const spaces = {
      organization: { organizationId: org, scopeKind: 'organization' as const, scopeRefId: org },
      department: { organizationId: org, scopeKind: 'department' as const, scopeRefId: deptId },
      project: { organizationId: org, scopeKind: 'project' as const, scopeRefId: w.project.id },
      ownUser: (u: User) => ({ organizationId: org, scopeKind: 'user' as const, scopeRefId: u.id }),
      otherUser: { organizationId: org, scopeKind: 'user' as const, scopeRefId: w.admin.id },
    }

    const matrix: Array<[string, User, Record<string, Expect>]> = [
      [
        '系统管理员',
        superAdmin,
        {
          organization: [true, true, true],
          department: [true, true, true],
          project: [true, true, true],
          own: [true, true, true],
        },
      ],
      [
        '组织管理员',
        w.admin,
        {
          organization: [true, true, true],
          department: [true, true, true],
          project: [true, true, true],
          own: [true, true, true],
        },
      ],
      [
        '项目经理（组织成员）',
        w.pm,
        {
          organization: [true, false, true],
          department: [true, false, true],
          project: [true, true, true],
          own: [true, true, true],
        },
      ],
      [
        '普通成员（非项目成员）',
        w.member,
        {
          organization: [true, false, true],
          department: [false, false, false],
          project: [false, false, false],
          own: [true, true, true],
        },
      ],
      [
        '只读观察者',
        w.viewer,
        {
          organization: [true, false, false],
          department: [false, false, false],
          project: [false, false, false],
          own: [true, true, true],
        },
      ],
      [
        '外部协作者',
        external,
        {
          organization: [false, false, false],
          department: [false, false, false],
          project: [false, false, false],
          own: [true, true, true],
        },
      ],
    ]

    for (const [label, user, expected] of matrix) {
      const actor = { user, organizationId: org }
      for (const [key, [read, review, propose]] of Object.entries(expected)) {
        const space =
          key === 'own'
            ? spaces.ownUser(user)
            : spaces[key as 'organization' | 'department' | 'project']
        assert.equal(await access.canReadSpace(actor, space), read, `${label} 读 ${key}`)
        assert.equal(await access.canReviewSpace(actor, space), review, `${label} 审阅 ${key}`)
        assert.equal(await access.canProposeInSpace(actor, space), propose, `${label} 提交 ${key}`)
      }
      if (user.id !== w.admin.id) {
        assert.isFalse(
          await access.canReadSpace(actor, spaces.otherUser),
          `${label} 读他人个人空间`,
        )
      }
      // 跨组织空间一律不可读
      const foreign = {
        organizationId: w.otherOrg.id,
        scopeKind: 'organization' as const,
        scopeRefId: w.otherOrg.id,
      }
      assert.isFalse(await access.canReadSpace(actor, foreign), `${label} 跨组织`)
      assert.isFalse(await access.canReviewSpace(actor, foreign), `${label} 跨组织审阅`)
    }
  })

  test('restricted 页面与个人页授权的读取判定', async ({ assert }) => {
    const w = await buildWorld()
    const access = await app.container.make(WikiAccessService)
    const orgSpace = {
      organizationId: w.org.id,
      scopeKind: 'organization' as const,
      scopeRefId: w.org.id,
    }
    const restricted = {
      organizationId: w.org.id,
      sensitivity: 'restricted' as const,
      sharedWithProjectIds: null,
    }
    assert.isTrue(
      await access.canReadPage({ user: w.admin, organizationId: w.org.id }, orgSpace, restricted),
    )
    assert.isFalse(
      await access.canReadPage({ user: w.member, organizationId: w.org.id }, orgSpace, restricted),
    )

    const memberSpace = {
      organizationId: w.org.id,
      scopeKind: 'user' as const,
      scopeRefId: w.member.id,
    }
    const shared = {
      organizationId: w.org.id,
      sensitivity: 'normal' as const,
      sharedWithProjectIds: [w.project.id],
    }
    assert.isTrue(
      await access.canReadPage({ user: w.pm, organizationId: w.org.id }, memberSpace, shared),
    )
    assert.isFalse(
      await access.canReadPage({ user: w.viewer, organizationId: w.org.id }, memberSpace, shared),
    )
    const sharedRestricted = { ...shared, sensitivity: 'restricted' as const }
    assert.isFalse(
      await access.canReadPage(
        { user: w.pm, organizationId: w.org.id },
        memberSpace,
        sharedRestricted,
      ),
    )
    const crossOrgPage = { ...shared, organizationId: w.otherOrg.id }
    assert.isFalse(
      await access.canReadPage(
        { user: w.member, organizationId: w.org.id },
        memberSpace,
        crossOrgPage,
      ),
    )
  })
})
