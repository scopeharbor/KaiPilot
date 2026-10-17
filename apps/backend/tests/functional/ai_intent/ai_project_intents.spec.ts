import AuditLog from '#models/audit_log'
import Milestone from '#models/milestone'
import Project from '#models/project'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import WbsNode from '#models/wbs_node'
import ClarificationService from '#services/ai_intent/clarification_service'
import AgentQuestionPlanTokenService from '#services/ai_intent/agent_question_plan_token_service'
import { test } from '@japa/runner'
import type { ClarificationAnswers, ClarificationCard, ClarificationField } from '@aiproj/types'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

const ENDPOINT = '/api/v1/ai/project-intents/analyze'

async function login(client: any, email: string) {
  const response = await client
    .post('/api/v1/auth/login')
    .json({ email, password: STRONG_PASSWORD })
  response.assertStatus(200)
  return response.body().data.accessToken as string
}

test.group('AI 项目意图生产 API', (group) => {
  useAuthDatabase(group)

  test('有 ai:trigger 的组织成员获得可审查上下文且零正式业务写入', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const before = await formalWriteCounts()

    const response = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ rawInput: '开发一个面向运营人员使用的内部系统，目标是减少重复录入。' })

    response.assertStatus(200)
    response.assertBodyContains({
      data: {
        parsedIntent: { projectType: 'software' },
        branch: 'clarify',
        phase: 'core',
        remainingCount: 7,
      },
    })
    assert.equal(response.body().data.activeCard.field, 'projectGoal')
    assert.isTrue(response.body().data.coverage.valid)
    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('旧 questionPlanRevision 被拒绝且不会提交答案或写入项目', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const before = await formalWriteCounts()

    const response = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({
        rawInput: '开发一个面向运营人员使用的内部系统，目标是减少重复录入。',
        questionPlanRevision: 'stale-question-plan-revision',
        answers: {
          projectGoal: {
            cardId: '1.0:projectGoal:critical',
            field: 'projectGoal',
            action: 'answer',
            value: '提升流程效率并减少重复工作',
            marker: null,
          },
        },
      })

    response.assertStatus(422)
    response.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
    assert.include(response.body().error.message, 'QUESTION_PLAN_STALE')
    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('签名 Agent 批次可连续回答多张卡且每题推进 revision', async ({ client, assert }) => {
    const owner = await createUser()
    const organization = await createOrganization(owner)
    const token = await login(client, owner.email)
    const rawInput = '开发一个面向运营人员使用的内部系统，目标是减少重复录入。'
    const clarification = new ClarificationService()
    const answers: ClarificationAnswers = {}
    const values: Partial<Record<ClarificationField, string | number>> = {
      projectGoal: '减少工单重复录入并缩短处理时间',
      corePain: '信息分散且无法追踪 SLA',
      targetUser: '150 名内部员工与 5 人运营团队',
      successMetrics: '创建成功率至少 99%，SLA 命中率至少 95%',
      scopeBoundary: '包含工单流转，不包含 OA 审批',
      teamSize: 5,
      startDate: '2026-09-01',
    }
    for (;;) {
      const result = clarification.analyze(rawInput, answers)
      if (result.branch === 'ready') break
      const current = result.activeCard!
      answers[current.field] = {
        field: current.field,
        action: current.category === 'critical' ? 'answer' : 'skip',
        value: current.category === 'critical' ? (values[current.field] ?? '已确认') : null,
        marker: null,
        cardId: current.cardId,
        source: current.source,
      }
    }

    const cards = ['agentRisk', 'agentDependency'].map((field) => ({
      cardId: `1.0:${field}:recommended`,
      field,
      category: 'recommended',
      title: `${field} 的追问`,
      description: '请补充会影响真实项目计划的事实。',
      impactScope: [{ domain: '风险', severity: 'medium' }],
      questionType: 'text',
      quickOptions: [],
      customInput: {
        enabled: true,
        label: '自定义输入',
        placeholder: '请输入真实情况',
        description: '按实际情况补充。',
      },
      defaultValue: null,
      confidence: 0.6,
      reasoning: '仍缺少该项事实。',
      allowSkip: true,
      isRequired: false,
      phase: 'agent',
      source: 'agent',
      packId: null,
      triggerEvidence: ['固定与条件卡片已完成'],
      suggestedValue: null,
    })) as ClarificationCard[]
    const issued = new AgentQuestionPlanTokenService().issue({
      organizationId: organization.id,
      userId: owner.id,
      rawInput,
      answers,
      selectedPackIds: [],
      cards,
    })

    const firstAnswers: ClarificationAnswers = {
      ...answers,
      agentRisk: {
        field: 'agentRisk',
        action: 'answer',
        value: 'SSO 对接延期',
        marker: null,
        cardId: '1.0:agentRisk:recommended',
        source: 'agent',
      },
    }
    const first = await client.post(ENDPOINT).header('Authorization', `Bearer ${token}`).json({
      rawInput,
      answers: firstAnswers,
      questionPlanRevision: issued.questionPlanRevision,
      agentQuestionPlanToken: issued.token,
    })
    first.assertStatus(200)
    first.assertBodyContains({
      data: { phase: 'agent', remainingCount: 1, agentQuestionPlanToken: issued.token },
    })
    assert.equal(first.body().data.activeCard.field, 'agentDependency')
    assert.notEqual(first.body().data.questionPlanRevision, issued.questionPlanRevision)

    const second = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({
        rawInput,
        answers: {
          ...firstAnswers,
          agentDependency: {
            field: 'agentDependency',
            action: 'answer',
            value: '员工目录同步',
            marker: null,
            cardId: '1.0:agentDependency:recommended',
            source: 'agent',
          },
        },
        questionPlanRevision: first.body().data.questionPlanRevision,
        agentQuestionPlanToken: issued.token,
      })
    second.assertStatus(200)
    second.assertBodyContains({ data: { branch: 'ready', phase: 'ready' } })
    assert.isNull(second.body().data.agentQuestionPlanToken)
  })

  test('未认证返回 401', async ({ client }) => {
    const response = await client
      .post(ENDPOINT)
      .json({ rawInput: '开发一个面向运营人员的内部系统，目标是减少重复录入。' })

    response.assertStatus(401)
    response.assertBodyContains({ error: { code: 'AUTH_REQUIRED' } })
  })

  test('无 ai:trigger 的只读观察者返回 403', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const response = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ rawInput: '开发一个面向运营人员的内部系统，目标是减少重复录入。' })

    response.assertStatus(403)
    response.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('长度和目录外回答字段返回统一 422', async ({ client }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const tooShort = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ rawInput: '太短' })
    tooShort.assertStatus(422)
    tooShort.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })

    const unknownField = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({
        rawInput: '开发一个面向运营人员使用的内部系统，目标是减少重复录入。',
        answers: {
          budget: { field: 'budget', action: 'answer', value: '十万元', marker: null },
        },
      })
    unknownField.assertStatus(422)
    unknownField.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('审计仅记录统计元数据，不记录输入、回答或潜在 PII', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const rawInput = '开发面向张三使用的内部系统，目标是处理身份证资料并满足隐私合规。'

    const response = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ rawInput })
    response.assertStatus(200)

    const audit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['AI_INTENT_ANALYZED'])
      .orderBy('id', 'desc')
      .firstOrFail()
    const serialized = JSON.stringify(audit.metadata)
    assert.notInclude(serialized, rawInput)
    assert.notInclude(serialized, '张三')
    assert.notInclude(serialized, '身份证')
    assert.deepInclude(audit.metadata, {
      event: 'AI_INTENT_ANALYZED',
      projectType: 'software',
      schemaVersion: '1.0',
    })
  })

  test('客户端 organizationId 不能切换租户上下文 → 404 掩蔽', async ({ client, assert }) => {
    const ownerA = await createUser()
    const ownerB = await createUser()
    await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const token = await login(client, ownerA.email)

    // 故意发送契约外的 organizationId，验证服务端拒绝客户端租户切换
    const response = await client.post(ENDPOINT).header('Authorization', `Bearer ${token}`).json({
      rawInput: '开发一个面向运营人员使用的内部系统，目标是减少重复录入。',
      organizationId: orgB.id,
    })
    response.assertStatus(404)
    response.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    // 无审计事件（请求被 middleware 拦截）
    const audit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['AI_INTENT_ANALYZED'])
      .orderBy('id', 'desc')
      .first()
    assert.isNull(audit)
  })
})

async function formalWriteCounts() {
  return {
    projects: await Project.query()
      .count('* as total')
      .then((rows) => Number(rows[0].$extras.total)),
    tasks: await Task.query()
      .count('* as total')
      .then((rows) => Number(rows[0].$extras.total)),
    wbsNodes: await WbsNode.query()
      .count('* as total')
      .then((rows) => Number(rows[0].$extras.total)),
    dependencies: await TaskDependency.query()
      .count('* as total')
      .then((rows) => Number(rows[0].$extras.total)),
    milestones: await Milestone.query()
      .count('* as total')
      .then((rows) => Number(rows[0].$extras.total)),
  }
}
