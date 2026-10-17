import AuditLog from '#models/audit_log'
import Milestone from '#models/milestone'
import Task from '#models/task'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import type Organization from '#models/organization'
import type User from '#models/user'
import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
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

/**
 * Calendar 完整模式改期写入契约测试（task 2.5）。
 *
 * Calendar 不新增改期端点，拖拽/键盘改期只组装 patch 后复用正式任务/里程碑更新链路。
 * 本文件断言该链路对「区间整体移动、非法日期、self 越权、只读拒绝、里程碑审计」的行为，
 * 即前端 `computeReschedulePatch` 产出的 patch 打到后端时的最终裁决。
 */

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

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

test.group('Calendar 改期写入契约', (group) => {
  useAuthDatabase(group)

  test('PM 整体平移任务区间（startDate+endDate）成功并写 TASK_UPDATED 审计', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('cal-resched-pm') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const task = await Task.create({
      projectId: project.id,
      name: '区间任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      startDate: DateTime.fromISO('2026-07-10'),
      endDate: DateTime.fromISO('2026-07-12'),
    })
    const token = await login(client, owner)

    // 前端 computeReschedulePatch 对整段 +4 天平移的等价 patch
    const res = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ startDate: '2026-07-14', endDate: '2026-07-16' })
    res.assertStatus(200)

    await task.refresh()
    assert.equal(task.startDate?.toISODate(), '2026-07-14')
    assert.equal(task.endDate?.toISODate(), '2026-07-16')

    const logs = await AuditLog.query()
      .where('entity_type', 'task')
      .where('entity_id', task.id)
      .where('action', 'update')
    assert.isAbove(logs.length, 0)
  })

  test('结束早于开始的改期返回 422 且不写入', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-resched-invalid') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const task = await Task.create({
      projectId: project.id,
      name: '任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      startDate: DateTime.fromISO('2026-07-10'),
      endDate: DateTime.fromISO('2026-07-12'),
    })
    const token = await login(client, owner)

    const res = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ startDate: '2026-07-20', endDate: '2026-07-15' })
    res.assertStatus(422)

    await task.refresh()
    assert.equal(task.startDate?.toISODate(), '2026-07-10')
    assert.equal(task.endDate?.toISODate(), '2026-07-12')
  })

  test('MEMBER(task:update:self) 改期他人任务返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('cal-resched-owner') })
    const member = await createUser({ email: uniqueEmail('cal-resched-member') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])
    const otherTask = await Task.create({
      projectId: project.id,
      name: '别人的任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      startDate: DateTime.fromISO('2026-07-10'),
      endDate: DateTime.fromISO('2026-07-12'),
    })
    const token = await login(client, member)

    const res = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${otherTask.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ startDate: '2026-07-14', endDate: '2026-07-16' })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('只读观察者改期返回 403', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('cal-resched-ro-owner') })
    const observer = await createUser({ email: uniqueEmail('cal-resched-ro') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: observer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    const task = await Task.create({
      projectId: project.id,
      name: '任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
      endDate: DateTime.fromISO('2026-07-12'),
    })
    const token = await login(client, observer)

    const res = await client
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ endDate: '2026-07-18' })
    res.assertStatus(403)
  })

  test('里程碑目标日期改期成功并写 MILESTONE_UPDATED 审计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cal-resched-ms') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const milestone = await Milestone.create({
      projectId: project.id,
      name: '里程碑',
      status: 'planned',
      plannedDate: DateTime.fromISO('2026-07-15'),
      displayOrder: 0,
    })
    const token = await login(client, owner)

    const res = await client
      .patch(`/api/v1/milestones/${milestone.id}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ plannedDate: '2026-07-20' })
    res.assertStatus(200)

    await milestone.refresh()
    assert.equal(milestone.plannedDate?.toISODate(), '2026-07-20')

    const logs = await AuditLog.query()
      .where('entity_type', 'milestone')
      .where('entity_id', milestone.id)
      .where('action', 'update')
    assert.isAbove(logs.length, 0)
  })
})
