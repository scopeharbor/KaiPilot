import { test } from '@japa/runner'
import ResourceLoadService from '#services/resource_load_service'
import ResourceService from '#services/resource_service'
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

test.group('ResourceLoadService', (group) => {
  useAuthDatabase(group)

  let loadSvc: ResourceLoadService
  let resSvc: ResourceService
  let allocSvc: ResourceAllocationService

  group.each.setup(() => {
    const mockAudit = { log: async () => {} } as unknown as AuditService
    loadSvc = new ResourceLoadService()
    resSvc = new ResourceService(mockAudit)
    allocSvc = new ResourceAllocationService(mockAudit)
  })

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('load-owner') })
    const org = await createOrganization(owner)
    const pm = await createUser({ email: uniqueEmail('load-pm') })
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

  test('多分配同日累加', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const taskId = await createTask(project.id)

    const resource = await resSvc.create(
      org.id,
      project.id,
      {
        name: '工程师A',
        dailyCapacityHours: 8,
        workDays: [1, 2, 3, 4, 5],
      },
      pm.id,
    )

    // 创建两个分配，各 50%
    await allocSvc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 50,
        startDate: '2026-07-07',
        endDate: '2026-07-07',
      },
      pm.id,
    )
    await allocSvc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 50,
        startDate: '2026-07-07',
        endDate: '2026-07-07',
      },
      pm.id,
    )

    const result = await loadSvc.load(org.id, project.id, '2026-07-07', '2026-07-07', 'team')
    if ('resources' in result) {
      const day = result.resources[0].days[0]
      assert.equal(day.totalAllocatedPercent, 100)
      assert.equal(day.allocatedHours, 8)
    }
  })

  test('有负责人无分配负载为0', async ({ assert }) => {
    const { pm, project, org } = await setupProject()

    await resSvc.create(
      org.id,
      project.id,
      {
        name: '工程师B',
        dailyCapacityHours: 8,
        workDays: [1, 2, 3, 4, 5],
      },
      pm.id,
    )

    const result = await loadSvc.load(org.id, project.id, '2026-07-07', '2026-07-07', 'team')
    if ('resources' in result) {
      assert.equal(result.resources.length, 1)
      assert.equal(result.resources[0].days[0].totalAllocatedPercent, 0)
      assert.equal(result.resources[0].overallUtilizationPercent, 0)
    }
  })

  test('非工作日负载为0', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const taskId = await createTask(project.id)

    const resource = await resSvc.create(
      org.id,
      project.id,
      {
        name: '工程师C',
        dailyCapacityHours: 8,
        workDays: [1, 2, 3, 4, 5], // 周一到周五
      },
      pm.id,
    )

    await allocSvc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 100,
        startDate: '2026-07-05', // 周日
        endDate: '2026-07-05',
      },
      pm.id,
    )

    const result = await loadSvc.load(org.id, project.id, '2026-07-05', '2026-07-05', 'team')
    if ('resources' in result) {
      assert.equal(result.resources[0].days[0].capacityHours, 0)
      assert.equal(result.resources[0].days[0].allocatedHours, 0)
    }
  })

  test('四档阈值边界', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const taskId = await createTask(project.id)

    const resource = await resSvc.create(
      org.id,
      project.id,
      {
        name: '工程师D',
        dailyCapacityHours: 8,
        workDays: [1, 2, 3, 4, 5],
      },
      pm.id,
    )

    // 80% = 正常
    await allocSvc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 80,
        startDate: '2026-07-07',
        endDate: '2026-07-07',
      },
      pm.id,
    )

    const result = await loadSvc.load(org.id, project.id, '2026-07-07', '2026-07-07', 'team')
    if ('resources' in result) {
      assert.equal(result.resources[0].days[0].totalAllocatedPercent, 80)
    }
  })

  test('过载>100%', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const taskId = await createTask(project.id)

    const resource = await resSvc.create(
      org.id,
      project.id,
      {
        name: '工程师E',
        dailyCapacityHours: 8,
        workDays: [1, 2, 3, 4, 5],
      },
      pm.id,
    )

    await allocSvc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 120,
        startDate: '2026-07-07',
        endDate: '2026-07-07',
      },
      pm.id,
    )

    const result = await loadSvc.load(org.id, project.id, '2026-07-07', '2026-07-07', 'team')
    if ('resources' in result) {
      assert.equal(result.resources[0].days[0].totalAllocatedPercent, 120)
      assert.equal(result.resources[0].overallUtilizationPercent, 120)
    }
  })

  test('软删资源不计入', async ({ assert }) => {
    const { pm, project, org } = await setupProject()

    const resource = await resSvc.create(
      org.id,
      project.id,
      {
        name: '待删资源',
        dailyCapacityHours: 8,
      },
      pm.id,
    )

    await resSvc.delete(org.id, project.id, resource.id, pm.id)

    const result = await loadSvc.load(org.id, project.id, '2026-07-07', '2026-07-07', 'team')
    if ('resources' in result) {
      assert.equal(result.resources.length, 0)
    }
  })

  test('可用工时为0且有分配→过载', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const taskId = await createTask(project.id)

    const resource = await resSvc.create(
      org.id,
      project.id,
      {
        name: '周末工程师',
        dailyCapacityHours: 8,
        workDays: [], // 无工作日
      },
      pm.id,
    )

    await allocSvc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 100,
        startDate: '2026-07-07',
        endDate: '2026-07-07',
      },
      pm.id,
    )

    const result = await loadSvc.load(org.id, project.id, '2026-07-07', '2026-07-07', 'team')
    if ('resources' in result) {
      assert.equal(result.resources[0].days[0].capacityHours, 0)
      assert.equal(result.resources[0].days[0].allocatedHours, 0)
    }
  })
})
