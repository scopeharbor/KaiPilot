import AuditLog from '#models/audit_log'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import type Organization from '#models/organization'
import { test } from '@japa/runner'
import { ProjectRoleName } from '#rbac'
import type User from '#models/user'
import type { ApiClient } from '@japa/api-client'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

/** 装配项目 + owner(PM) + 可选额外成员。 */
async function setupProject(
  org: Organization,
  creator: User,
  extraMembers: Array<{ user: User; role: string }> = [],
) {
  const { project } = await createProjectWithMember(
    org,
    creator,
    creator,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const roleCache = new Map<string, ProjectRole>()
  for (const { user, role } of extraMembers) {
    await addOrgMember(org, user, 'member')
    let roleRow = roleCache.get(role)
    if (!roleRow) {
      roleRow = await ProjectRole.create({
        projectId: project.id,
        name: role,
        description: role,
        permissions: [],
        isSystem: true,
      })
      roleCache.set(role, roleRow)
    }
    await ProjectMember.create({
      projectId: project.id,
      userId: user.id,
      projectRoleId: roleRow.id,
      isActive: true,
    })
  }
  return { project }
}

test.group('Risks API', (group) => {
  useAuthDatabase(group)

  // ---------------- CRUD ----------------

  test('POST /api/v1/projects/:projectId/risks 创建风险', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-create') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const res = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        title: '技术风险',
        description: '新框架学习曲线陡峭',
        category: 'technical',
        probability: 4,
        impact: 3,
      })

    res.assertStatus(201)
    const risk = res.body().data
    assert.equal(risk.title, '技术风险')
    assert.equal(risk.score, 12)
    assert.equal(risk.status, 'identified')
  })

  test('GET /api/v1/projects/:projectId/risks 列表', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-list') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    // 创建几条风险
    for (let i = 0; i < 3; i++) {
      await client
        .post(`/api/v1/projects/${project.id}/risks`)
        .header('Authorization', `Bearer ${token}`)
        .json({ title: `风险 ${i}`, description: `描述 ${i}` })
    }

    const res = await client
      .get(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assert.lengthOf(res.body().data, 3)
    assert.equal(res.body().meta.total, 3)
  })

  test('GET /api/v1/projects/:projectId/risks 支持分页', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-page') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    for (let i = 0; i < 5; i++) {
      await client
        .post(`/api/v1/projects/${project.id}/risks`)
        .header('Authorization', `Bearer ${token}`)
        .json({ title: `风险 ${i}`, description: `描述 ${i}` })
    }

    const res = await client
      .get(`/api/v1/projects/${project.id}/risks?page=1&perPage=2`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assert.lengthOf(res.body().data, 2)
    assert.equal(res.body().meta.total, 5)
    assert.equal(res.body().meta.totalPages, 3)
  })

  test('PATCH /api/v1/risks/:id 更新风险', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-update') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '原始标题', description: '描述' })

    const riskId = createRes.body().data.id

    const res = await client
      .patch(`/api/v1/risks/${riskId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '更新后标题', probability: 5, impact: 5 })

    res.assertStatus(200)
    const body = res.body() as { data: { title: string; score: number } }
    const data = body.data
    assert.equal(data.title, '更新后标题')
    assert.equal(data.score, 25)
  })

  test('DELETE /api/v1/risks/:id 软删除', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-delete') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '待删除', description: '描述' })

    const riskId = createRes.body().data.id

    const res = await client
      .delete(`/api/v1/risks/${riskId}`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(204)

    // 列表中不应出现
    const listRes = await client
      .get(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)

    assert.lengthOf(listRes.body().data, 0)
  })

  // ---------------- 状态推进 ----------------

  test('POST /api/v1/risks/:id/status 状态推进', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-status') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '状态测试', description: '描述' })

    const riskId = createRes.body().data.id

    const res = await client
      .post(`/api/v1/risks/${riskId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'analyzing' })

    res.assertStatus(200)
    assert.equal(res.body().data.status, 'analyzing')
  })

  test('POST /api/v1/risks/:id/status 非法转换返回 422', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-illegal') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '非法转换', description: '描述' })

    const riskId = createRes.body().data.id

    const res = await client
      .post(`/api/v1/risks/${riskId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'resolved' })

    res.assertStatus(422)
  })

  // ---------------- 矩阵 ----------------

  test('GET /api/v1/projects/:projectId/risks/matrix 返回 25 格', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-matrix') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '矩阵风险', description: '描述', probability: 3, impact: 4 })

    const res = await client
      .get(`/api/v1/projects/${project.id}/risks/matrix`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    assert.lengthOf(res.body().data.cells, 25)
  })

  // ---------------- 权限 ----------------

  test('readonly_observer 不能创建风险', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-readonly') })
    const viewer = await createUser({ email: uniqueEmail('risk-viewer') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: viewer, role: ProjectRoleName.READONLY_OBSERVER },
    ])
    const token = await login(client, viewer)

    const res = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '越权创建', description: '描述' })

    res.assertStatus(403)
  })

  test('member 可以查看但不能创建风险', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-member-view') })
    const member = await createUser({ email: uniqueEmail('risk-member') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner, [
      { user: member, role: ProjectRoleName.MEMBER },
    ])

    // owner 创建一条风险
    const ownerToken = await login(client, owner)
    await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ title: '成员可见', description: '描述' })

    // member 可以查看
    const memberToken = await login(client, member)
    const listRes = await client
      .get(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${memberToken}`)
    listRes.assertStatus(200)
    assert.lengthOf(listRes.body().data, 1)

    // member 不能创建
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${memberToken}`)
      .json({ title: '成员创建', description: '描述' })
    createRes.assertStatus(403)
  })

  // ---------------- 审计 ----------------

  test('创建/更新/删除/状态推进均写审计', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-audit') })
    const org = await createOrganization(owner)
    const { project } = await setupProject(org, owner)
    const token = await login(client, owner)

    // 创建
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '审计风险', description: '描述' })
    const riskId = createRes.body().data.id

    // 更新
    await client
      .patch(`/api/v1/risks/${riskId}`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '更新后' })

    // 状态推进
    await client
      .post(`/api/v1/risks/${riskId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'analyzing' })

    // 删除
    await client.delete(`/api/v1/risks/${riskId}`).header('Authorization', `Bearer ${token}`)

    // 验证审计日志
    const logs = await AuditLog.query().where('entity_type', 'risk').where('entity_id', riskId)

    const events = logs.map((l) => l.metadata?.event).filter(Boolean)
    assert.include(events, 'RISK_CREATED')
    assert.include(events, 'RISK_UPDATED')
    assert.include(events, 'RISK_STATUS_CHANGED')
    assert.include(events, 'RISK_DELETED')
  })

  // ---------------- 跨组织隔离 ----------------

  test('跨组织访问返回 404', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('risk-cross-org') })
    const otherUser = await createUser({ email: uniqueEmail('risk-other-org') })
    const org = await createOrganization(owner)
    await createOrganization(otherUser)
    const { project } = await setupProject(org, owner)
    const otherToken = await login(client, otherUser)

    // 先创建一条风险
    const ownerToken = await login(client, owner)
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ title: '隔离风险', description: '描述' })
    const riskId = createRes.body().data.id

    // 其他组织用户访问
    const res = await client
      .get(`/api/v1/risks/${riskId}`)
      .header('Authorization', `Bearer ${otherToken}`)

    res.assertStatus(404)
  })
})
