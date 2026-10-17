/**
 * 组织 Dashboard API 功能性测试（v3-organization-dashboard §4.5–4.7）。
 *
 * 覆盖：未认证拒绝、授权读取、跨组织隔离、非成员不可推断存在性、非法查询、空组织、
 *       维度脱敏、PMO 降级、freshness、以及读路径无副作用。
 * 默认全部使用本地 fixture/mock，不触发 AI、OAuth、Webhook、Web Push 或任何外部网络。
 */
import { test } from '@japa/runner'
import Project from '#models/project'
import AuditLog from '#models/audit_log'
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

function dashboardUrl(organizationId: number | string): string {
  return `/api/v1/organizations/${organizationId}/dashboard`
}

test.group('组织 Dashboard API —— 认证与授权', (group) => {
  useAuthDatabase(group)

  test('未认证请求被拒绝 401', async ({ client, assert }) => {
    const response = await client.get(dashboardUrl(1))
    assert.equal(response.status(), 401)
  })

  test('组织所有者读取 Dashboard 返回稳定 envelope', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-owner') })
    const org = await createOrganization(owner)
    await Project.create({
      organizationId: org.id,
      name: '核心平台',
      code: `ODA-${Date.now()}`,
      category: 'delivery',
      priority: 'high',
      status: 'active',
      createdBy: owner.id,
    })
    const token = await login(client, owner)

    const response = await client
      .get(dashboardUrl(org.id))
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)

    const data = response.body().data
    assert.equal(data.meta.metricVersion, 'organization-dashboard.v1')
    assert.equal(data.meta.organizationId, Number(org.id))
    assert.equal(data.organization.organizationId, Number(org.id))
    assert.equal(data.meta.visibleProjectCount, 1)
    assert.isArray(data.kpis)
    assert.isArray(data.sourceFreshness)
    assert.isArray(data.warnings)
    assert.property(data, 'pmoEntry')
    assert.property(data, 'memberOverview')
    assert.property(data, 'resourceOverview')
  })

  test('非成员访问返回 RESOURCE_NOT_FOUND，不泄露组织或项目存在性', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-inside') })
    const outsider = await createUser({ email: uniqueEmail('org-dashboard-outside') })
    const org = await createOrganization(owner)
    await createOrganization(outsider)
    await Project.create({
      organizationId: org.id,
      name: '机密项目',
      code: `ODB-${Date.now()}`,
      category: 'secret',
      priority: 'critical',
      status: 'active',
      createdBy: owner.id,
    })
    const token = await login(client, outsider)

    const response = await client
      .get(dashboardUrl(org.id))
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(404)
    assert.equal(response.body().error.code, 'RESOURCE_NOT_FOUND')
    assert.notInclude(JSON.stringify(response.body()), '机密项目')
    assert.notInclude(JSON.stringify(response.body()), 'secret')
  })

  test('不存在的组织与非成员组织返回一致的 404，不可区分', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-probe-owner') })
    const probe = await createUser({ email: uniqueEmail('org-dashboard-probe') })
    const org = await createOrganization(owner)
    await createOrganization(probe)
    const token = await login(client, probe)

    const existing = await client
      .get(dashboardUrl(org.id))
      .header('Authorization', `Bearer ${token}`)
    const missing = await client
      .get(dashboardUrl(999999))
      .header('Authorization', `Bearer ${token}`)

    assert.equal(existing.status(), missing.status())
    assert.equal(existing.body().error.code, missing.body().error.code)
  })
})

test.group('组织 Dashboard API —— 组织隔离与空组织', (group) => {
  useAuthDatabase(group)

  test('跨组织项目不计入本组织聚合', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-iso-owner') })
    const other = await createUser({ email: uniqueEmail('org-dashboard-iso-other') })
    const org = await createOrganization(owner)
    const otherOrg = await createOrganization(other)
    await Project.create({
      organizationId: org.id,
      name: '本组织项目',
      code: `ODC-${Date.now()}`,
      category: 'delivery',
      priority: 'high',
      status: 'active',
      createdBy: owner.id,
    })
    await Project.create({
      organizationId: otherOrg.id,
      name: '跨组织机密',
      code: `ODD-${Date.now()}`,
      category: 'secret',
      priority: 'critical',
      status: 'active',
      createdBy: other.id,
    })
    const token = await login(client, owner)

    const response = await client
      .get(dashboardUrl(org.id))
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    assert.equal(response.body().data.meta.visibleProjectCount, 1)
    assert.notInclude(JSON.stringify(response.body()), '跨组织机密')
  })

  test('空组织返回显式空态而非缺失数据', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-empty') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client
      .get(dashboardUrl(org.id))
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)

    const data = response.body().data
    assert.equal(data.meta.visibleProjectCount, 0)
    assert.isEmpty(data.attentionProjects)
    assert.isEmpty(data.statusDistribution)
    assert.include(
      data.warnings.map((warning: { code: string }) => warning.code),
      'EMPTY_ORGANIZATION_DASHBOARD',
    )
    assert.isTrue(data.kpis.every((metric: { value: number }) => metric.value === 0))
  })
})

