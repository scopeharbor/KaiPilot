// v3-triz-contradiction-copilot tasks 2.2 / 2.3 —— 矛盾求解对话流集成测试。
//
// 覆盖（tasks 2.2 验收 + spec「对话求解的 RBAC 与组织隔离」「映射依据可查看与可改判」
// 「澄清轮次与自主权预算硬上限」「反幻觉与低敏审计边界」）：
// - 认证 401 / 越权 403（且零落库、拒绝留痕）/ 跨组织 404（统一不泄露存在性）/ 入参 422；
// - 受理求解：规则路径（真实模型默认关闭）零 provider 调用 + 低敏落库（无陈述原文 / prompt / 输出全文）；
// - 列表统一 `{ data, meta }` 信封；详情返回映射依据（参数名 / 候选原则定义 / 预算快照）；
// - 改判：重算候选原则与 Top 3、置人工改判、产生审计事件、**业务数据零变更**（任务 / 风险 / 变更 / 矛盾表计数不变）；
// - 预算：请求体试图上调预算被忽略（token_budget 仍为默认上限 TRIZ_MAPPING_LIMITS.runTokenBudget）；澄清链第 3 轮被拒绝并返回中间成果与中文原因。
import AuditLog from '#models/audit_log'
import ChangeRequest from '#models/change_request'
import ProjectContradiction from '#models/project_contradiction'
import Risk from '#models/risk'
import Task from '#models/task'
import ProjectSignal from '#models/project_signal'
import TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import { ProjectRoleName } from '#rbac'
import { TRIZ_MAPPING_LIMITS } from '#services/triz_copilot/triz_contradiction_mapping_service'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const API_PREFIX = '/api/v1'

/** spec「AI-as-ARIZ 后台语义映射」场景陈述（规则路径可命中 14 对 PM 矛盾映射）。 */
const BASE_STATEMENT = '客户催进度，但再加人测试就跟不上了'
/** 信息不足的陈述（规则路径给出中性「信息不足」草案 ⇒ 需要澄清）。 */
const VAGUE_STATEMENT = '项目有点问题，说不清楚'

function endpoint(projectId: number, suffix = ''): string {
  return `${API_PREFIX}/projects/${projectId}/triz-copilot/analyses${suffix}`
}

