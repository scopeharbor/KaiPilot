// OKR 级联与对齐 API 集成测试
// v3-okr-cascade-and-alignment §4.3
//
// 本文件原先 21 个用例全是 `assert.isTrue(true)` 占位，真实断言写在注释里。
// 也就是说这一族 HTTP 端点从归档起就没有任何集成覆盖——同一模式在
// Copilot 回合端点上已经造成过「端点每次认证请求都 500 却无人发现」。
// 现按各自标题改写为真实 HTTP 断言，并保留三条红线：
// 未认证 401、跨组织不可见、AI 预览零落库。

import { test } from '@japa/runner'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import OkrAlignment from '#models/okr_alignment'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const base = (orgId: number) => `/api/v1/organizations/${orgId}/okrs`

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function setupActor(client: any, prefix: string) {
  const owner = await createUser({ email: uniqueEmail(prefix) })
  const org = await createOrganization(owner)
  const cycle = await OkrCycle.create({
    organizationId: org.id,
    title: '2026 Q3',
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    status: 'active',
  })
  const objective = await OkrObjective.create({
    organizationId: org.id,
    cycleId: cycle.id,
    title: '源目标',
    scope: 'organization',
    status: 'active',
    metricVersion: '1.0.0',
  })
  const token = await login(client, owner.email)
  return { owner, org, cycle, objective, token }
}

async function makeObjective(orgId: number, cycleId: number, title: string) {
  return OkrObjective.create({
    organizationId: orgId,
    cycleId,
    title,
    scope: 'team',
    status: 'active',
    metricVersion: '1.0.0',
  })
}

async function countOkrFacts(orgId: number) {
  const [objectives, keyResults, alignments] = await Promise.all([
    OkrObjective.query().where('organization_id', orgId).count('* as t'),
    OkrKeyResult.query().where('organization_id', orgId).count('* as t'),
    OkrAlignment.query().where('organization_id', orgId).count('* as t'),
  ])
  return {
    objectives: Number(objectives[0]!.$extras.t),
    keyResults: Number(keyResults[0]!.$extras.t),
    alignments: Number(alignments[0]!.$extras.t),
  }
}

test.group('OKR Cascade/Alignment API — Cascade Plans', (group) => {
  useAuthDatabase(group)

  test('POST /cascade-plans 未认证返回 401', async ({ client }) => {
    const res = await client.post(`${base(1)}/cascade-plans`).json({ sourceObjectiveId: 1 })
    res.assertStatus(401)
  })

  test('POST /cascade-plans returns draft plan', async ({ client, assert }) => {
    const { org, objective, token } = await setupActor(client, 'api-plan-create')
    const res = await client
      .post(`${base(org.id)}/cascade-plans`)
      .bearerToken(token)
      .json({ sourceObjectiveId: objective.id, title: '级联草案' })

    assert.oneOf(res.status(), [200, 201])
    assert.equal(res.body().data.status, 'draft')
    assert.equal(res.body().data.sourceObjectiveId, objective.id)
  })

  test('POST /cascade-plans with missing field returns 422', async ({ client, assert }) => {
    const { org, token } = await setupActor(client, 'api-plan-invalid')
    const res = await client
      .post(`${base(org.id)}/cascade-plans`)
      .bearerToken(token)
      .json({})
    assert.equal(res.status(), 422)
    assert.equal(res.body().error.code, 'VALIDATION_ERROR')
  })

  test('GET /cascade-plans returns paginated list', async ({ client, assert }) => {
    const { org, objective, token } = await setupActor(client, 'api-plan-list')
    for (let i = 0; i < 3; i++) {
      await client
        .post(`${base(org.id)}/cascade-plans`)
        .bearerToken(token)
        .json({ sourceObjectiveId: objective.id, title: `草案 ${i}` })
    }

    const res = await client
      .get(`${base(org.id)}/cascade-plans`)
      .bearerToken(token)
      .qs({ page: 1, perPage: 2 })
    res.assertStatus(200)
    assert.property(res.body(), 'meta')
    assert.property(res.body().meta, 'total')
    // 有界：perPage 生效，不得回全量
    assert.isAtMost(res.body().data.length, 2)
  })

  test('GET /cascade-plans/:planId returns detail with items', async ({ client, assert }) => {
    const { org, objective, token } = await setupActor(client, 'api-plan-detail')
    const created = await client
      .post(`${base(org.id)}/cascade-plans`)
      .bearerToken(token)
      .json({ sourceObjectiveId: objective.id })

    const planId = created.body().data.id
    const res = await client.get(`${base(org.id)}/cascade-plans/${planId}`).bearerToken(token)
    res.assertStatus(200)
    assert.equal(res.body().data.id, planId)
    assert.isArray(res.body().data.items)
  })

  test('POST /cascade-plans/:planId/reject marks items rejected', async ({ client, assert }) => {
    const { org, objective, token } = await setupActor(client, 'api-plan-reject')
    const created = await client
      .post(`${base(org.id)}/cascade-plans`)
      .bearerToken(token)
      .json({ sourceObjectiveId: objective.id })
    const planId = created.body().data.id

    const detail = await client.get(`${base(org.id)}/cascade-plans/${planId}`).bearerToken(token)
    const itemIds = (detail.body().data.items as Array<{ id: number }>).map((i) => i.id)

    const res = await client
      .post(`${base(org.id)}/cascade-plans/${planId}/reject`)
      .bearerToken(token)
      .json({ rejectedItemIds: itemIds.slice(0, 1), reason: '与现有目标重复' })

    res.assertStatus(200)
    assert.equal(res.body().data.rejectedCount, itemIds.slice(0, 1).length)
  })
})