test.group('组织 Dashboard API —— 查询校验', (group) => {
  useAuthDatabase(group)

  test('未知 section 返回 VALIDATION_ERROR', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-badsection') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client
      .get(dashboardUrl(org.id))
      .qs({ sections: 'kpi,secret_section' })
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(422)
    assert.equal(response.body().error.code, 'VALIDATION_ERROR')
  })

  test('超上限 limit 返回 VALIDATION_ERROR 而非无界扫描', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-badlimit') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const response = await client
      .get(dashboardUrl(org.id))
      .qs({ attentionLimit: 9999 })
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(422)
    assert.equal(response.body().error.code, 'VALIDATION_ERROR')
  })

  test('合法 section 子集只返回请求范围', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-sections') })
    const org = await createOrganization(owner)
    await Project.create({
      organizationId: org.id,
      name: '范围项目',
      code: `ODE-${Date.now()}`,
      category: 'delivery',
      priority: 'medium',
      status: 'active',
      createdBy: owner.id,
    })
    const token = await login(client, owner)

    const response = await client
      .get(dashboardUrl(org.id))
      .qs({ sections: 'kpi' })
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    assert.deepEqual(response.body().data.meta.sections, ['kpi'])
    assert.isEmpty(response.body().data.attentionProjects)
  })
})

test.group('组织 Dashboard API —— 降级与无副作用', (group) => {
  useAuthDatabase(group)

  test('freshness 与 warning 显式返回，不静默当作新鲜', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-fresh') })
    const org = await createOrganization(owner)
    await Project.create({
      organizationId: org.id,
      name: '新鲜度项目',
      code: `ODF-${Date.now()}`,
      category: 'delivery',
      priority: 'medium',
      status: 'active',
      createdBy: owner.id,
    })
    const token = await login(client, owner)

    const response = await client
      .get(dashboardUrl(org.id))
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)

    const freshness = response.body().data.sourceFreshness as Array<{
      source: string
      status: string
      isStale: boolean
      staleThresholdMinutes: number
    }>
    assert.isAbove(freshness.length, 0)
    for (const item of freshness) {
      assert.isString(item.source)
      assert.isNumber(item.staleThresholdMinutes)
      assert.include(['ok', 'stale', 'forbidden', 'unavailable', 'empty'], item.status)
    }
  })

  test('命中财务关键词返回 unsupported warning 而非伪造财务指标', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-financial') })
    const org = await createOrganization(owner)
    await Project.create({
      organizationId: org.id,
      name: '预算相关项目',
      code: `ODG-${Date.now()}`,
      category: 'delivery',
      priority: 'medium',
      status: 'active',
      createdBy: owner.id,
    })
    const token = await login(client, owner)

    const response = await client
      .get(dashboardUrl(org.id))
      .qs({ search: '预算' })
      .header('Authorization', `Bearer ${token}`)
    response.assertStatus(200)
    assert.include(
      response.body().data.warnings.map((warning: { code: string }) => warning.code),
      'FINANCIAL_UNSUPPORTED',
    )
    assert.notMatch(JSON.stringify(response.body().data.kpis), /budget|roi|cost/i)
  })

  test('读路径不修改项目、组织或审计事实', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('org-dashboard-readonly') })
    const org = await createOrganization(owner)
    const project = await Project.create({
      organizationId: org.id,
      name: '只读校验项目',
      code: `ODH-${Date.now()}`,
      category: 'delivery',
      priority: 'medium',
      status: 'active',
      createdBy: owner.id,
    })
    const token = await login(client, owner)

    const countProjects = async () => {
      const rows = await Project.query().where('organization_id', org.id)
      return rows.length
    }
    const countAuditLogs = async () => {
      const rows = await AuditLog.query().where('organization_id', org.id)
      return rows.length
    }

    const beforeProject = await Project.find(project.id)
    const beforeUpdatedAt = beforeProject?.updatedAt?.toISO() ?? null
    const beforeProjectCount = await countProjects()
    const beforeAuditCount = await countAuditLogs()

    await client.get(dashboardUrl(org.id)).header('Authorization', `Bearer ${token}`)
    await client.get(dashboardUrl(org.id)).header('Authorization', `Bearer ${token}`)

    const afterProject = await Project.find(project.id)
    assert.equal(afterProject?.updatedAt?.toISO() ?? null, beforeUpdatedAt)
    assert.equal(afterProject?.status, 'active')
    assert.equal(await countProjects(), beforeProjectCount)
    // 读取不得写入新的业务审计事实（低敏 read audit 为可选项，本实现不落库）。
    assert.equal(await countAuditLogs(), beforeAuditCount)
  })
})
