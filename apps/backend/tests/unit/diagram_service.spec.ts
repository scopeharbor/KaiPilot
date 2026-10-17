import AuditLog from '#models/audit_log'
import Diagram from '#models/diagram'
import { ProjectRoleName } from '#rbac'
import AuditService from '#services/audit_service'
import DiagramService from '#services/diagram_service'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import type { DiagramSpec } from '@aiproj/types'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

function makeSpec(overrides?: Partial<DiagramSpec>): DiagramSpec {
  return {
    version: '1.0',
    type: 'wbs_tree',
    title: '测试图表',
    data: { nodes: [] },
    metadata: {
      generatedBy: 'system',
      generatedAt: '2026-01-01T00:00:00Z',
      sourceProjectId: 1,
    },
    exports: { mermaid: { supported: false } },
    ...overrides,
  }
}

test.group('DiagramService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('diagram-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project, service: new DiagramService(new AuditService()) }
  }

  // ---------------- CRUD ----------------

  test('create 默认创建图表记录', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const diagram = await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS', spec: makeSpec() },
      owner.id,
    )

    assert.equal(diagram.type, 'wbs_tree')
    assert.equal(diagram.title, 'WBS')
    assert.equal(diagram.organizationId, org.id)
    assert.equal(diagram.projectId, project.id)
    assert.isString(diagram.sourceHash)
  })

  test('create 写 DIAGRAM_CREATED 审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const diagram = await service.create(
      org.id,
      project.id,
      {
        type: 'gantt',
        title: '甘特',
        spec: makeSpec({
          type: 'gantt',
          data: {
            bars: [],
            milestones: [],
            timelineStart: '2026-01-01',
            timelineEnd: '2026-01-10',
          },
        }),
      },
      owner.id,
    )

    const logs = await AuditLog.query()
      .where('entity_type', 'diagram')
      .where('entity_id', diagram.id)
      .where('action', 'create')

    assert.lengthOf(logs, 1)
    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'DIAGRAM_CREATED')
  })

  test('list 返回项目内图表', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS 1', spec: makeSpec() },
      owner.id,
    )
    await service.create(
      org.id,
      project.id,
      {
        type: 'gantt',
        title: '甘特 1',
        spec: makeSpec({
          type: 'gantt',
          data: {
            bars: [],
            milestones: [],
            timelineStart: '2026-01-01',
            timelineEnd: '2026-01-10',
          },
        }),
      },
      owner.id,
    )

    const result = await service.list(org.id, project.id)
    assert.lengthOf(result.data, 2)
    assert.equal(result.meta.total, 2)
  })

  test('list 按类型过滤', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS', spec: makeSpec() },
      owner.id,
    )
    await service.create(
      org.id,
      project.id,
      {
        type: 'gantt',
        title: '甘特',
        spec: makeSpec({
          type: 'gantt',
          data: {
            bars: [],
            milestones: [],
            timelineStart: '2026-01-01',
            timelineEnd: '2026-01-10',
          },
        }),
      },
      owner.id,
    )

    const result = await service.list(org.id, project.id, { type: 'wbs_tree' })
    assert.lengthOf(result.data, 1)
    assert.equal(result.data[0].type, 'wbs_tree')
  })

  test('show 返回指定图表', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const created = await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS', spec: makeSpec() },
      owner.id,
    )
    const found = await service.show(org.id, project.id, created.id)

    assert.equal(found.id, created.id)
    assert.equal(found.title, 'WBS')
  })

  test('show 跨组织返回 RESOURCE_NOT_FOUND', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const otherOwner = await createUser({ email: uniqueEmail('other') })
    const otherOrg = await createOrganization(otherOwner)

    const created = await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS', spec: makeSpec() },
      owner.id,
    )

    let caught: unknown
    try {
      await service.show(otherOrg.id, project.id, created.id)
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('update 修改标题', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const created = await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: '旧标题', spec: makeSpec() },
      owner.id,
    )
    const updated = await service.update(
      org.id,
      project.id,
      created.id,
      { title: '新标题' },
      owner.id,
    )

    assert.equal(updated.title, '新标题')
  })

  test('update 写 DIAGRAM_UPDATED 审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const created = await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS', spec: makeSpec() },
      owner.id,
    )
    await service.update(org.id, project.id, created.id, { title: '更新' }, owner.id)

    const logs = await AuditLog.query()
      .where('entity_type', 'diagram')
      .where('entity_id', created.id)
      .where('action', 'update')

    assert.lengthOf(logs, 1)
    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'DIAGRAM_UPDATED')
  })

  test('softDelete 标记 deletedAt', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const created = await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS', spec: makeSpec() },
      owner.id,
    )
    await service.softDelete(org.id, project.id, created.id, owner.id)

    const found = await Diagram.query()
      .where('id', created.id)
      .where('organization_id', org.id)
      .first()
    assert.isNotNull(found?.deletedAt)
  })

  test('softDelete 后 list 默认排除', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const created = await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS', spec: makeSpec() },
      owner.id,
    )
    await service.softDelete(org.id, project.id, created.id, owner.id)

    const result = await service.list(org.id, project.id)
    assert.lengthOf(result.data, 0)
  })

  test('softDelete 写 DIAGRAM_DELETED 审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    const created = await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS', spec: makeSpec() },
      owner.id,
    )
    await service.softDelete(org.id, project.id, created.id, owner.id)

    const logs = await AuditLog.query()
      .where('entity_type', 'diagram')
      .where('entity_id', created.id)
      .where('action', 'delete')

    assert.lengthOf(logs, 1)
    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'DIAGRAM_DELETED')
  })

  test('show 不存在的图表返回 RESOURCE_NOT_FOUND', async ({ assert }) => {
    const { org, project, service } = await setup()

    let caught: unknown
    try {
      await service.show(org.id, project.id, 99999)
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })

  test('跨组织隔离：不同组织不能访问', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const otherOwner = await createUser({ email: uniqueEmail('other-org') })
    const otherOrg = await createOrganization(otherOwner)

    const created = await service.create(
      org.id,
      project.id,
      { type: 'wbs_tree', title: 'WBS', spec: makeSpec() },
      owner.id,
    )

    let caught: unknown
    try {
      await service.show(otherOrg.id, project.id, created.id)
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ResourceNotFoundException)
  })
})
