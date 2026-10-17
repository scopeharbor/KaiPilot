import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import type Organization from '#models/organization'
import type User from '#models/user'
import { ValidationException } from '#exceptions/api_exception'
import TaskBatchService from '#services/task_batch_service'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
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
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return response.body().data.accessToken
}

async function createTask(
  projectId: number,
  overrides: Partial<{
    name: string
    status: string
    assigneeId: number | null
    parentTaskId: number | null
    deletedAt: DateTime | null
  }> = {},
): Promise<Task> {
  return Task.create({
    projectId,
    name: overrides.name ?? '批量测试任务',
    status: (overrides.status ?? 'not_started') as never,
    priority: 'medium',
    taskType: 'task',
    assigneeId: overrides.assigneeId ?? null,
    parentTaskId: overrides.parentTaskId ?? null,
    deletedAt: overrides.deletedAt ?? null,
  })
}

async function setupProject(
  org: Organization,
  owner: User,
  extraMembers: Array<{ user: User; role: string }> = [],
) {
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
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
  return project
}

test.group('任务批量操作与回收站', (group) => {
  useAuthDatabase(group)

  test('批量状态变更逐项事务并返回部分成功', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('batch-owner') })
    const org = await createOrganization(owner)
    const project = await setupProject(org, owner)
    const canComplete = await createTask(project.id, { status: 'in_progress' })
    const invalid = await createTask(project.id, { status: 'not_started' })
    const token = await login(client, owner)

    const response = await client
      .post(`/api/v1/projects/${project.id}/tasks/batch`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        action: 'change_status',
        taskIds: [canComplete.id, invalid.id],
        data: { status: 'completed' },
      })

    response.assertStatus(200)
    response.assertBodyContains({
      data: { total: 2, successCount: 1, failedCount: 1 },
    })
    assert.deepEqual(
      response.body().data.results.map((item: { taskId: number }) => item.taskId),
      [canComplete.id, invalid.id],
    )
    await canComplete.refresh()
    await invalid.refresh()
    assert.equal(canComplete.status, 'completed')
    assert.equal(invalid.status, 'not_started')
  })

  test('批量请求超过 100 项在执行前返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('batch-limit') })
    const org = await createOrganization(owner)
    const project = await setupProject(org, owner)
    const token = await login(client, owner)

    const response = await client
      .post(`/api/v1/projects/${project.id}/tasks/batch`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        action: 'delete',
        taskIds: Array.from({ length: 101 }, (_, index) => index + 1),
      })

    response.assertStatus(422)
    response.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('成员批量编辑只成功处理指派给自己的任务', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('batch-owner') })
    const member = await createUser({ email: uniqueEmail('batch-member') })
    const org = await createOrganization(owner)
    const project = await setupProject(org, owner, [{ user: member, role: ProjectRoleName.MEMBER }])
    const own = await createTask(project.id, { assigneeId: member.id })
    const other = await createTask(project.id)
    const token = await login(client, member)

    const response = await client
      .post(`/api/v1/projects/${project.id}/tasks/batch`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        action: 'update',
        taskIds: [own.id, other.id],
        data: { priority: 'high' },
      })

    response.assertStatus(200)
    assert.equal(response.body().data.successCount, 1)
    assert.equal(response.body().data.results[1].error.code, 'PERMISSION_DENIED')
    await own.refresh()
    await other.refresh()
    assert.equal(own.priority, 'high')
    assert.equal(other.priority, 'medium')
  })

  test('批量删除保留有活动子任务的父任务但继续删除合法叶子', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('batch-delete') })
    const org = await createOrganization(owner)
    const project = await setupProject(org, owner)
    const parent = await createTask(project.id, { name: '父任务' })
    await createTask(project.id, { name: '子任务', parentTaskId: parent.id })
    const leaf = await createTask(project.id, { name: '独立叶子' })
    const token = await login(client, owner)

    const response = await client
      .post(`/api/v1/projects/${project.id}/tasks/batch`)
      .header('Authorization', `Bearer ${token}`)
      .json({ action: 'delete', taskIds: [parent.id, leaf.id] })

    response.assertStatus(200)
    assert.equal(response.body().data.successCount, 1)
    assert.equal(response.body().data.failedCount, 1)
    await parent.refresh()
    const leafRow = await Task.queryWithTrashed().where('id', leaf.id).first()
    assert.isNull(parent.deletedAt)
    assert.isNotNull(leafRow?.deleted_at)
  })

  test('回收站只列出当前项目 30 天内软删除任务', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('recycle-list') })
    const org = await createOrganization(owner)
    const project = await setupProject(org, owner)
    const recent = await createTask(project.id, {
      name: '最近删除',
      deletedAt: DateTime.now().minus({ days: 2 }),
    })
    await createTask(project.id, {
      name: '过期删除',
      deletedAt: DateTime.now().minus({ days: 31 }),
    })
    await createTask(project.id, { name: '仍然有效' })
    const token = await login(client, owner)

    const response = await client
      .get(`/api/v1/projects/${project.id}/tasks/recycle-bin`)
      .header('Authorization', `Bearer ${token}`)

    response.assertStatus(200)
    assert.deepEqual(
      response.body().data.map((item: { id: number }) => item.id),
      [recent.id],
    )
    assert.equal(response.body().meta.total, 1)
  })

  test('批量恢复有效任务并保留过期失败项', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('recycle-restore') })
    const org = await createOrganization(owner)
    const project = await setupProject(org, owner)
    const recent = await createTask(project.id, {
      deletedAt: DateTime.now().minus({ days: 2 }),
    })
    const expired = await createTask(project.id, {
      deletedAt: DateTime.now().minus({ days: 31 }),
    })
    const token = await login(client, owner)

    const response = await client
      .post(`/api/v1/projects/${project.id}/tasks/batch-restore`)
      .header('Authorization', `Bearer ${token}`)
      .json({ taskIds: [recent.id, expired.id] })

    response.assertStatus(200)
    assert.equal(response.body().data.successCount, 1)
    assert.equal(response.body().data.failedCount, 1)
    const recentRow = await Task.queryWithTrashed().where('id', recent.id).first()
    const expiredRow = await Task.queryWithTrashed().where('id', expired.id).first()
    assert.isNull(recentRow?.deleted_at)
    assert.isNotNull(expiredRow?.deleted_at)
  })

  test('批量编排器在单项异常时回滚该项写入', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('batch-rollback') })
    const org = await createOrganization(owner)
    const project = await setupProject(org, owner)
    const task = await createTask(project.id, { name: '事务前' })
    const service = new TaskBatchService()

    const result = await service.execute([task.id], async (taskId, transaction) => {
      await transaction.from('tasks').where('id', taskId).update({ name: '不应保留' })
      throw new ValidationException('模拟审计失败')
    })

    assert.equal(result.failedCount, 1)
    await task.refresh()
    assert.equal(task.name, '事务前')

    const unknown = await service.execute([task.id], async () => {
      throw new Error('数据库连接意外中断')
    })
    assert.equal(unknown.results[0]?.success, false)
    if (!unknown.results[0]?.success) {
      assert.equal(unknown.results[0]?.error.code, 'INTERNAL_ERROR')
      assert.equal(unknown.results[0]?.error.message, '任务处理失败，请稍后重试')
    }
  })
})
