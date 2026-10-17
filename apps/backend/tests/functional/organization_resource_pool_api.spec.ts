import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
  orgBearer,
} from './auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import db from '@adonisjs/lucid/services/db'

test.group('OrganizationResourcePool API — Functional', (group) => {
  useAuthDatabase(group)

  let owner: any
  let org: any
  let member: any
  let outsider: any

  group.each.setup(async () => {
    owner = await createUser({ email: uniqueEmail('pool-api-own') })
    org = await createOrganization(owner)
    member = await createUser({ email: uniqueEmail('pool-api-mem') })
    outsider = await createUser({ email: uniqueEmail('pool-api-out') })

    // 创建成员。
    // 两个坑：①`organization_members` 没有 `joined_at` 列（迁移与生成的 schema 里都没有），
    // 传它会抛 SqliteError；②这里走的是原始 query builder，不经模型的 `autoCreate`，
    // 因此 `created_at`（NOT NULL）必须显式给。任一处出错都会让整个 setup hook 抛错，
    // 该 group 的 27 个用例全部失败在 setup 上。
    const memberCreatedAt = new Date().toISOString()
    await db.table('organization_members').insert({
      organization_id: Number(org.id),
      user_id: Number(member.id),
      role: 'member',
      created_at: memberCreatedAt,
      updated_at: memberCreatedAt,
    })

    // 创建项目和资源
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    // `resources.role` 有 CHECK 约束，只接受
    // `('owner','project_manager','team_lead','member','viewer')`（见
    // `1784120000000_create_resources_table.ts`）。`'developer'` 不在其中，会让 setup 抛错。
    await db.table('resources').insert({
      project_id: Number(project.id),
      name: '测试资源',
      resource_type: 'human',
      role: 'member',
      status: 'active',
      daily_capacity_hours: 8,
      created_at: new Date().toISOString(),
    })
  })

  // ─── 5.5.1: Success envelope ──────────────────────────────────────────────

  test('GET /summary returns success envelope with data', async ({ client, assert }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/summary`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(200)
    assert.isDefined(response.body().data)
    assert.isDefined(response.body().data.meta)
    assert.isDefined(response.body().data.metrics)
  })

  test('GET /catalogue returns same structure as summary', async ({ client, assert }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/catalogue`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(200)
    assert.isDefined(response.body().data)
  })

  test('GET /resources returns paginated envelope', async ({ client, assert }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/resources?page=1&perPage=10`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(200)
    assert.isDefined(response.body().data)
    assert.isDefined(response.body().meta)
    assert.equal(response.body().meta.page, 1)
    assert.equal(response.body().meta.perPage, 10)
  })

  test('GET /skills returns skill coverage list', async ({ client, assert }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/skills`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(200)
    assert.isArray(response.body().data)
  })

  test('GET /capacity returns capacity matrix with date range', async ({ client, assert }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/capacity?from=2026-01-01&to=2026-03-31`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(200)
    assert.isDefined(response.body().data.from)
    assert.isDefined(response.body().data.to)
    assert.isArray(response.body().data.rows)
  })

  test('GET /conflicts returns conflicts with pagination', async ({ client, assert }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/conflicts?page=1&perPage=20`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(200)
    assert.isDefined(response.body().data)
    assert.isDefined(response.body().meta)
  })

  test('GET /demand-gaps returns gaps with pagination', async ({ client, assert }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/demand-gaps?page=1&perPage=20`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(200)
    assert.isDefined(response.body().data)
    assert.isDefined(response.body().meta)
  })

  test('GET /drill-down for project returns authorized data', async ({ client }) => {
    // Get a project id first
    const project = await db.from('projects').where('organization_id', Number(org.id)).first()

    if (project) {
      const response = await client
        .get(
          `/api/v1/organizations/${org.id}/resource-pool/drill-down?kind=project&targetId=${project.id}&projectId=${project.id}`,
        )
        .header('Authorization', await orgBearer(owner, org.id))

      response.assertStatus(200)
    }
  })

  // ─── 5.5.2: Validation errors ─────────────────────────────────────────────

  test('unsupported sort key returns VALIDATION_ERROR', async ({ client }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/resources?sort=unsupported`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(422)
  })

  test('excessive page size returns VALIDATION_ERROR', async ({ client }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/resources?perPage=9999`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(422)
  })

  test('excessive topN returns VALIDATION_ERROR', async ({ client }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/resources?topN=9999`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(422)
  })

  test('malformed drill-down kind returns VALIDATION_ERROR', async ({ client }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/drill-down?kind=financial`)
      .header('Authorization', await orgBearer(owner, org.id))

    response.assertStatus(422)
  })

  // ─── 5.5.3: Non-member isolation ──────────────────────────────────────────

  test('non-member receives RESOURCE_NOT_FOUND', async ({ client }) => {
    const response = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/summary`)
      .header('Authorization', await orgBearer(outsider, org.id))

    response.assertStatus(404)
  })

  test('unauthenticated request receives 401', async ({ client }) => {
    const response = await client.get(`/api/v1/organizations/${org.id}/resource-pool/summary`)

    response.assertStatus(401)
  })

  // ─── 5.5.4: No-side-effect reads ──────────────────────────────────────────

  test('consecutive reads return consistent results without side effects', async ({
    client,
    assert,
  }) => {
    const r1 = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/summary`)
      .header('Authorization', await orgBearer(owner, org.id))
    const r2 = await client
      .get(`/api/v1/organizations/${org.id}/resource-pool/summary`)
      .header('Authorization', await orgBearer(owner, org.id))

    assert.equal(r1.body().data.resourceCount, r2.body().data.resourceCount)
    assert.equal(r1.body().data.conflictCount, r2.body().data.conflictCount)
  })

  // ─── 5.5.5: Drill-down reauthorization ────────────────────────────────────

  test('non-member drill-down to project returns 404', async ({ client }) => {
    const project = await db.from('projects').where('organization_id', Number(org.id)).first()

    if (project) {
      const response = await client
        .get(
          `/api/v1/organizations/${org.id}/resource-pool/drill-down?kind=project&targetId=${project.id}&projectId=${project.id}`,
        )
        .header('Authorization', await orgBearer(outsider, org.id))

      response.assertStatus(404)
    }
  })
})
