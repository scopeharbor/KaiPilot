import AuditLog from '#models/audit_log'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
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

/** 创建一个任务（直接造数据，不经 API）。 */
async function createTask(
  projectId: number,
  overrides: Partial<{
    name: string
    status: string
    assigneeId: number | null
    parentTaskId: number | null
    startDate: DateTime
    endDate: DateTime
    durationDays: number
  }> = {},
): Promise<Task> {
  return Task.create({
    projectId,
    name: overrides.name ?? '测试任务',
    status: (overrides.status ?? 'not_started') as never,
    priority: 'medium',
    taskType: 'task',
    assigneeId: overrides.assigneeId ?? null,
    parentTaskId: overrides.parentTaskId ?? null,
    startDate: overrides.startDate ?? null,
    endDate: overrides.endDate ?? null,
    durationDays: overrides.durationDays ?? null,
  })
}

/** 默认工作日历（周一至周五）下吸附到当天或之前的工作日（与排期引擎 snapToWorkingDay(-1) 一致）。 */
function snapToWorkingDayOnOrBefore(date: DateTime): DateTime {
  let current = date
  while (current.weekday > 5) current = current.minus({ days: 1 })
  return current
}

/** 默认工作日历（周一至周五）下的下一个工作日。 */
function nextWorkingDay(date: DateTime): DateTime {
  let current = date.plus({ days: 1 })
  while (current.weekday > 5) current = current.plus({ days: 1 })
  return current
}

/**
 * 装配一个项目 + owner(PM) + 可选额外成员（自动加 org member + project member）。
 * 注意：额外成员必须挂到**同一个** project 上（createProjectWithMember 会另建项目，不能复用）。
 */
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
  // project_roles 有 (project_id, name) 联合唯一，同名校色只建一次后复用
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

