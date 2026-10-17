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
const rawQuery = (table: string) => db.from(table as any) as any

/**
 * v3-resource-gap-analysis E2E 集成流程测试（§9.1-§9.4）。
 */
test.group('ResourceGapAnalysis — E2E Integration Flow', (group) => {
  useAuthDatabase(group)

  let owner: any
  let org: any
  let pm: any
  let viewer: any
  let outsider: any
  let project1: any
  let project2: any

  group.each.setup(async () => {
    owner = await createUser({ email: uniqueEmail('e2e-own') })
    org = await createOrganization(owner)

    pm = await createUser({ email: uniqueEmail('e2e-pm') })
    viewer = await createUser({ email: uniqueEmail('e2e-view') })
    outsider = await createUser({ email: uniqueEmail('e2e-out') })

    await multiInsert('organization_members', [
      {
        organization_id: Number(org.id),
        user_id: Number(pm.id),
        role: 'member',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        organization_id: Number(org.id),
        user_id: Number(viewer.id),
        role: 'viewer',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])

    const setup1 = await createProjectWithMember(org, owner, pm, ProjectRoleName.PROJECT_MANAGER)
    project1 = setup1.project
    const setup2 = await createProjectWithMember(org, owner, owner, ProjectRoleName.PROJECT_MANAGER)
    project2 = setup2.project

    await multiInsert('resources', [
      {
        project_id: Number(project1.id),
        name: 'P1前端',
        resource_type: 'human',
        role: 'member',
        status: 'active',
        daily_capacity_hours: 8,
        created_at: new Date().toISOString(),
      },
      {
        project_id: Number(project1.id),
        name: 'P1后端',
        resource_type: 'human',
        role: 'team_lead',
        status: 'active',
        daily_capacity_hours: 8,
        created_at: new Date().toISOString(),
      },
      {
        project_id: Number(project2.id),
        name: 'P2设计',
        resource_type: 'human',
        role: 'project_manager',
        status: 'active',
        daily_capacity_hours: 8,
        created_at: new Date().toISOString(),
      },
    ])
  })

  // ─── 9.1 ─────────────────────────────────────────────────────────────

  test('9.1: PMO 读取缺口画像 → 切换维度 → 打开解释 → 跳转 CTA', async ({ client, assert }) => {
    const summaryRes = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(pm, org.id))

    summaryRes.assertStatus(200)
    const summary = summaryRes.body().data
    assert.isDefined(summary.meta)
    assert.isDefined(summary.totalGaps)
    assert.isArray(summary.topGaps)
    assert.isArray(summary.warnings)

    const skillRes = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-skill?page=1&perPage=10`)
      .header('Authorization', await orgBearer(pm, org.id))
    skillRes.assertStatus(200)
    assert.isArray(skillRes.body().data)

    const roleRes = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-role?page=1&perPage=10`)
      .header('Authorization', await orgBearer(pm, org.id))
    roleRes.assertStatus(200)
    assert.isArray(roleRes.body().data)

    const projRes = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-project?page=1&perPage=10`)
      .header('Authorization', await orgBearer(pm, org.id))
    projRes.assertStatus(200)
    assert.isArray(projRes.body().data)

    if (summary.topGaps.length > 0) {
      const gapId = summary.topGaps[0].gapId
      const explainRes = await client
        .get(`/api/v1/organizations/${org.id}/resource-gaps/explanation?gapId=${gapId}`)
        .header('Authorization', await orgBearer(pm, org.id))
      explainRes.assertStatus(200)
      const explanation = explainRes.body().data
      assert.isDefined(explanation.ruleExplanation)
      assert.isArray(explanation.actionLinks)
      assert.isTrue(explanation.actionLinks.length > 0)
      const ctaLabels = explanation.actionLinks.map((l: any) => l.label)
      assert.include(ctaLabels, '跨项目调配')
    }

    if (summary.topGaps.length > 0) {
      const gapId = summary.topGaps[0].gapId
      const drillRes = await client
        .get(
          `/api/v1/organizations/${org.id}/resource-gaps/drill-down?gapId=${gapId}&sourceCapability=resource-registry-and-allocation`,
        )
        .header('Authorization', await orgBearer(pm, org.id))
      drillRes.assertStatus(200)
      assert.isDefined(drillRes.body().data.authorization)
    }
  })

  // ─── 9.2 ─────────────────────────────────────────────────────────────

  test('9.2: 无组织成员资格返回 404', async ({ client }) => {
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(outsider, org.id))
    res.assertStatus(404)
  })

  // 9.2 原为「viewer 可读取 summary」。v3-tech-debt-backlog-sweep 已按设计把组织级资源端点
  // 登记为 resource:view 路由门槛，只读观察者不持有该权限（与 organization_routes_rbac 用例一致）。
  test('9.2: viewer（只读观察者）无 resource:view，summary 返回 403', async ({ client }) => {
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(viewer, org.id))
    res.assertStatus(403)
  })

  // ─── 9.3 ─────────────────────────────────────────────────────────────

  test('9.3: 所有 endpoint 上游不可用时仍返回 200', async ({ client }) => {
    const endpoints = [
      'resource-gaps/summary',
      'resource-gaps/by-role',
      'resource-gaps/by-skill',
      'resource-gaps/by-timebucket',
      'resource-gaps/by-project',
      'resource-gaps/by-portfolio',
    ]
    for (const ep of endpoints) {
      const res = await client
        .get(`/api/v1/organizations/${org.id}/${ep}`)
        .header('Authorization', await orgBearer(pm, org.id))
      res.assertStatus(200)
    }
  })

  test('9.3: warnings 包含 CONTENTION_UNAVAILABLE 和 FORECAST_UNAVAILABLE', async ({
    client,
    assert,
  }) => {
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(pm, org.id))
    res.assertStatus(200)
    const warnings = res.body().data.warnings ?? []
    const codes = warnings.map((w: any) => w.code)
    assert.include(codes, 'FORECAST_UNAVAILABLE')
    assert.include(codes, 'CONTENTION_UNAVAILABLE')
  })

  // ─── 9.4 ─────────────────────────────────────────────────────────────

  test('9.4: AI 关闭时只返回 ruleExplanation', async ({ client, assert }) => {
    const sumRes = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(pm, org.id))
    const topGaps = sumRes.body().data?.topGaps ?? []
    if (topGaps.length === 0) return

    const gapId = topGaps[0].gapId
    const res = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/explanation?gapId=${gapId}`)
      .header('Authorization', await orgBearer(pm, org.id))
    res.assertStatus(200)
    const explanation = res.body().data
    assert.isDefined(explanation.ruleExplanation)
    assert.isNull(explanation.aiExplanation)
    assert.isNull(explanation.aiConfidence)
  })

  test('9.4: includeAi=true 返回 fixture AI 解释', async ({ client, assert }) => {
    const sumRes = await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(pm, org.id))
    const topGaps = sumRes.body().data?.topGaps ?? []
    if (topGaps.length === 0) return

    const gapId = topGaps[0].gapId
    const res = await client
      .get(
        `/api/v1/organizations/${org.id}/resource-gaps/explanation?gapId=${gapId}&includeAi=true`,
      )
      .header('Authorization', await orgBearer(pm, org.id))
    res.assertStatus(200)
    const explanation = res.body().data
    if (explanation.aiExplanation) {
      assert.include(explanation.aiExplanation, '[AI 解释-fixture]')
    }
    assert.isDefined(explanation.ruleExplanation)
    assert.isArray(explanation.suggestedActions)
  })
})

