// v3-triz-contradiction-copilot 任务 2.5 —— 干预落库两阶段确认与审计集成测试（W2b）。
//
// 覆盖（tasks 2.5 逐条 + spec「人工确认落库（预览—确认两阶段）」「反幻觉与低敏审计边界」）：
// 1. 预览阶段业务表零写入（tasks / risks / change_requests 行数不变）；
// 2. 携带 `previewToken` 确认 → 单事务落库（来源分析记录 / 方案序号 / 原则编号 / 确认人）
//    且令牌失效（复用同一令牌第二次确认被拒）；
// 3. 预览与确认之间目标数据被改 → 409 `SCHEDULE_STALE` 且业务数据零变更（两种改法各一例）；
// 4. 鉴权失败 / 越权 → `REJECTED` 审计事件，且零落库；
// 5. RL-12：AI 工具审计只含 `parametersHash` / 状态 / 耗时 / 错误码，不含陈述原文、prompt、
//    结果全文（逐字段断言）；
// 6. 三类落库目标（任务 / 风险 / 变更请求）各 ≥1 条端到端用例。
//
// 走真实 HTTP 链路（`POST /api/v1/ai/tools/execute` → `/confirm`），不直连 handler：
// 权限门、信封校验、RL-01 预览拦截与审计都由既有编排层施加（不新造执行通道）。
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { ApiClient } from '@japa/api-client'
import AuditLog from '#models/audit_log'
import ChangeRequest from '#models/change_request'
import Risk from '#models/risk'
import Task from '#models/task'
import TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import type User from '#models/user'
import { ProjectRoleName } from '#rbac'
import { TRIZ_MAPPING_LIMITS } from '#services/triz_copilot/triz_contradiction_mapping_service'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const API = '/api/v1'
const TOOLS = `${API}/ai/tools`
/** spec 场景陈述：规则路径可命中 14 对 PM 矛盾映射，且会绑定项目内的逾期任务。 */
const BASE_STATEMENT = '客户催进度，但再加人测试就跟不上了'

const TOOL_TASK = 'create_task_from_intervention'
const TOOL_RISK = 'create_risk_from_intervention'
const TOOL_CR = 'create_change_request_from_intervention'
const TOOL_ANALYZE = 'analyze_project_contradiction'

interface ApiUser {
  orgId: number
  token: string
}

function authed(client: ApiClient, session: ApiUser) {
  return {
    get: (url: string) =>
      client
        .get(url)
        .header('Authorization', `Bearer ${session.token}`)
        .header('x-organization-id', String(session.orgId)),
    post: (url: string) =>
      client
        .post(url)
        .header('Authorization', `Bearer ${session.token}`)
        .header('x-organization-id', String(session.orgId)),
  }
}