async function login(client: any, user: any): Promise<string> {
  const res = await client
    .post(`${API_PREFIX}/auth/login`)
    .json({ email: user.email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return (res.body() as { data: { accessToken: string } }).data.accessToken
}

function authed(client: any, token: string, orgId: number) {
  return {
    get: (url: string) =>
      client
        .get(url)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(orgId)),
    post: (url: string) =>
      client
        .post(url)
        .header('Authorization', `Bearer ${token}`)
        .header('x-organization-id', String(orgId)),
  }
}

async function tableCount(model: { query: () => any }): Promise<number> {
  const rows = (await model.query().count('* as total')) as unknown as Array<{
    $extras: { total: number | string }
  }>
  return Number(rows[0]?.$extras?.total ?? 0)
}

async function analysisCount(): Promise<number> {
  return tableCount(TrizCopilotAnalysis)
}

async function businessTableCounts(): Promise<Record<string, number>> {
  return {
    tasks: await tableCount(Task),
    risks: await tableCount(Risk),
    changeRequests: await tableCount(ChangeRequest),
    contradictions: await tableCount(ProjectContradiction),
  }
}

test.group('TRIZ 矛盾求解对话流 API', (group) => {
  useAuthDatabase(group)

  async function setup(client: any) {
    const owner = await createUser({ email: uniqueEmail('triz-copilot-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const token = await login(client, owner)
    return { owner, org, project, token }
  }

  test('未认证发起求解返回 401', async ({ client }) => {
    const owner = await createUser({ email: uniqueEmail('triz-copilot-anon') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const res = await client.post(endpoint(Number(project.id))).json({ statement: BASE_STATEMENT })
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('无 ai:trigger 权限返回 403，零落库且拒绝留痕', async ({ client, assert }) => {
    const { owner, org, project } = await setup(client)
    const viewer = await createUser({ email: uniqueEmail('triz-copilot-viewer') })
    await addOrgMember(org, viewer, 'viewer')
    await createProjectWithMember(org, owner, viewer, ProjectRoleName.READONLY_OBSERVER)
    const token = await login(client, viewer)

    const res = await authed(client, token, Number(org.id))
      .post(endpoint(Number(project.id)))
      .json({
        statement: BASE_STATEMENT,
      })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    assert.equal(await analysisCount(), 0)

    const denials = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('action', 'reject')
    assert.isAtLeast(denials.length, 1)
    assert.equal((denials[0].metadata as Record<string, unknown>).status, 'REJECTED')
  })

  test('跨组织访问统一 404（不泄露存在性）', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const outsider = await createUser({ email: uniqueEmail('triz-copilot-outsider') })
    const outsiderOrg = await createOrganization(outsider)
    const outsiderToken = await login(client, outsider)

    const solve = await authed(client, outsiderToken, Number(outsiderOrg.id))
      .post(endpoint(Number(project.id)))
      .json({ statement: BASE_STATEMENT })
    solve.assertStatus(404)
    solve.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
    assert.notInclude(solve.text(), String(project.name))

    // 组织内的分析记录对另一组织同样不可见
    const created = await authed(client, token, Number(org.id))
      .post(endpoint(Number(project.id)))
      .json({ statement: BASE_STATEMENT })
    created.assertStatus(201)
    const analysisId = (created.body() as { data: { id: number } }).data.id

    const foreignShow = await authed(client, outsiderToken, Number(outsiderOrg.id)).get(
      endpoint(Number(project.id), `/${analysisId}`),
    )
    foreignShow.assertStatus(404)
    foreignShow.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  test('入参非法返回 422（统一错误体）', async ({ client }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const missing = await api.post(endpoint(Number(project.id))).json({})
    missing.assertStatus(422)
    missing.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })

    const wrongType = await api.post(endpoint(Number(project.id))).json({ statement: 12345 })
    wrongType.assertStatus(422)
    wrongType.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('受理求解：规则路径零模型调用 + 低敏落库（无陈述原文）', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const res = await authed(client, token, Number(org.id))
      .post(endpoint(Number(project.id)))
      .json({ statement: BASE_STATEMENT })

    res.assertStatus(201)
    const data = (res.body() as { data: Record<string, any> }).data

    assert.equal(data.path, 'rule')
    assert.equal(data.modelUsage.providerCalls, 0)
    assert.equal(data.modelUsage.totalTokens, 0)
    assert.equal(data.budget.tokenBudget, TRIZ_MAPPING_LIMITS.runTokenBudget)
    assert.equal(data.budget.state, 'within_budget')
    assert.equal(data.budget.metricReadCount, 5, '五个域各记一次度量读取')
    assert.equal(data.budget.clarificationRounds, 0)
    assert.isAtLeast(data.mapping.candidatePrinciples.length, 1)
    assert.equal(data.statement.length, BASE_STATEMENT.length)
    assert.match(data.statement.digest, /^[0-9a-f]{32}$/)
    assert.equal(data.solutions.length, 3)
    assert.equal(data.humanOverride, false)

    // 响应中不得出现陈述原文全文（RL-12：陈述只在请求生命周期内存在）
    assert.notInclude(res.text(), BASE_STATEMENT)

    const record = await TrizCopilotAnalysis.query().where('id', data.id).firstOrFail()
    const raw = JSON.stringify(record.toJSON())
    assert.notInclude(raw, BASE_STATEMENT)
    assert.notMatch(raw, /prompt/i)
    assert.equal(record.organizationId, Number(org.id))
    assert.equal(record.projectId, Number(project.id))
    assert.equal(record.statementDigest, data.statement.digest)

    // 审计：参数哈希 + 状态 + 耗时，且不含陈述原文
    const audits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('action', 'ai_generate')
    assert.lengthOf(audits, 1)
    const metadata = audits[0].metadata as Record<string, unknown>
    assert.match(String(metadata.parametersHash), /^[0-9a-f]{64}$/)
    assert.equal(metadata.status, 'SUCCESS')
    assert.equal(typeof metadata.durationMs, 'number')
    assert.notInclude(JSON.stringify(metadata), BASE_STATEMENT)
  })

  test('列表统一信封、详情返回映射依据与预算快照', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const created = await api.post(endpoint(Number(project.id))).json({ statement: BASE_STATEMENT })
    created.assertStatus(201)
    const analysisId = (created.body() as { data: { id: number } }).data.id

    const list = await api.get(endpoint(Number(project.id)))
    list.assertStatus(200)
    const body = list.body() as {
      data: Array<Record<string, any>>
      meta: Record<string, number>
    }
    assert.lengthOf(body.data, 1)
    assert.equal(body.meta.total, 1)
    assert.equal(body.meta.page, 1)
    assert.isAtLeast(body.meta.perPage, 1)
    assert.equal(body.meta.totalPages, 1)

    const show = await api.get(endpoint(Number(project.id), `/${analysisId}`))
    show.assertStatus(200)
    const detail = (show.body() as { data: Record<string, any> }).data
    assert.equal(detail.id, analysisId)
    assert.isNotNull(detail.improvingParameter)
    assert.isNotEmpty(detail.improvingParameter.nameZh)
    assert.isAtLeast(detail.candidatePrinciples.length, 1)
    assert.isNotEmpty(detail.candidatePrinciples[0].definition)
    assert.include(['ai', 'rule'], detail.path)
    assert.isAtLeast(detail.topSolutions.solutions.length, 1)
    assert.equal(detail.budget.tokenBudget, TRIZ_MAPPING_LIMITS.runTokenBudget)

    const filtered = await api.get(endpoint(Number(project.id), '?humanOverride=false'))
    filtered.assertStatus(200)
    assert.lengthOf((filtered.body() as { data: unknown[] }).data, 1)

    const notFound = await api.get(endpoint(Number(project.id), '/999999'))
    notFound.assertStatus(404)
    notFound.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  test('改判：重算 + 人工改判标注 + 审计 + 业务数据零变更', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const created = await api.post(endpoint(Number(project.id))).json({ statement: BASE_STATEMENT })
    created.assertStatus(201)
    const before = (created.body() as { data: Record<string, any> }).data

    const countsBefore = await businessTableCounts()

    const overridden = await api.post(endpoint(Number(project.id), `/${before.id}/override`)).json({
      improvingParameter: 39,
      worseningParameter: 27,
      contradictionType: 'technical',
      reason: '与 PM 复核后确认真正的互斥项是可靠性与生产率',
    })

    overridden.assertStatus(200)
    const data = (overridden.body() as { data: Record<string, any> }).data

    assert.equal(data.humanOverride, true)
    assert.isNotNull(data.overrideAt)
    assert.equal(data.overrideBy, Number(org.ownerId))
    assert.equal(data.improvingParameter.number, 39)
    assert.equal(data.worseningParameter.number, 27)
    assert.equal(data.contradictionType, 'technical')
    assert.isAtLeast(data.candidatePrinciples.length, 1, '知识包确定性重查应给出候选原则')
    assert.equal(data.path, 'rule')
    assert.isAtLeast(data.solutions.length, 1)
    assert.equal(data.change.from.worseningParameter, before.worseningParameter?.number ?? null)
    assert.equal(data.change.to.worseningParameter, 27)

    // 业务数据零变更（改判只写本分析表）
    assert.deepEqual(await businessTableCounts(), countsBefore)

    // 审计：改判事件含前后参数编号与参数哈希（不含理由正文）
    const audits = await AuditLog.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .where('action', 'apply')
    assert.lengthOf(audits, 1)
    const metadata = audits[0].metadata as Record<string, unknown>
    assert.equal(metadata.toolName, 'triz_copilot_analysis_override')
    assert.equal(metadata.status, 'CONFIRMED')
    assert.equal(metadata.toWorseningParameter, 27)
    assert.match(String(metadata.parametersHash), /^[0-9a-f]{64}$/)
    assert.notInclude(JSON.stringify(metadata), '可靠性与生产率')

    // 记录已更新（不是新建）
    const records = await TrizCopilotAnalysis.query().where('project_id', project.id)
    assert.lengthOf(records, 1)
    assert.isTrue(Boolean(records[0].humanOverride))
    assert.equal(records[0].worseningParameter, 27)

    // 详情按落库低敏投影读回：改判结果可复现（top_solutions 非空 + 人工改判标注）
    const detail = await api.get(endpoint(Number(project.id), `/${before.id}`))
    detail.assertStatus(200)
    const detailData = (detail.body() as { data: Record<string, any> }).data
    assert.equal(detailData.humanOverride, true)
    assert.equal(detailData.worseningParameter.number, 27)
    assert.isAtLeast(detailData.topSolutions.solutions.length, 1)
    assert.equal(detailData.topSolutions.path, 'rule')
  })

  test('改判入参：未提供参数 422，编号越界 422', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const created = await api.post(endpoint(Number(project.id))).json({ statement: BASE_STATEMENT })
    created.assertStatus(201)
    const analysisId = (created.body() as { data: { id: number } }).data.id

    const empty = await api.post(endpoint(Number(project.id), `/${analysisId}/override`)).json({})
    empty.assertStatus(422)
    empty.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })

    const outOfRange = await api
      .post(endpoint(Number(project.id), `/${analysisId}/override`))
      .json({ improvingParameter: 40 })
    outOfRange.assertStatus(422)
    outOfRange.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })

    // 越界改判不得改动记录
    const record = await TrizCopilotAnalysis.query().where('id', analysisId).firstOrFail()
    assert.isFalse(Boolean(record.humanOverride))
  })

  test('预算默认值不可上调：请求体传更大的预算被忽略', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const res = await authed(client, token, Number(org.id))
      .post(endpoint(Number(project.id)))
      .json({
        statement: BASE_STATEMENT,
        budget: { clarificationRounds: 9, metricReads: 99, runTokens: 500_000 },
      })

    res.assertStatus(201)
    const data = (res.body() as { data: Record<string, any> }).data
    assert.equal(data.budget.tokenBudget, TRIZ_MAPPING_LIMITS.runTokenBudget)
    assert.equal(data.clarification.maxRounds, 2)

    const record = await TrizCopilotAnalysis.query().where('id', data.id).firstOrFail()
    assert.equal(record.tokenBudget, TRIZ_MAPPING_LIMITS.runTokenBudget)

    // 收紧生效：runTokens = 200 时模型预算门阻断（规则路径照常完成）
    const tightened = await authed(client, token, Number(org.id))
      .post(endpoint(Number(project.id)))
      .json({ statement: BASE_STATEMENT, budget: { runTokens: 200 } })
    tightened.assertStatus(201)
    const tightenedData = (tightened.body() as { data: Record<string, any> }).data
    assert.equal(tightenedData.budget.tokenBudget, 200)
    assert.equal(tightenedData.path, 'rule')
  })

  test('澄清链：第 3 轮不再追问，挂起并返回中间成果与中文原因', async ({ client, assert }) => {
    const { org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    const first = await api.post(endpoint(Number(project.id))).json({ statement: VAGUE_STATEMENT })
    first.assertStatus(201)
    const firstData = (first.body() as { data: Record<string, any> }).data
    assert.equal(firstData.clarification.needed, true)
    assert.equal(firstData.clarification.asked, true)
    assert.equal(firstData.clarification.round, 1)
    assert.isNotEmpty(firstData.clarification.prompt)
    assert.equal(firstData.budget.state, 'within_budget')

    const second = await api
      .post(endpoint(Number(project.id)))
      .json({ statement: VAGUE_STATEMENT, parentAnalysisId: firstData.id })
    second.assertStatus(201)
    const secondData = (second.body() as { data: Record<string, any> }).data
    assert.equal(secondData.clarification.asked, true)
    assert.equal(secondData.clarification.round, 2)

    const third = await api
      .post(endpoint(Number(project.id)))
      .json({ statement: VAGUE_STATEMENT, parentAnalysisId: secondData.id })
    third.assertStatus(201)
    const thirdData = (third.body() as { data: Record<string, any> }).data

    assert.equal(thirdData.clarification.asked, false, '第 3 轮不得再发起追问')
    assert.equal(thirdData.clarification.exhausted, true)
    assert.equal(thirdData.clarification.round, 2)
    assert.equal(thirdData.budget.state, 'exhausted')
    assert.include(String(thirdData.budget.reason), '2 轮')
    assert.match(String(thirdData.budget.reason), /[\u4e00-\u9fff]/)
    // 触顶不停在空结果：映射结论与方案容器照常返回（此处为明确的「信息不足」结论）
    assert.equal(thirdData.clarification.needed, true)
    assert.isArray(thirdData.solutions)
    assert.equal(thirdData.budget.clarificationRounds, 2)
    assert.isNotEmpty(thirdData.statement.digest)
  })

  test('solve 支持 sourceSignalId：合法信号落库并关联、不存在信号 422 且无记录、跨项目信号 422', async ({
    client,
    assert,
  }) => {
    const { owner, org, project, token } = await setup(client)
    const api = authed(client, token, Number(org.id))

    // 构造合法信号
    const signal = await ProjectSignal.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      signalType: 'progress_deviation',
      confidenceTier: 'low',
      tierReasons: { scheduleMargin: 0.15 },
      severity: 'warning',
      evidence: { metric: 'schedule_delay_days', currentValue: 8, threshold: 5 },
      idempotencyKey: 'test-sig-solve-valid',
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

    // ① 合法 sourceSignalId：响应与 DB 列均包含该 ID
    const validRes = await api.post(endpoint(Number(project.id))).json({
      statement: BASE_STATEMENT,
      sourceSignalId: Number(signal.id),
    })
    validRes.assertStatus(201)
    const validData = (validRes.body() as { data: Record<string, any> }).data
    assert.equal(validData.sourceSignalId, signal.id)

    const persisted = await TrizCopilotAnalysis.findOrFail(validData.id)
    assert.equal(persisted.sourceSignalId, signal.id)

    const beforeNonExistent = await analysisCount()

    // ② 不存在的信号 ID → 422 且无分析记录落库
    const notFoundRes = await api.post(endpoint(Number(project.id))).json({
      statement: BASE_STATEMENT,
      sourceSignalId: 999999,
    })
    notFoundRes.assertStatus(422)
    notFoundRes.assertBodyContains({ error: { message: '来源信号不存在或不属于当前项目' } })
    assert.equal(await analysisCount(), beforeNonExistent)

    // ③ 跨项目信号 → 422 且无记录落库
    const { project: otherProject } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const otherSignal = await ProjectSignal.create({
      organizationId: Number(org.id),
      projectId: Number(otherProject.id),
      signalType: 'risk_surge',
      confidenceTier: 'low',
      tierReasons: { surge: true },
      severity: 'critical',
      evidence: { metric: 'risk_count', currentValue: 10 },
      idempotencyKey: 'test-sig-other-project',
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

    const crossProjectRes = await api.post(endpoint(Number(project.id))).json({
      statement: BASE_STATEMENT,
      sourceSignalId: Number(otherSignal.id),
    })
    crossProjectRes.assertStatus(422)
    crossProjectRes.assertBodyContains({ error: { message: '来源信号不存在或不属于当前项目' } })
    assert.equal(await analysisCount(), beforeNonExistent)
  })

  test('GET /projects/:projectId/triz-copilot/parameters 返回 39 项参数且首尾完整、只读零写、权限与组织隔离', async ({
    client,
    assert,
  }) => {
    const { org, project, token } = await setup(client)
    const url = `${API_PREFIX}/projects/${project.id}/triz-copilot/parameters`

    // ① 未认证 401
    const unauthedRes = await client.get(url)
    unauthedRes.assertStatus(401)
    unauthedRes.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })

    // ② 越权 403（非项目成员）
    const outsider = await createUser({ email: uniqueEmail('triz-params-outsider') })
    await addOrgMember(org, outsider, 'viewer')
    const outsiderToken = await login(client, outsider)
    const forbiddenRes = await authed(client, outsiderToken, Number(org.id)).get(url)
    forbiddenRes.assertStatus(403)
    forbiddenRes.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })

    // ③ 跨组织 404（统一不泄露存在性）
    const otherOwner = await createUser({ email: uniqueEmail('triz-params-other-owner') })
    const otherOrg = await createOrganization(otherOwner)
    const otherToken = await login(client, otherOwner)
    const notFoundRes = await authed(client, otherToken, Number(otherOrg.id)).get(url)
    notFoundRes.assertStatus(404)
    notFoundRes.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    // ④ 只读零写与 39 项参数
    const beforeBiz = await businessTableCounts()
    const beforeAnalysis = await analysisCount()

    const res = await authed(client, token, Number(org.id)).get(url)
    res.assertStatus(200)
    const body = res.body() as { data: Array<Record<string, any>> }
    assert.isArray(body.data)
    assert.lengthOf(body.data, 39)

    // 首项（#1 在途工作负荷）
    const first = body.data[0]
    assert.equal(first.number, 1)
    assert.equal(first.nameZh, '运动物体的重量')
    assert.equal(first.displayName, '在途工作负荷')
    assert.equal(first.category, '几何与物理形态')
    assert.isString(first.pmMeaning)

    // 尾项（#39 团队产出效率）
    const last = body.data[38]
    assert.equal(last.number, 39)
    assert.equal(last.nameZh, '生产率')
    assert.equal(last.displayName, '团队产出效率')
    assert.equal(last.category, '动力与时间效率')
    assert.isString(last.pmMeaning)

    // 只读零写断言
    const afterBiz = await businessTableCounts()
    const afterAnalysis = await analysisCount()
    assert.deepEqual(afterBiz, beforeBiz, '业务表零写入')
    assert.equal(afterAnalysis, beforeAnalysis, '分析表零写入')
  })
})
