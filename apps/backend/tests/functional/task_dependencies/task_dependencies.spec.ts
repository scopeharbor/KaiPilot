import AuditLog from '#models/audit_log'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User) {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return response.body().data.accessToken as string
}

async function task(projectId: number, name: string, assigneeId?: number) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    assigneeId: assigneeId ?? null,
  })
}

test.group('Task dependencies API', (group) => {
  useAuthDatabase(group)

  test('创建、双向查询、循环 422、删除与 dependency_count 同步', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('dep-api-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const [a, b] = await Promise.all([task(project.id, 'A'), task(project.id, 'B')])
    const token = await login(client, owner)

    const created = await client
      .post(`/api/v1/projects/${project.id}/tasks/${b.id}/dependencies`)
      .header('Authorization', `Bearer ${token}`)
      .json({ predecessorId: a.id, type: 'fs', lagDays: -2 })
    created.assertStatus(201)
    created.assertBodyContains({ data: { type: 'fs', lagDays: -2 } })

    const listed = await client
      .get(`/api/v1/projects/${project.id}/tasks/${b.id}/dependencies`)
      .header('Authorization', `Bearer ${token}`)
    listed.assertStatus(200)
    assert.equal(listed.body().data.predecessors[0].predecessor.name, 'A')

    const detail = await client
      .get(`/api/v1/projects/${project.id}/tasks/${b.id}`)
      .header('Authorization', `Bearer ${token}`)
    assert.equal(detail.body().data.dependencyCount, 1)
    const taskList = await client
      .get(`/api/v1/projects/${project.id}/tasks?perPage=100`)
      .header('Authorization', `Bearer ${token}`)
    const listedTasks = taskList.body().data as Array<{ id: number; dependencyCount: number }>
    assert.equal(listedTasks.find((item) => item.id === b.id)?.dependencyCount, 1)

    const cycle = await client
      .post(`/api/v1/projects/${project.id}/tasks/${a.id}/dependencies`)
      .header('Authorization', `Bearer ${token}`)
      .json({ predecessorId: b.id })
    cycle.assertStatus(422)
    cycle.assertBodyContains({ error: { code: 'VALIDATION_ERROR', message: '将形成循环依赖' } })

    const removed = await client
      .delete(`/api/v1/dependencies/${created.body().data.id}`)
      .header('Authorization', `Bearer ${token}`)
    removed.assertStatus(204)

    const refreshed = await client
      .get(`/api/v1/projects/${project.id}/tasks/${b.id}`)
      .header('Authorization', `Bearer ${token}`)
    assert.equal(refreshed.body().data.dependencyCount, 0)
    const auditLogs = await AuditLog.query().where('entity_type', 'task_dependency')
    const events = auditLogs.map((log) => (log.metadata as { event?: string }).event)
    assert.includeMembers(events, ['DEPENDENCY_CREATED', 'DEPENDENCY_DELETED'])
  })

  test('task:update:self 仅能管理本人后续任务，只读角色拒绝', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('dep-owner') })
    const member = await createUser({ email: uniqueEmail('dep-member') })
    const observer = await createUser({ email: uniqueEmail('dep-observer') })
    const org = await createOrganization(owner)
    await addOrgMember(org, member, 'member')
    await addOrgMember(org, observer, 'viewer')
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    for (const [user, name] of [
      [member, ProjectRoleName.MEMBER],
      [observer, ProjectRoleName.READONLY_OBSERVER],
    ] as const) {
      const role = await ProjectRole.create({
        projectId: project.id,
        name,
        description: name,
        permissions: [],
        isSystem: true,
      })
      await ProjectMember.create({
        projectId: project.id,
        userId: user.id,
        projectRoleId: role.id,
        isActive: true,
      })
    }
    const predecessor = await task(project.id, '前置')
    const own = await task(project.id, '本人任务', member.id)
    const foreign = await task(project.id, '他人任务', owner.id)
    const memberToken = await login(client, member)
    const observerToken = await login(client, observer)

    const allowed = await client
      .post(`/api/v1/projects/${project.id}/tasks/${own.id}/dependencies`)
      .header('Authorization', `Bearer ${memberToken}`)
      .json({ predecessorId: predecessor.id })
    allowed.assertStatus(201)

    const denied = await client
      .post(`/api/v1/projects/${project.id}/tasks/${foreign.id}/dependencies`)
      .header('Authorization', `Bearer ${memberToken}`)
      .json({ predecessorId: predecessor.id })
    denied.assertStatus(403)

    const readonly = await client
      .post(`/api/v1/projects/${project.id}/tasks/${foreign.id}/dependencies`)
      .header('Authorization', `Bearer ${observerToken}`)
      .json({ predecessorId: predecessor.id })
    readonly.assertStatus(403)
  })

  test('项目级依赖端点：返回全项目依赖；跨组织 404（组织隔离）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('dep-proj-owner') })
    const outsider = await createUser({ email: uniqueEmail('dep-proj-outsider') })
    const org = await createOrganization(owner)
    await createOrganization(outsider)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const [a, b, c] = await Promise.all([
      task(project.id, 'A'),
      task(project.id, 'B'),
      task(project.id, 'C'),
    ])
    const token = await login(client, owner)
    await client
      .post(`/api/v1/projects/${project.id}/tasks/${b.id}/dependencies`)
      .header('Authorization', `Bearer ${token}`)
      .json({ predecessorId: a.id, type: 'fs' })
    await client
      .post(`/api/v1/projects/${project.id}/tasks/${c.id}/dependencies`)
      .header('Authorization', `Bearer ${token}`)
      .json({ predecessorId: b.id, type: 'ss' })

    const listed = await client
      .get(`/api/v1/projects/${project.id}/dependencies`)
      .header('Authorization', `Bearer ${token}`)
    listed.assertStatus(200)
    const data = listed.body().data as Array<{
      predecessorId: number
      successorId: number
      type: string
      predecessor: { name: string }
    }>
    assert.lengthOf(data, 2)
    assert.includeMembers(
      data.map((d) => d.type),
      ['fs', 'ss'],
    )
    assert.isDefined(data[0]!.predecessor.name)

    // 组织隔离：跨组织统一 404，不泄露存在性。
    const outsiderToken = await login(client, outsider)
    const crossOrg = await client
      .get(`/api/v1/projects/${project.id}/dependencies`)
      .header('Authorization', `Bearer ${outsiderToken}`)
    crossOrg.assertStatus(404)
  })

  test('跨组织查询统一返回 404，跨项目前置任务返回 404/422 不泄露', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('dep-owner') })
    const outsider = await createUser({ email: uniqueEmail('dep-outsider') })
    const org = await createOrganization(owner)
    await createOrganization(outsider)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const current = await task(project.id, '当前')
    const outsiderToken = await login(client, outsider)
    const crossOrg = await client
      .get(`/api/v1/projects/${project.id}/tasks/${current.id}/dependencies`)
      .header('Authorization', `Bearer ${outsiderToken}`)
    crossOrg.assertStatus(404)

    const other = await createProjectWithMember(org, owner, owner, ProjectRoleName.PROJECT_MANAGER)
    const foreign = await task(other.project.id, '跨项目')
    const ownerToken = await login(client, owner)
    const crossProject = await client
      .post(`/api/v1/projects/${project.id}/tasks/${current.id}/dependencies`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ predecessorId: foreign.id })
    crossProject.assertStatus(422)
  })
})
