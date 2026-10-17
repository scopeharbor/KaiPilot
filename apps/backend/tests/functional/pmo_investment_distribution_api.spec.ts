import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import Project from '#models/project'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function login(client: any, user: any): Promise<string> {
  const loginRes = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return loginRes.body().data.accessToken
}

test.group('PMO Investment Distribution API', (group) => {
  useAuthDatabase(group)

  test('未认证请求 catalogue 被拒绝 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/investment-distribution/catalogue')
    assert.equal(response.status(), 401)
  })

  test('未认证请求 summary 被拒绝 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/investment-distribution')
    assert.equal(response.status(), 401)
  })

  test('未认证请求 trends 被拒绝 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/investment-distribution/trends')
    assert.equal(response.status(), 401)
  })

  test('未认证请求 drill-down 被拒绝 401', async ({ client, assert }) => {
    const response = await client.get('/api/v1/pmo/investment-distribution/buckets/delivery')
    assert.equal(response.status(), 401)
  })

  test('认证 PMO 用户读取 catalogue 和 empty summary envelope', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-investment-owner') })
    const org = await createOrganization(user)
    const token = await login(client, user)

    const catalogue = await client
      .get('/api/v1/pmo/investment-distribution/catalogue')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
    catalogue.assertStatus(200)
    assert.include(catalogue.body().data.nonFinancialBasis, 'project_count')
    assert.include(catalogue.body().data.unsupportedFinancialBasis, 'roi')

    const summary = await client
      .get('/api/v1/pmo/investment-distribution')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
    summary.assertStatus(200)
    assert.equal(summary.body().data.meta.metricVersion, 'pmo-investment-distribution.v1')
    assert.equal(summary.body().data.warnings[0].code, 'EMPTY_PORTFOLIO')
  })

  test('认证 PMO 用户读取项目数分布且排除跨组织项目', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-investment-projects') })
    const other = await createUser({ email: uniqueEmail('pmo-investment-other') })
    const org = await createOrganization(user)
    const otherOrg = await createOrganization(other)
    await Project.create({
      organizationId: org.id,
      name: '交付项目 A',
      code: `PIDA-${Date.now()}`,
      category: 'delivery',
      priority: 'high',
      status: 'active',
      createdBy: user.id,
    })
    await Project.create({
      organizationId: otherOrg.id,
      name: '跨组织项目',
      code: `PIDB-${Date.now()}`,
      category: 'secret',
      priority: 'critical',
      status: 'active',
      createdBy: other.id,
    })
    const token = await login(client, user)

    const response = await client
      .get('/api/v1/pmo/investment-distribution')
      .qs({ basis: 'project_count', dimension: 'project_type' })
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
    response.assertStatus(200)
    assert.equal(response.body().data.meta.visibleProjectCount, 1)
    assert.notInclude(JSON.stringify(response.body()), 'secret')
  })

  test('认证 PMO 用户请求 ROI 返回 unsupported 而非伪造数值', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-investment-roi') })
    const org = await createOrganization(user)
    const token = await login(client, user)

    const response = await client
      .get('/api/v1/pmo/investment-distribution')
      .qs({ basis: 'roi', displayMode: 'matrix' })
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
    response.assertStatus(200)
    assert.isNull(response.body().data.meta.totalBasisValue)
    assert.equal(response.body().data.warnings[0].code, 'FINANCIAL_BASIS_UNSUPPORTED')
  })

  test('登录但无目标组织 portfolio:view 返回 403 且不泄露组合数据', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmo-investment-denied-owner') })
    const outsider = await createUser({ email: uniqueEmail('pmo-investment-denied-outsider') })
    const org = await createOrganization(owner)
    await Project.create({
      organizationId: org.id,
      name: '不可见项目',
      code: `PIDD-${Date.now()}`,
      category: 'secret',
      priority: 'critical',
      status: 'active',
      createdBy: owner.id,
    })
    const token = await login(client, outsider)

    const response = await client
      .get('/api/v1/pmo/investment-distribution')
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
    response.assertStatus(403)
    assert.equal((response.body() as any).error.code, 'PERMISSION_DENIED')
    assert.notInclude(JSON.stringify(response.body()), 'secret')
    assert.notInclude(JSON.stringify(response.body()), '不可见项目')
  })

  test('成功读取写入低敏审计事件且不含敏感字段（§4.15/§4.16）', async ({ client, assert }) => {
    const user = await createUser({ email: uniqueEmail('pmo-investment-audit') })
    const org = await createOrganization(user)
    await Project.create({
      organizationId: org.id,
      name: '审计观察项目',
      code: `PIDE-${Date.now()}`,
      category: 'delivery',
      priority: 'high',
      status: 'active',
      createdBy: user.id,
    })
    const token = await login(client, user)

    const response = await client
      .get('/api/v1/pmo/investment-distribution')
      .qs({ basis: 'project_count', dimension: 'project_type' })
      .header('Authorization', `Bearer ${token}`)
      .header('X-Organization-Id', String(org.id))
    response.assertStatus(200)

    const logs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'pmo_investment_distribution')
    assert.lengthOf(logs, 1)
    assert.equal(logs[0]!.action, 'read')
    assert.equal(logs[0]!.userId, user.id)

    const metadata = logs[0]!.metadata as Record<string, unknown>
    assert.equal(metadata.event, 'PMO_INVESTMENT_DISTRIBUTION_READ')
    assert.equal(metadata.basis, 'project_count')
    assert.equal(metadata.dimension, 'project_type')
    assert.equal(metadata.bucketCount, 1)

    const serialized = JSON.stringify(logs[0]!.metadata).toLowerCase()
    for (const term of ['审计观察项目', 'authorization', 'bearer', 'token', 'secret', 'prompt']) {
      assert.notInclude(serialized, term.toLowerCase())
    }
  })

  test('钻取审计只落 bucket key hash，权限拒绝写入拒绝事件', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmo-investment-audit-drill') })
    const outsider = await createUser({ email: uniqueEmail('pmo-investment-audit-denied') })
    const org = await createOrganization(owner)
    await Project.create({
      organizationId: org.id,
      name: '钻取项目',
      code: `PIDF-${Date.now()}`,
      category: 'delivery',
      priority: 'high',
      status: 'active',
      createdBy: owner.id,
    })
    const ownerToken = await login(client, owner)
    const outsiderToken = await login(client, outsider)

    const drill = await client
      .get('/api/v1/pmo/investment-distribution/buckets/delivery')
      .qs({ basis: 'project_count', dimension: 'project_type' })
      .header('Authorization', `Bearer ${ownerToken}`)
      .header('X-Organization-Id', String(org.id))
    drill.assertStatus(200)

    const drillLogs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'pmo_investment_distribution')
    const drillMetadata = drillLogs
      .map((log) => log.metadata as Record<string, unknown>)
      .find((meta) => meta.event === 'PMO_INVESTMENT_DISTRIBUTION_DRILL_DOWN')
    assert.exists(drillMetadata)
    assert.isString(drillMetadata!.bucketKeyHash)
    assert.isUndefined(drillMetadata!.bucketKey)
    assert.notInclude(JSON.stringify(drillMetadata), '钻取项目')

    const denied = await client
      .get('/api/v1/pmo/investment-distribution')
      .header('Authorization', `Bearer ${outsiderToken}`)
      .header('X-Organization-Id', String(org.id))
    denied.assertStatus(403)

    const deniedLogs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('user_id', outsider.id)
      .where('entity_type', 'pmo_investment_distribution')
    assert.lengthOf(deniedLogs, 1)
    const deniedMetadata = deniedLogs[0]!.metadata as Record<string, unknown>
    assert.equal(deniedMetadata.event, 'PMO_INVESTMENT_DISTRIBUTION_PERMISSION_DENIED')
    assert.equal(deniedMetadata.denyReason, 'portfolio_view_denied')
    assert.isUndefined(deniedMetadata.bucketCount)
    assert.isUndefined(deniedMetadata.visibleProjectCount)
  })
})