async function login(client: ApiClient, user: User): Promise<string> {
  const res = await client
    .post(`${API}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

async function tableCount(model: { query: () => any }): Promise<number> {
  const rows = (await model.query().count('* as total')) as unknown as Array<{
    $extras: { total: number | string }
  }>
  return Number(rows[0]?.$extras?.total ?? 0)
}

async function businessCounts(): Promise<{ tasks: number; risks: number; changeRequests: number }> {
  return {
    tasks: await tableCount(Task),
    risks: await tableCount(Risk),
    changeRequests: await tableCount(ChangeRequest),
  }
}

/** 逾期任务（规则路径的强锚点 ⇒ 方案会绑定 `task:<id>`，使绑定实体相关用例不空转）。 */
async function overdueTask(projectId: number, name = '逾期任务 A'): Promise<Task> {
  return Task.create({
    projectId,
    name,
    status: 'in_progress',
    priority: 'medium',
    taskType: 'task',
    startDate: DateTime.now().minus({ days: 10 }),
    endDate: DateTime.now().minus({ days: 3 }),
    durationDays: 8,
  })
}

function parseProvenance(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  if (value && typeof value === 'object') return value as Record<string, unknown>
  throw new Error('来源元数据缺失')
}

/** 一次完整求解：返回分析记录 ID 与 Top 3 方案（规则路径，零 Token）。 */
async function solve(
  client: ApiClient,
  session: ApiUser,
  projectId: number,
  statement = BASE_STATEMENT,
): Promise<{ analysisId: number; solutions: Array<{ index: number; principleNumber: number }> }> {
  const res = await authed(client, session)
    .post(`${API}/projects/${projectId}/triz-copilot/analyses`)
    .json({ statement })
  res.assertStatus(201)
  const data = (res.body() as { data: Record<string, any> }).data
  const drafts = data.solutions as Array<{
    index: number
    principle: { number: number }
  }>
  if (drafts.length === 0) {
    throw new Error('规则路径未产出方案，测试装配失败')
  }
  return {
    analysisId: Number(data.id),
    solutions: drafts.map((draft) => ({
      index: Number(draft.index),
      principleNumber: Number(draft.principle.number),
    })),
  }
}

async function executeTool(
  client: ApiClient,
  session: ApiUser,
  toolName: string,
  parameters: Record<string, unknown>,
) {
  return authed(client, session).post(`${TOOLS}/execute`).json({ toolName, parameters })
}

async function confirmTool(
  client: ApiClient,
  session: ApiUser,
  toolName: string,
  parameters: Record<string, unknown>,
  previewToken: string,
) {
  return authed(client, session)
    .post(`${TOOLS}/confirm`)
    .json({ toolName, parameters, previewToken })
}

test.group('TRIZ 干预落库两阶段确认（W2b）', (group) => {
  useAuthDatabase(group)

  async function setup(client: ApiClient) {
    const owner = await createUser({ email: uniqueEmail('triz-intervention-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    return { owner, org, project, session: { orgId: Number(org.id), token } as ApiUser }
  }

  test('预览阶段：三类写工具均返回 PREVIEW_REQUIRED + 64 位令牌 + 差异预览，业务表零写入', async ({
    client,
    assert,
  }) => {
    const { org, project, session } = await setup(client)
    await overdueTask(Number(project.id))
    const { analysisId } = await solve(client, session, Number(project.id))
    const parameters = { projectId: Number(project.id), analysisId, solutionIndex: 1 }
    const before = await businessCounts()

    for (const toolName of [TOOL_TASK, TOOL_RISK, TOOL_CR]) {
      const res = await executeTool(client, session, toolName, parameters)
      res.assertStatus(200)
      const body = res.body() as { data: Record<string, any>; meta: Record<string, any> }
      assert.equal(body.meta.status, 'PREVIEW_REQUIRED')
      assert.match(String(body.meta.previewToken), /^[0-9a-f]{64}$/)
      assert.isObject(body.data)
      assert.equal(body.data.operation, 'create')
      assert.isObject(body.data.entity)
      assert.equal(body.data.provenance.analysisId, analysisId)
      assert.equal(body.data.provenance.solutionIndex, 1)
      assert.isAtLeast(Number(body.data.provenance.principleNumber), 1)
      assert.equal(body.data.provenance.confirmedByUserId, Number(org.ownerId))
      assert.isArray(body.data.links)
      assert.isTrue(
        (body.data.notes as string[]).some((note) => note.includes('不自动执行')),
        '预览必须显式声明 AI 只建议不自动执行（RL-01）',
      )
      // 预览阶段业务表零写入
      assert.deepEqual(await businessCounts(), before)
    }

    // 预览不得泄漏 PM 陈述原文（RL-12）
    const preview = await executeTool(client, session, TOOL_TASK, parameters)
    assert.notInclude(preview.text(), BASE_STATEMENT)
  })

  test('任务目标端到端：确认后单事务落库并留痕，同一令牌不可复用', async ({ client, assert }) => {
    const { owner, org, project, session } = await setup(client)
    await overdueTask(Number(project.id))
    const { analysisId, solutions } = await solve(client, session, Number(project.id))
    const parameters = { projectId: Number(project.id), analysisId, solutionIndex: 1 }

    const preview = await executeTool(client, session, TOOL_TASK, parameters)
    preview.assertStatus(200)
    const previewBody = preview.body() as { data: Record<string, any>; meta: Record<string, any> }
    const token = String(previewBody.meta.previewToken)
    assert.equal(await tableCount(Task), 1, '预览不得建任务')

    const confirmed = await confirmTool(client, session, TOOL_TASK, parameters, token)
    confirmed.assertStatus(200)
    const confirmedBody = confirmed.body() as {
      data: Record<string, any>
      meta: Record<string, any>
    }
    assert.equal(confirmedBody.meta.committed, true)
    assert.equal(await tableCount(Task), 2)

    const created = await Task.query()
      .where('project_id', project.id)
      .orderBy('id', 'desc')
      .firstOrFail()
    assert.equal(created.name, previewBody.data.entity.name)
    assert.equal(created.status, 'not_started')
    assert.equal(created.priority, 'medium')
    assert.equal(created.taskType, 'task')
    assert.isNotNull(created.kanbanRank)
    // 描述含来源原则与命中参数（有界摘要），不含 PM 陈述原文（RL-12）
    assert.include(String(created.description), '由矛盾求解干预生成')
    assert.notInclude(String(created.description), BASE_STATEMENT)

    // 来源可追溯字段（spec 第 5 条）
    const provenance = parseProvenance(created.aiMetadata)
    assert.equal(provenance.analysisId, analysisId)
    assert.equal(provenance.solutionIndex, 1)
    assert.equal(provenance.principleNumber, solutions[0].principleNumber)
    assert.equal(provenance.confirmedByUserId, Number(owner.id))
    assert.equal(provenance.source, 'triz_intervention')
    assert.equal(confirmedBody.data.provenance.confirmedByUserId, Number(owner.id))

    // 令牌失效：复用同一令牌第二次确认被拒（409 SCHEDULE_STALE），且未二次落库
    const replay = await confirmTool(client, session, TOOL_TASK, parameters, token)
    replay.assertStatus(409)
    replay.assertBodyContains({ error: { code: 'SCHEDULE_STALE' } })
    assert.equal(await tableCount(Task), 2, '令牌复用不得产生第二条记录')

    // 确认审计可见（apply = 人工确认落库）
    const applyAudits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('action', 'apply')
    assert.isAtLeast(applyAudits.length, 1)
    assert.equal((applyAudits[0].metadata as Record<string, unknown>).toolName, TOOL_TASK)
  })

  test('风险目标端到端：确认后落库风险登记条目（单入口，零任务/变更写入）', async ({
    client,
    assert,
  }) => {
    const { project, session } = await setup(client)
    await overdueTask(Number(project.id))
    const { analysisId, solutions } = await solve(client, session, Number(project.id))
    const parameters = { projectId: Number(project.id), analysisId, solutionIndex: 1 }

    const preview = await executeTool(client, session, TOOL_RISK, parameters)
    preview.assertStatus(200)
    const diff = (preview.body() as { data: Record<string, any> }).data
    assert.equal(diff.target, 'risk')
    assert.equal(diff.entity.probability, 3)
    assert.equal(diff.entity.impact, 3)
    assert.equal(diff.entity.score, 9)
    assert.equal(diff.entity.status, 'identified')
    assert.equal(await tableCount(Risk), 0)

    const confirmed = await confirmTool(
      client,
      session,
      TOOL_RISK,
      parameters,
      String((preview.body() as { meta: Record<string, any> }).meta.previewToken),
    )
    confirmed.assertStatus(200)

    const risks = await Risk.query().where('project_id', project.id)
    assert.lengthOf(risks, 1)
    assert.equal(risks[0].score, 9)
    assert.equal(risks[0].category, 'other')
    assert.isNotEmpty(risks[0].riskLevel)
    const provenance = parseProvenance(risks[0].aiMetadata)
    assert.equal(provenance.analysisId, analysisId)
    assert.equal(provenance.principleNumber, solutions[0].principleNumber)
    // 只写风险表：任务与变更请求仍为初始状态
    assert.equal(await tableCount(Task), 1)
    assert.equal(await tableCount(ChangeRequest), 0)
  })

  test('变更请求目标端到端：确认后落库 draft 变更请求并带来源标注', async ({ client, assert }) => {
    const { owner, project, session } = await setup(client)
    await overdueTask(Number(project.id))
    const { analysisId } = await solve(client, session, Number(project.id))
    const parameters = { projectId: Number(project.id), analysisId, solutionIndex: 1 }

    const preview = await executeTool(client, session, TOOL_CR, parameters)
    preview.assertStatus(200)
    const diff = (preview.body() as { data: Record<string, any> }).data
    assert.match(String(diff.entity.crCode), /^CR-\d{4}-\d{4}$/)
    assert.equal(diff.entity.status, 'draft')
    assert.equal(await tableCount(ChangeRequest), 0)

    const confirmed = await confirmTool(
      client,
      session,
      TOOL_CR,
      parameters,
      String((preview.body() as { meta: Record<string, any> }).meta.previewToken),
    )
    confirmed.assertStatus(200)

    const records = await ChangeRequest.query().where('project_id', project.id)
    assert.lengthOf(records, 1)
    assert.equal(records[0].status, 'draft')
    assert.equal(records[0].crCode, diff.entity.crCode)
    assert.equal(records[0].requesterId, Number(owner.id))
    const provenance = parseProvenance(records[0].aiMetadata)
    assert.equal(provenance.analysisId, analysisId)
    assert.include(String(records[0].description), '由矛盾求解干预生成')
    // 变更请求：不自动提交（AI 只建议不执行，RL-01）
    assert.equal(records[0].status, 'draft')
    assert.equal(await tableCount(Task), 1)
    assert.equal(await tableCount(Risk), 0)
  })

  test('预览后源分析被改判 → 确认 409 SCHEDULE_STALE 且业务数据零变更', async ({
    client,
    assert,
  }) => {
    const { project, session } = await setup(client)
    await overdueTask(Number(project.id))
    const { analysisId } = await solve(client, session, Number(project.id))
    const parameters = { projectId: Number(project.id), analysisId, solutionIndex: 1 }

    const preview = await executeTool(client, session, TOOL_TASK, parameters)
    preview.assertStatus(200)
    const before = await businessCounts()

    // 预览与确认之间：源分析被人工改判（参数与候选原则重算）
    const override = await authed(client, session)
      .post(`${API}/projects/${project.id}/triz-copilot/analyses/${analysisId}/override`)
      .json({ improvingParameter: 39, worseningParameter: 27, contradictionType: 'technical' })
    override.assertStatus(200)

    const confirmed = await confirmTool(
      client,
      session,
      TOOL_TASK,
      parameters,
      String((preview.body() as { meta: Record<string, any> }).meta.previewToken),
    )
    confirmed.assertStatus(409)
    confirmed.assertBodyContains({ error: { code: 'SCHEDULE_STALE' } })
    // 回滚：业务数据零变更
    assert.deepEqual(await businessCounts(), before)
  })

  test('预览后绑定实体被改 → 确认 409 SCHEDULE_STALE 且业务数据零变更', async ({
    client,
    assert,
  }) => {
    const { project, session } = await setup(client)
    const bound = await overdueTask(Number(project.id))
    const { analysisId } = await solve(client, session, Number(project.id))
    const parameters = { projectId: Number(project.id), analysisId, solutionIndex: 1 }

    const preview = await executeTool(client, session, TOOL_TASK, parameters)
    preview.assertStatus(200)
    const diff = (preview.body() as { data: Record<string, any> }).data
    const boundLink = (diff.links as Array<{ ref: string }>).find((link) =>
      link.ref.startsWith('task:'),
    )
    assert.isDefined(boundLink, '本用例需要方案绑定项目实体（逾期任务）才有意义')
    const before = await businessCounts()

    // 预览与确认之间：被方案引用的任务被他人改名（字段级内容变化即视为目标被改）
    bound.name = '并发改名后的任务'
    await bound.save()

    const confirmed = await confirmTool(
      client,
      session,
      TOOL_TASK,
      parameters,
      String((preview.body() as { meta: Record<string, any> }).meta.previewToken),
    )
    confirmed.assertStatus(409)
    confirmed.assertBodyContains({ error: { code: 'SCHEDULE_STALE' } })
    assert.deepEqual(await businessCounts(), before)

    // 令牌形态非法（非 64 位十六进制）在信封层即被拒（422），绝不进入落库分支
    const malformed = await confirmTool(client, session, TOOL_TASK, parameters, 'not-a-token')
    malformed.assertStatus(422)
    malformed.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
    assert.deepEqual(await businessCounts(), before)
  })

  test('鉴权与越权：未认证 401；越权（缺 ai:confirm / 缺目标实体写权限）403 且 REJECTED 留痕', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, session } = await setup(client)
    await overdueTask(Number(project.id))
    const { analysisId } = await solve(client, session, Number(project.id))
    const parameters = { projectId: Number(project.id), analysisId, solutionIndex: 1 }
    const before = await businessCounts()

    // a) 未认证：401，零落库
    const anonymous = await client.post(`${TOOLS}/execute`).json({
      toolName: TOOL_TASK,
      parameters,
    })
    anonymous.assertStatus(401)
    anonymous.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
    assert.deepEqual(await businessCounts(), before)

    // b) 越权：项目成员（MEMBER）无 `risk:manage` ⇒ 风险写工具 403，且留 REJECTED 审计
    const member = await createUser({ email: uniqueEmail('triz-intervention-member') })
    await addOrgMember(org, member, 'member')
    await createProjectWithMember(org, owner, member, ProjectRoleName.MEMBER)
    const memberSession: ApiUser = { orgId: Number(org.id), token: await login(client, member) }

    const riskDenied = await executeTool(client, memberSession, TOOL_RISK, parameters)
    riskDenied.assertStatus(403)
    riskDenied.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
    assert.deepEqual(await businessCounts(), before)

    // c) 越权确认：MEMBER 有 `task:create` 但无 `ai:confirm` ⇒ 即便持有合法令牌也不能提交
    const preview = await executeTool(client, session, TOOL_TASK, parameters)
    preview.assertStatus(200)
    const token = String((preview.body() as { meta: Record<string, any> }).meta.previewToken)

    const confirmDenied = await confirmTool(client, memberSession, TOOL_TASK, parameters, token)
    confirmDenied.assertStatus(403)
    confirmDenied.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
    assert.deepEqual(await businessCounts(), before)

    // 拒绝留痕：action=reject 且 status=REJECTED（spec「反幻觉与低敏审计边界」第 4 条）
    const denials = await AuditLog.query()
      .where('organization_id', org.id)
      .where('action', 'reject')
    assert.isAtLeast(denials.length, 2)
    const rejected = denials.filter(
      (row) => (row.metadata as Record<string, unknown>).status === 'REJECTED',
    )
    assert.isAtLeast(rejected.length, 2)
    for (const row of rejected) {
      const metadata = row.metadata as Record<string, unknown>
      assert.equal(metadata.errorCode, 'PERMISSION_DENIED')
      assert.isNotNull(row.userId)
      assert.isNotNull(row.organizationId)
    }
  })

  test('RL-12：AI 工具审计只含 parametersHash / 状态 / 耗时 / 错误码，不含陈述原文与结果全文', async ({
    client,
    assert,
  }) => {
    const { project, session } = await setup(client)
    await overdueTask(Number(project.id))

    // 全链路：求解（只读工具）→ 预览 → 确认
    const analyze = await executeTool(client, session, TOOL_ANALYZE, {
      projectId: Number(project.id),
      statement: BASE_STATEMENT,
    })
    analyze.assertStatus(200)
    const analysisId = Number((analyze.body() as { data: Record<string, any> }).data.analysis.id)
    const parameters = { projectId: Number(project.id), analysisId, solutionIndex: 1 }

    const preview = await executeTool(client, session, TOOL_TASK, parameters)
    preview.assertStatus(200)
    const diff = (preview.body() as { data: Record<string, any> }).data
    const confirmed = await confirmTool(
      client,
      session,
      TOOL_TASK,
      parameters,
      String((preview.body() as { meta: Record<string, any> }).meta.previewToken),
    )
    confirmed.assertStatus(200)

    // 逐字段断言：AI 工具审计（ai_generate / apply / reject）只有低敏字段
    const aiAudits = await AuditLog.query()
      .where('project_id', project.id)
      .whereIn('action', ['ai_generate', 'apply', 'reject'])
    assert.isAtLeast(aiAudits.length, 3)

    const allowedKeys = new Set([
      'toolName',
      'parametersHash',
      'status',
      'durationMs',
      'errorCode',
      'event',
    ])
    let strictRows = 0
    for (const row of aiAudits) {
      const metadata = row.metadata as Record<string, unknown>
      assert.match(String(metadata.parametersHash), /^[0-9a-f]{64}$/)
      assert.isString(metadata.toolName)
      assert.isString(metadata.status)
      assert.isNumber(metadata.durationMs)
      assert.isTrue(metadata.errorCode === null || typeof metadata.errorCode === 'string')

      const serialized = JSON.stringify(metadata)
      // 禁存全文：PM 陈述原文 / prompt / 结果数据集（所有审计行一视同仁）
      assert.notInclude(serialized, BASE_STATEMENT)
      assert.notMatch(serialized, /prompt/i)
      assert.notInclude(serialized, '由矛盾求解干预生成', '审计不得存落库产物正文')
      assert.notInclude(serialized, String(diff.entity.name), '审计不得存方案/结果全文')

      // 编排层写入的 AI 工具审计：字段集严格等于 RL-12 低敏白名单
      // （W2a 对话流服务另记 path / contradictionType 等**枚举类**低敏码，属其自身口径，不计入本断言）
      if (metadata.toolName === TOOL_TASK) {
        strictRows += 1
        for (const key of Object.keys(metadata)) {
          assert.isTrue(allowedKeys.has(key), `审计字段「${key}」不在 RL-12 低敏白名单内`)
        }
      }
    }
    assert.isAtLeast(strictRows, 2, '预览与确认各留一条工具审计')

    // 落库记录本身也不含陈述原文
    const created = await Task.query()
      .where('project_id', project.id)
      .orderBy('id', 'desc')
      .firstOrFail()
    assert.notInclude(JSON.stringify(created.toJSON()), BASE_STATEMENT)
    const record = await TrizCopilotAnalysis.query().where('id', analysisId).firstOrFail()
    assert.notInclude(JSON.stringify(record.toJSON()), BASE_STATEMENT)
  })

  test('只读工具端到端：get_triz_analysis 读回映射依据；跨组织一律 404（RL-05）', async ({
    client,
    assert,
  }) => {
    const { org, project, session } = await setup(client)
    await overdueTask(Number(project.id))

    const analyze = await executeTool(client, session, TOOL_ANALYZE, {
      projectId: Number(project.id),
      statement: BASE_STATEMENT,
    })
    analyze.assertStatus(200)
    const analyzeData = (analyze.body() as { data: Record<string, any> }).data
    const analysisId = Number(analyzeData.analysis.id)
    // 只读工具不得回显陈述原文；规则路径零 Token
    assert.notInclude(analyze.text(), BASE_STATEMENT)
    assert.equal(analyzeData.modelUsage.providerCalls, 0)

    const show = await executeTool(client, session, 'get_triz_analysis', {
      projectId: Number(project.id),
      analysisId,
    })
    show.assertStatus(200)
    const detail = (show.body() as { data: Record<string, any> }).data
    assert.equal(detail.id, analysisId)
    assert.include(['ai', 'rule'], detail.path)
    assert.isAtLeast(detail.candidatePrinciples.length, 1)
    assert.isNotEmpty(detail.candidatePrinciples[0].definition)
    assert.isAtLeast(detail.topSolutions.solutions.length, 1)
    assert.equal(detail.budget.tokenBudget, TRIZ_MAPPING_LIMITS.runTokenBudget)
    assert.isFalse(detail.humanOverride)

    // 跨组织：另一组织用户读同一分析记录 → 404（不泄露存在性）
    const outsider = await createUser({ email: uniqueEmail('triz-intervention-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    const outsiderSession: ApiUser = {
      orgId: Number(outsiderOrg.id),
      token: await login(client, outsider),
    }
    const foreign = await executeTool(client, outsiderSession, 'get_triz_analysis', {
      projectId: Number(project.id),
      analysisId,
    })
    foreign.assertStatus(404)
    foreign.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
    assert.notInclude(foreign.text(), String(org.name))
  })
})
