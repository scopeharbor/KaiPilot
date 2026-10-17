/**
 * v3-multitenant-database-isolation §4.7 —— DatabaseTenantBoundary 行为测试。
 *
 * 覆盖 spec「Scoped read helpers MUST apply tenant filters before derived values」、
 *「Scoped writes MUST stamp and verify organization ownership」、
 *「Batch database operations MUST reject mixed-tenant inputs」、
 *「Raw SQL and schema introspection MUST be guarded」：
 * - scoped list / count / aggregate / hash 先 scope 后算派生值
 * - detail 跨租户 404（与不存在完全同形）
 * - tenant-derived 表经父级链 scope（tasks → projects）
 * - preload 子表 scope（project.tasks 不挂他租任务）
 * - create 忽略并拒绝客户端 organizationId；update 禁止改归属
 * - 批量混租整体拒绝，且拒绝发生在任何写入之前
 * - 事务内引用校验失败 → 整体回滚，无半写入
 * - raw wrapper 强制 scope 绑定；introspection 只能读元数据
 * 全程本地 SQLite fixture，无外部依赖。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import Project from '#models/project'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import DatabaseTenantBoundary from '#services/database_tenant_boundary'
import { computeTenantScopedDigest } from '@aiproj/types/multitenant-database-isolation'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from '../auth/_helpers.js'

/** 两组织同名资源——任何"按名字返回"的实现会立刻穿帮。 */
const SHARED_PROJECT = '边界服务-同名项目'
const SHARED_TASK = '边界服务-同名任务'

interface Fixture {
  organizationId: number
  ownerId: number
  project: Project
  task: Task
}

