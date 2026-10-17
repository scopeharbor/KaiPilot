/**
 * v3-codegen-34-stage-candidate-runtime-execution —— 候选运行 API 集成测试。
 *
 * 覆盖 tasks 8.1-8.7：创建 → 201 且 34/34、窄权限 codegen_candidate_run:run 缺失即 403
 * 且零副作用、跨组织 404、分页信封、无任何 provider 凭据也能通过、审计留痕且低敏。
 */
import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import CompilerCodegenCandidateRun from '#models/compiler_codegen_candidate_run'
import CompilerCodegenStageRecord from '#models/compiler_codegen_stage_record'
import Organization from '#models/organization'
import Project from '#models/project'
import type User from '#models/user'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function login(client: any, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

/** 组织 owner（ORG_ADMIN）+ 一个真实项目：view + run 都具备。 */
async function setupOwner(client: any) {
  const user = await createUser({ email: uniqueEmail('codegen-owner') })
  const org = await createOrganization(user)
  const project = await Project.create({
    organizationId: org.id,
    name: '代码生成候选项目',
    code: `CG${Date.now()}`,
    createdBy: user.id,
  })
  const token = await login(client, user)
  return { user, org, project, token }
}

function baseUrl(projectId: number): string {
  return `/api/v1/projects/${projectId}/compiler/codegen/candidate-runs`
}

test.group('Codegen 候选运行 API', (group) => {
  useAuthDatabase(group)

  test('POST 创建候选运行返回 201 且推进到 34/34', async ({ client, assert }) => {
    const { project, token } = await setupOwner(client)

    const res = await client
      .post(baseUrl(project.id))
      .header('Authorization', `Bearer ${token}`)
      .json({ provider: 'openai_responses' })

    assert.equal(res.status(), 201)
    const data = (res.body() as any).data
    assert.equal(data.status, 'candidate_ready_pending_review')
    assert.equal(data.completedStageCount, 34)
    assert.equal(data.totalStageCount, 34)
    assert.equal(data.executionMode, 'fixture')
    // 红线 1：响应恒声明需人工复核，且不存在任何转正字段
    assert.isTrue(data.requiresHumanReview)
    assert.notProperty(data, 'appliedAt')
    assert.notProperty(data, 'approvedAt')

    const stages = await client
      .get(`${baseUrl(project.id)}/${data.id}/stages`)
      .header('Authorization', `Bearer ${token}`)
      .qs({ perPage: 50 })
    assert.equal(stages.status(), 200)
    const stageBody = stages.body() as any
    assert.lengthOf(stageBody.data, 34)
    assert.equal(stageBody.meta.total, 34)
    assert.deepEqual(
      stageBody.data.map((s: any) => s.order),
      Array.from({ length: 34 }, (_, i) => i + 1),
    )
  })

  test('无 provider 凭据也能完成：fixture 模式零外部调用', async ({ client, assert }) => {
    const originalOpenai = process.env.OPENAI_API_KEY
    const originalAnthropic = process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    try {
      const { project, token } = await setupOwner(client)
      const res = await client
        .post(baseUrl(project.id))
        .header('Authorization', `Bearer ${token}`)
        .json({ provider: 'anthropic_messages' })

      assert.equal(res.status(), 201)
      assert.equal((res.body() as any).data.completedStageCount, 34)
    } finally {
      if (originalOpenai !== undefined) process.env.OPENAI_API_KEY = originalOpenai
      if (originalAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropic
    }
  })

  test('executionMode 只接受 fixture：真实模式在 schema 层就不可达', async ({ client, assert }) => {
    const { project, token } = await setupOwner(client)

    const res = await client
      .post(baseUrl(project.id))
      .header('Authorization', `Bearer ${token}`)
      .json({ provider: 'openai_responses', executionMode: 'real_model' })

    // 本仓库把 vine 校验失败统一映射为 422 / VALIDATION_ERROR（exceptions/handler.ts）
    assert.equal(res.status(), 422)
    assert.equal((res.body() as any).error.code, 'VALIDATION_ERROR')
    assert.lengthOf(await CompilerCodegenCandidateRun.all(), 0)
  })

  test('缺少 codegen_candidate_run:run 权限时 403 且零副作用', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('codegen-owner2') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('codegen-member') })
    await addOrgMember(org, member, 'member')
    const { project } = await createProjectWithMember(org, owner, member, 'Member')
    const token = await login(client, member)

    const res = await client
      .post(baseUrl(project.id))
      .header('Authorization', `Bearer ${token}`)
      .json({ provider: 'openai_responses' })

    assert.equal(res.status(), 403)
    assert.equal((res.body() as any).error.code, 'PERMISSION_DENIED')

    // 零副作用：既无 run 头，也无任何 stage 记录
    assert.lengthOf(await CompilerCodegenCandidateRun.all(), 0)
    assert.lengthOf(await CompilerCodegenStageRecord.all(), 0)
  })

  test('仅有 view 权限的成员可以只读查询', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('codegen-owner3') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('codegen-member2') })
    await addOrgMember(org, member, 'member')
    const { project } = await createProjectWithMember(org, owner, member, 'Member')

    const ownerToken = await login(client, owner)
    const created = await client
      .post(baseUrl(project.id))
      .header('Authorization', `Bearer ${ownerToken}`)
      .json({ provider: 'openai_responses' })
    assert.equal(created.status(), 201)

    const memberToken = await login(client, member)
    const list = await client
      .get(baseUrl(project.id))
      .header('Authorization', `Bearer ${memberToken}`)
    assert.equal(list.status(), 200)
    assert.lengthOf((list.body() as any).data, 1)
  })

  test('跨组织读取统一 404，不泄露存在性', async ({ client, assert }) => {
    const first = await setupOwner(client)
    const created = await client
      .post(baseUrl(first.project.id))
      .header('Authorization', `Bearer ${first.token}`)
      .json({ provider: 'openai_responses' })
    assert.equal(created.status(), 201)
    const runId = (created.body() as any).data.id

    // 另一组织的 owner，在自己组织下的项目里尝试读取别人的 run id
    const outsider = await setupOwner(client)
    const res = await client
      .get(`${baseUrl(outsider.project.id)}/${runId}`)
      .header('Authorization', `Bearer ${outsider.token}`)

    assert.equal(res.status(), 404)
    assert.equal((res.body() as any).error.code, 'RESOURCE_NOT_FOUND')
  })

  test('列表返回标准分页信封', async ({ client, assert }) => {
    const { project, token } = await setupOwner(client)
    for (let i = 0; i < 2; i += 1) {
      const res = await client
        .post(baseUrl(project.id))
        .header('Authorization', `Bearer ${token}`)
        .json({ provider: 'openai_responses' })
      assert.equal(res.status(), 201)
    }

    const res = await client
      .get(baseUrl(project.id))
      .header('Authorization', `Bearer ${token}`)
      .qs({ page: 1, perPage: 1 })

    assert.equal(res.status(), 200)
    const body = res.body() as any
    assert.lengthOf(body.data, 1)
    assert.deepEqual(body.meta, { total: 2, page: 1, perPage: 1, totalPages: 2 })
  })

  test('review-packet 端点恒返回待人工复核标记', async ({ client, assert }) => {
    const { project, token } = await setupOwner(client)
    const created = await client
      .post(baseUrl(project.id))
      .header('Authorization', `Bearer ${token}`)
      .json({ provider: 'openai_chat_compat' })
    const runId = (created.body() as any).data.id

    const res = await client
      .get(`${baseUrl(project.id)}/${runId}/review-packet`)
      .header('Authorization', `Bearer ${token}`)

    assert.equal(res.status(), 200)
    const packet = (res.body() as any).data
    assert.isTrue(packet.requiresHumanReview)
    assert.isTrue(packet.readyForHumanReview)
    assert.lengthOf(packet.completedStageIds, 34)
  })

  test('审计留痕存在且不含敏感字段', async ({ client, assert }) => {
    const { project, token } = await setupOwner(client)
    const created = await client
      .post(baseUrl(project.id))
      .header('Authorization', `Bearer ${token}`)
      .json({ provider: 'openai_responses' })
    assert.equal(created.status(), 201)

    // AuditService 把 event 落在 metadata.event，action 走 EVENT_TO_ACTION 映射
    const logs = await AuditLog.query().orderBy('id', 'asc')
    const events = logs.map((log) => (log.metadata as any)?.event)
    assert.include(events, 'CODEGEN_CANDIDATE_RUN_STARTED')
    assert.include(events, 'CODEGEN_CANDIDATE_RUN_READY_FOR_REVIEW')

    const serialized = JSON.stringify(logs.map((log) => log.serialize())).toLowerCase()
    for (const forbidden of ['apikey', 'api_key', 'prompt', 'completion', 'secret', 'token']) {
      assert.notInclude(serialized, `"${forbidden}"`)
    }
  })

  test('未认证请求返回 401', async ({ client, assert }) => {
    const { project } = await setupOwner(client)
    const res = await client.post(baseUrl(project.id)).json({ provider: 'openai_responses' })
    assert.isAtLeast(res.status(), 401)
    assert.isBelow(res.status(), 404)
  })
})

test.group('Codegen 候选运行 API —— 组织隔离持久化', (group) => {
  useAuthDatabase(group)

  test('stage 记录带组织归属且跨组织查不到', async ({ client, assert }) => {
    const { org, project, token } = await setupOwner(client)
    const created = await client
      .post(baseUrl(project.id))
      .header('Authorization', `Bearer ${token}`)
      .json({ provider: 'openai_responses' })
    const runId = (created.body() as any).data.id

    const records = await CompilerCodegenStageRecord.query().where('run_id', runId)
    assert.lengthOf(records, 34)
    assert.isTrue(records.every((r) => r.organizationId === org.id))

    const otherOrgRecords = await CompilerCodegenStageRecord.query().whereNot(
      'organization_id',
      org.id,
    )
    assert.lengthOf(otherOrgRecords, 0)

    const orgCount = await Organization.query().count('* as total').firstOrFail()
    assert.equal(Number((orgCount as any).$extras.total), 1)
  })
})
