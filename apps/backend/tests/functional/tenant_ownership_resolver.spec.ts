// v3-multitenant-tenant-identification §5.4/§5.5 —— 资源归属 resolver 跨租户测试与登记盘点。
//
// spec 场景覆盖：
//   - 「Project-only route resolves organization」：只带 projectId 的路由服务端反推组织；
//   - 「Resolver failure does not leak existence」：scope 外资源统一非泄露 404；
//   - §5.4 两组织**同名**资源：任何"按名字命中就返回"的实现会立刻穿帮；
//   - §5.5 inventory：每类租户资源必须显式登记 resolver 或 unsupported（无默认放行留白）。
//
// 全程本地 SQLite + fixture，无外部 provider。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import Project from '#models/project'
import Report from '#models/report'
import Task from '#models/task'
import TokenService from '#services/token_service'
import TenantOwnershipResolverService from '#services/tenant_ownership_resolver_service'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { MULTITENANT_RESOURCE_TYPES } from '@aiproj/types/multitenant-isolation-architecture'
import {
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

/** 两组织共用的资源名——同名才能证伪"按名字返回"的实现。 */
const SHARED_PROJECT = '共享名称-项目'
const SHARED_TASK = '共享名称-任务'
const SHARED_REPORT = '共享名称-报表'

interface OrgFixture {
  organizationId: number
  projectId: number
  taskId: number
  reportId: number
}

async function seedOrg(prefix: string): Promise<OrgFixture> {
  const owner = await createUser({ email: uniqueEmail(prefix) })
  const org = await createOrganization(owner)
  const project = await Project.create({
    organizationId: Number(org.id),
    name: SHARED_PROJECT,
    code: `P${prefix}${Date.now()}`,
    createdBy: owner.id,
  })
  const task = await Task.create({
    projectId: Number(project.id),
    name: SHARED_TASK,
    status: 'not_started',
    priority: 'medium',
  })
  const report = await Report.create({
    projectId: Number(project.id),
    title: SHARED_REPORT,
    template: 'progress',
    config: {} as never,
    dataSnapshot: {} as never,
  })
  return {
    organizationId: Number(org.id),
    projectId: Number(project.id),
    taskId: Number(task.id),
    reportId: Number(report.id),
  }
}

test.group('资源归属 resolver 跨租户解析（§5.4）', (group) => {
  useAuthDatabase(group)

  let resolver: TenantOwnershipResolverService
  let orgA: OrgFixture
  let orgB: OrgFixture

  group.each.setup(async () => {
    resolver = new TenantOwnershipResolverService()
    orgA = await seedOrg('own-a')
    orgB = await seedOrg('own-b')
  })

  test('project 直接归属：反推出正确组织并与 effective tenant 匹配', async ({ assert }) => {
    const own = await resolver.resolveOwner({
      resourceType: 'project',
      resourceId: orgA.projectId,
      effectiveOrganizationId: orgA.organizationId,
    })
    assert.isTrue(own.found)
    assert.equal(own.organizationId, orgA.organizationId)
    assert.isTrue(own.matches)
    assert.equal(own.reason, 'RESOLVED')
  })

  test('同名项目跨组织不匹配（按名字命中的实现会在此穿帮）', async ({ assert }) => {
    const cross = await resolver.resolveOwner({
      resourceType: 'project',
      resourceId: orgB.projectId,
      effectiveOrganizationId: orgA.organizationId,
    })
    assert.isTrue(cross.found)
    assert.equal(cross.organizationId, orgB.organizationId)
    assert.isFalse(cross.matches)
    assert.equal(cross.reason, 'RESOURCE_OWNERSHIP_MISMATCH')
  })

  test('task 经 projects.organization_id 两跳反推（tenant-derived）', async ({ assert }) => {
    const same = await resolver.resolveOwner({
      resourceType: 'task',
      resourceId: orgA.taskId,
      effectiveOrganizationId: orgA.organizationId,
    })
    const cross = await resolver.resolveOwner({
      resourceType: 'task',
      resourceId: orgB.taskId,
      effectiveOrganizationId: orgA.organizationId,
    })

    assert.equal(same.organizationId, orgA.organizationId)
    assert.isTrue(same.matches)
    assert.equal(cross.organizationId, orgB.organizationId)
    assert.isFalse(cross.matches)
  })

  test('report 经 project 两跳反推（tenant-derived）', async ({ assert }) => {
    const same = await resolver.resolveOwner({
      resourceType: 'report',
      resourceId: orgA.reportId,
      effectiveOrganizationId: orgA.organizationId,
    })
    const cross = await resolver.resolveOwner({
      resourceType: 'report',
      resourceId: orgB.reportId,
      effectiveOrganizationId: orgA.organizationId,
    })

    assert.isTrue(same.matches)
    assert.isFalse(cross.matches)
  })

  test('资源不存在与跨组织资源的 matches 结果一致（不泄露存在性）', async ({ assert }) => {
    const missing = await resolver.resolveOwner({
      resourceType: 'project',
      resourceId: 987654,
      effectiveOrganizationId: orgA.organizationId,
    })
    const hidden = await resolver.resolveOwner({
      resourceType: 'project',
      resourceId: orgB.projectId,
      effectiveOrganizationId: orgA.organizationId,
    })

    // matches 都是 false —— 调用方据此产出同一个 404，无法区分两种情况。
    assert.isFalse(missing.matches)
    assert.isFalse(hidden.matches)
  })

  test('assertOwnedByTenant 对跨组织与不存在都抛非泄露 404', async ({ assert }) => {
    const cases = [
      { resourceType: 'project' as const, resourceId: orgB.projectId },
      { resourceType: 'task' as const, resourceId: 987654 },
    ]
    for (const c of cases) {
      let thrown: unknown = null
      try {
        await resolver.assertOwnedByTenant({
          ...c,
          effectiveOrganizationId: orgA.organizationId,
        })
      } catch (error) {
        thrown = error
      }
      assert.instanceOf(thrown, ResourceNotFoundException)
      // 消息必须是通用文案，不含资源名/组织名（两种情况文案一致才不泄露存在性）。
      assert.equal((thrown as ResourceNotFoundException).message, '资源不存在')
    }
  })

  test('effectiveOrganizationId 为 null 时一律不匹配（不给"无租户即放行"留口子）', async ({
    assert,
  }) => {
    const resolution = await resolver.resolveOwner({
      resourceType: 'project',
      resourceId: orgA.projectId,
      effectiveOrganizationId: null,
    })
    assert.isFalse(resolution.matches)
  })

  test('归属列为 null 的资源行不匹配（无归属 ≠ 人人可读）', async ({ assert }) => {
    // `projects.organization_id` 是 NOT NULL、`tasks.project_id` 有 FK 约束——DB 层已挡住
    // 这两条路径上的"无归属"。`audit_logs.organization_id` 是 nullable（识别层自己的
    // 拒绝审计就写 null），因此用它验证 resolver 的 null 归属分支。
    const [id] = await db
      .table('audit_logs')
      .insert({
        action: 'read',
        severity: 'info',
        user_id: null,
        organization_id: null,
        created_at: new Date(),
      })
      .returning('id')
    const auditId = Number(typeof id === 'object' && id !== null ? (id as { id: number }).id : id)

    const resolution = await resolver.resolveOwner({
      resourceType: 'audit',
      resourceId: auditId,
      effectiveOrganizationId: orgA.organizationId,
    })
    // 行存在，但归属为空 → 不匹配（不退化为"谁都能读"）。
    assert.isTrue(resolution.found)
    assert.isNull(resolution.organizationId)
    assert.isFalse(resolution.matches)
    assert.equal(resolution.reason, 'RESOURCE_OWNERSHIP_MISMATCH')
  })

  test('resolver 依赖故障 → RESOLVER_FAILED 且 fail closed', async ({ assert }) => {
    const original = db.from.bind(db)
    db.from = (() => {
      throw new Error('resolver dependency down')
    }) as typeof db.from
    try {
      const resolution = await resolver.resolveOwner({
        resourceType: 'project',
        resourceId: orgA.projectId,
        effectiveOrganizationId: orgA.organizationId,
      })
      assert.equal(resolution.reason, 'RESOLVER_FAILED')
      assert.isFalse(resolution.matches)
    } finally {
      db.from = original
    }
  })
})

test.group('资源归属 resolver 路由接入（§5.3/§5.4）', (group) => {
  useAuthDatabase(group)

  let tokenSvc: TokenService
  let orgA: OrgFixture
  let orgB: OrgFixture
  let memberA: Awaited<ReturnType<typeof createUser>>

  group.each.setup(async () => {
    tokenSvc = await app.container.make(TokenService)
    orgA = await seedOrg('rt-a')
    orgB = await seedOrg('rt-b')
    memberA = await createUser({ email: uniqueEmail('rt-mem') })
    const orgAModel = { id: orgA.organizationId } as never
    await addOrgMember(orgAModel, memberA, 'admin')
  })

  async function tokenFor(userId: number, organizationId: number): Promise<string> {
    return tokenSvc.generateAccessToken({
      sub: userId,
      organizationId,
      roleVersion: 0,
      permissions: [],
    })
  }

  test('project-only 路由：他组织同名项目返回 404，与不存在不可区分', async ({
    client,
    assert,
  }) => {
    const token = await tokenFor(memberA.id, orgA.organizationId)

    const hidden = await client
      .get(`/api/v1/projects/${orgB.projectId}`)
      .header('Authorization', `Bearer ${token}`)
    const missing = await client
      .get('/api/v1/projects/987654')
      .header('Authorization', `Bearer ${token}`)

    hidden.assertStatus(404)
    missing.assertStatus(404)
    assert.deepEqual(hidden.body(), missing.body())
    // 响应不得出现同名项目名称（否则名称本身构成命中证据）。
    assert.notInclude(JSON.stringify(hidden.body()), SHARED_PROJECT)
  })

  test('task 路由：他组织任务 404（经 project 两跳反推）', async ({ client }) => {
    const token = await tokenFor(memberA.id, orgA.organizationId)
    const res = await client
      .get(`/api/v1/projects/${orgB.projectId}/tasks/${orgB.taskId}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(404)
  })

  test('report 路由：他组织报表 404（tenant-derived 两跳）', async ({ client }) => {
    const token = await tokenFor(memberA.id, orgA.organizationId)
    const res = await client
      .get(`/api/v1/reports/${orgB.reportId}`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(404)
  })

  test('被拒的归属校验写低敏审计且不记录目标资源归属', async ({ client, assert }) => {
    const token = await tokenFor(memberA.id, orgA.organizationId)
    // 用 report 扁平路由：`/projects/:id` 与 `/projects/:projectId/tasks/*` 上，全局
    // `RbacMiddleware` 会先按 actor 的当前租户判定项目级权限并拦下跨组织请求，
    // resolver 那一道到不了（多层防御的正常结果）。`/reports/:id` 是 resolver
    // **首个可达**的拦截点，因此审计断言挂在它上面。
    await client.get(`/api/v1/reports/${orgB.reportId}`).header('Authorization', `Bearer ${token}`)

    // 按 metadata 匹配而非 user_id：`user_id` 是否落库取决于中间件栈顺序，
    // actor 的权威低敏形式是 `actorRef`。
    const logs = await db.from('audit_logs').orderBy('id', 'desc').limit(20)
    const denied = logs.find((l) => {
      const meta = typeof l.metadata === 'string' ? l.metadata : JSON.stringify(l.metadata ?? {})
      return meta.includes('ownership.report')
    })
    assert.isDefined(denied, '归属校验拒绝必须留低敏审计')
    const meta = JSON.parse(
      typeof denied.metadata === 'string' ? denied.metadata : JSON.stringify(denied.metadata),
    )
    assert.equal(meta.kind, 'denied')
    assert.equal(meta.resolutionReason, 'RESOURCE_OWNERSHIP_MISMATCH')
    // 记的是 actor 自己的组织，不是目标资源的归属组织。
    assert.equal(meta.organizationId, orgA.organizationId)
    assert.notInclude(JSON.stringify(meta), SHARED_REPORT)
  })
})

test.group('资源归属登记盘点（§5.5）', (group) => {
  // 第三条用例要查 schema，需要已迁移的库。
  useAuthDatabase(group)

  test('全部租户资源类型都显式登记 resolver 或 unsupported（无默认放行留白）', ({ assert }) => {
    const resolver = new TenantOwnershipResolverService()
    for (const resourceType of MULTITENANT_RESOURCE_TYPES) {
      const descriptor = resolver.descriptorOf(resourceType)
      assert.isDefined(descriptor, `资源类型 ${resourceType} 未登记归属 resolver`)
      assert.equal(descriptor.resourceType, resourceType)
      assert.include(
        ['direct', 'derived_via_parent', 'unsupported'],
        descriptor.kind,
        `资源类型 ${resourceType} 的 kind 非法`,
      )
    }
  })

  test('supported 登记必须给出表名与归属列；unsupported 必须给出原因', ({ assert }) => {
    const resolver = new TenantOwnershipResolverService()
    for (const descriptor of resolver.allDescriptors()) {
      if (descriptor.kind === 'unsupported') {
        assert.isNotEmpty(
          descriptor.unsupportedReason,
          `${descriptor.resourceType} 标了 unsupported 但没写原因（fail-closed 需可追溯）`,
        )
        continue
      }
      assert.isNotEmpty(descriptor.table, `${descriptor.resourceType} 缺表名`)
      assert.isNotEmpty(descriptor.column, `${descriptor.resourceType} 缺归属列`)
      if (descriptor.kind === 'derived_via_parent') {
        assert.isNotEmpty(descriptor.parentTable, `${descriptor.resourceType} 缺父表`)
        assert.isNotEmpty(descriptor.parentColumn, `${descriptor.resourceType} 缺父表归属列`)
      }
    }
  })

  test('登记的表与归属列在数据库 schema 中真实存在', async ({ assert }) => {
    const resolver = new TenantOwnershipResolverService()
    for (const descriptor of resolver.allDescriptors()) {
      if (descriptor.kind === 'unsupported' || !descriptor.table || !descriptor.column) continue
      const hasTable = await db.connection().schema.hasTable(descriptor.table)
      assert.isTrue(hasTable, `登记表 ${descriptor.table} 不存在`)
      const hasColumn = await db.connection().schema.hasColumn(descriptor.table, descriptor.column)
      assert.isTrue(hasColumn, `${descriptor.table}.${descriptor.column} 不存在`)
      if (descriptor.kind === 'derived_via_parent') {
        const hasParentColumn = await db
          .connection()
          .schema.hasColumn(descriptor.parentTable as string, descriptor.parentColumn as string)
        assert.isTrue(
          hasParentColumn,
          `${descriptor.parentTable}.${descriptor.parentColumn} 不存在`,
        )
      }
    }
  })
})
