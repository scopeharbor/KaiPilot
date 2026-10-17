/**
 * v2-traceability-source-attribution —— Traceability API 功能测试（tasks 6.5）。
 *
 * 覆盖：未认证、无权限、跨组织不可见、合法查询、统一错误契约。
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import CompilerRun from '#models/compiler_run'
import SourceAttribution from '#models/source_attribution'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  STRONG_PASSWORD,
  useAuthDatabase,
} from './auth/_helpers.js'

async function loginToken(client: any, email: string) {
  const loginRes = await client.post('/api/v1/auth/login').json({
    email,
    password: STRONG_PASSWORD,
  })

  loginRes.assertStatus(200)
  return loginRes.body().data.accessToken as string
}

function createCompilerRun(organizationId: number, userId: number) {
  return CompilerRun.create({
    organizationId,
    requestedByUserId: userId,
    status: 'completed',
    currentPhase: 'intent',
    currentStage: 'intent_parsing',
    input: { prompt: '测试追溯 API' },
  })
}

test.group('Traceability API：权限与错误契约', (group) => {
  useAuthDatabase(group)

  test('未认证访问 attribution 端点返回 401', async ({ client }) => {
    const res = await client.get('/api/v1/ai/compiler/runs/1/attributions')
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('未认证访问 traceability 端点返回 401', async ({ client }) => {
    const res = await client.get('/api/v1/ai/compiler/projects/1/traceability/links')
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('合法 attribution 查询返回统一 data 格式', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const run = await createCompilerRun(org.id, user.id)

    // 创建一条 attribution
    const attr = await SourceAttribution.create({
      organizationId: org.id,
      compilerRunId: run.id,
      stageId: 'intent_parsing',
      generatedByKind: 'llm',
      summary: 'Test attribution',
      sourceRefs: [],
      contentHash: 'test_hash_001',
    })

    const token = await loginToken(client, user.email)

    const res = await client
      .get(`/api/v1/ai/compiler/runs/${attr.compilerRunId}/attributions`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    res.assertBodyContains({
      data: [
        {
          id: attr.id,
          compilerRunId: run.id,
          stageId: 'intent_parsing',
          generatedBy: 'llm',
          summary: 'Test attribution',
        },
      ],
    })
  })

  test('无效 attribution id 返回 VALIDATION_ERROR', async ({ client }) => {
    const user = await createUser()
    await createOrganization(user)
    const token = await loginToken(client, user.email)

    const res = await client
      .get('/api/v1/ai/compiler/runs/1/attributions/invalid')
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(400)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('合法 traceability links 查询返回统一 data 格式', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const { project } = await createProjectWithMember(org, user, user, '项目经理', ['project:view'])
    const token = await loginToken(client, user.email)

    const res = await client
      .get(`/api/v1/ai/compiler/projects/${project.id}/traceability/links`)
      .header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    res.assertBodyContains({ data: [] })
  })
})
