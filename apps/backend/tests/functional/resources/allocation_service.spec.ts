import { test } from '@japa/runner'
import Resource from '#models/resource'
import ResourceAllocationService from '#services/resource_allocation_service'
import type AuditService from '#services/audit_service'
import db from '@adonisjs/lucid/services/db'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('ResourceAllocationService', (group) => {
  useAuthDatabase(group)

  let svc: ResourceAllocationService

  group.each.setup(() => {
    const mockAudit = { log: async () => {} } as unknown as AuditService
    svc = new ResourceAllocationService(mockAudit)
  })

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('a-owner') })
    const org = await createOrganization(owner)
    const pm = await createUser({ email: uniqueEmail('a-pm') })
    const { project } = await createProjectWithMember(org, owner, pm, 'Project Manager')
    return { owner, org, pm, project }
  }

  async function createTask(projectId: number) {
    const [taskId] = await db.table('tasks').insert({
      project_id: projectId,
      name: '测试任务',
      status: 'not_started',
      created_at: new Date().toISOString(),
    })
    return taskId
  }

  async function createResource(_pm: any, project: any, overrides = {}) {
    return Resource.create({
      projectId: project.id,
      name: '资源',
      resourceType: 'human',
      role: 'member',
      dailyCapacityHours: 8,
      ...overrides,
    })
  }

  test('创建分配返回完整分配对象', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await createResource(pm, project)
    const taskId = await createTask(project.id)
    const alloc = await svc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 50,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      },
      pm.id,
    )

    assert.isNotNull(alloc)
    assert.equal(alloc.resourceId, resource.id)
    assert.equal(alloc.taskId, taskId)
    assert.equal(alloc.allocationPercent, 50)
    assert.equal(alloc.startDate!.toISODate(), '2026-01-01')
    assert.equal(alloc.endDate!.toISODate(), '2026-01-31')
  })

  test('endDate < startDate 抛验证错误', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await createResource(pm, project)
    const taskId = await createTask(project.id)
    await assert.rejects(async () =>
      svc.create(
        org.id,
        project.id,
        resource.id,
        {
          taskId,
          allocationPercent: 50,
          startDate: '2026-02-01',
          endDate: '2026-01-01',
        },
        pm.id,
      ),
    )
  })

  test('列表返回资源的所有分配', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await createResource(pm, project)
    const taskId1 = await createTask(project.id)
    const taskId2 = await createTask(project.id)
    await svc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId: taskId1,
        allocationPercent: 50,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      },
      pm.id,
    )
    await svc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId: taskId2,
        allocationPercent: 30,
        startDate: '2026-02-01',
        endDate: '2026-02-28',
      },
      pm.id,
    )

    const result = await svc.listByResource(org.id, project.id, resource.id, {})
    assert.lengthOf(result.data, 2)
  })

  test('列表支持分页', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await createResource(pm, project)
    const taskIds = []
    for (let i = 0; i < 5; i++) {
      taskIds.push(await createTask(project.id))
    }
    for (let i = 0; i < 5; i++) {
      await svc.create(
        org.id,
        project.id,
        resource.id,
        {
          taskId: taskIds[i],
          allocationPercent: 20,
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        },
        pm.id,
      )
    }

    const page1 = await svc.listByResource(org.id, project.id, resource.id, { page: 1, perPage: 2 })
    assert.lengthOf(page1.data, 2)
    assert.equal(page1.meta.total, 5)
  })

  test('更新分配的时间窗和百分比', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await createResource(pm, project)
    const taskId = await createTask(project.id)
    const alloc = await svc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 50,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      },
      pm.id,
    )

    const updated = await svc.update(
      org.id,
      project.id,
      alloc.id,
      {
        allocationPercent: 75,
        endDate: '2026-02-15',
      },
      pm.id,
    )
    assert.equal(updated.allocationPercent, 75)
    assert.equal(updated.endDate!.toISODate(), '2026-02-15')
  })

  test('创建和更新分配支持实际工时字段', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await createResource(pm, project)
    const taskId = await createTask(project.id)
    const alloc = await svc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 50,
        actualUnits: 2,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      },
      pm.id,
    )

    assert.equal(alloc.actualUnits, 2)

    const updated = await svc.update(org.id, project.id, alloc.id, { actualUnits: 3.5 }, pm.id)
    assert.equal(updated.actualUnits, 3.5)
  })

  test('创建过载分配返回非阻断 warning summary', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await createResource(pm, project)
    const taskId = await createTask(project.id)
    await svc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 75,
        startDate: '2026-10-01',
        endDate: '2026-10-01',
      },
      pm.id,
    )

    const result = await svc.createWithWarnings(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 50,
        startDate: '2026-10-01',
        endDate: '2026-10-01',
      },
      pm.id,
    )

    assert.equal(result.data.allocationPercent, 50)
    assert.isAtLeast(result.warningSummary.meta.warningCount, 1)
    assert.include(
      result.warningSummary.data.map((conflict) => conflict.type),
      'overload',
    )
  })

  test('删除分配后从列表消失', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await createResource(pm, project)
    const taskId = await createTask(project.id)
    const alloc = await svc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 50,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      },
      pm.id,
    )

    await svc.delete(org.id, project.id, alloc.id, pm.id)
    const result = await svc.listByResource(org.id, project.id, resource.id, {})
    assert.lengthOf(result.data, 0)
  })
})
