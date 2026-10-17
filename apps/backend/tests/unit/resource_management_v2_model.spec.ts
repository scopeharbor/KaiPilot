import Resource from '#models/resource'
import ResourceAvailabilityException from '#models/resource_availability_exception'
import ResourceCapacityVersion from '#models/resource_capacity_version'
import TaskResourceRequirement from '#models/task_resource_requirement'
import ResourceService from '#services/resource_service'
import type AuditService from '#services/audit_service'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'

test.group('V2 Resource Management Model — schema and defaults', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rm-v2') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  test('ResourceService creates a V2 capacity version while preserving V1 fields', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const service = new ResourceService({ log: async () => {} } as unknown as AuditService)

    const resource = await service.create(
      Number(org.id),
      Number(project.id),
      {
        name: '前端工程师',
        dailyCapacityHours: 6,
        skillTags: ['React'],
        roleTags: ['frontend'],
      },
      Number(owner.id),
    )

    assert.equal(resource.resourceType, 'human')
    assert.equal(resource.role, 'member')
    assert.equal(resource.capacityVersion, 1)
    assert.equal(resource.capacityCalendarPolicy, 'project_working_calendar')
    assert.equal(resource.dailyCapacityHours, 6)
    assert.equal(resource.skillTags, JSON.stringify(['React']))
    assert.equal(resource.roleTags, JSON.stringify(['frontend']))

    const version = await ResourceCapacityVersion.query()
      .where('resource_id', resource.id)
      .firstOrFail()
    assert.equal(version.organizationId, Number(org.id))
    assert.equal(version.projectId, Number(project.id))
    assert.equal(version.version, 1)
    assert.equal(version.baseDailyCapacityHours, 6)
    assert.equal(version.calendarPolicy, 'project_working_calendar')
  })

  test('legacy direct Resource.create receives DB-level V2 defaults', async ({ assert }) => {
    const { project } = await setupProject()

    const resource = await Resource.create({
      projectId: Number(project.id),
      name: '旧资源',
      resourceType: 'human',
      role: 'member',
      status: 'active',
      dailyCapacityHours: 8,
    })

    const raw = await db.from('resources').where('id', resource.id).firstOrFail()
    assert.equal(raw.capacity_version, 1)
    assert.equal(raw.capacity_calendar_policy, 'project_working_calendar')
    assert.equal(raw.role_tags, '[]')
    assert.isNull(raw.capacity_profile)
  })

  test('availability exception stores date window and rejects invalid ranges', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const resource = await Resource.create({
      projectId: Number(project.id),
      name: '资源',
      resourceType: 'human',
      role: 'member',
      status: 'active',
      dailyCapacityHours: 8,
    })

    const exception = await ResourceAvailabilityException.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      resourceId: resource.id,
      startDate: DateTime.fromISO('2026-08-03'),
      endDate: DateTime.fromISO('2026-08-05'),
      capacityOverrideHours: 0,
      reason: '请假',
      status: 'confirmed',
      createdBy: Number(owner.id),
      auditLogId: null,
    })

    assert.equal(exception.startDate.toISODate(), '2026-08-03')
    assert.equal(exception.endDate.toISODate(), '2026-08-05')
    assert.equal(exception.capacityOverrideHours, 0)

    await assert.rejects(async () => {
      await db.table('resource_availability_exceptions').insert({
        organization_id: Number(org.id),
        project_id: Number(project.id),
        resource_id: resource.id,
        start_date: '2026-08-05',
        end_date: '2026-08-03',
        capacity_override_hours: 4,
        reason: '非法日期',
        status: 'planned',
        created_at: new Date().toISOString(),
      })
    })
  })

  test('task resource requirement is independent from assignee and allocations', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const assignee = await createUser({ email: uniqueEmail('rm-assignee') })
    const [taskId] = await db.table('tasks').insert({
      project_id: Number(project.id),
      name: '需要前端资源的任务',
      status: 'not_started',
      assignee_id: Number(assignee.id),
      start_date: '2026-08-01',
      end_date: '2026-08-05',
      created_at: new Date().toISOString(),
    })

    const requirement = await TaskResourceRequirement.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      taskId,
      role: 'frontend',
      skillTags: JSON.stringify(['React']),
      allocationPercent: 50,
      estimatedPersonDays: null,
      startDate: DateTime.fromISO('2026-08-01'),
      endDate: DateTime.fromISO('2026-08-05'),
      priority: 'high',
      status: 'open',
      sourceKind: 'manual',
      sourceRef: null,
      createdBy: Number(owner.id),
      auditLogId: null,
    })

    assert.equal(requirement.role, 'frontend')
    const task = await db.from('tasks').where('id', taskId).firstOrFail()
    assert.equal(task.assignee_id, Number(assignee.id))
    const allocations = await db
      .from('resource_allocations')
      .where('task_id', taskId)
      .count('*', 'total')
    assert.equal(Number(allocations[0].total), 0)
  })

  test('task resource requirement rejects missing effort and invalid enum values', async ({
    assert,
  }) => {
    const { project, org } = await setupProject()
    const [taskId] = await db.table('tasks').insert({
      project_id: Number(project.id),
      name: '非法需求测试',
      status: 'not_started',
      created_at: new Date().toISOString(),
    })

    await assert.rejects(async () => {
      await db.table('task_resource_requirements').insert({
        organization_id: Number(org.id),
        project_id: Number(project.id),
        task_id: taskId,
        role: 'frontend',
        start_date: '2026-08-01',
        end_date: '2026-08-05',
        priority: 'urgent',
        status: 'open',
        source_kind: 'manual',
        created_at: new Date().toISOString(),
      })
    })
  })
})
