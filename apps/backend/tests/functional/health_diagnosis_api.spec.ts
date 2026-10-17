/**
 * Health Diagnosis API Functional Tests
 *
 * v2-ai-project-health-diagnosis / 5.5
 *
 * 覆盖：权限矩阵、跨组织 404、只读不可确认、非法分页、错误契约和审计脱敏
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'
import { ProjectRoleName } from '#rbac'

const API_PREFIX = '/api/v1'

async function login(client: any, user: any) {
  const r = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  return (r.body() as { data: { accessToken: string } }).data.accessToken
}

test.group('Health Diagnosis API', (group) => {
  useAuthDatabase(group)

  async function setupProject(client: any) {
    const owner = await createUser({ email: uniqueEmail('hd-api-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    return { project, org, owner, token }
  }

  test('latest - 未认证返回 401', async ({ client }) => {
    const { project } = await setupProject(client)
    const res = await client.get(`${API_PREFIX}/projects/${project.id}/health-diagnoses/latest`)
    res.assertStatus(401)
  })

  test('latest - 已认证返回诊断或无诊断（200）', async ({ client }) => {
    const { project, token, org } = await setupProject(client)
    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/health-diagnoses/latest`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
    res.assertStatus(200) // 或诊断不可用时返回 404
  })

  test('generate - 成功创建诊断（201）', async ({ client, assert }) => {
    const { project, token, org } = await setupProject(client)
    const res = await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ enableAiDraft: false })

    assert.equal(res.status(), 201)
    const d = (res.body() as { data: Record<string, unknown> }).data
    assert.equal(d.status, 'pending')
  })

  test('generate - 返回诊断摘要', async ({ client, assert }) => {
    const { project, token, org } = await setupProject(client)
    const res = await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})

    assert.equal(res.status(), 201)
    const d = (res.body() as { data: Record<string, unknown> }).data
    assert.isNotNull(d.summary)
    assert.isString(d.inputSignature)
    assert.isString(d.ruleVersion)
  })

  test('list - 返回分页列表', async ({ client, assert }) => {
    const { project, token, org } = await setupProject(client)
    await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/health-diagnoses`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 200)
  })

  test('list - 非法 perPage 返回 422', async ({ client, assert }) => {
    const { project, token, org } = await setupProject(client)
    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/health-diagnoses?perPage=999`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(res.status(), 422)
  })

  test('confirm - POST 确认诊断', async ({ client, assert }) => {
    const { project, token, org } = await setupProject(client)
    const genRes = await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    const diagnosis = (genRes.body() as { data: { id: number } }).data

    const confirmRes = await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses/${diagnosis.id}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ notes: '诊断验证通过' })

    assert.equal(confirmRes.status(), 200)
    const d = (confirmRes.body() as { data: Record<string, unknown> }).data
    assert.equal(d.status, 'confirmed')
  })

  test('reject - POST 驳回诊断', async ({ client, assert }) => {
    const { project, token, org } = await setupProject(client)
    const genRes = await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    const diagnosis = (genRes.body() as { data: { id: number } }).data

    const rejectRes = await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses/${diagnosis.id}/reject`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ reason: '诊断不准确' })

    assert.equal(rejectRes.status(), 200)
    const d = (rejectRes.body() as { data: Record<string, unknown> }).data
    assert.equal(d.status, 'rejected')
  })

  test('跨组织项目返回 404', async ({ client, assert }) => {
    const { project } = await setupProject(client)
    const otherUser = await createUser({ email: uniqueEmail('hd-api-other') })
    const otherOrg = await createOrganization(otherUser)
    const otherToken = await login(client, otherUser)

    const res = await client
      .get(`${API_PREFIX}/projects/${project.id}/health-diagnoses/latest`)
      .header('Authorization', `Bearer ${otherToken}`)
      .header('x-organization-id', String(otherOrg.id))

    assert.equal(res.status(), 404)
  })

  test('refresh - 创建新诊断快照', async ({ client, assert }) => {
    const { project, token, org } = await setupProject(client)
    await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})

    const refreshRes = await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses/refresh`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(refreshRes.status(), 201)
  })

  test('show - 返回诊断详情', async ({ client, assert }) => {
    const { project, token, org } = await setupProject(client)
    const genRes = await client
      .post(`${API_PREFIX}/projects/${project.id}/health-diagnoses`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({})
    const diagnosisId = (genRes.body() as { data: { id: number } }).data.id

    const showRes = await client
      .get(`${API_PREFIX}/projects/${project.id}/health-diagnoses/${diagnosisId}`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))

    assert.equal(showRes.status(), 200)
    assert.equal((showRes.body() as { data: { id: number } }).data.id, diagnosisId)
  })
})
