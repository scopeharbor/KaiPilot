import { test } from '@japa/runner'
import ResourceAllocationService from '#services/resource_allocation_service'
import ResourceService from '#services/resource_service'
import type AuditService from '#services/audit_service'
import db from '@adonisjs/lucid/services/db'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('ResourceService', (group) => {
  useAuthDatabase(group)

  let svc: ResourceService
  let allocSvc: ResourceAllocationService

  group.each.setup(() => {
    const mockAudit = { log: async () => {} } as unknown as AuditService
    svc = new ResourceService(mockAudit)
    allocSvc = new ResourceAllocationService(mockAudit)
  })

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('r-owner') })
    const org = await createOrganization(owner)
    const pm = await createUser({ email: uniqueEmail('r-pm') })
    const { project } = await createProjectWithMember(org, owner, pm, 'Project Manager')
    return { owner, org, pm, project }
  }

  test('创建资源返回资源对象含完整字段', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await svc.create(
      org.id,
      project.id,
      {
        name: '张三',
        email: 'zhangsan@test.local',
        resourceType: 'human',
        role: 'member',
        dailyCapacityHours: 8,
      },
      pm.id,
    )

    assert.isNotNull(resource)
    assert.equal(resource.name, '张三')
    assert.equal(resource.email, 'zhangsan@test.local')
    assert.equal(resource.resourceType, 'human')
    assert.equal(resource.role, 'member')
    assert.equal(resource.dailyCapacityHours, 8)
    assert.equal(resource.projectId, project.id)
    assert.isNull(resource.deletedAt ?? null)
  })

  test('列表按 projectId 过滤', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const other = await setupProject()
    await svc.create(org.id, project.id, { name: 'A' }, pm.id)
    await svc.create(other.org.id, other.project.id, { name: 'B' }, other.pm.id)

    const result = await svc.list(org.id, project.id, {})
    assert.lengthOf(result.data, 1)
    assert.equal(result.data[0].name, 'A')
  })

  test('列出支持分页', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    for (let i = 0; i < 5; i++) {
      await svc.create(org.id, project.id, { name: `R${i}` }, pm.id)
    }

    const page1 = await svc.list(org.id, project.id, { page: 1, perPage: 2 })
    assert.lengthOf(page1.data, 2)
    assert.equal(page1.meta.total, 5)
    assert.equal(page1.meta.totalPages, 3)
  })

  test('支持 resourceType 筛选', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    await svc.create(org.id, project.id, { name: 'Human', resourceType: 'human' }, pm.id)
    await svc.create(org.id, project.id, { name: 'Equip', resourceType: 'equipment' }, pm.id)

    const filtered = await svc.list(org.id, project.id, { resourceType: 'equipment' })
    assert.lengthOf(filtered.data, 1)
    assert.equal(filtered.data[0].name, 'Equip')
  })

  test('获取详情返回正确资源', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const created = await svc.create(org.id, project.id, { name: '张四' }, pm.id)
    const found = await svc.get(org.id, project.id, created.id)
    assert.equal(found.name, '张四')
  })

  test('获取不存在资源抛异常', async ({ assert }) => {
    const { org, project } = await setupProject()
    await assert.rejects(async () => svc.get(org.id, project.id, 99999))
  })

  test('更新资源字段', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const created = await svc.create(org.id, project.id, { name: '旧名' }, pm.id)
    const updated = await svc.update(org.id, project.id, created.id, { name: '新名' }, pm.id)
    assert.equal(updated.name, '新名')
  })

  test('删除标记 deletedAt', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const created = await svc.create(org.id, project.id, { name: '待删' }, pm.id)
    await svc.delete(org.id, project.id, created.id, pm.id)

    const raw = await db.from('resources').where('id', created.id).first()
    assert.isNotNull(raw)
    assert.isNotNull(raw.deleted_at)
  })

  test('删除后列表不包含', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const created = await svc.create(org.id, project.id, { name: '待删' }, pm.id)
    await svc.delete(org.id, project.id, created.id, pm.id)

    const after = await svc.list(org.id, project.id, {})
    assert.lengthOf(after.data, 0)
  })

  test('有活跃分配的资源删除被拒', async ({ assert }) => {
    const { pm, project, org } = await setupProject()
    const resource = await svc.create(org.id, project.id, { name: '有分配' }, pm.id)

    // 创建一个真正的任务
    const [taskId] = await db.table('tasks').insert({
      project_id: project.id,
      name: '测试任务',
      status: 'not_started',
      created_at: new Date().toISOString(),
    })

    await allocSvc.create(
      org.id,
      project.id,
      resource.id,
      {
        taskId,
        allocationPercent: 100,
        startDate: '2026-07-01',
        endDate: '2026-12-31',
      },
      pm.id,
    )

    await assert.rejects(async () => svc.delete(org.id, project.id, resource.id, pm.id))
    const raw = await db.from('resources').where('id', resource.id).first()
    assert.isNull(raw.deleted_at)
  })
})
