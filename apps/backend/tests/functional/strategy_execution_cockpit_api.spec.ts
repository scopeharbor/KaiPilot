/**
 * 战略执行驾驶舱 API 功能性测试（v3-strategy-execution-cockpit §4.8）。
 *
 * 覆盖：未认证拒绝、授权读取、组织隔离、非法查询、空组织空态、feature flag 关闭、
 *       读路径无副作用。默认全部使用本地 fixture/mock，不触发 AI/OAuth/Webhook/External。
 */
import { test } from '@japa/runner'
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

function cockpitUrl(organizationId: number | string): string {
  return '/api/v1/organizations/' + organizationId + '/strategy-execution-cockpit'
}

test.group('战略执行驾驶舱 API —— 认证与授权', (group) => {
  useAuthDatabase(group)

  test('未认证请求被拒绝 401', async ({ client, assert }) => {
    const response = await client.get(cockpitUrl(1))
    assert.equal(response.status(), 401)
  })

  test('组织所有者读取驾驶舱返回稳定 envelope 与空态', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cockpit-owner') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client.get(cockpitUrl(org.id)).header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    const data = response.body().data
    assert.equal(data.meta.metricVersion, 'strategy-execution-cockpit.v1.0.0')
    assert.equal(data.meta.organizationId, Number(org.id))
    assert.equal(data.meta.overallStatus, 'empty')
    assert.isArray(data.kpis)
    assert.isArray(data.objectiveRows)
    assert.isArray(data.attention)
    assert.isArray(data.sourceFreshness)
    assert.isArray(data.warnings)
    assert.include(
      data.warnings.map((warning: { code: string }) => warning.code),
      'EMPTY_STRATEGY_SCOPE',
    )
  })

  test('非成员访问返回 RESOURCE_NOT_FOUND，不泄露驾驶舱存在性', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cockpit-inside') })
    const outsider = await createUser({ email: uniqueEmail('cockpit-outside') })
    const org = await createOrganization(owner)
    await createOrganization(outsider)
    const token = await login(client, outsider)

    const response = await client.get(cockpitUrl(org.id)).header('Authorization', 'Bearer ' + token)
    response.assertStatus(404)
    assert.equal(response.body().error.code, 'RESOURCE_NOT_FOUND')
  })

  test('不存在的组织与非成员组织返回一致 404，不可区分', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cockpit-probe-owner') })
    const probe = await createUser({ email: uniqueEmail('cockpit-probe') })
    const org = await createOrganization(owner)
    await createOrganization(probe)
    const token = await login(client, probe)

    const existing = await client.get(cockpitUrl(org.id)).header('Authorization', 'Bearer ' + token)
    const missing = await client.get(cockpitUrl(999999)).header('Authorization', 'Bearer ' + token)

    assert.equal(existing.status(), missing.status())
    assert.equal(existing.body().error.code, missing.body().error.code)
  })
})

test.group('战略执行驾驶舱 API —— 查询校验与 feature flag', (group) => {
  useAuthDatabase(group)

  test('未知 include 返回 VALIDATION_ERROR', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cockpit-badinclude') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client
      .get(cockpitUrl(org.id))
      .qs({ include: 'objective_matrix,secret_include' })
      .header('Authorization', 'Bearer ' + token)
    response.assertStatus(422)
    assert.equal(response.body().error.code, 'VALIDATION_ERROR')
  })

  test('超上限 attentionLimit 返回 VALIDATION_ERROR', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cockpit-badlimit') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client
      .get(cockpitUrl(org.id))
      .qs({ attentionLimit: 9999 })
      .header('Authorization', 'Bearer ' + token)
    response.assertStatus(422)
    assert.equal(response.body().error.code, 'VALIDATION_ERROR')
  })

  test('feature flag 关闭时入口返回 503 FEATURE_DISABLED', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cockpit-disabled') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)
    const old = process.env.STRATEGY_EXECUTION_COCKPIT_ENABLED
    process.env.STRATEGY_EXECUTION_COCKPIT_ENABLED = 'false'

    try {
      const response = await client
        .get(cockpitUrl(org.id))
        .header('Authorization', 'Bearer ' + token)
      response.assertStatus(503)
      assert.equal(response.body().error.code, 'FEATURE_DISABLED')
    } finally {
      if (old === undefined) delete process.env.STRATEGY_EXECUTION_COCKPIT_ENABLED
      else process.env.STRATEGY_EXECUTION_COCKPIT_ENABLED = old
    }
  })
})

test.group('战略执行驾驶舱 API —— 读路径无副作用', (group) => {
  useAuthDatabase(group)

  test('GET 请求不改变业务事实', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cockpit-zero-side-effect') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const { default: Project } = await import('#models/project')
    const beforeRow = (await Project.query()
      .where('organization_id', org.id)
      .count('* as c')
      .first()) as unknown as { $extras: { c: number } }
    const beforeCount = Number(beforeRow.$extras.c ?? 0)

    const response = await client.get(cockpitUrl(org.id)).header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    const afterRow = (await Project.query()
      .where('organization_id', org.id)
      .count('* as c')
      .first()) as unknown as { $extras: { c: number } }
    const afterCount = Number(afterRow.$extras.c ?? 0)
    assert.equal(beforeCount, afterCount)
  })

  test('GET 不改变 OKR/分配等核心业务表计数', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('cockpit-zero-side-effect-multi') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const modelNames = ['okr_objective', 'okr_key_result'] as const
    const countTable = async (name: string) => {
      const { default: Model } = await import('#models/' + name)
      const row = (await Model.query()
        .where('organization_id', org.id)
        .count('* as c')
        .first()) as unknown as { $extras: { c: number } }
      return Number(row.$extras.c ?? 0)
    }
    const before: Record<string, number> = {}
    for (const name of modelNames) before[name] = await countTable(name)

    const response = await client.get(cockpitUrl(org.id)).header('Authorization', 'Bearer ' + token)
    response.assertStatus(200)

    for (const name of modelNames) {
      assert.equal(await countTable(name), before[name], name)
    }
  })
})