test.group('任务管理 + 状态工作流', (group) => {
  useAuthDatabase(group)

  // ---------------- 创建 ----------------

  test('PM 创建任务成功 201 并写 TASK_CREATED 审计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '设计数据库', priority: 'high' })
    res.assertStatus(201)
    res.assertBodyContains({
      data: { name: '设计数据库', status: 'not_started', priority: 'high' },
    })

    const logs = await AuditLog.query()
      .where('entity_type', 'task')
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
      .post(`/api/v1/projects/${project.id}/tasks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ priority: 'high' })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('end_date 早于 start_date 返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'T', startDate: '2026-08-01', endDate: '2026-07-01' })
    res.assertStatus(422)
  })

  test('READONLY_OBSERVER 创建任务返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const observer = await createUser({ email: uniqueEmail('observer') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    const token = await login(client, observer)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'T' })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  // ---------------- 子任务树 ----------------

  test('父任务不存在返回 422（错误码 2008）', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '子', parentTaskId: 999999 })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: '2008' } })
  })

  test('嵌套超过 3 级返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const root = await createTask(project.id, { name: 'L1' })
    const l2 = await createTask(project.id, { name: 'L2', parentTaskId: root.id })
    const l3 = await createTask(project.id, { name: 'L3', parentTaskId: l2.id })

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'L4', parentTaskId: l3.id })
    res.assertStatus(422)
  })

  // ---------------- 列表与详情 ----------------

  test('列表返回项目内任务 + 分页 meta，排除软删除', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    await createTask(project.id, { name: '进行中', status: 'in_progress' })
    await createTask(project.id, { name: '待办', status: 'not_started' })
    const softDeleted = await createTask(project.id, { name: '已删', status: 'not_started' })
    softDeleted.deletedAt = DateTime.now()
    await softDeleted.save()
    const token = await login(client, owner)

    const res = await client
      .get(`/api/v1/projects/${project.id}/tasks?status=in_progress`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    assert.equal(res.body().data.length, 1)
    assert.equal(res.body().data[0].name, '进行中')
    assert.properties(res.body().meta, ['total', 'page', 'perPage', 'totalPages'])
  })

  test('跨项目访问任务详情返回 404', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const otherProject = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const taskInOther = await createTask(otherProject.project.id, { name: '其他项目任务' })
    const token = await login(client, owner)

    const res = await client
      .get(`/api/v1/projects/${project.id}/tasks/${taskInOther.id}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  test('跨组织项目路由返回 404', async ({ client }) => {
    const ownerA = await createUser({ email: uniqueEmail('a') })
    const ownerB = await createUser({ email: uniqueEmail('b') })
    const orgA = await createOrganization(ownerA)
    await createOrganization(ownerB)
    const { project } = await setupProject(orgA, ownerA)
    const tokenB = await login(client, ownerB)

    const res = await client
      .get(`/api/v1/projects/${project.id}/tasks`)
      .header('Authorization', `Bearer ${tokenB}`)
    res.assertStatus(404)
  })

  // ---------------- 编辑与权限 ----------------

  test('MEMBER 仅能编辑指派给自己的任务，他人任务 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const member = await createUser({ email: uniqueEmail('member') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    const ownTask = await createTask(project.id, { name: '我的', assigneeId: member.id })
    const otherTask = await createTask(project.id, { name: '别人的' })
    const token = await login(client, member)

    const ok = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${ownTask.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '改名' })
    ok.assertStatus(200)

    const denied = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${otherTask.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ name: '越权' })
    denied.assertStatus(403)
    denied.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('MEMBER 改派负责人返回 403（无 task:assign）', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const member = await createUser({ email: uniqueEmail('member') })
    const other = await createUser({ email: uniqueEmail('other') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
      { user: other, role: ProjectRoleName.MEMBER },
    ])
    const ownTask = await createTask(project.id, { name: '我的', assigneeId: member.id })
    const token = await login(client, member)

    const res = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${ownTask.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ assigneeId: other.id })
    res.assertStatus(403)
  })

  // ---------------- 状态机 ----------------

  test('非法状态转换返回 422（not_started → completed）', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const task = await createTask(project.id, { name: 'T', status: 'not_started' })
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'completed' })
    res.assertStatus(422)
  })

  test('合法转换 in_progress → completed 回填 actual_end_date 并写审计', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const task = await createTask(project.id, { name: 'T', status: 'in_progress' })
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'completed', note: '完成' })
    res.assertStatus(200)
    assert.isNotNull(res.body().data.actualEndDate)

    const fresh = await Task.find(task.id)
    assert.isNotNull(fresh?.actualEndDate)

    const logs = await AuditLog.query()
      .where('entity_type', 'task')
      .where('entity_id', task.id)
      .where('action', 'update')
    assert.isAbove(logs.length, 0)
  })

  test('同状态转换幂等、不写状态审计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const task = await createTask(project.id, { name: 'T', status: 'in_progress' })
    const token = await login(client, owner)

    const before = await AuditLog.query()
      .where('entity_type', 'task')
      .where('entity_id', task.id)
      .count('*', 'total')

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'in_progress' })
    res.assertStatus(200)

    const after = await AuditLog.query()
      .where('entity_type', 'task')
      .where('entity_id', task.id)
      .count('*', 'total')
    assert.equal(Number(after[0]?.$extras?.total), Number(before[0]?.$extras?.total))
  })

  test('READONLY_OBSERVER 流转状态返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const observer = await createUser({ email: uniqueEmail('observer') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    const task = await createTask(project.id, { name: 'T', status: 'not_started' })
    const token = await login(client, observer)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'in_progress' })
    res.assertStatus(403)
  })

  // ---------------- 软删除与恢复 ----------------

  test('删除含未删除子任务的任务返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const parent = await createTask(project.id, { name: '父' })
    await createTask(project.id, { name: '子', parentTaskId: parent.id })
    const token = await login(client, owner)

    const res = await client
      .delete(`/api/v1/projects/${project.id}/tasks/${parent.id}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(422)
  })

  test('软删除叶子任务返回 204', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const task = await createTask(project.id, { name: '叶子' })
    const token = await login(client, owner)

    const res = await client
      .delete(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(204)
  })

  test('恢复未删除的任务返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const task = await createTask(project.id, { name: '未删' })
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/restore`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(422)
  })

  test('恢复超过 30 天的软删除任务返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const task = await createTask(project.id, { name: '过期' })
    // 直接置 deleted_at 为 31 天前（经 model save 正确序列化 DateTime）
    task.deletedAt = DateTime.now().minus({ days: 31 })
    await task.save()
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/restore`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(422)
  })

  // ---------------- 排期往前拉 ----------------

  test('提前完成把未开工的后续任务往前拉（锚点不动）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const today = DateTime.now().startOf('day')
    const plannedEnd = today.plus({ days: 14 })
    const predecessor = await createTask(project.id, {
      name: '前置',
      status: 'in_progress',
      startDate: today,
      endDate: plannedEnd,
      durationDays: 10,
    })
    const successorPlannedStart = today.plus({ days: 15 })
    const successor = await createTask(project.id, {
      name: '后续',
      startDate: successorPlannedStart,
      endDate: successorPlannedStart.plus({ days: 4 }),
      durationDays: 4,
    })
    await TaskDependency.create({
      predecessorId: predecessor.id,
      successorId: successor.id,
      type: 'fs',
      lagDays: 0,
    })
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${predecessor.id}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'completed' })
    res.assertStatus(200)

    // 实际完成日（今天）远早于计划完成日：后续任务被拉到依赖允许的最早开工日
    const freshSuccessor = await Task.findOrFail(successor.id)
    const expectedStart = nextWorkingDay(snapToWorkingDayOnOrBefore(today))
    assert.equal(freshSuccessor.startDate?.toISODate(), expectedStart.toISODate())
    assert.isTrue(freshSuccessor.endDate!.toISODate()! < plannedEnd.toISODate()!)

    // 锚点自身按既有行为把结束日缩到实际完成日（「提前完成，结束日期已改为…」），
    // 往前拉只动下游未开工任务，不动锚点
    const freshPredecessor = await Task.findOrFail(predecessor.id)
    assert.isTrue(freshPredecessor.endDate!.toISODate()! < plannedEnd.toISODate()!)
  })

  test('退回待处理把已顺延的任务回滚到依赖允许的最早开工日', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const today = DateTime.now().startOf('day')
    const predecessorEnd = today.minus({ days: 10 })
    const completedPredecessor = await createTask(project.id, {
      name: '已完成前置',
      status: 'completed',
      startDate: today.minus({ days: 20 }),
      endDate: predecessorEnd,
      durationDays: 8,
    })
    const lateStart = today.plus({ days: 20 })
    const anchor = await createTask(project.id, {
      name: '被顺延的任务',
      status: 'in_progress',
      startDate: lateStart,
      endDate: lateStart.plus({ days: 4 }),
      durationDays: 4,
    })
    await TaskDependency.create({
      predecessorId: completedPredecessor.id,
      successorId: anchor.id,
      type: 'fs',
      lagDays: 0,
    })
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/tasks/${anchor.id}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'not_started', note: '退回待处理' })
    res.assertStatus(200)

    // 晚开工被顺延的日期，退回待处理后回滚到前置完成日之后的第一个工作日
    const freshAnchor = await Task.findOrFail(anchor.id)
    const expectedStart = nextWorkingDay(snapToWorkingDayOnOrBefore(predecessorEnd))
    assert.equal(freshAnchor.startDate?.toISODate(), expectedStart.toISODate())
    assert.isTrue(freshAnchor.startDate!.toISODate()! < lateStart.toISODate()!)
  })
})
