import AuditLog from '#models/audit_log'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import { test } from '@japa/runner'
import {
  createOrganization,
  createUser,
  STRONG_PASSWORD,
  uniqueEmail,
  useAuthDatabase,
  addOrgMember,
} from '../auth/_helpers.js'

/**
 * v3-database-schema-expansion §4.8 —— V3 组合事实后端 focused 测试。
 * 覆盖：create 默认 manager=创建者、create 拒绝非创建者 manager、update 持久化 V3 事实、
 * 跨组织 manager 拒绝、非成员 manager 拒绝、custom-field 拒绝、null forecast 不转 0、
 * 审计记录 changed 字段名 + source/freshness 摘要（不含 custom_fields 全量）。
 */
test.group('v3-database-schema-expansion: V3 项目事实 CRUD', (group) => {
  useAuthDatabase(group)

  async function login(
    client: any,
    email: string,
    password = STRONG_PASSWORD,
    organizationId?: number,
  ) {
    const res = await client.post('/api/v1/auth/login').json({ email, password })
    const accessToken = res.body().data.accessToken as string
    if (organizationId === undefined) return accessToken
    const refreshRes = await client.post('/api/v1/auth/refresh').json({
      refreshToken: res.body().data.refreshToken,
      organizationId,
    })
    return refreshRes.body().data.accessToken as string
  }

  async function createOrgAndAdmin(client: any) {
    const admin = await createUser({ email: uniqueEmail('admin') })
    const org = await createOrganization(admin)
    const token = await login(client, admin.email, STRONG_PASSWORD, org.id)
    return { admin, org, token }
  }

  test('create 默认 project_manager_id 为创建者', async ({ client, assert }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const res = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'v3-default-manager', code: 'V3DM' })

    res.assertStatus(201)
    assert.equal(res.body().data.projectManagerId, admin.id)

    const project = await Project.find(res.body().data.id)
    assert.equal(project!.projectManagerId, Number(admin.id))
    void org
  })

  test('create 拒绝非创建者 project_manager_id', async ({ client, assert }) => {
    const { admin, token } = await createOrgAndAdmin(client)
    // 另一组织用户
    const other = await createUser({ email: uniqueEmail('other') })
    const otherOrg = await createOrganization(other)

    const res = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'v3-non-creator-mgr', code: 'V3NCM', projectManagerId: other.id })

    res.assertStatus(422)
    assert.equal(res.body().error.code, 'VALIDATION_ERROR')
    // 项目未创建
    const count = await Project.query().where('code', 'V3NCM').count('* as total')
    const total = Number((count[0] as any).$extras?.total ?? 0)
    assert.equal(total, 0)
    void admin
    void otherOrg
  })

  test('update 持久化 V3 事实 + 低敏审计摘要', async ({ client, assert }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const createRes = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'v3-update-facts', code: 'V3UF' })
    const projectId = createRes.body().data.id

    const res = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        departmentKey: 'eng',
        departmentName: 'Engineering',
        businessLine: 'platform',
        investmentType: 'strategic',
        strategyTheme: 'ai-native',
        programKey: 'pgm-01',
        forecastCostCents: 4200000,
        forecastEndDate: '2027-06-30',
        customFields: { kpi: 'velocity', owner: 'eve' },
        portfolioFactSource: 'manual',
      })

    res.assertStatus(200)
    const body = res.body().data
    assert.equal(body.departmentKey, 'eng')
    assert.equal(body.investmentType, 'strategic')
    assert.equal(body.forecastCostCents, 4200000)
    assert.equal(body.forecastEndDate, '2027-06-30')
    assert.deepEqual(body.customFields, { kpi: 'velocity', owner: 'eve' })
    assert.equal(body.portfolioFactSource, 'manual')
    assert.isNotNull(body.portfolioFactUpdatedAt)

    // 审计：记录 changed 字段名 + source/freshness，不含 custom_fields 全量
    const audit = await AuditLog.query()
      .where('project_id', projectId)
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['PROJECT_UPDATED'])
      .first()
    assert.isNotNull(audit)
    const meta = audit!.metadata as Record<string, unknown>
    const v3 = meta.v3Facts as Record<string, unknown>
    assert.includeMembers(v3.changed as string[], [
      'departmentKey',
      'investmentType',
      'forecastCostCents',
      'portfolioFactSource',
    ])
    assert.equal(v3.portfolioFactSource, 'manual')
    // custom_fields 全量不得进审计
    const metaJson = JSON.stringify(meta)
    assert.notInclude(metaJson, 'velocity')
    void admin
    void org
  })

  test('update 跨组织 manager 拒绝（非泄露）', async ({ client, assert }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const createRes = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'v3-cross-mgr', code: 'V3XM' })
    const projectId = createRes.body().data.id

    // 另一组织的用户
    const other = await createUser({ email: uniqueEmail('other') })
    await createOrganization(other)

    const res = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ projectManagerId: other.id })

    res.assertStatus(422)
    assert.equal(res.body().error.code, 'VALIDATION_ERROR')
    // manager 未变更
    const project = await Project.find(projectId)
    assert.equal(project!.projectManagerId, Number(admin.id))
    void org
  })

  test('update 非项目成员 manager 拒绝', async ({ client, assert }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const createRes = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'v3-non-member-mgr', code: 'V3NMM' })
    const projectId = createRes.body().data.id

    // 同组织但非项目成员
    const colleague = await createUser({ email: uniqueEmail('colleague') })
    await addOrgMember(org, colleague, 'member')

    const res = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ projectManagerId: colleague.id })

    res.assertStatus(422)
    assert.equal(res.body().error.code, 'VALIDATION_ERROR')
    const project = await Project.find(projectId)
    assert.equal(project!.projectManagerId, Number(admin.id))
  })

  test('update 同组织活跃成员 manager 接受', async ({ client, assert }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const createRes = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'v3-assign-mgr', code: 'V3AM' })
    const projectId = createRes.body().data.id

    // 同组织用户 + 加为项目成员
    const colleague = await createUser({ email: uniqueEmail('colleague2') })
    await addOrgMember(org, colleague, 'member')
    // 用项目既有系统角色建成员关系
    const sysRole = await ProjectRole.query().where('project_id', projectId).first()
    await ProjectMember.create({
      projectId,
      userId: colleague.id,
      projectRoleId: sysRole!.id,
      isActive: true,
    })

    const res = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ projectManagerId: colleague.id })

    res.assertStatus(200)
    assert.equal(res.body().data.projectManagerId, colleague.id)
    void admin
  })

  test('update 拒绝不支持的投资类型', async ({ client }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const createRes = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'v3-bad-investment', code: 'V3BI' })
    const projectId = createRes.body().data.id

    const res = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ investmentType: 'speculative' })

    res.assertStatus(422)
    void admin
    void org
  })

  test('update 拒绝 unsafe custom_fields（root array / 可执行键 / secret-like）', async ({
    client,
    assert,
  }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const createRes = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'v3-unsafe-custom', code: 'V3UC' })
    const projectId = createRes.body().data.id

    // root array
    const r1 = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ customFields: ['a'] })
    r1.assertStatus(422)

    // secret-like
    const r2 = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ customFields: { token: 'sk-live-secret' } })
    r2.assertStatus(422)

    // 可执行键
    const r3 = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ customFields: { onclick: 'alert(1)' } })
    r3.assertStatus(422)

    // 项目 custom_fields 仍为 null（未部分提交）
    const project = await Project.find(projectId)
    assert.isNull(project!.customFields)
    void admin
    void org
  })

  test('update forecast_cost_cents=null 保持 null（不转 0）', async ({ client, assert }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const createRes = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({ name: 'v3-null-forecast', code: 'V3NF' })
    const projectId = createRes.body().data.id

    const res = await client
      .patch(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ forecastCostCents: null })

    res.assertStatus(200)
    assert.isNull(res.body().data.forecastCostCents)
    const project = await Project.find(projectId)
    assert.isNull(project!.forecastCostCents)
    void admin
    void org
  })

  test('list/detail 返回 V3 事实（仅授权读后）', async ({ client, assert }) => {
    const { admin, org, token } = await createOrgAndAdmin(client)
    const createRes = await client
      .post('/api/v1/projects')
      .header('Authorization', `Bearer ${token}`)
      .json({
        name: 'v3-list-detail',
        code: 'V3LD',
        departmentKey: 'eng',
        investmentType: 'innovation',
        forecastCostCents: 100000,
      })
    const projectId = createRes.body().data.id

    // detail
    const detailRes = await client
      .get(`/api/v1/projects/${projectId}`)
      .header('Authorization', `Bearer ${token}`)
    detailRes.assertStatus(200)
    assert.equal(detailRes.body().data.departmentKey, 'eng')
    assert.equal(detailRes.body().data.investmentType, 'innovation')
    assert.equal(detailRes.body().data.forecastCostCents, 100000)

    // list
    const listRes = await client.get('/api/v1/projects').header('Authorization', `Bearer ${token}`)
    listRes.assertStatus(200)
    const item = (listRes.body().data as any[]).find((p) => p.id === projectId)
    assert.isOk(item)
    assert.equal(item.departmentKey, 'eng')
    void admin
    void org
  })
})
