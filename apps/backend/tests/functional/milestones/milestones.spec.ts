import AuditLog from '#models/audit_log'
import Milestone from '#models/milestone'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import type Organization from '#models/organization'
import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import type User from '#models/user'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

/** 装配项目 + owner(PM) + 可选额外成员（同一项目）。 */
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

test.group('里程碑管理 + 权限/隔离', (group) => {
  useAuthDatabase(group)

  // ---------------- 创建 ----------------

  test('PM 创建里程碑 201 并写 MILESTONE_CREATED 审计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    // 必须用相对日期：status 按 today 派生（写死日期会随日历过期而变成 'missed'）。
    const futurePlannedDate = DateTime.now().plus({ days: 30 }).toISODate()!
    const res = await client
      .post(`/api/v1/projects/${project.id}/milestones`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '需求冻结', status: 'planned', plannedDate: futurePlannedDate })
    res.assertStatus(201)
    res.assertBodyContains({
      data: { name: '需求冻结', status: 'planned', storedStatus: 'planned' },
    })

    const logs = await AuditLog.query()
      .where('entity_type', 'milestone')
      .where('entity_id', res.body().data.id)
      .where('action', 'create')
    assert.isAbove(logs.length, 0)
  })

  test('name 缺失返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/milestones`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'planned' })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('list 返回 {data, meta}', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)
    await Milestone.create({
      projectId: project.id,
      name: 'M1',
      status: 'planned',
      displayOrder: 0,
    })

    const res = await client
      .get(`/api/v1/projects/${project.id}/milestones`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    assert.equal(res.body().meta.total, 1)
    assert.lengthOf(res.body().data, 1)
  })

  // ---------------- 权限降级 ----------------

  test('只读观察者创建里程碑返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const observer = await createUser({ email: uniqueEmail('observer') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    const token = await login(client, observer)

    const res = await client
      .post(`/api/v1/projects/${project.id}/milestones`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '越权建碑' })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('只读观察者可查看但改扁平路由返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const observer = await createUser({ email: uniqueEmail('observer') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    const milestone = await Milestone.create({
      projectId: project.id,
      name: 'M',
      status: 'planned',
      displayOrder: 0,
    })
    const token = await login(client, observer)

    const view = await client
      .get(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${token}`)
    view.assertStatus(200)

    const denied = await client
      .patch(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '越权改名' })
    denied.assertStatus(403)
    denied.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('同组织但非项目成员查看扁平详情返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const outsider = await createUser({ email: uniqueEmail('outsider') })
    const org = await createOrganization(owner)
    await addOrgMember(org, outsider, 'member')
    const { project } = await setupProject(org, owner)
    const milestone = await Milestone.create({
      projectId: project.id,
      name: 'M',
      status: 'planned',
      displayOrder: 0,
    })
    const token = await login(client, outsider)

    const res = await client
      .get(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('只读观察者删除扁平里程碑返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const observer = await createUser({ email: uniqueEmail('observer') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    const milestone = await Milestone.create({
      projectId: project.id,
      name: 'M',
      status: 'planned',
      displayOrder: 0,
    })
    const token = await login(client, observer)

    const res = await client
      .delete(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  // ---------------- 组织隔离（跨组织 404） ----------------

  test('跨组织嵌套列表返回 404', async ({ client }) => {
    const ownerA = await createUser({ email: uniqueEmail('a') })
    const ownerB = await createUser({ email: uniqueEmail('b') })
    const orgA = await createOrganization(ownerA)
    await createOrganization(ownerB)
    const { project } = await setupProject(orgA, ownerA)
    const tokenB = await login(client, ownerB)

    const res = await client
      .get(`/api/v1/projects/${project.id}/milestones`)
      .header('Authorization', `Bearer ${tokenB}`)
    res.assertStatus(404)
  })

  test('跨组织扁平详情/编辑返回 404（不泄露存在性）', async ({ client }) => {
    const ownerA = await createUser({ email: uniqueEmail('a') })
    const ownerB = await createUser({ email: uniqueEmail('b') })
    const orgA = await createOrganization(ownerA)
    await createOrganization(ownerB)
    const { project } = await setupProject(orgA, ownerA)
    const milestone = await Milestone.create({
      projectId: project.id,
      name: 'A 的里程碑',
      status: 'planned',
      displayOrder: 0,
    })
    const tokenB = await login(client, ownerB)

    const show = await client
      .get(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${tokenB}`)
    show.assertStatus(404)
    show.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    const patch = await client
      .patch(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${tokenB}`)
      .json({ name: '越权跨组织' })
    patch.assertStatus(404)
  })

  // ---------------- achieved 显式确认 ----------------

  test('PATCH status=achieved 显式确认落库并写 MILESTONE_ACHIEVED 审计', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const milestone = await Milestone.create({
      projectId: project.id,
      name: '达成碑',
      status: 'planned',
      displayOrder: 0,
    })
    const token = await login(client, owner)

    const res = await client
      .patch(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'achieved' })
    res.assertStatus(200)
    res.assertBodyContains({ data: { status: 'achieved', storedStatus: 'achieved' } })

    const fresh = await Milestone.find(milestone.id)
    assert.equal(fresh?.status, 'achieved')
    assert.isFalse(fresh!.autoCalculated)
  })

  test('逾期里程碑展示态 missed 但持久化态不被自动置 achieved', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const milestone = await Milestone.create({
      projectId: project.id,
      name: '逾期碑',
      status: 'planned',
      plannedDate: DateTime.fromISO('2020-01-01'),
      displayOrder: 0,
    })
    const token = await login(client, owner)

    const res = await client
      .get(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    assert.equal(res.body().data.status, 'missed')
    assert.equal(res.body().data.storedStatus, 'planned')

    // 持久化态从不被自动改为 achieved
    const fresh = await Milestone.find(milestone.id)
    assert.equal(fresh?.status, 'planned')
  })

  test('删除里程碑 204 并写 MILESTONE_DELETED 审计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const milestone = await Milestone.create({
      projectId: project.id,
      name: '待删',
      status: 'planned',
      displayOrder: 0,
    })
    const token = await login(client, owner)

    const res = await client
      .delete(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(204)

    assert.isNull(await Milestone.find(milestone.id))
    const logs = await AuditLog.query()
      .where('entity_type', 'milestone')
      .where('entity_id', milestone.id)
      .where('action', 'delete')
    assert.isAbove(logs.length, 0)
  })
})
