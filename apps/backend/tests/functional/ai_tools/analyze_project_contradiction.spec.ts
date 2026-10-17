// v3-triz-copilot-followups 任务 1.2 / 1.3 —— AI 工具 analyze_project_contradiction 透传集成测试。
//
// 覆盖：
// - 传入合法 sourceSignalId 时正确透传至底层的 TrizCopilotAnalysisService.solve；
// - 返回结果与数据库落库记录中均包含 sourceSignalId；
// - 未传 sourceSignalId 时正常执行且 sourceSignalId 为 null；
// - 传入不存在或非法的 sourceSignalId 时阻断。
import type { ApiClient } from '@japa/api-client'
import ProjectSignal from '#models/project_signal'
import TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import { ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME } from '#services/ai_tools/handlers/analyze_project_contradiction'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

const API = '/api/v1'
const TOOLS = `${API}/ai/tools`
const BASE_STATEMENT = '客户催进度，但再加人测试就跟不上了'

async function login(client: ApiClient, user: any): Promise<string> {
  const res = await client
    .post(`${API}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

function authed(client: ApiClient, token: string, orgId: number) {
  return {
    post: (url: string) =>
      client
        .post(url)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(orgId)),
  }
}

async function executeTool(
  client: ApiClient,
  session: { orgId: number; token: string },
  toolName: string,
  parameters: Record<string, unknown>,
) {
  return authed(client, session.token, session.orgId)
    .post(`${TOOLS}/execute`)
    .json({ toolName, parameters })
}

test.group('AI 工具 analyze_project_contradiction 透传', (group) => {
  useAuthDatabase(group)

  async function setup(client: ApiClient) {
    const owner = await createUser({ email: uniqueEmail('analyze-contra-owner') })
    const org = await createOrganization(owner)
    const { project, role } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    return { owner, org, project, role, session: { orgId: Number(org.id), token } }
  }

  test('工具透传：合法 sourceSignalId 成功传递并落库', async ({ client, assert }) => {
    const { owner, org, project, session } = await setup(client)

    const signal = await ProjectSignal.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      signalType: 'progress_deviation',
      confidenceTier: 'low',
      tierReasons: { scheduleMargin: 0.15 },
      severity: 'warning',
      evidence: { metric: 'schedule_delay_days', currentValue: 8, threshold: 5 },
      idempotencyKey: 'test-ai-tool-sig-1',
      observationWindow: '2026-09-01..2026-09-07',
      expiresAt: DateTime.fromISO('2026-09-21T23:59:59.000Z'),
      status: 'open',
      previousStatus: null,
      statusChangedBy: null,
      statusChangedAt: null,
      adoptedAnalysisId: null,
      createdBy: Number(owner.id),
      deletedAt: null,
    })

    const res = await executeTool(client, session, ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME, {
      projectId: Number(project.id),
      statement: BASE_STATEMENT,
      sourceSignalId: Number(signal.id),
    })

    res.assertStatus(200)
    const body = res.body() as { data: Record<string, any> }
    const result = body.data
    assert.equal(result.analysis.sourceSignalId, signal.id)

    const record = await TrizCopilotAnalysis.findOrFail(result.analysis.id)
    assert.equal(record.sourceSignalId, signal.id)
  })

  test('工具透传：不传 sourceSignalId 时正常执行且 sourceSignalId 为 null', async ({
    client,
    assert,
  }) => {
    const { project, session } = await setup(client)

    const res = await executeTool(client, session, ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME, {
      projectId: Number(project.id),
      statement: BASE_STATEMENT,
    })

    res.assertStatus(200)
    const body = res.body() as { data: Record<string, any> }
    const result = body.data
    assert.isNull(result.analysis.sourceSignalId)
  })

  test('工具透传：不存在的 sourceSignalId 阻断执行并返回错误', async ({ client }) => {
    const { project, session } = await setup(client)

    const res = await executeTool(client, session, ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME, {
      projectId: Number(project.id),
      statement: BASE_STATEMENT,
      sourceSignalId: 999999,
    })

    // 422 校验失败
    res.assertStatus(422)
  })
})
