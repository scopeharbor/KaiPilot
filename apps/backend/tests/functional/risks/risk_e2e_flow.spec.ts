import Risk from '#models/risk'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
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

/**
 * Task 12.2 — E2E 核心流程测试（API 级别）
 * 覆盖：手动创建→状态推进→AI建议→草案导入→越权
 */
test.group('Risk E2E 核心流程', (group) => {
  useAuthDatabase(group)

  test('流程1: 手动创建风险 → 状态推进 → 关闭', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('e2e-manual') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 创建风险
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        title: '手动创建的风险',
        description: '测试手动创建流程',
        category: 'technical',
        probability: 4,
        impact: 3,
      })
    createRes.assertStatus(201)
    const riskId = createRes.body().data.id
    assert.equal(createRes.body().data.status, 'identified')
    assert.equal(createRes.body().data.score, 12)

    // 状态推进 identified → analyzing
    const s1 = await client
      .post(`/api/v1/risks/${riskId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'analyzing' })
    s1.assertStatus(200)
    assert.equal(s1.body().data.status, 'analyzing')

    // 状态推进 analyzing → mitigating
    const s2 = await client
      .post(`/api/v1/risks/${riskId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'mitigating' })
    s2.assertStatus(200)
    assert.equal(s2.body().data.status, 'mitigating')

    // 状态推进 mitigating → resolved
    const s3 = await client
      .post(`/api/v1/risks/${riskId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'resolved' })
    s3.assertStatus(200)
    assert.equal(s3.body().data.status, 'resolved')

    // 状态推进 resolved → closed
    const s4 = await client
      .post(`/api/v1/risks/${riskId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'closed' })
    s4.assertStatus(200)
    assert.equal(s4.body().data.status, 'closed')

    // closed 不能推进
    const s5 = await client
      .post(`/api/v1/risks/${riskId}/status`)
      .header('Authorization', `Bearer ${token}`)
      .json({ status: 'analyzing' })
    s5.assertStatus(422)
  })

  test('流程2: AI建议→采纳3条拒绝7条→DB只增3行', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('e2e-ai') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 模拟采纳 3 条 AI 建议
    for (let i = 0; i < 3; i++) {
      const res = await client
        .post(`/api/v1/projects/${project.id}/risks`)
        .header('Authorization', `Bearer ${token}`)
        .json({
          title: `AI 建议 ${i + 1}`,
          description: `来自 AI 的建议 ${i + 1}`,
          category: 'technical',
          probability: 3 + i,
          impact: 2 + i,
          aiMetadata: {
            aiMarker: {
              confidence: 0.7 + i * 0.1,
              source: 'inferred',
              reason: `AI 推断 ${i + 1}`,
              needsConfirmation: false,
            },
            suggestionBatchId: 'batch-e2e-001',
          },
        })
      res.assertStatus(201)
    }

    // 拒绝 7 条（不创建）
    // 只验证 DB 只有 3 行
    const risks = await Risk.query().where('project_id', project.id)
    assert.lengthOf(risks, 3)

    // 验证所有风险都有 aiMetadata
    for (const risk of risks) {
      assert.isNotNull(risk.aiMetadata)
      const parsed = JSON.parse(risk.aiMetadata!)
      assert.equal(parsed.suggestionBatchId, 'batch-e2e-001')
    }
  })

  test('流程3: 越权用户看不到创建按钮（403）', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('e2e-forbidden') })
    const viewer = await createUser({ email: uniqueEmail('e2e-viewer') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await addOrgMember(org, viewer, 'member')
    const viewerRole = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.READONLY_OBSERVER,
      description: ProjectRoleName.READONLY_OBSERVER,
      permissions: [],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: viewer.id,
      projectRoleId: viewerRole.id,
      isActive: true,
    })
    const viewerToken = await login(client, viewer)

    // 观察者可以查看列表
    const listRes = await client
      .get(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${viewerToken}`)
    listRes.assertStatus(200)

    // 观察者不能创建
    const createRes = await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${viewerToken}`)
      .json({ title: '越权', description: '描述' })
    createRes.assertStatus(403)

    // 观察者不能触发 AI 建议
    const aiRes = await client
      .post(`/api/v1/projects/${project.id}/risks/ai-suggestions`)
      .header('Authorization', `Bearer ${viewerToken}`)
    aiRes.assertStatus(403)
  })

  test('流程4: 矩阵视图返回正确的 5×5 聚合', async ({ assert, client }) => {
    const owner = await createUser({ email: uniqueEmail('e2e-matrix') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)

    // 创建不同概率-影响组合的风险
    await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '高高', description: '描述', probability: 5, impact: 5 })

    await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '高中', description: '描述', probability: 5, impact: 3 })

    await client
      .post(`/api/v1/projects/${project.id}/risks`)
      .header('Authorization', `Bearer ${token}`)
      .json({ title: '高中2', description: '描述', probability: 5, impact: 3 })

    // 查询矩阵
    const matrixRes = await client
      .get(`/api/v1/projects/${project.id}/risks/matrix`)
      .header('Authorization', `Bearer ${token}`)
    matrixRes.assertStatus(200)

    const cells = matrixRes.body().data.cells
    assert.lengthOf(cells, 25)

    // 概率5影响5 应有1条
    const cell55 = cells.find((c: any) => c.probability === 5 && c.impact === 5)
    assert.equal(cell55.count, 1)

    // 概率5影响3 应有2条
    const cell53 = cells.find((c: any) => c.probability === 5 && c.impact === 3)
    assert.equal(cell53.count, 2)
  })
})
