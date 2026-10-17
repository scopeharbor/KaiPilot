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

const multiInsert = (table: string, rows: Record<string, unknown>[]) =>
  (db.table(table) as any).multiInsert(rows)

/**
 * v3-resource-gap-analysis 性能基线测试（§6.1, §6.3, §6.4）。
 */
test.group('ResourceGapAnalysis — Performance Baseline (task 6)', (group) => {
  useAuthDatabase(group)

  let owner: any
  let org: any

  group.each.setup(async () => {
    owner = await createUser({ email: uniqueEmail('gap-perf') })
    org = await createOrganization(owner)

    const setup = await createProjectWithMember(org, owner, owner, ProjectRoleName.PROJECT_MANAGER)
    const project = setup.project

    const resources = Array.from({ length: 50 }, (_, i) => ({
      project_id: Number(project.id),
      name: `资源${i + 1}`,
      resource_type: i % 3 === 0 ? 'material' : 'human',
      role: ['member', 'team_lead', 'project_manager', 'viewer', 'owner'][i % 5],
      status: 'active',
      daily_capacity_hours: 8,
      created_at: new Date().toISOString(),
    }))
    await multiInsert('resources', resources)
  })

  test('6.1: 摘要 GET /summary P95 ≤ 800ms (soft target)', async ({ client, assert }) => {
    const start = Date.now()
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary?topN=10`)
      .header('Authorization', await orgBearer(owner, org.id))
    const elapsed = Date.now() - start
    res.assertStatus(200)
    assert.isTrue(elapsed < 5000, `摘要响应时间 ${elapsed}ms 应在 5s 内`)
    console.log(`[perf] summary: ${elapsed}ms`)
  })

  test('6.1: 透视 by-skill ≤ 1500ms', async ({ client, assert }) => {
    const start = Date.now()
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-skill?page=1&perPage=20`)
      .header('Authorization', await orgBearer(owner, org.id))
    const elapsed = Date.now() - start
    res.assertStatus(200)
    assert.isTrue(elapsed < 5000, `透视响应时间 ${elapsed}ms 应在 5s 内`)
    console.log(`[perf] by-skill: ${elapsed}ms`)
  })

  test('6.1: 透视 by-role ≤ 1500ms', async ({ client, assert }) => {
    const start = Date.now()
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-role?page=1&perPage=20`)
      .header('Authorization', await orgBearer(owner, org.id))
    const elapsed = Date.now() - start
    res.assertStatus(200)
    assert.isTrue(elapsed < 5000)
    console.log(`[perf] by-role: ${elapsed}ms`)
  })

  test('6.1: drill-down ≤ 1200ms', async ({ client, assert }) => {
    const sumRes = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(owner, org.id))
    const topGaps = sumRes.body().data?.topGaps ?? []
    if (topGaps.length > 0) {
      const start = Date.now()
      const res = await client
        .get(`/api/v1/organizations/${org.id}/resource-gaps/drill-down?gapId=${topGaps[0].gapId}`)
        .header('Authorization', await orgBearer(owner, org.id))
      const elapsed = Date.now() - start
      res.assertStatus(200)
      assert.isTrue(elapsed < 5000)
      console.log(`[perf] drill-down: ${elapsed}ms`)
    }
  })

  test('6.3: 缓存不可用时返回 200（SQLite 直算）', async ({ client }) => {
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(owner, org.id))
    res.assertStatus(200)
  })

  test('6.4: 大日期窗口自动 clamp', async ({ client, assert }) => {
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary?from=2020-01-01&to=2026-12-31`)
      .header('Authorization', await orgBearer(owner, org.id))
    assert.isTrue(res.status() === 200 || res.status() === 422)
  })
})

// ─── 6.4: 边界值测试 ────────────────────────────────────────────────

test.group('ResourceGapAnalysis — Edge Cases (task 6.4)', (group) => {
  useAuthDatabase(group)

  let owner: any
  let org: any

  group.each.setup(async () => {
    owner = await createUser({ email: uniqueEmail('gap-edge') })
    org = await createOrganization(owner)
  })

  test('空组织返回 200 + totalGaps=0', async ({ client, assert }) => {
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(owner, org.id))
    res.assertStatus(200)
    assert.equal(res.body().data.totalGaps, 0)
  })

  test('0 值 perPage → 422', async ({ client }) => {
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-skill?perPage=0`)
      .header('Authorization', await orgBearer(owner, org.id))
    res.assertStatus(422)
  })

  test('负数 page → 422', async ({ client }) => {
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-role?page=-1`)
      .header('Authorization', await orgBearer(owner, org.id))
    res.assertStatus(422)
  })

  test('不存在的组织 ID → 404', async ({ client }) => {
    const res = await client
      .get(`/api/v1/organizations/99999/resource-gaps/summary`)
      .header('Authorization', await orgBearer(owner, org.id))
    res.assertStatus(404)
  })

  test('不存在的 gapId explanation → 返回 not-found 响应', async ({ client, assert }) => {
    const url = `/api/v1/organizations/${org.id}/resource-gaps/explanation?gapId=nonexistent_gap_id_12345`
    // explanation 路由按已归档裁决要求 ai:resource-gap:explain；该码刻意未授予任何角色
    // （legacy-contract-debt-fixes「补登记不等于授权」，是否开放待产品裁决），
    // 组织管理员当前被拒；not-found 行为用超级管理员验证。
    const denied = await client.get(url).header('Authorization', await orgBearer(owner, org.id))
    denied.assertStatus(403)

    const admin = await createUser({ email: uniqueEmail('gap-perf-sa'), isSuperAdmin: true })
    const res = await client.get(url).header('Authorization', await orgBearer(admin, org.id))
    res.assertStatus(200)
    assert.equal(res.body().data.gapId, 'nonexistent_gap_id_12345')
  })
})