test.group('OKR Cascade/Alignment API — Relations', (group) => {
  useAuthDatabase(group)

  test('POST /relations returns active relation', async ({ client, assert }) => {
    const { org, cycle, objective, token } = await setupActor(client, 'api-rel-create')
    const target = await makeObjective(org.id, cycle.id, '目标目标')

    const res = await client
      .post(`${base(org.id)}/relations`)
      .bearerToken(token)
      .json({
        sourceObjectiveId: objective.id,
        targetObjectiveId: target.id,
        relationType: 'supports',
      })

    assert.oneOf(res.status(), [200, 201])
    assert.equal(res.body().data.status, 'active')
    assert.equal(res.body().data.relationType, 'supports')
  })

  test('POST /relations with duplicate returns 4xx', async ({ client, assert }) => {
    const { org, cycle, objective, token } = await setupActor(client, 'api-rel-dup')
    const target = await makeObjective(org.id, cycle.id, '目标目标')
    const payload = {
      sourceObjectiveId: objective.id,
      targetObjectiveId: target.id,
      relationType: 'supports',
    }
    await client
      .post(`${base(org.id)}/relations`)
      .bearerToken(token)
      .json(payload)
    const res = await client
      .post(`${base(org.id)}/relations`)
      .bearerToken(token)
      .json(payload)

    assert.isAtLeast(res.status(), 400)
    assert.isBelow(res.status(), 500, '重复关系必须是明确的客户端错误，不是 500')
  })

  test('POST /relations with self-relation returns 4xx', async ({ client, assert }) => {
    const { org, objective, token } = await setupActor(client, 'api-rel-self')
    const res = await client
      .post(`${base(org.id)}/relations`)
      .bearerToken(token)
      .json({
        sourceObjectiveId: objective.id,
        targetObjectiveId: objective.id,
        relationType: 'supports',
      })

    assert.isAtLeast(res.status(), 400)
    assert.isBelow(res.status(), 500)
  })

  test('PUT /relations/:relationId updates status', async ({ client, assert }) => {
    const { org, cycle, objective, token } = await setupActor(client, 'api-rel-update')
    const target = await makeObjective(org.id, cycle.id, '目标目标')
    const created = await client
      .post(`${base(org.id)}/relations`)
      .bearerToken(token)
      .json({
        sourceObjectiveId: objective.id,
        targetObjectiveId: target.id,
        relationType: 'supports',
      })
    const relationId = created.body().data.id

    const res = await client
      .put(`${base(org.id)}/relations/${relationId}`)
      .bearerToken(token)
      .json({ status: 'resolved' })

    res.assertStatus(200)
    assert.equal(res.body().data.status, 'resolved')
  })

  test('POST /relations/:relationId/archive soft-deletes', async ({ client, assert }) => {
    const { org, cycle, objective, token } = await setupActor(client, 'api-rel-archive')
    const target = await makeObjective(org.id, cycle.id, '目标目标')
    const created = await client
      .post(`${base(org.id)}/relations`)
      .bearerToken(token)
      .json({
        sourceObjectiveId: objective.id,
        targetObjectiveId: target.id,
        relationType: 'supports',
      })
    const relationId = created.body().data.id

    const res = await client
      .post(`${base(org.id)}/relations/${relationId}/archive`)
      .bearerToken(token)
    res.assertStatus(200)

    // 归档后列表里看不到，但库里仍在（软删除不是物理删除）
    const list = await client.get(`${base(org.id)}/relations`).bearerToken(token)
    assert.notInclude(
      (list.body().data as Array<{ id: number }>).map((r) => r.id),
      relationId,
    )
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const kept = await db.from('okr_objective_relations').where('id', relationId)
    assert.lengthOf(kept, 1)
  })

  test('GET /relations returns filtered list', async ({ client, assert }) => {
    const { org, cycle, objective, token } = await setupActor(client, 'api-rel-filter')
    const t1 = await makeObjective(org.id, cycle.id, '目标一')
    const t2 = await makeObjective(org.id, cycle.id, '目标二')
    await client
      .post(`${base(org.id)}/relations`)
      .bearerToken(token)
      .json({ sourceObjectiveId: objective.id, targetObjectiveId: t1.id, relationType: 'supports' })
    await client
      .post(`${base(org.id)}/relations`)
      .bearerToken(token)
      .json({ sourceObjectiveId: objective.id, targetObjectiveId: t2.id, relationType: 'blocks' })

    const res = await client
      .get(`${base(org.id)}/relations`)
      .bearerToken(token)
      .qs({ relationType: 'supports' })
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 1)
    assert.equal(res.body().data[0].relationType, 'supports')
  })
})

