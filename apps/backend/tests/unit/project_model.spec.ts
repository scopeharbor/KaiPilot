import db from '@adonisjs/lucid/services/db'
import Organization from '#models/organization'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

test.group('Project / ProjectMember / ProjectRole 模型关系与 JSON 序列化', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  test('Project 关系可预加载 organization / creator / members / roles', async ({ assert }) => {
    const owner = await User.create({
      fullName: '测试管理员',
      email: 'owner@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org = await owner.related('ownedOrganizations').create({
      name: '测试组织',
      slug: 'test-org',
      planTier: 'free',
    })
    const project = await Project.create({
      organizationId: org.id,
      name: '测试项目',
      code: 'TEST',
      createdBy: owner.id,
    })
    const role = await ProjectRole.create({
      projectId: project.id,
      name: 'Project Owner',
      permissions: ['project:view', 'project:update'],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: owner.id,
      projectRoleId: role.id,
      isActive: true,
    })

    const loaded = await Project.query()
      .where('id', project.id)
      .preload('organization')
      .preload('creator')
      .preload('members')
      .preload('roles')
      .firstOrFail()

    assert.equal(loaded.organization.id, org.id)
    assert.equal(loaded.creator.id, owner.id)
    assert.lengthOf(loaded.members, 1)
    assert.lengthOf(loaded.roles, 1)
    assert.equal(loaded.roles[0].name, 'Project Owner')
    assert.deepEqual(loaded.roles[0].permissions, ['project:view', 'project:update'])
  })

  test('Project.settings JSON 序列化往返', async ({ assert }) => {
    const user = await User.create({
      fullName: '测试用户',
      email: 'settings@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org = await Organization.create({
      ownerId: user.id,
      name: '测试组织',
      slug: 'settings-org',
      planTier: 'free',
    })
    const payload = {
      workdays: [1, 2, 3, 4, 5],
      holidays: ['2026-10-01'],
      timezone: 'Asia/Shanghai',
    }
    const project = await Project.create({
      organizationId: org.id,
      name: 'JSON 测试项目',
      code: 'JSON',
      createdBy: user.id,
      settings: payload,
    })

    const fresh = await Project.findOrFail(project.id)
    assert.deepEqual(fresh.settings, payload)
  })

  test('ProjectMember 关系可预加载 user / project / projectRole', async ({ assert }) => {
    const user = await User.create({
      fullName: '测试成员',
      email: 'member@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const owner = await User.create({
      fullName: '测试所有者',
      email: 'owner2@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org = await Organization.create({
      ownerId: owner.id,
      name: '测试组织',
      slug: 'member-org',
      planTier: 'free',
    })
    const project = await Project.create({
      organizationId: org.id,
      name: '测试项目',
      code: 'MEMBER',
      createdBy: owner.id,
    })
    const role = await ProjectRole.create({
      projectId: project.id,
      name: 'Member',
      permissions: ['project:view'],
      isSystem: true,
    })
    const membership = await ProjectMember.create({
      projectId: project.id,
      userId: user.id,
      projectRoleId: role.id,
      isActive: true,
    })

    await membership.load('user')
    await membership.load('project')
    await membership.load('projectRole')

    assert.equal(membership.user.id, user.id)
    assert.equal(membership.project.id, project.id)
    assert.equal(membership.projectRole?.id, role.id)
  })

  test('Project soft-delete 钩子默认排除已删除项目', async ({ assert }) => {
    const user = await User.create({
      fullName: '测试用户',
      email: 'soft@test.local',
      password: 'Passw0rd!',
      authProvider: 'local',
    })
    const org = await Organization.create({
      ownerId: user.id,
      name: '测试组织',
      slug: 'soft-org',
      planTier: 'free',
    })
    const project = await Project.create({
      organizationId: org.id,
      name: '待删除项目',
      code: 'SOFT',
      createdBy: user.id,
    })
    project.deletedAt = DateTime.now()
    await project.save()

    const found = await Project.find(project.id)
    assert.isNull(found)

    const raw = await db.from('projects').where('id', project.id).first()
    assert.isNotNull(raw)
  })
})
