import { test } from '@japa/runner'
import Resource from '#models/resource'
import ResourceLoadService from '#services/resource_load_service'
import db from '@adonisjs/lucid/services/db'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('ResourceLoadService', (group) => {
  useAuthDatabase(group)

  let svc: ResourceLoadService

  group.each.setup(() => {
    svc = new ResourceLoadService()
  })

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('l-owner') })
    const org = await createOrganization(owner)
    const pm = await createUser({ email: uniqueEmail('l-pm') })
    const { project } = await createProjectWithMember(org, owner, pm, 'Project Manager')
    return { owner, org, pm, project }
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

  async function createTask(projectId: number) {
    const [taskId] = await db.table('tasks').insert({
      project_id: projectId,
      name: 'resource load task',
      status: 'not_started',
      created_at: new Date().toISOString(),
    })
    return taskId
  }

  async function createAllocation(
    resourceId: number,
    taskId: number,
    allocationPercent: number,
    startDate: string,
    endDate: string,
  ) {
    await db.table('resource_allocations').insert({
      resource_id: resourceId,
      task_id: taskId,
      allocation_percent: allocationPercent,
      start_date: startDate,
      end_date: endDate,
      created_at: new Date().toISOString(),
    })
  }

  function daysBetween(from: string, to: string): number {
    return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1
  }

  test('团队负载返回所有资源日负荷与团队平均', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const r1 = await createResource(pm, project, { name: 'R1' })
    await createResource(pm, project, { name: 'R2' })
    const taskId = await createTask(project.id)
    await createAllocation(r1.id, taskId, 100, '2026-01-01', '2026-01-10')

    const result = (await svc.load(org.id, project.id, '2026-01-01', '2026-01-10', 'team')) as any
    assert.isArray(result.resources)
    assert.lengthOf(result.resources, 2)
    const r1Result = result.resources.find((r: any) => r.resourceName === 'R1')
    assert.isDefined(r1Result)
    assert.equal(r1Result.overallUtilizationPercent, 100)
    assert.equal(r1Result.days.length, daysBetween('2026-01-01', '2026-01-10'))
  })

  test('个人负载返回正确的日负荷百分比', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await createResource(pm, project)
    const task1Id = await createTask(project.id)
    const task2Id = await createTask(project.id)
    await createAllocation(resource.id, task1Id, 100, '2026-01-01', '2026-01-10')
    await createAllocation(resource.id, task2Id, 50, '2026-01-05', '2026-01-15')

    const result = (await svc.load(
      org.id,
      project.id,
      '2026-01-01',
      '2026-01-15',
      'personal',
      resource.id,
    )) as any
    const day1 = result.resources[0]?.days.find((d: any) => d.date === '2026-01-01')
    assert.isDefined(day1)
    assert.equal(day1.totalAllocatedPercent, 100)

    const day5 = result.resources[0]?.days.find((d: any) => d.date === '2026-01-05')
    assert.isDefined(day5)
    assert.equal(day5.totalAllocatedPercent, 150)
  })

  test('趋势返回每日团队平均利用率', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const r1 = await createResource(pm, project, { name: 'R1' })
    const r2 = await createResource(pm, project, { name: 'R2' })
    const taskId = await createTask(project.id)
    await createAllocation(r1.id, taskId, 100, '2026-01-01', '2026-01-10')
    await createAllocation(r2.id, taskId, 50, '2026-01-01', '2026-01-10')

    const result = (await svc.load(org.id, project.id, '2026-01-01', '2026-01-10', 'trend')) as any
    assert.isArray(result.days)
    assert.equal(result.totalResources, 2)
    assert.lengthOf(result.days, daysBetween('2026-01-01', '2026-01-10'))
    const day1 = result.days.find((d: any) => d.date === '2026-01-01')
    assert.approximately(day1.utilizationPercent, 75, 1)
  })

  test('无活跃资源返回空列表', async ({ assert }) => {
    const { org, project } = await setupProject()
    const result = (await svc.load(org.id, project.id, '2026-01-01', '2026-01-10', 'team')) as any
    assert.isArray(result.resources)
    assert.lengthOf(result.resources, 0)
    assert.equal(result.teamAverageUtilizationPercent, 0)
  })
})
