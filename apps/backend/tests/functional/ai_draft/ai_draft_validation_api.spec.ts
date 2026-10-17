import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import Project from '#models/project'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import TaskDependency from '#models/task_dependency'
import Milestone from '#models/milestone'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

function makeReadyContext(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

async function login(client: any, email: string) {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function formalWriteCounts() {
  const count = async (q: any) => {
    const row = await q.count('* as total')
    return Number(row[0].$extras.total)
  }
  return {
    projects: await count(Project.query()),
    tasks: await count(Task.query()),
    wbsNodes: await count(WbsNode.query()),
    dependencies: await count(TaskDependency.query()),
    milestones: await count(Milestone.query()),
  }
}

async function createDraft(client: any, token: string): Promise<string> {
  const gen = await client
    .post('/api/v1/ai/project-drafts/stream')
    .header('Authorization', `Bearer ${token}`)
    .json({ context: makeReadyContext() })
  return gen.headers()['x-draft-id']
}

test.group('AI 反幻觉校验 API · 权限与组织隔离', (group) => {
  useAuthDatabase(group)

  test('未认证调用校验端点返回 401', async ({ client }) => {
    const res = await client.post('/api/v1/ai/project-drafts/nonexistent/validations').json({})
    res.assertStatus(401)
    res.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('无 ai:trigger 的观察者返回 403', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client
      .post('/api/v1/ai/project-drafts/whatever/validations')
      .header('Authorization', `Bearer ${token}`)
      .json({})
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('跨组织草案校验返回 404 不泄露存在性', async ({ client }) => {
    const ownerB = await createUser()
    await createOrganization(ownerB)
    const tokenB = await login(client, ownerB.email)
    const draftUid = await createDraft(client, tokenB)

    const ownerA = await createUser()
    await createOrganization(ownerA)
    const tokenA = await login(client, ownerA.email)

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/validations`)
      .header('Authorization', `Bearer ${tokenA}`)
      .json({})
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  test('客户端携带 enableRules/severityOverride/confidenceScore 被 strict 拒绝', async ({
    client,
  }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const draftUid = await createDraft(client, token)

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/validations`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        enableRules: ['HL-002'],
        severityOverride: { 'HL-002': 'info' },
        confidenceScore: 100,
      })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })
})

test.group('AI 反幻觉校验 API · 报告、审计与隔离', (group) => {
  useAuthDatabase(group)

  test('重新校验返回后端权威报告且零正式业务落库', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const draftUid = await createDraft(client, token)
    const before = await formalWriteCounts()

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/validations`)
      .header('Authorization', `Bearer ${token}`)
      .json({ phase: 'all' })
    res.assertStatus(200)

    const report = res.body().data.report
    assert.isNumber(report.confidenceScore)
    assert.property(report, 'overallRiskLevel')
    assert.property(report, 'canConfirm')
    assert.equal(report.canConfirm, report.blocking.length === 0)
    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('校验写 AI_DRAFT_VALIDATED 审计，仅摘要不含草案正文', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const draftUid = await createDraft(client, token)

    await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/validations`)
      .header('Authorization', `Bearer ${token}`)
      .json({ phase: 'all' })

    const audit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['AI_DRAFT_VALIDATED'])
      .orderBy('id', 'desc')
      .firstOrFail()
    const serialized = JSON.stringify(audit.metadata)
    assert.notInclude(serialized, 'charter')
    assert.property(audit.metadata as Record<string, unknown>, 'confidenceScore')
    assert.property(audit.metadata as Record<string, unknown>, 'blocking')
  })

  test('autoFix 生成 auto_fixed 新版本、返回差异且报告不可直接确认', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const draftUid = await createDraft(client, token)
    const before = await formalWriteCounts()

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/validations`)
      .header('Authorization', `Bearer ${token}`)
      .json({ phase: 'all', autoFix: true })
    res.assertStatus(200)
    const body = res.body().data
    assert.isArray(body.autoFixDiffs)
    assert.isFalse(body.report.canConfirm)
    // autoFix 只在草案区新增版本，绝不写正式业务表。
    assert.deepEqual(await formalWriteCounts(), before)

    const detail = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}`)
      .header('Authorization', `Bearer ${token}`)
    detail.assertBodyContains({ data: { version: 2 } })
  })

  test('重新校验携带 modifications：服务端先应用就地编辑再跑 VE/HL，报告反映编辑后内容', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const draftUid = await createDraft(client, token)

    // 基准重检：fallback 草案所有任务工期均在 0.5~30 天 → 不应出现 HL-002（工期越界）
    const base = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/validations`)
      .header('Authorization', `Bearer ${token}`)
      .json({ phase: 'all' })
    base.assertStatus(200)
    const baseBlocking = base.body().data.report.blocking as Array<{ ruleId: string }>
    assert.isFalse(baseBlocking.some((issue) => issue.ruleId === 'HL-002'))

    // 取关键路径任务，模拟就地编辑把工期改为 40 天后重检：报告必须反映编辑后内容。
    // （bodyParser convertEmptyStringsToNull 会把空串/纯空白转 null，故选用数字字段制造差异。）
    const detail = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}`)
      .header('Authorization', `Bearer ${token}`)
    const criticalTaskId = detail.body().data.draft.ganttPreview.criticalPathTaskIds[0]

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/validations`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        phase: 'all',
        modifications: [{ path: `tasks[${criticalTaskId}].durationDays`, value: 40 }],
      })
    res.assertStatus(200)
    const blocking = res.body().data.report.blocking as Array<{ ruleId: string }>
    assert.isTrue(blocking.some((issue) => issue.ruleId === 'HL-002'))
  })

  test('latest 端点返回最近一次校验报告', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const draftUid = await createDraft(client, token)

    await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/validations`)
      .header('Authorization', `Bearer ${token}`)
      .json({ phase: 'all' })

    const res = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}/validations/latest`)
      .header('Authorization', `Bearer ${token}`)
    res.assertStatus(200)
    assert.isNotNull(res.body().data)
    assert.property(res.body().data, 'confidenceScore')
  })
})