test.group('OKR Cascade/Alignment API — Health & Matrix', (group) => {
  useAuthDatabase(group)

  test('GET /matrix returns bounded sparse matrix', async ({ client, assert }) => {
    const { org, cycle, objective, token } = await setupActor(client, 'api-matrix')
    for (let i = 0; i < 3; i++) {
      const t = await makeObjective(org.id, cycle.id, `矩阵目标 ${i}`)
      await client
        .post(`${base(org.id)}/relations`)
        .bearerToken(token)
        .json({
          sourceObjectiveId: objective.id,
          targetObjectiveId: t.id,
          relationType: 'supports',
        })
    }

    const res = await client
      .get(`${base(org.id)}/matrix`)
      .bearerToken(token)
      .qs({ cycleId: cycle.id, page: 1, perPage: 2 })
    res.assertStatus(200)
    assert.isAtMost(res.body().data.length, 2, 'perPage 必须约束矩阵行数')
    assert.property(res.body(), 'meta')
  })

  test('GET /matrix with invalid filter returns 422', async ({ client, assert }) => {
    const { org, token } = await setupActor(client, 'api-matrix-invalid')
    const res = await client
      .get(`${base(org.id)}/matrix`)
      .bearerToken(token)
      .qs({ sort: 'invalid_field' })
    assert.equal(res.status(), 422)
    assert.equal(res.body().error.code, 'VALIDATION_ERROR')
  })
})

test.group('OKR Cascade/Alignment API — AI Preview & 红线', (group) => {
  useAuthDatabase(group)

  test('POST /ai-cascade-suggestions does not persist OKR facts', async ({ client, assert }) => {
    const { org, cycle, token } = await setupActor(client, 'api-ai-preview')
    const before = await countOkrFacts(org.id)

    const res = await client
      .post(`${base(org.id)}/ai-cascade-suggestions`)
      .bearerToken(token)
      .json({ cycleId: cycle.id })

    assert.oneOf(res.status(), [200, 201])
    const after = await countOkrFacts(org.id)
    // 红线：AI 只建议不落库
    assert.deepEqual(after, before, 'AI 预览不得写入任何正式 OKR 事实')
  })

  test('cross-organization access is not visible', async ({ client, assert }) => {
    const a = await setupActor(client, 'api-xorg-a')
    const b = await setupActor(client, 'api-xorg-b')

    const created = await client
      .post(`${base(a.org.id)}/cascade-plans`)
      .bearerToken(a.token)
      .json({ sourceObjectiveId: a.objective.id })
    const planId = created.body().data.id

    // B 用自己的组织前缀去取 A 的草案 id：不得回出 A 的内容
    const res = await client.get(`${base(b.org.id)}/cascade-plans/${planId}`).bearerToken(b.token)
    assert.isAtLeast(res.status(), 400)
    assert.notInclude(JSON.stringify(res.body()), a.objective.title)
  })

  test('unauthorized user receives 4xx', async ({ client, assert }) => {
    const { org, objective } = await setupActor(client, 'api-unauth')
    const outsider = await createUser({ email: uniqueEmail('api-outsider') })
    const outsiderToken = await login(client, outsider.email)

    const res = await client
      .post(`${base(org.id)}/cascade-plans`)
      .bearerToken(outsiderToken)
      .json({ sourceObjectiveId: objective.id })

    assert.isAtLeast(res.status(), 400)
    assert.isBelow(res.status(), 500, '无权限必须是明确的客户端错误，不是 500')
  })

  test('bounded pagination prevents unbounded reads', async ({ client, assert }) => {
    const { org, token } = await setupActor(client, 'api-bounded')
    // 请求一个远超上限的 perPage：要么被验证器拒绝，要么被钳制，绝不能真的回那么多
    const res = await client
      .get(`${base(org.id)}/cascade-plans`)
      .bearerToken(token)
      .qs({ perPage: 100000 })

    if (res.status() === 200) {
      assert.isBelow(res.body().meta.perPage, 1000, 'perPage 必须被钳制到有界值')
    } else {
      assert.equal(res.status(), 422)
    }
  })
})
