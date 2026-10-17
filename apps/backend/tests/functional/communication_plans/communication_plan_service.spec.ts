import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type Organization from '#models/organization'
import ProjectRole from '#models/project_role'
import ProjectMember from '#models/project_member'
import type User from '#models/user'
import CommunicationPlanService from '#services/communication_plan_service'
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

test.group('CommunicationPlanService 沟通管理计划', (group) => {
  useAuthDatabase(group)
  const svc = new CommunicationPlanService()

  test('创建周期性沟通计划：默认档位 + 报表模板标识关联', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('cp-create') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const created = await svc.create(
      org.id,
      project.id,
      {
        name: '月度干系人进展报告',
        ownerId: owner.id,
        communicationType: 'report',
        purpose: '向干系人同步月度进展与风险',
        frequency: 'monthly',
        channel: 'pdf_export',
        audience: '干系人登记表全量',
        deliverable: '月度报告 PDF',
        reportTemplateKey: 'stakeholder-monthly-report',
      },
      owner.id,
    )

    assert.equal(created.name, '月度干系人进展报告')
    assert.equal(created.ownerId, owner.id)
    assert.equal(created.communicationType, 'report')
    assert.equal(created.frequency, 'monthly')
    assert.equal(created.channel, 'pdf_export')
    assert.equal(created.reportTemplateKey, 'stakeholder-monthly-report')
    assert.equal(created.isActive, true)
    assert.equal(created.createdBy, owner.id)
  })

  test('省略可选档位时落入模型默认值', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('cp-default') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const created = await svc.create(
      org.id,
      project.id,
      {
        name: '每周核心团队同步例会',
        ownerId: owner.id,
        purpose: '同步本周进展与卡点',
        audience: '核心团队',
      },
      owner.id,
    )

    assert.equal(created.communicationType, 'meeting')
    assert.equal(created.frequency, 'weekly')
    assert.equal(created.channel, 'video_conference')
    assert.equal(created.deliverable, null)
    assert.equal(created.reportTemplateKey, null)
    assert.equal(created.isActive, true)
  })

  test('ownerId 缺失 / 非本组织用户 → ValidationException', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('cp-own') })
    const outsider = await createUser({ email: uniqueEmail('cp-out') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await createOrganization(outsider)

    await assert.rejects(
      () =>
        svc.create(
          org.id,
          project.id,
          {
            name: '缺责任人',
            purpose: 'p',
            audience: 'a',
          } as never,
          owner.id,
        ),
      ValidationException,
    )
    await assert.rejects(
      () =>
        svc.create(
          org.id,
          project.id,
          {
            name: '越权责任人',
            ownerId: outsider.id,
            purpose: 'p',
            audience: 'a',
          },
          owner.id,
        ),
      ValidationException,
    )
  })

  test('列表：类型 / 频次 / 启停过滤 + 搜索 + 分页', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('cp-list') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    for (let i = 0; i < 2; i++) {
      await svc.create(
        org.id,
        project.id,
        {
          name: `同步例会 ${i}`,
          ownerId: owner.id,
          communicationType: 'meeting',
          frequency: 'weekly',
          purpose: '周同步',
          audience: '核心团队',
        },
        owner.id,
      )
    }
    await svc.create(
      org.id,
      project.id,
      {
        name: '月度报告',
        ownerId: owner.id,
        communicationType: 'report',
        frequency: 'monthly',
        channel: 'pdf_export',
        purpose: '干系人简报',
        audience: '干系人',
        reportTemplateKey: 'monthly-report',
      },
      owner.id,
    )

    const meetings = await svc.list(org.id, project.id, { communicationType: 'meeting' })
    assert.equal(meetings.meta.total, 2)

    const monthly = await svc.list(org.id, project.id, { frequency: 'monthly' })
    assert.equal(monthly.meta.total, 1)
    assert.equal(monthly.data[0].reportTemplateKey, 'monthly-report')

    const bySearch = await svc.list(org.id, project.id, { search: '报告' })
    assert.equal(bySearch.meta.total, 1)

    const paged = await svc.list(org.id, project.id, { page: 1, perPage: 2 })
    assert.equal(paged.meta.total, 3)
    assert.lengthOf(paged.data, 2)
    assert.equal(paged.meta.totalPages, 2)
  })

  test('update 配置变更 + setActive 启停开关', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('cp-update') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const created = await svc.create(
      org.id,
      project.id,
      {
        name: '可调整例会',
        ownerId: owner.id,
        purpose: '初始目的',
        audience: '初始受众',
      },
      owner.id,
    )

    const updated = await svc.update(
      org.id,
      project.id,
      created.id,
      {
        frequency: 'biweekly',
        channel: 'feishu',
        reportTemplateKey: 'biweekly-sync',
        deliverable: '会议纪要',
      },
      owner.id,
    )
    assert.equal(updated.frequency, 'biweekly')
    assert.equal(updated.channel, 'feishu')
    assert.equal(updated.reportTemplateKey, 'biweekly-sync')

    // 启停切换：停用后仅 isActive=false 的过滤可查见
    await svc.setActive(org.id, project.id, created.id, false, owner.id)
    const inactive = await svc.list(org.id, project.id, { isActive: false })
    assert.equal(inactive.meta.total, 1)
    const activeOnly = await svc.list(org.id, project.id, { isActive: true })
    assert.equal(activeOnly.meta.total, 0)

    // 重新启用
    const reactivated = await svc.setActive(org.id, project.id, created.id, true, owner.id)
    assert.equal(reactivated.isActive, true)
  })

  test('softDelete 后列表与详情不可见', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('cp-del') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)

    const created = await svc.create(
      org.id,
      project.id,
      {
        name: '待删除计划',
        ownerId: owner.id,
        purpose: 'p',
        audience: 'a',
      },
      owner.id,
    )

    await svc.softDelete(org.id, project.id, created.id, owner.id)
    const list = await svc.list(org.id, project.id)
    assert.equal(list.meta.total, 0)
    await assert.rejects(() => svc.get(org.id, project.id, created.id), ResourceNotFoundException)
  })

  test('跨组织隔离：他人项目沟通计划 CRUD 一律 404', async ({ assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('cp-iso-a') })
    const ownerB = await createUser({ email: uniqueEmail('cp-iso-b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const { project: projectA } = await setupProject(orgA, ownerA)
    const { project: projectB } = await setupProject(orgB, ownerB)

    const created = await svc.create(
      orgA.id,
      projectA.id,
      {
        name: 'A 组织例会',
        ownerId: ownerA.id,
        purpose: 'p',
        audience: 'a',
      },
      ownerA.id,
    )

    await assert.rejects(() => svc.list(orgB.id, projectA.id), ResourceNotFoundException)
    await assert.rejects(() => svc.get(orgB.id, projectA.id, created.id), ResourceNotFoundException)
    await assert.rejects(
      () => svc.update(orgB.id, projectA.id, created.id, { name: '越权' }, ownerB.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => svc.setActive(orgB.id, projectA.id, created.id, false, ownerB.id),
      ResourceNotFoundException,
    )
    await assert.rejects(
      () => svc.softDelete(orgB.id, projectA.id, created.id, ownerB.id),
      ResourceNotFoundException,
    )
    // B 组织自己的项目正常
    const own = await svc.create(
      orgB.id,
      projectB.id,
      {
        name: 'B 组织例会',
        ownerId: ownerB.id,
        purpose: 'p',
        audience: 'a',
      },
      ownerB.id,
    )
    assert.equal(own.projectId, projectB.id)
  })
})
