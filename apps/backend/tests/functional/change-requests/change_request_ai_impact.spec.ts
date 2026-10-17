import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import type User from '#models/user'
import type { ApiClient } from '@japa/api-client'
import {
  STRONG_PASSWORD,
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

test.group('ChangeRequest AI 影响分析测试', (group) => {
  useAuthDatabase(group)

  test('AI 建议返回待确认状态，不自动覆盖人工内容', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-ai-impact') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 创建变更请求
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/change-requests`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: 'AI 影响测试', changeType: 'scope', priority: 'high' })
    const crId = createRes.body().data.id

    // 请求 AI 影响分析
    const aiRes = await client
      .post(`/api/v1/change-requests/${crId}/ai-impact`)
      .header('Authorization', `Bearer ${token}`)

    aiRes.assertStatus(200)
    const data = aiRes.body().data

    // 验证 AI 建议结构
    assert.isObject(data.suggestions)
    for (const key of ['scope', 'schedule', 'resources', 'cost', 'risks', 'assumptions']) {
      assert.property(data.suggestions, key, `suggestions 应包含 ${key}`)
    }
    assert.isNumber(data.confidence)
    assert.isAbove(data.confidence, 0)
    assert.isBelow(data.confidence, 1)
    assert.equal(data.source, 'ai_generated')
    assert.isArray(data.assumptions)
    assert.isAbove(data.assumptions.length, 0)
    assert.isTrue(data.needsConfirmation, 'AI 建议必须标记为待确认')
  })

  test('AI 建议不自动提交审批', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-ai-no-submit') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/change-requests`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: 'AI 不自动提交', changeType: 'schedule', priority: 'medium' })
    const crId = createRes.body().data.id

    // 请求 AI 影响分析
    await client
      .post(`/api/v1/change-requests/${crId}/ai-impact`)
      .header('Authorization', `Bearer ${token}`)

    // 验证状态仍为 draft（AI 不自动提交）
    const showRes = await client
      .get(`/api/v1/change-requests/${crId}`)
      .header('Authorization', `Bearer ${token}`)

    showRes.assertStatus(200)
    const data = showRes.body().data as { status: string }
    assert.equal(data.status, 'draft', 'AI 分析后状态应仍为 draft')
  })

  test('AI 建议不自动修改正式计划', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-ai-no-plan') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/change-requests`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: 'AI 不改计划', changeType: 'cost', priority: 'low' })
    const crId = createRes.body().data.id

    // 请求 AI 影响分析
    await client
      .post(`/api/v1/change-requests/${crId}/ai-impact`)
      .header('Authorization', `Bearer ${token}`)

    // 验证变更请求的 impactSummary 未被自动覆盖（应为 null）
    const showRes = await client
      .get(`/api/v1/change-requests/${crId}`)
      .header('Authorization', `Bearer ${token}`)

    showRes.assertStatus(200)
    const data = showRes.body().data as { impactSummary: string | null }
    assert.isNull(data.impactSummary, 'AI 分析后 impactSummary 应仍为 null')
  })

  test('未认证请求 AI 影响分析返回 401', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('cr-ai-noauth') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    const createRes = await client
      .post(`/api/v1/projects/${project.id}/change-requests`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '未认证测试', changeType: 'other' })
    const crId = createRes.body().data.id

    const res = await client.post(`/api/v1/change-requests/${crId}/ai-impact`)

    res.assertStatus(401)
  })

  test('跨组织请求 AI 影响分析返回 404', async ({ client }) => {
    const owner1 = await createUser({ email: uniqueEmail('cr-ai-org1') })
    const owner2 = await createUser({ email: uniqueEmail('cr-ai-org2') })
    const org1 = await createOrganization(owner1)
    const org2 = await createOrganization(owner2)
    const { project: project1 } = await createProjectWithMember(
      org1,
      owner1,
      owner1,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await createProjectWithMember(org2, owner2, owner2, ProjectRoleName.PROJECT_MANAGER)
    const token1 = await login(client, owner1)
    const token2 = await login(client, owner2)

    // 在 org1 创建变更请求
    const createRes = await client
      .post(`/api/v1/projects/${project1.id}/change-requests`)
      .header('Authorization', `Bearer ${token1}`)
      .json({ title: '跨组织测试', changeType: 'other' })
    const crId = createRes.body().data.id

    // org2 用户尝试请求 AI 影响分析
    const res = await client
      .post(`/api/v1/change-requests/${crId}/ai-impact`)
      .header('Authorization', `Bearer ${token2}`)

    res.assertStatus(404)
  })
})
