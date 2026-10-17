import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type Organization from '#models/organization'
import ProjectRole from '#models/project_role'
import ProjectMember from '#models/project_member'
import type User from '#models/user'
import StakeholderService from '#services/stakeholder_service'
import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

/** 装配项目 + owner(PM) + 可选额外成员（自动加 org member + project member）。 */
async function setupProject(
  org: Organization,
  creator: User,
  extraMembers: Array<{ user: User; role: string }> = [],
) {
  const { project } = await createProjectWithMember(
    org,
    creator,
    creator,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const roleCache = new Map<string, ProjectRole>()
  for (const { user, role } of extraMembers) {
    await addOrgMember(org, user, 'member')
    let roleRow = roleCache.get(role)
    if (!roleRow) {
      roleRow = await ProjectRole.create({
        projectId: project.id,
        name: role,
        description: role,
        permissions: [],
        isSystem: true,
      })
      roleCache.set(role, roleRow)
    }
    await ProjectMember.create({
      projectId: project.id,
      userId: user.id,
      projectRoleId: roleRow.id,
      isActive: true,
    })
  }
  return { project }
}

test.group('StakeholderService 干系人登记与四象限', (group) => {
  useAuthDatabase(group)
  const svc = new StakeholderService()

  test('创建 internal 干系人并绑定组织成员，默认档位 + 策略自动推导', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('stk-create') })
    const member = await createUser({ email: uniqueEmail('stk-member') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [{ user: member, role: 'member' }])

    const created = await svc.create(
      org.id,
      project.id,
      {
        name: '张工',
        userId: member.id,
        roleTitle: '技术负责人',
        expectations: '关注里程碑',
      },
      owner.id,
    )

    assert.equal(created.name, '张工')
    assert.equal(created.userId, member.id)
    assert.equal(created.stakeholderType, 'internal')
    assert.equal(created.powerLevel, 'medium')
    assert.equal(created.interestLevel, 'medium')
    assert.equal(created.attitude, 'neutral')
    // medium/medium → 监督观察（monitor），未显式传策略时自动推导
    assert.equal(created.managementStrategy, 'monitor')
    assert.deepEqual(created.contactInfo, {})
    assert.equal(created.createdBy, owner.id)
  })

  test('创建 external 干系人：不绑用户、显式策略 keep_satisfied 保留', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('stk-ext') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const created = await svc.create(
      org.id,
      project.id,
      {
        name: '监管机构代表',
        organizationName: '外部监管局',
        stakeholderType: 'external',
        powerLevel: 'high',
        interestLevel: 'low',
        managementStrategy: 'keep_satisfied',
        contactInfo: { email: 'regulator@example.test' },
      },
      owner.id,
    )

    assert.equal(created.stakeholderType, 'external')
    assert.equal(created.userId, null)
    assert.equal(created.managementStrategy, 'keep_satisfied')
    assert.deepEqual(created.contactInfo, { email: 'regulator@example.test' })
  })

  test('internal 干系人绑定其他组织用户 → ValidationException', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('stk-own') })
    const outsider = await createUser({ email: uniqueEmail('stk-out') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await createOrganization(outsider) // 外部用户在别的组织

    await assert.rejects(
      () => svc.create(org.id, project.id, { name: '越权绑定', userId: outsider.id }, owner.id),
      ValidationException,
    )
  })

  test('列表分页 + 按 stakeholderType / managementStrategy / search 过滤', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('stk-list') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    for (let i = 0; i < 3; i++) {
      await svc.create(
        org.id,
        project.id,
        {
          name: `内部干系人 ${i}`,
          stakeholderType: 'internal',
        },
        owner.id,
      )
    }
    await svc.create(
      org.id,
      project.id,
      {
        name: '外部监督方',
        organizationName: '监管局',
        stakeholderType: 'external',
        powerLevel: 'high',
        interestLevel: 'low',
        managementStrategy: 'keep_satisfied',
      },
      owner.id,
    )

    const filtered = await svc.list(org.id, project.id, { stakeholderType: 'external' })
    assert.equal(filtered.meta.total, 1)
    assert.equal(filtered.data[0].name, '外部监督方')

    const byStrategy = await svc.list(org.id, project.id, {
      managementStrategy: 'keep_satisfied',
    })
    assert.equal(byStrategy.meta.total, 1)

    const bySearch = await svc.list(org.id, project.id, { search: '监督' })
    assert.equal(bySearch.meta.total, 1)

    const paged = await svc.list(org.id, project.id, { page: 1, perPage: 2 })
    assert.equal(paged.meta.total, 4)
    assert.equal(paged.meta.totalPages, 2)
    assert.lengthOf(paged.data, 2)
  })

  test('update 修改权力/利益自动重推导策略；显式策略优先', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('stk-update') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const created = await svc.create(org.id, project.id, { name: '测试干系人' }, owner.id)
    assert.equal(created.managementStrategy, 'monitor') // medium/medium

    // 只改档位 → 策略自动重推导为 keep_satisfied（high 权力 / medium 利益）
    const updated = await svc.update(
      org.id,
      project.id,
      created.id,
      {
        powerLevel: 'high',
      },
      owner.id,
    )
    assert.equal(updated.powerLevel, 'high')
    assert.equal(updated.interestLevel, 'medium')
    assert.equal(updated.managementStrategy, 'keep_satisfied')

    // 高权力 + 高利益 + 显式策略 → 显式覆盖保留
    const overridden = await svc.update(
      org.id,
      project.id,
      created.id,
      {
        powerLevel: 'high',
        interestLevel: 'high',
        managementStrategy: 'keep_satisfied',
      },
      owner.id,
    )
    assert.equal(overridden.managementStrategy, 'keep_satisfied')
  })

  test('get 详情 + softDelete 后列表与详情不可见', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('stk-del') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const created = await svc.create(org.id, project.id, { name: '待删除干系人' }, owner.id)
    const detail = await svc.get(org.id, project.id, created.id)
    assert.equal(detail.id, created.id)

    await svc.softDelete(org.id, project.id, created.id, owner.id)

    const list = await svc.list(org.id, project.id)
    assert.equal(list.meta.total, 0)
    await assert.rejects(() => svc.get(org.id, project.id, created.id), ResourceNotFoundException)
  })

  test('四象限聚合：power/interest 组合准确分桶并计数', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('stk-quad') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    // manage_closely：high/high
    await svc.create(
      org.id,
      project.id,
      {
        name: '重点管理',
        powerLevel: 'high',
        interestLevel: 'high',
      },
      owner.id,
    )
    // keep_satisfied：high/medium 与 high/low
    await svc.create(
      org.id,
      project.id,
      {
        name: '令其满意-高-中',
        powerLevel: 'high',
        interestLevel: 'medium',
      },
      owner.id,
    )
    // keep_informed：medium/high
    await svc.create(
      org.id,
      project.id,
      {
        name: '随时知会',
        powerLevel: 'medium',
        interestLevel: 'high',
      },
      owner.id,
    )
    // monitor：low/low 与 medium/medium
    await svc.create(
      org.id,
      project.id,
      {
        name: '监督观察-低',
        powerLevel: 'low',
        interestLevel: 'low',
      },
      owner.id,
    )
    await svc.create(
      org.id,
      project.id,
      {
        name: '监督观察-中',
        powerLevel: 'medium',
        interestLevel: 'medium',
      },
      owner.id,
    )

    const view = await svc.getQuadrantView(org.id, project.id)
    assert.deepEqual(view.summary, {
      manageClosely: 1,
      keepSatisfied: 1,
      keepInformed: 1,
      monitor: 2,
    })
    assert.equal(view.quadrants.manageClosely[0].name, '重点管理')
    assert.equal(view.quadrants.keepSatisfied[0].name, '令其满意-高-中')
    assert.equal(view.quadrants.keepInformed[0].name, '随时知会')
    assert.lengthOf(view.quadrants.monitor, 2)
    // Array.prototype.sort 按 UTF-16 码元排序：「中」(U+4E2D) < 「低」(U+4F4E)
    assert.deepEqual(view.quadrants.monitor.map((item) => item.name).sort(), [
      '监督观察-中',
      '监督观察-低',
    ])
  })

  test('跨组织隔离：他人项目干系人 CRUD / 象限一律 404', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('stk-iso-a') })
    const ownerB = await createUser({ email: uniqueEmail('stk-iso-b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const { project: projectA } = await setupProject(orgA, ownerA)
    const { project: projectB } = await setupProject(orgB, ownerB)

    const created = await svc.create(
      orgA.id,
      projectA.id,
      {
        name: 'A 组织干系人',
        powerLevel: 'high',
        interestLevel: 'high',
      },
      ownerA.id,
    )

    // B 组织用户访问 A 的项目资源 → 404（不泄露存在性）
    await assert.rejects(() => svc.list(orgB.id, projectA.id), ResourceNotFoundException)
    await assert.rejects(() => svc.getQuadrantView(orgB.id, projectA.id), ResourceNotFoundException)
    await assert.rejects(() => svc.get(orgB.id, projectA.id, created.id), ResourceNotFoundException)
    await assert.rejects(
      () => svc.update(orgB.id, projectA.id, created.id, { name: '越权' }, ownerB.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => svc.softDelete(orgB.id, projectA.id, created.id, ownerB.id),
      ResourceNotFoundException,
    )
    // B 组织自己的项目不受影响
    const view = await svc.getQuadrantView(orgB.id, projectB.id)
    assert.equal(view.summary.manageClosely, 0)
  })
})
