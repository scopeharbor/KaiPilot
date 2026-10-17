import Resource from '#models/resource'
import ResourceAvailabilityException from '#models/resource_availability_exception'
import ResourceAllocation from '#models/resource_allocation'
import TaskResourceRequirement from '#models/task_resource_requirement'
import ResourceAvailabilityService from '#services/resource_availability_service'
import ResourceConflictService from '#services/resource_conflict_service'
import ResourceMatchingService from '#services/resource_matching_service'
import ResourcePlanningService from '#services/resource_planning_service'
import ProjectService from '#services/project_service'
import ResourceInvalidationService, {
  type ResourceInvalidationInput,
} from '#services/resource_invalidation_service'
import TaskResourceRequirementService from '#services/task_resource_requirement_service'
import type AuditService from '#services/audit_service'
import type NotificationService from '#services/notification_service'
import type RbacService from '#services/rbac_service'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { performance } from 'node:perf_hooks'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'

test.group('V2 Resource Management Services', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rm-v2-svc') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  async function createTask(projectId: number, overrides: Record<string, unknown> = {}) {
    const [taskId] = await db.table('tasks').insert({
      project_id: projectId,
      name: '资源服务测试任务',
      status: 'not_started',
      start_date: '2026-10-01',
      end_date: '2026-10-07',
      created_at: new Date().toISOString(),
      ...overrides,
    })
    return taskId
  }

  async function createResource(projectId: number, overrides: Partial<Resource> = {}) {
    return Resource.create({
      projectId,
      name: '资源',
      resourceType: 'human',
      role: 'member',
      status: 'active',
      dailyCapacityHours: 8,
      ...overrides,
    })
  }

  async function nextId(table: string) {
    const row = await db.from(table).max('id as max').first()
    return Number(row?.max ?? 0) + 1
  }

  async function insertChunks(table: string, rows: Record<string, unknown>[], size = 100) {
    for (let index = 0; index < rows.length; index += size) {
      await db.table(table).insert(rows.slice(index, index + size))
    }
  }

  test('ResourceAvailabilityService overlays project calendar and resource exception', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    project.settings = {
      workingCalendar: {
        workdays: [1, 2, 3, 4, 5],
        holidays: ['2026-10-01'],
        extraWorkdays: ['2026-10-03'],
      },
    }
    await project.save()

    const resource = await createResource(Number(project.id))
    await ResourceAvailabilityException.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      resourceId: resource.id,
      startDate: DateTime.fromISO('2026-10-02'),
      endDate: DateTime.fromISO('2026-10-02'),
      capacityOverrideHours: 0,
      reason: '请假',
      status: 'confirmed',
      createdBy: Number(owner.id),
      auditLogId: null,
    })

    const service = new ResourceAvailabilityService()
    const result = await service.calculateForResource(
      Number(org.id),
      Number(project.id),
      resource.id,
      '2026-10-01',
      '2026-10-03',
    )

    assert.deepEqual(
      result.days.map((day) => ({
        date: day.date,
        base: day.baseCapacityHours,
        capacity: day.capacityHours,
        reason: day.exceptionReason,
      })),
      [
        { date: '2026-10-01', base: 0, capacity: 0, reason: null },
        { date: '2026-10-02', base: 8, capacity: 0, reason: '请假' },
        { date: '2026-10-03', base: 8, capacity: 8, reason: null },
      ],
    )
    assert.equal(result.totalBaseCapacityHours, 16)
    assert.equal(result.totalCapacityHours, 8)
  })

  test('ResourceAvailabilityService rejects cross-organization project access', async ({
    assert,
  }) => {
    const { project } = await setupProject()
    const other = await setupProject()
    const resource = await createResource(Number(project.id))
    const service = new ResourceAvailabilityService()

    await assert.rejects(async () => {
      await service.calculateForResource(
        Number(other.org.id),
        Number(project.id),
        resource.id,
        '2026-10-01',
        '2026-10-02',
      )
    }, /项目不存在/)
  })

  test('TaskResourceRequirementService CRUD keeps assignee and allocations untouched', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const assignee = await createUser({ email: uniqueEmail('rm-v2-assignee') })
    const taskId = await createTask(Number(project.id), { assignee_id: Number(assignee.id) })
    const resource = await createResource(Number(project.id))
    await ResourceAllocation.create({
      resourceId: resource.id,
      taskId,
      allocationType: 'assigned',
      allocationPercent: 25,
      startDate: DateTime.fromISO('2026-10-01'),
      endDate: DateTime.fromISO('2026-10-02'),
    })

    const service = new TaskResourceRequirementService()
    const requirement = await service.create(
      Number(org.id),
      Number(project.id),
      {
        taskId,
        role: 'frontend',
        skillTags: ['React'],
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-03',
        priority: 'high',
      },
      Number(owner.id),
    )

    assert.equal(requirement.role, 'frontend')
    assert.equal(requirement.skillTags, JSON.stringify(['React']))
    assert.equal(await service.countAllocationsForTask(taskId), 1)
    let task = await db.from('tasks').where('id', taskId).firstOrFail()
    assert.equal(task.assignee_id, Number(assignee.id))

    const updated = await service.update(Number(org.id), Number(project.id), requirement.id, {
      estimatedPersonDays: 2,
      allocationPercent: null,
      status: 'matched',
    })
    assert.equal(updated.estimatedPersonDays, 2)
    assert.equal(updated.allocationPercent, null)
    assert.equal(updated.status, 'matched')

    await service.delete(Number(org.id), Number(project.id), requirement.id)
    assert.equal(await service.countAllocationsForTask(taskId), 1)
    task = await db.from('tasks').where('id', taskId).firstOrFail()
    assert.equal(task.assignee_id, Number(assignee.id))
  })

  test('TaskResourceRequirementService validates task ownership and date window', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const other = await setupProject()
    const otherTaskId = await createTask(Number(other.project.id))
    const taskId = await createTask(Number(project.id))
    const service = new TaskResourceRequirementService()

    await assert.rejects(async () => {
      await service.create(
        Number(org.id),
        Number(project.id),
        {
          taskId: otherTaskId,
          role: 'frontend',
          allocationPercent: 50,
          startDate: '2026-10-01',
          endDate: '2026-10-03',
        },
        Number(owner.id),
      )
    }, /任务不存在/)

    await assert.rejects(async () => {
      await service.create(
        Number(org.id),
        Number(project.id),
        {
          taskId,
          role: 'frontend',
          allocationPercent: 50,
          startDate: '2026-09-30',
          endDate: '2026-10-03',
        },
        Number(owner.id),
      )
    }, /不能早于任务开始日期/)
  })

  test('TaskResourceRequirementService list scopes by organization and project', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const other = await setupProject()
    const taskId = await createTask(Number(project.id))
    const otherTaskId = await createTask(Number(other.project.id))
    const service = new TaskResourceRequirementService()

    await service.create(
      Number(org.id),
      Number(project.id),
      {
        taskId,
        role: 'frontend',
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-03',
      },
      Number(owner.id),
    )
    await service.create(
      Number(other.org.id),
      Number(other.project.id),
      {
        taskId: otherTaskId,
        role: 'backend',
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-03',
      },
      Number(other.owner.id),
    )

    const result = await service.list(Number(org.id), Number(project.id), {})
    assert.lengthOf(result.data, 1)
    assert.equal(result.data[0].role, 'frontend')
  })

  test('ResourcePlanningService returns summary matrix aggregates and unmet requirements', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const taskId = await createTask(Number(project.id), {
      start_date: '2026-10-01',
      end_date: '2026-10-02',
    })
    const resource = await createResource(Number(project.id), {
      role: 'member',
      skillTags: JSON.stringify(['React']),
      roleTags: JSON.stringify(['frontend']),
    })
    await ResourceAllocation.create({
      resourceId: resource.id,
      taskId,
      allocationType: 'assigned',
      allocationPercent: 50,
      startDate: DateTime.fromISO('2026-10-01'),
      endDate: DateTime.fromISO('2026-10-02'),
    })
    await new TaskResourceRequirementService().create(
      Number(org.id),
      Number(project.id),
      {
        taskId,
        role: 'backend',
        skillTags: ['Go'],
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-02',
      },
      Number(owner.id),
    )

    const result = await new ResourcePlanningService().getPlanning(
      Number(org.id),
      Number(project.id),
      {
        from: '2026-10-01',
        to: '2026-10-02',
      },
    )

    assert.equal(result.summary.totalResources, 1)
    assert.equal(result.summary.totalCapacityHours, 16)
    assert.equal(result.summary.totalAllocatedHours, 8)
    assert.equal(result.summary.unmetRequirements, 1)
    assert.equal(result.matrix[0].days[0].allocatedHours, 4)
    assert.equal(result.matrix[0].loadStatus, 'available')
    assert.equal(result.aggregates.byRole[0].key, 'member')
    assert.equal(result.aggregates.bySkill[0].key, 'React')
    assert.lengthOf(result.trends, 2)
  })

  test('ResourceConflictService detects overload unavailable gap overflow and illegal refs', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const other = await setupProject()
    const taskId = await createTask(Number(project.id), {
      start_date: '2026-10-01',
      end_date: '2026-10-02',
    })
    const otherTaskId = await createTask(Number(other.project.id), {
      start_date: '2026-10-01',
      end_date: '2026-10-02',
    })
    const resource = await createResource(Number(project.id), {
      role: 'member',
      skillTags: JSON.stringify(['React']),
      roleTags: JSON.stringify(['frontend']),
    })
    await ResourceAvailabilityException.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      resourceId: resource.id,
      startDate: DateTime.fromISO('2026-10-02'),
      endDate: DateTime.fromISO('2026-10-02'),
      capacityOverrideHours: 0,
      reason: '请假',
      status: 'confirmed',
      createdBy: Number(owner.id),
      auditLogId: null,
    })
    await ResourceAllocation.create({
      resourceId: resource.id,
      taskId,
      allocationType: 'assigned',
      allocationPercent: 75,
      startDate: DateTime.fromISO('2026-10-01'),
      endDate: DateTime.fromISO('2026-10-02'),
    })
    await ResourceAllocation.create({
      resourceId: resource.id,
      taskId,
      allocationType: 'assigned',
      allocationPercent: 50,
      startDate: DateTime.fromISO('2026-09-30'),
      endDate: DateTime.fromISO('2026-10-03'),
    })
    await ResourceAllocation.create({
      resourceId: resource.id,
      taskId: otherTaskId,
      allocationType: 'assigned',
      allocationPercent: 10,
      startDate: DateTime.fromISO('2026-10-01'),
      endDate: DateTime.fromISO('2026-10-01'),
    })
    await new TaskResourceRequirementService().create(
      Number(org.id),
      Number(project.id),
      {
        taskId,
        role: 'backend',
        skillTags: ['Go'],
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-02',
      },
      Number(owner.id),
    )

    const result = await new ResourceConflictService().listConflicts(
      Number(org.id),
      Number(project.id),
      {
        from: '2026-10-01',
        to: '2026-10-02',
      },
    )
    const types = result.data.map((conflict) => conflict.type)

    assert.include(types, 'overload')
    assert.include(types, 'unavailable_allocation')
    assert.include(types, 'requirement_gap')
    assert.include(types, 'allocation_window_overflow')
    assert.include(types, 'illegal_reference')
    assert.isAtLeast(result.meta.warningCount, 4)
    assert.isAtLeast(result.meta.blockingCount, 1)
  })

  test('ResourceMatchingService explains candidates without creating allocations', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const taskId = await createTask(Number(project.id), {
      start_date: '2026-10-01',
      end_date: '2026-10-03',
    })
    const resource = await createResource(Number(project.id), {
      name: '前端资源',
      role: 'member',
      skillTags: JSON.stringify(['React', 'TypeScript']),
      roleTags: JSON.stringify(['frontend']),
    })
    await createResource(Number(project.id), {
      name: '后端资源',
      role: 'member',
      skillTags: JSON.stringify(['Go']),
      roleTags: JSON.stringify(['backend']),
    })
    const requirement = await new TaskResourceRequirementService().create(
      Number(org.id),
      Number(project.id),
      {
        taskId,
        role: 'frontend',
        skillTags: ['React'],
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-03',
      },
      Number(owner.id),
    )

    const beforeCount = await ResourceAllocation.query()
      .where('task_id', taskId)
      .count('*', 'total')
    const result = await new ResourceMatchingService().matchRequirement(
      Number(org.id),
      Number(project.id),
      requirement.id,
    )
    const afterCount = await ResourceAllocation.query().where('task_id', taskId).count('*', 'total')

    assert.equal(result.meta.writesApplied, false)
    assert.equal(result.candidates[0].resourceId, resource.id)
    assert.isAbove(result.candidates[0].score, 80)
    assert.include(result.candidates[0].explanations.join('\n'), '角色匹配')
    assert.equal(Number(beforeCount[0].$extras.total), Number(afterCount[0].$extras.total))
  })

  test('ProjectService working calendar update emits resource invalidation hint', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const captured: ResourceInvalidationInput[] = []
    const original = ResourceInvalidationService.prototype.broadcast
    ResourceInvalidationService.prototype.broadcast = function (input: ResourceInvalidationInput) {
      captured.push(input)
      return this.buildEvent(input)
    }

    try {
      const audit = { log: async () => {} } as unknown as AuditService
      const service = new ProjectService(audit, {} as RbacService, {} as NotificationService)
      await service.updateWorkingCalendar(
        Number(org.id),
        Number(project.id),
        { workdays: [1, 2, 3, 4, 5], holidays: ['2026-10-01'], extraWorkdays: [] },
        Number(owner.id),
        {},
        ['workdays', 'holidays', 'extraWorkdays'],
      )

      assert.lengthOf(captured, 1)
      assert.equal(captured[0].reason, 'working_calendar_changed')
      assert.include(captured[0].affectedQueries ?? [], 'resource-planning')
      assert.include(captured[0].affectedQueries ?? [], 'resource-matches')
    } finally {
      ResourceInvalidationService.prototype.broadcast = original
    }
  })

  test('resource planning baseline records timings for 1000 tasks 100 resources 2000 items', async ({
    assert,
  }) => {
    const { project, org, owner } = await setupProject()
    const projectId = Number(project.id)
    const organizationId = Number(org.id)
    const now = new Date().toISOString()
    const taskStartId = await nextId('tasks')
    const resourceStartId = await nextId('resources')

    const tasks = Array.from({ length: 1000 }, (_, index) => ({
      id: taskStartId + index,
      project_id: projectId,
      name: `资源基准任务 ${index + 1}`,
      status: 'not_started',
      start_date: '2026-10-01',
      end_date: '2026-10-14',
      created_at: now,
    }))
    await insertChunks('tasks', tasks, 100)

    const resources = Array.from({ length: 100 }, (_, index) => ({
      id: resourceStartId + index,
      project_id: projectId,
      name: `资源基准人员 ${index + 1}`,
      resource_type: 'human',
      role: 'member',
      status: 'active',
      daily_capacity_hours: 8,
      skill_tags: JSON.stringify(index % 2 === 0 ? ['React'] : ['Go']),
      role_tags: JSON.stringify(index % 2 === 0 ? ['frontend'] : ['backend']),
      work_days: JSON.stringify([1, 2, 3, 4, 5]),
      timezone: 'Asia/Shanghai',
      capacity_version: 1,
      capacity_calendar_policy: 'project_working_calendar',
      created_at: now,
    }))
    await insertChunks('resources', resources, 50)

    const allocations = Array.from({ length: 1000 }, (_, index) => ({
      resource_id: resourceStartId + (index % 100),
      task_id: taskStartId + index,
      allocation_type: 'assigned',
      allocation_percent: index % 5 === 0 ? 80 : 40,
      start_date: '2026-10-01',
      end_date: '2026-10-10',
      planned_units: null,
      actual_units: null,
      created_at: now,
    }))
    await insertChunks('resource_allocations', allocations, 100)

    const requirements = Array.from({ length: 1000 }, (_, index) => ({
      organization_id: organizationId,
      project_id: projectId,
      task_id: taskStartId + index,
      role: index % 2 === 0 ? 'frontend' : 'backend',
      skill_tags: JSON.stringify(index % 2 === 0 ? ['React'] : ['Go']),
      allocation_percent: 50,
      estimated_person_days: null,
      start_date: '2026-10-01',
      end_date: '2026-10-10',
      priority: 'medium',
      status: 'open',
      source_kind: 'manual',
      source_ref: null,
      created_by: Number(owner.id),
      audit_log_id: null,
      created_at: now,
    }))
    await insertChunks('task_resource_requirements', requirements, 100)

    const planningService = new ResourcePlanningService()
    const conflictService = new ResourceConflictService()
    const matchingService = new ResourceMatchingService()
    const filters = { from: '2026-10-01', to: '2026-10-14' }
    const timings: Record<string, number> = {}

    let start = performance.now()
    const planning = await planningService.getPlanning(organizationId, projectId, filters)
    timings.planningMs = Math.round(performance.now() - start)

    start = performance.now()
    const conflicts = await conflictService.listConflicts(organizationId, projectId, filters)
    timings.conflictsMs = Math.round(performance.now() - start)

    const firstRequirement = await TaskResourceRequirement.query()
      .where('project_id', projectId)
      .orderBy('id', 'asc')
      .firstOrFail()
    start = performance.now()
    const matches = await matchingService.matchRequirement(
      organizationId,
      projectId,
      firstRequirement.id,
      10,
    )
    timings.matchingMs = Math.round(performance.now() - start)

    const counters = {
      tasks: tasks.length,
      resources: planning.summary.totalResources,
      allocations: allocations.length,
      requirements: requirements.length,
      matrixRows: planning.matrix.length,
      conflicts: conflicts.meta.total,
      candidates: matches.meta.totalCandidates,
    }
    console.info('[resource-management-baseline]', { timings, counters })

    assert.equal(counters.tasks, 1000)
    assert.equal(counters.resources, 100)
    assert.equal(counters.allocations + counters.requirements, 2000)
    assert.equal(counters.matrixRows, 100)
    assert.isAtMost(timings.planningMs, 5000)
    assert.isAtMost(timings.conflictsMs, 15000)
    assert.isAtMost(timings.matchingMs, 5000)
  })
})
