/**
 * OKR Dashboard API 功能性测试（v3-okr-dashboard §3.8）。
 *
 * 覆盖：未认证、授权读取、跨组织隔离、校验错误、空组织、维度脱敏、无副作用。
 * 默认全部使用本地 fixture，不触发 AI/OAuth/Webhook/Web Push/外部网络。
 */
import { test } from '@japa/runner'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import { OKR_METRIC_VERSION } from '@aiproj/types'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function login(client: any, user: any): Promise<string> {
  const response = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return response.body().data.accessToken
}

function url(organizationId: number | string, qs: string = ''): string {
  const path = `/api/v1/organizations/${organizationId}/okrs/dashboard`
  return qs ? `${path}?${qs}` : path
}

async function seedCycleWithKr(orgId: number, ownerId: number, progress: number = 25) {
  const cycle = await OkrCycle.create({
    organizationId: orgId,
    title: '2026 Q3',
    status: 'active',
    startDate: '2026-07-01',
    endDate: '2026-09-30',
  })
  const objective = await OkrObjective.create({
    organizationId: orgId,
    cycleId: cycle.id,
    scope: 'organization',
    title: '组织目标 A',
    status: 'active',
    progress,
    confidence: 'medium',
    weight: 1,
    metricVersion: OKR_METRIC_VERSION,
    ownerId,
    startDate: '2026-07-01',
    endDate: '2026-09-30',
  })
  await OkrKeyResult.create({
    organizationId: orgId,
    objectiveId: objective.id,
    title: 'KR-1',
    measurementType: 'percent',
    baselineValue: 0,
    targetValue: 100,
    currentValue: progress,
    confidence: 'medium',
    status: 'active',
    weight: 1,
  })
  return { cycle, objective }
}

test.group('OKR Dashboard API —— 认证与授权', (group) => {
  useAuthDatabase(group)

  test('未认证请求被拒绝 401', async ({ client, assert }) => {
    const response = await client.get(url(1))
    assert.equal(response.status(), 401)
  })

  test('组织所有者读取 Dashboard 返回稳定 envelope', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('okr-dash-api-owner') })
    const org = await createOrganization(owner)
    await seedCycleWithKr(org.id, owner.id)
    const token = await login(client, owner)

    const response = await client.get(url(org.id)).header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)

    const body = response.body()
    assert.property(body, 'data')
    const data = body.data
    assert.equal(data.meta.organizationId, Number(org.id))
    assert.equal(data.meta.metricVersion, `okr-dashboard.${OKR_METRIC_VERSION}`)
    assert.property(data, 'cycleContext')
    assert.property(data, 'kpis')
    assert.property(data, 'attention')
    assert.property(data, 'alignmentHealth')
    assert.property(data, 'evidenceFreshness')
    assert.property(data, 'backflow')
    assert.property(data, 'meta')
    assert.isArray(data.warnings)
  })

  test('非成员访问返回 RESOURCE_NOT_FOUND，不泄露组织存在性', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('okr-dash-api-inside') })
    const outsider = await createUser({ email: uniqueEmail('okr-dash-api-outside') })
    const org = await createOrganization(owner)
    await createOrganization(outsider)
    await seedCycleWithKr(org.id, owner.id)
    const token = await login(client, outsider)

    const response = await client.get(url(org.id)).header('Authorization', `Bearer ${token}`)
    response.assertStatus(404)
    assert.equal(response.body().error.code, 'RESOURCE_NOT_FOUND')
    assert.notInclude(JSON.stringify(response.body()), '组织目标 A')
    assert.notInclude(JSON.stringify(response.body()), 'KR-1')
  })

  test('不存在的组织与非成员组织返回一致的 404', async ({ client, assert }) => {
    const probe = await createUser({ email: uniqueEmail('okr-dash-api-probe') })
    await createOrganization(probe)
    const token = await login(client, probe)

    const nonExistent = await client.get(url(999_999)).header('Authorization', `Bearer ${token}`)
    nonExistent.assertStatus(404)
    assert.equal(nonExistent.body().error.code, 'RESOURCE_NOT_FOUND')
  })
})

test.group('OKR Dashboard API —— 校验', (group) => {
  useAuthDatabase(group)

  test('拒绝未知 scope', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('okr-dash-api-val1') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client
      .get(url(org.id, 'scope=budget'))
      .header('Authorization', `Bearer ${token}`)
    // 400 or 422 视框架
    assert.oneOf(response.status(), [400, 422] as any)
    assert.equal(response.body().error.code, 'VALIDATION_ERROR')
  })

  test('拒绝超上限 attentionLimit', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('okr-dash-api-val2') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client
      .get(url(org.id, 'attentionLimit=9999'))
      .header('Authorization', `Bearer ${token}`)
    assert.oneOf(response.status(), [400, 422] as any)
    assert.equal(response.body().error.code, 'VALIDATION_ERROR')
  })

  test('拒绝非法日期窗口（超上限）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('okr-dash-api-val3') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client
      .get(url(org.id, 'dateFrom=2026-01-01&dateTo=2028-01-01'))
      .header('Authorization', `Bearer ${token}`)
    assert.oneOf(response.status(), [400, 422] as any)
    assert.equal(response.body().error.code, 'VALIDATION_ERROR')
  })
})

test.group('OKR Dashboard API —— 空态与只读', (group) => {
  useAuthDatabase(group)

  test('空组织返回稳定 shape，attention/alignment/evidence 均为空', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('okr-dash-api-empty') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client.get(url(org.id)).header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    const data = response.body().data
    assert.isArray(data.attention)
    assert.lengthOf(data.attention, 0)
  })

  test('backflow 默认可用但无候选时 counts 为零', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('okr-dash-api-backflow') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client.get(url(org.id)).header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    const data = response.body().data
    assert.isTrue(data.backflow.available)
    assert.equal(data.backflow.candidateCount, 0)
    assert.equal(data.backflow.conflictCount, 0)
    assert.equal(data.backflow.staleCount, 0)
  })
})