test.group('DatabaseTenantBoundary（§4）', (group) => {
  useAuthDatabase(group)

  let boundary: DatabaseTenantBoundary
  let orgA: Fixture
  let orgB: Fixture

  async function seed(prefix: string): Promise<Fixture> {
    const owner = await createUser({ email: uniqueEmail(prefix) })
    const organization = await createOrganization(owner)
    const organizationId = Number(organization.id)
    const project = await Project.create({
      organizationId,
      name: SHARED_PROJECT,
      code: `${prefix.toUpperCase()}${Date.now()}`,
      createdBy: owner.id,
    })
    const task = await Task.create({
      projectId: project.id,
      name: SHARED_TASK,
      status: 'not_started',
      priority: 'medium',
    })
    return { organizationId, ownerId: Number(owner.id), project, task }
  }

  group.each.setup(async () => {
    boundary = new DatabaseTenantBoundary()
    orgA = await seed('boundarya')
    orgB = await seed('boundaryb')
  })

  test('scoped list 只返回本组织行（同名资源不串）', async ({ assert }) => {
    const rows = (await boundary
      .scopedQuery(db.from('projects'), 'projects', { organizationId: orgA.organizationId })
      .select('id', 'organization_id')) as Array<Record<string, unknown>>
    assert.isNotEmpty(rows)
    for (const row of rows) {
      assert.equal(Number(row.organization_id), orgA.organizationId)
    }
    assert.notInclude(
      rows.map((r) => Number(r.id)),
      Number(orgB.project.id),
    )
  })

  test('countInTenant 在 scope 之后计数（meta.total 不含他租）', async ({ assert }) => {
    const countA = await boundary.countInTenant('projects', {
      organizationId: orgA.organizationId,
    })
    const countB = await boundary.countInTenant('projects', {
      organizationId: orgB.organizationId,
    })
    const total = Number(
      ((await db.from('projects').count('* as total')) as Array<Record<string, unknown>>)[0].total,
    )
    assert.equal(countA, 1)
    assert.equal(countB, 1)
    assert.isAtLeast(total, 2)
    assert.notEqual(countA, total)
  })

  test('aggregateInTenant 先 scope 再聚合', async ({ assert }) => {
    const maxA = await boundary.aggregateInTenant('projects', {
      organizationId: orgA.organizationId,
      fn: 'max',
      column: 'id',
    })
    assert.equal(maxA, Number(orgA.project.id))
  })

  test('hashInTenant 摘要租户绑定：同内容跨组织不同', async ({ assert }) => {
    const hashA = await boundary.hashInTenant('projects', {
      organizationId: orgA.organizationId,
      columns: ['name'],
    })
    const hashB = await boundary.hashInTenant('projects', {
      organizationId: orgB.organizationId,
      columns: ['name'],
    })
    // 两组织项目名完全相同，摘要仍必须不同（organizationId 纳入摘要输入）
    assert.notEqual(hashA, hashB)
    assert.equal(
      hashA,
      computeTenantScopedDigest({
        organizationId: orgA.organizationId,
        table: 'projects',
        rows: [{ name: SHARED_PROJECT }],
      }),
    )
  })

  test('findInTenantOrFail：他租行与不存在行返回完全相同的 404', async ({ assert }) => {
    const own = await boundary.findInTenantOrFail<Project>(Project, orgA.project.id, 'projects', {
      organizationId: orgA.organizationId,
    })
    assert.equal(Number(own.id), Number(orgA.project.id))

    let crossTenantError: unknown
    try {
      await boundary.findInTenantOrFail(Project, orgB.project.id, 'projects', {
        organizationId: orgA.organizationId,
      })
    } catch (error) {
      crossTenantError = error
    }
    let missingError: unknown
    try {
      await boundary.findInTenantOrFail(Project, 99999999, 'projects', {
        organizationId: orgA.organizationId,
      })
    } catch (error) {
      missingError = error
    }
    assert.isDefined(crossTenantError)
    assert.isDefined(missingError)
    assert.equal((crossTenantError as { code?: string }).code, 'RESOURCE_NOT_FOUND')
    assert.equal(
      (crossTenantError as { message: string }).message,
      (missingError as { message: string }).message,
    )
  })

  test('tenant-derived 表经父级链 scope（tasks → projects）', async ({ assert }) => {
    const rows = (await boundary
      .scopedQuery(db.from('tasks'), 'tasks', { organizationId: orgA.organizationId })
      .select('id')) as Array<Record<string, unknown>>
    const ids = rows.map((r) => Number(r.id))
    assert.include(ids, Number(orgA.task.id))
    assert.notInclude(ids, Number(orgB.task.id))

    await assert.rejects(
      () =>
        boundary.findInTenantOrFail(Task, orgB.task.id, 'tasks', {
          organizationId: orgA.organizationId,
        }),
      '资源不存在',
    )
  })

  test('preloadInTenant：preload 子查询真的带上租户 scope', async ({ assert }) => {
    const nodeA = await WbsNode.create({
      projectId: orgA.project.id,
      name: '同名WBS节点',
      depth: 0,
      isLeaf: true,
      collapsed: false,
      displayOrder: 0,
    })
    await WbsNode.create({
      projectId: orgB.project.id,
      name: '同名WBS节点',
      depth: 0,
      isLeaf: true,
      collapsed: false,
      displayOrder: 0,
    })

    const scopedQuery = boundary.preloadInTenant(Project.query(), 'wbsNodes', 'wbs_nodes', {
      organizationId: orgA.organizationId,
    })
    const projects = await boundary
      .scopedQuery(scopedQuery, 'projects', { organizationId: orgA.organizationId })
      .exec()
    assert.lengthOf(projects, 1)
    const nodeIds = projects[0].wbsNodes.map((n: WbsNode) => Number(n.id))
    assert.deepEqual(nodeIds, [Number(nodeA.id)])

    // 用 orgB 的 scope 去 preload orgA 的项目：外键仍匹配，但子查询 scope 必须把它清空。
    // 这证明 scope 来自 helper 而不是仅靠外键关联。
    const mismatched = await Project.query()
      .where('id', orgA.project.id)
      .preload('wbsNodes', (childQuery) => {
        boundary.scopedQuery(childQuery, 'wbs_nodes', { organizationId: orgB.organizationId })
      })
      .exec()
    assert.isEmpty(mismatched[0].wbsNodes)
  })

  test('stampTenantForCreate：忽略客户端 org 字段并拒绝冲突值', ({ assert }) => {
    const stamped = boundary.stampTenantForCreate(
      { name: 'x', organizationId: orgA.organizationId },
      'projects',
      orgA.organizationId,
    )
    assert.equal(stamped.organizationId, orgA.organizationId)

    assert.throws(
      () =>
        boundary.stampTenantForCreate(
          { name: 'x', organization_id: orgB.organizationId },
          'projects',
          orgA.organizationId,
        ),
      '资源不存在',
    )
  })

  test('assertUpdatableInTenant：禁止把归属改到别的组织', async ({ assert }) => {
    await assert.rejects(
      () =>
        boundary.assertUpdatableInTenant(
          Project,
          orgA.project.id,
          'projects',
          { organizationId: orgA.organizationId },
          { organizationId: orgB.organizationId },
        ),
      '资源不存在',
    )
    const ok = await boundary.assertUpdatableInTenant<Project>(
      Project,
      orgA.project.id,
      'projects',
      { organizationId: orgA.organizationId },
      { name: '改名' },
    )
    assert.equal(Number(ok.id), Number(orgA.project.id))
  })

  test('assertIdsInTenant：混租批量整体拒绝，同租批量放行', async ({ assert }) => {
    const ok = await boundary.assertIdsInTenant('projects', [orgA.project.id], {
      organizationId: orgA.organizationId,
    })
    assert.lengthOf(ok, 1)

    await assert.rejects(
      () =>
        boundary.assertIdsInTenant('projects', [orgA.project.id, orgB.project.id], {
          organizationId: orgA.organizationId,
        }),
      '资源不存在',
    )
    // 跨租 ID 与不存在 ID 走同一拒绝路径（不可据错误区分存在性）
    await assert.rejects(
      () =>
        boundary.assertIdsInTenant('projects', [orgA.project.id, 99999999], {
          organizationId: orgA.organizationId,
        }),
      '资源不存在',
    )
  })

  test('事务内引用校验失败 → 整体回滚，无半写入', async ({ assert }) => {
    const before = await boundary.countInTenant('tasks', {
      organizationId: orgA.organizationId,
      projectId: null,
    })

    let rejected = false
    try {
      await db.transaction(async (trx) => {
        // 先写一行，再校验一个跨租引用：校验失败必须让这行一起回滚
        await trx.insertQuery().table('tasks').insert({
          project_id: orgA.project.id,
          name: '事务内新任务',
          status: 'not_started',
          priority: 'medium',
          created_at: new Date(),
          updated_at: new Date(),
        })
        await boundary.assertReferencesInTenant([{ table: 'projects', id: orgB.project.id }], {
          organizationId: orgA.organizationId,
          client: trx as never,
        })
      })
    } catch {
      rejected = true
    }

    assert.isTrue(rejected)
    const after = await boundary.countInTenant('tasks', {
      organizationId: orgA.organizationId,
      projectId: null,
    })
    assert.equal(after, before, '跨租引用被拒后不得留下半写入')
  })

  test('同租引用校验通过并可提交', async ({ assert }) => {
    await db.transaction(async (trx) => {
      await boundary.assertReferencesInTenant([{ table: 'projects', id: orgA.project.id }], {
        organizationId: orgA.organizationId,
        client: trx as never,
      })
      await trx.insertQuery().table('tasks').insert({
        project_id: orgA.project.id,
        name: '同租新任务',
        status: 'not_started',
        priority: 'medium',
        created_at: new Date(),
        updated_at: new Date(),
      })
    })
    const rows = (await db.from('tasks').where('name', '同租新任务').select('id')) as Array<
      Record<string, unknown>
    >
    assert.lengthOf(rows, 1)
  })

  test('assertRestorableInTenant：他租软删行不可恢复（404）', async ({ assert }) => {
    await assert.rejects(
      () =>
        boundary.assertRestorableInTenant(Project, orgB.project.id, 'projects', {
          organizationId: orgA.organizationId,
        }),
      '资源不存在',
    )
  })

  test('全局分类表不能走租户 scope 入口（fail closed）', ({ assert }) => {
    assert.throws(
      () =>
        boundary.scopedQuery(db.from('users'), 'users', { organizationId: orgA.organizationId }),
      /全局分类/,
    )
    assert.throws(() => boundary.assertGlobalAllowed('projects'))
    assert.doesNotThrow(() => boundary.assertGlobalAllowed('users'))
  })

  test('未登记表一律拒绝（catalog fail closed）', ({ assert }) => {
    assert.throws(() =>
      boundary.scopedQuery(db.from('projects'), 'ghost_table', {
        organizationId: orgA.organizationId,
      }),
    )
  })

  test('scopedRawQuery：强制 SELECT + 引用组织列 + 绑定 scope', async ({ assert }) => {
    const res = (await boundary.scopedRawQuery({
      table: 'projects',
      sql: 'SELECT id FROM projects WHERE organization_id = ?',
      organizationId: orgA.organizationId,
    })) as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
    const rows = Array.isArray(res) ? res : (res.rows ?? [])
    assert.lengthOf(rows, 1)
    assert.equal(Number(rows[0].id), Number(orgA.project.id))

    // 写操作、缺组织列、缺绑定三类都必须拒绝
    await assert.rejects(
      () =>
        boundary.scopedRawQuery({
          table: 'projects',
          sql: 'DELETE FROM projects WHERE organization_id = ?',
          organizationId: orgA.organizationId,
        }),
      /只允许 SELECT/,
    )
    await assert.rejects(
      () =>
        boundary.scopedRawQuery({
          table: 'projects',
          sql: 'SELECT id FROM projects WHERE id = ?',
          organizationId: orgA.organizationId,
        }),
      /必须显式引用租户条件列/,
    )
    await assert.rejects(
      () =>
        boundary.scopedRawQuery({
          table: 'projects',
          sql: `SELECT id FROM projects WHERE organization_id = ${orgB.organizationId}`,
          organizationId: orgA.organizationId,
        }),
      /必须用绑定参数/,
    )
  })

  test('introspectionRawQuery：只读元数据，业务查询被拒', async ({ assert }) => {
    const res = (await boundary.introspectionRawQuery('PRAGMA table_info(projects)')) as unknown
    assert.isDefined(res)
    await assert.rejects(
      () => boundary.introspectionRawQuery('SELECT name FROM projects'),
      /只允许查询 schema 元数据来源/,
    )
  })
})
