import AuditLog from '#models/audit_log'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import AuditService from '#services/audit_service'
import GanttSchedulingService from '#services/gantt_scheduling_service'
import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'
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

async function login(client: ApiClient, user: User) {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return response.body().data.accessToken as string
}

async function datedTask(
  projectId: number,
  name: string,
  startDate: string,
  endDate: string,
  durationDays: number,
) {
  return Task.create({
    projectId,
    name,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: DateTime.fromISO(startDate),
    endDate: DateTime.fromISO(endDate),
    durationDays,
  })
}

test.group('Gantt scheduling API', (group) => {
  useAuthDatabase(group)

  test('preview 只读，commit 原子顺延并写聚合审计', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('schedule-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    project.settings = { workdays: [1, 2, 3, 4, 5], holidays: [] }
    await project.save()
    const [a, b] = await Promise.all([
      datedTask(project.id, 'A', '2026-07-01', '2026-07-03', 3),
      datedTask(project.id, 'B', '2026-07-06', '2026-07-07', 2),
    ])
    await TaskDependency.create({
      predecessorId: a.id,
      successorId: b.id,
      type: 'fs',
      lagDays: 0,
    })
    const token = await login(client, owner)
    const intent = {
      taskId: a.id,
      operation: 'move',
      startDate: '2026-07-06',
      autoSchedule: true,
    }

    const preview = await client
      .post(`/api/v1/projects/${project.id}/gantt/schedule`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'preview', ...intent })
    preview.assertStatus(200)
    assert.isFalse(preview.body().data.committed)
    assert.lengthOf(preview.body().data.changes, 2)
    await a.refresh()
    await b.refresh()
    assert.equal(a.startDate?.toISODate(), '2026-07-01')
    assert.equal(b.startDate?.toISODate(), '2026-07-06')

    const committed = await client
      .post(`/api/v1/projects/${project.id}/gantt/schedule`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        mode: 'commit',
        ...intent,
        previewToken: preview.body().data.previewToken,
      })
    committed.assertStatus(200)
    assert.isTrue(committed.body().data.committed)
    await a.refresh()
    await b.refresh()
    assert.equal(a.startDate?.toISODate(), '2026-07-06')
    assert.equal(b.startDate?.toISODate(), '2026-07-09')
    const audit = await AuditLog.query()
      .where('project_id', project.id)
      .where('entity_type', 'project')
      .where('action', 'update')
      .orderBy('id', 'desc')
      .first()
    assert.equal((audit?.metadata as { event?: string })?.event, 'GANTT_SCHEDULE_COMMITTED')
  })

  test('任务并发变化使 preview token 过期且不写入', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('schedule-stale') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const task = await datedTask(project.id, 'A', '2026-07-06', '2026-07-06', 1)
    const token = await login(client, owner)
    const intent = {
      taskId: task.id,
      operation: 'move',
      startDate: '2026-07-07',
      autoSchedule: true,
    }
    const preview = await client
      .post(`/api/v1/projects/${project.id}/gantt/schedule`)
      .header('Authorization', `Bearer ${token}`)
      .json({ mode: 'preview', ...intent })
    task.name = '并发修改'
    await task.save()

    const stale = await client
      .post(`/api/v1/projects/${project.id}/gantt/schedule`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        mode: 'commit',
        ...intent,
        previewToken: preview.body().data.previewToken,
      })
    stale.assertStatus(409)
    stale.assertBodyContains({ error: { code: 'SCHEDULE_STALE' } })
    await task.refresh()
  })

  test('审计写入失败时排程事务全部回滚', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('schedule-rollback') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const task = await datedTask(project.id, 'A', '2026-07-06', '2026-07-06', 1)
    const service = new GanttSchedulingService(new AuditService())
    const intent = {
      mode: 'preview' as const,
      taskId: task.id,
      operation: 'move' as const,
      startDate: '2026-07-07',
      autoSchedule: true,
    }
    const preview = await service.execute(org.id, project.id, intent, owner.id)
    const failingService = new GanttSchedulingService({
      log: async () => {
        throw new Error('audit failure')
      },
    } as never)
    await assert.rejects(
      () =>
        failingService.execute(
          org.id,
          project.id,
          {
            ...intent,
            mode: 'commit',
            previewToken: preview.previewToken,
          },
          owner.id,
        ),
      'audit failure',
    )
    await task.refresh()
    assert.equal(task.startDate?.toISODate(), '2026-07-06')
  })

  test('仅 task:update:self 的成员被拒，跨组织不可见', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('schedule-perm-owner') })
    const member = await createUser({ email: uniqueEmail('schedule-perm-member') })
    const outsider = await createUser({ email: uniqueEmail('schedule-perm-outsider') })
    const org = await createOrganization(owner)
    await addOrgMember(org, member, 'member')
    await createOrganization(outsider)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const memberRole = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.MEMBER,
      description: 'member',
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: member.id,
      projectRoleId: memberRole.id,
      isActive: true,
    })
    const task = await datedTask(project.id, 'A', '2026-07-06', '2026-07-06', 1)
    const body = {
      mode: 'preview',
      taskId: task.id,
      operation: 'move',
      startDate: '2026-07-07',
      autoSchedule: true,
    }

    const memberToken = await login(client, member)
    const denied = await client
      .post(`/api/v1/projects/${project.id}/gantt/schedule`)
      .header('Authorization', `Bearer ${memberToken}`)
      .json(body)
    denied.assertStatus(403)

    const outsiderToken = await login(client, outsider)
    const hidden = await client
      .post(`/api/v1/projects/${project.id}/gantt/schedule`)
      .header('Authorization', `Bearer ${outsiderToken}`)
      .json(body)
    hidden.assertStatus(404)
  })
})