// ─── 后置状态验证 ────────────────────────────────────────────────

test.group('ResourceGapAnalysis — Post-E2E State Verification', (group) => {
  useAuthDatabase(group)

  let owner: any
  let org: any

  group.each.setup(async () => {
    owner = await createUser({ email: uniqueEmail('e2e-post') })
    org = await createOrganization(owner)
  })

  test('全部 E2E 流程后无数据污染', async ({ client, assert }) => {
    const beforeResourcesRow = await rawQuery('resources').count('* as cnt').first()
    const beforeResources = beforeResourcesRow.cnt
    const beforeTasksRow = await rawQuery('tasks').count('* as cnt').first()
    const beforeTasks = beforeTasksRow.cnt
    const beforeAllocationsRow = await rawQuery('resource_allocations').count('* as cnt').first()
    const beforeAllocations = beforeAllocationsRow.cnt

    await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/summary`)
      .header('Authorization', await orgBearer(owner, org.id))
    await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-role`)
      .header('Authorization', await orgBearer(owner, org.id))
    await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-skill`)
      .header('Authorization', await orgBearer(owner, org.id))
    await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-timebucket`)
      .header('Authorization', await orgBearer(owner, org.id))
    await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-project`)
      .header('Authorization', await orgBearer(owner, org.id))
    await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/by-portfolio`)
      .header('Authorization', await orgBearer(owner, org.id))
    await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/explanation?gapId=test123`)
      .header('Authorization', await orgBearer(owner, org.id))
    await client
      .get(`/api/v1/organizations/${org.id}/resource-gaps/drill-down?gapId=test123`)
      .header('Authorization', await orgBearer(owner, org.id))

    const afterResourcesRow = await rawQuery('resources').count('* as cnt').first()
    const afterResources = afterResourcesRow.cnt
    const afterTasksRow = await rawQuery('tasks').count('* as cnt').first()
    const afterTasks = afterTasksRow.cnt
    const afterAllocationsRow = await rawQuery('resource_allocations').count('* as cnt').first()
    const afterAllocations = afterAllocationsRow.cnt

    assert.equal(afterResources, beforeResources, '资源表不应有变化')
    assert.equal(afterTasks, beforeTasks, '任务表不应有变化')
    assert.equal(afterAllocations, beforeAllocations, '分配表不应有变化')
  })
})
