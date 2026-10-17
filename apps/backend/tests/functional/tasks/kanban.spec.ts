import AuditLog from '#models/audit_log'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import type Organization from '#models/organization'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
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

async function setupProject(
  organization: Organization,
  owner: User,
  extraMembers: Array<{ user: User; role: string }> = [],
) {
  const { project } = await createProjectWithMember(
    organization,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  for (const entry of extraMembers) {
    await addOrgMember(organization, entry.user, 'member')
    const role = await ProjectRole.create({
      projectId: project.id,
      name: entry.role,
      description: entry.role,
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: entry.user.id,
      projectRoleId: role.id,
      isActive: true,
    })
  }
  return project
}

function createTask(
  projectId: number,
  name: string,
  status: string,
  rank: number,
  assigneeId: number | null = null,
) {
  return Task.create({
    projectId,
    name,
    status: status as never,
    priority: 'medium',
    taskType: 'task',
    kanbanRank: rank,
    assigneeId,
  })
}

test.group('Kanban API', (group) => {
  useAuthDatabase(group)

  test('four fixed columns map the six task statuses without a second status model', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('kanban-owner') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const token = await login(client, owner)
    const statuses = ['not_started', 'in_progress', 'completed', 'blocked', 'on_hold', 'cancelled']
    for (const [index, status] of statuses.entries()) {
      await createTask(project.id, status, status, (index + 1) * 1024)
    }

    const expectations: Record<string, string[]> = {
      pending: ['not_started'],
      in_progress: ['in_progress'],
      completed: ['completed'],
      other: ['blocked', 'on_hold', 'cancelled'],
    }
    for (const [column, expected] of Object.entries(expectations)) {
      const response = await client
        .get(`/api/v1/projects/${project.id}/kanban?column=${column}`)
        .header('Authorization', `Bearer ${token}`)
      response.assertStatus(200)
      assert.deepEqual(
        response
          .body()
          .data.map((task: { status: string }) => task.status)
          .sort(),
        expected.sort(),
      )
      assert.properties(response.body().meta, ['total', 'page', 'perPage', 'totalPages'])
    }
  })

  test('column query paginates and filters by search, priority and assignee', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('kanban-filter') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const first = await createTask(project.id, '目标任务', 'not_started', 1024, owner.id)
    first.priority = 'high'
    await first.save()
    await createTask(project.id, '其他任务', 'not_started', 2048)
    const token = await login(client, owner)

    const response = await client
      .get(
        `/api/v1/projects/${project.id}/kanban?column=pending&search=${encodeURIComponent('目标')}&priority=high&assigneeId=${owner.id}&page=1&perPage=1`,
      )
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    assert.equal(response.body().data.length, 1)
    assert.equal(response.body().data[0].id, first.id)
    assert.equal(response.body().meta.perPage, 1)
  })

  test('same-column move persists an independent sparse rank and strict audit', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('kanban-order') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const first = await createTask(project.id, '第一', 'not_started', 1024)
    const second = await createTask(project.id, '第二', 'not_started', 2048)
    const moved = await createTask(project.id, '移动', 'not_started', 3072)
    const token = await login(client, owner)

    const response = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        taskId: moved.id,
        targetColumn: 'pending',
        beforeTaskId: first.id,
        afterTaskId: second.id,
      })
    response.assertStatus(200)
    assert.equal(response.body().data.status, 'not_started')
    assert.equal(response.body().data.kanbanRank, 1536)

    const audit = await AuditLog.query()
      .where('entity_type', 'task')
      .where('entity_id', moved.id)
      .where('action', 'update')
    assert.isAbove(audit.length, 0)
  })

  test('dense ranks rebalance only the target lane before inserting', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('kanban-rebalance') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const first = await createTask(project.id, '第一', 'not_started', 1024)
    const second = await createTask(project.id, '第二', 'not_started', 1025)
    const moved = await createTask(project.id, '移动', 'not_started', 4096)
    const token = await login(client, owner)

    const response = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        taskId: moved.id,
        targetColumn: 'pending',
        beforeTaskId: first.id,
        afterTaskId: second.id,
      })
    response.assertStatus(200)
    assert.equal(response.body().data.kanbanRank, 1536)
    await second.refresh()
    assert.equal(Number(second.kanbanRank), 2048)
  })

  test('cross-column move reuses the legal status machine and writes side effects', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('kanban-state') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const task = await createTask(project.id, '开始任务', 'not_started', 1024)
    const token = await login(client, owner)

    const started = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${token}`)
      .json({ taskId: task.id, targetColumn: 'in_progress' })
    started.assertStatus(200)
    assert.equal(started.body().data.status, 'in_progress')
    assert.isNotNull(started.body().data.actualStartDate)

    const completed = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${token}`)
      .json({ taskId: task.id, targetColumn: 'completed' })
    completed.assertStatus(200)
    assert.equal(completed.body().data.status, 'completed')
    assert.isNotNull(completed.body().data.actualEndDate)
  })

  test('illegal transition and missing Other target status are rejected without moving', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('kanban-invalid') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const task = await createTask(project.id, '不可跳跃', 'not_started', 1024)
    const token = await login(client, owner)

    const illegal = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${token}`)
      .json({ taskId: task.id, targetColumn: 'completed' })
    illegal.assertStatus(422)

    const ambiguous = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${token}`)
      .json({ taskId: task.id, targetColumn: 'other' })
    ambiguous.assertStatus(422)

    await task.refresh()
    assert.equal(task.status, 'not_started')
    assert.equal(Number(task.kanbanRank), 1024)
  })

  test('Other target status is explicit and anchors cannot cross projects or columns', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('kanban-other') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner)
    const secondProject = await setupProject(organization, owner)
    const task = await createTask(project.id, '进行中', 'in_progress', 1024)
    const blocked = await createTask(project.id, '阻塞项', 'blocked', 1024)
    const foreign = await createTask(secondProject.id, '外部锚点', 'blocked', 1024)
    const token = await login(client, owner)

    const moved = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        taskId: task.id,
        targetColumn: 'other',
        targetStatus: 'blocked',
        beforeTaskId: blocked.id,
      })
    moved.assertStatus(200)
    assert.equal(moved.body().data.status, 'blocked')

    const isolated = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        taskId: task.id,
        targetColumn: 'other',
        targetStatus: 'blocked',
        beforeTaskId: foreign.id,
      })
    isolated.assertStatus(404)
  })

  test('read-only users may view but cannot move; self-update is resource scoped', async ({
    client,
  }) => {
    const owner = await createUser({ email: uniqueEmail('kanban-owner') })
    const observer = await createUser({ email: uniqueEmail('kanban-observer') })
    const member = await createUser({ email: uniqueEmail('kanban-member') })
    const organization = await createOrganization(owner)
    const project = await setupProject(organization, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    const task = await createTask(project.id, '只读任务', 'not_started', 1024)
    const observerToken = await login(client, observer)
    const memberToken = await login(client, member)

    const viewed = await client
      .get(`/api/v1/projects/${project.id}/kanban?column=pending`)
      .header('Authorization', `Bearer ${observerToken}`)
    viewed.assertStatus(200)

    const observerDenied = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${observerToken}`)
      .json({ taskId: task.id, targetColumn: 'in_progress' })
    observerDenied.assertStatus(403)

    const memberDenied = await client
      .post(`/api/v1/projects/${project.id}/kanban/move`)
      .header('Authorization', `Bearer ${memberToken}`)
      .json({ taskId: task.id, targetColumn: 'in_progress' })
    memberDenied.assertStatus(403)
  })
})
