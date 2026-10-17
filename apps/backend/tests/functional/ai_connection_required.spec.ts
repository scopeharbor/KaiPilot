/**
 * v3-personal-edition-open-source-export §3.3 —— 没有可用 AI 连接时的统一提示。
 *
 * 组织没有任何 AI 连接、部署者也没有配置 OPENAI_API_KEY，且未显式放行 Mock 时：
 * - AI 草案生成：HTTP 503 `AI_SERVICE_ERROR`，`details.reason = AI_CONNECTION_REQUIRED`，不开流；
 * - AI 同事（流式回合）：`turn-error`，`errorKind = ai-connection-required`；
 * - 矛盾求解：HTTP 503 同一错误体，不出规则模板结果、不落库。
 * 三个入口都不调用任何模型（Mock 适配器调用次数为 0）。
 */
import { test } from '@japa/runner'
import env from '#start/env'
import TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import { MockAdapter } from '#services/ai_m0/mock_adapter'
import { ProjectRoleName } from '#rbac'
import {
  AI_CONNECTION_REQUIRED_MESSAGE,
  AI_CONNECTION_REQUIRED_REASON,
  AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND,
  AI_CONNECTION_SETTINGS_PATH,
} from '@aiproj/types'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const EXPECTED_ERROR = {
  error: {
    code: 'AI_SERVICE_ERROR',
    message: AI_CONNECTION_REQUIRED_MESSAGE,
    details: { reason: AI_CONNECTION_REQUIRED_REASON, settingsPath: AI_CONNECTION_SETTINGS_PATH },
  },
}

let mockCalls = 0

async function setupActor() {
  const owner = await createUser({ email: uniqueEmail('ai-conn-required') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

async function loginToken(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

test.group('没有可用 AI 连接时的统一提示', (group) => {
  useAuthDatabase(group)

  group.setup(() => {
    const previous = {
      allowMock: process.env.AI_ALLOW_MOCK,
      openaiKey: env.get('OPENAI_API_KEY'),
      trizRealAi: process.env.AIPROJ_TRIZ_ENABLE_REAL_AI,
    }
    process.env.AI_ALLOW_MOCK = 'false'
    env.set('OPENAI_API_KEY', '')
    process.env.AIPROJ_TRIZ_ENABLE_REAL_AI = 'true'
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }

    const originalStream = MockAdapter.prototype.stream
    MockAdapter.prototype.stream = function (this: MockAdapter, ...args) {
      mockCalls += 1
      return originalStream.apply(this, args)
    }

    return () => {
      MockAdapter.prototype.stream = originalStream
      env.set('OPENAI_API_KEY', previous.openaiKey ?? '')
      restore('AI_ALLOW_MOCK', previous.allowMock)
      restore('AIPROJ_TRIZ_ENABLE_REAL_AI', previous.trizRealAi)
    }
  })
  group.each.setup(() => {
    mockCalls = 0
  })

  test('AI 草案生成：提示先添加 AI 连接，不开流、不调用模型', async ({ client, assert }) => {
    const { owner } = await setupActor()
    const token = await loginToken(client, owner.email)
    const res = await client
      .post('/api/v1/ai/project-drafts/stream')
      .bearerToken(token)
      .json({
        context: {
          schemaVersion: '1.0',
          rawInput: '开发一个面向运营人员的内部审批系统，减少重复录入。',
          parsedIntent: {
            schemaVersion: '1.0',
            projectType: 'software',
            projectName: '内部审批系统',
            objectives: ['减少重复录入'],
            deliverables: [],
            timeline: { startDate: null, deadline: null, durationDays: null },
            constraints: [],
            entities: [],
            overallConfidence: 0.72,
          },
          resolvedFields: {},
          assumptions: {},
          unresolvedCriticalFields: [],
          unansweredOptionalFields: [],
        },
      })
    res.assertStatus(503)
    res.assertBody(EXPECTED_ERROR)
    assert.notInclude(String(res.header('content-type') ?? ''), 'text/event-stream')
    assert.equal(mockCalls, 0)
  })

  test('AI 同事：流式回合返回 ai-connection-required，不调用模型', async ({ client, assert }) => {
    const { owner, org } = await setupActor()
    const token = await loginToken(client, owner.email)
    const res = await client
      .post('/api/v1/copilot/turns/stream')
      .bearerToken(token)
      .json({
        sessionId: null,
        scope: 'global',
        attribution: { organizationId: org.id },
        text: '什么是项目的关键路径？',
        mentions: [],
      })
    res.assertStatus(200)
    const events = res
      .text()
      .split('\n\n')
      .map((block) => block.split('\n').find((line) => line.startsWith('data: ')))
      .filter((line): line is string => Boolean(line))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; errorKind?: string })
    const terminal = events.at(-1)
    assert.equal(terminal?.type, 'turn-error')
    assert.equal(terminal?.errorKind, AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND)
    assert.include(res.text(), AI_CONNECTION_REQUIRED_MESSAGE)
    assert.equal(mockCalls, 0)
  })

  test('矛盾求解：提示先添加 AI 连接，不出规则模板结果、不落库', async ({ client, assert }) => {
    const { owner, org, project } = await setupActor()
    const token = await loginToken(client, owner.email)
    const before = await TrizCopilotAnalysis.query().count('* as total')
    const res = await client
      .post(`/api/v1/projects/${project.id}/triz-copilot/analyses`)
      .header('Authorization', `Bearer ${token}`)
      .header('x-organization-id', String(org.id))
      .json({ statement: '客户催进度，但再加人测试就跟不上了' })
    res.assertStatus(503)
    res.assertBody(EXPECTED_ERROR)
    const after = await TrizCopilotAnalysis.query().count('* as total')
    assert.equal(Number(after[0].$extras.total), Number(before[0].$extras.total))
    assert.equal(mockCalls, 0)
  })
})
