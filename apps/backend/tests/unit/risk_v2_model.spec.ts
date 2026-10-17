import Risk from '#models/risk'
import RiskResponsePlan from '#models/risk_response_plan'
import RiskHistory from '#models/risk_history'
import RiskMatrixConfig from '#models/risk_matrix_config'
import RiskSignalCandidate from '#models/risk_signal_candidate'
import RiskKnowledgeTemplate from '#models/risk_knowledge_template'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('V2 风险模型', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('v2-model') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project }
  }

  test('Risk V2 字段：riskLevel 默认 medium，priority 默认 normal', async ({ assert }) => {
    const { org, project: project, owner } = await setup()

    // 不指定 riskLevel 和 priority，依赖 DB 默认值
    const created = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '默认值测试风险',
      description: '验证 riskLevel 和 priority 默认值',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    // refresh 以获取 DB 默认值
    await created.refresh()
    assert.equal(created.riskLevel, 'medium')
    assert.equal(created.priority, 'normal')
  })

  test('Risk V2 字段：riskLevel 和 priority 可显式设置', async ({ assert }) => {
    const { org, project: project, owner } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '显式设置风险',
      description: '验证显式设置 riskLevel 和 priority',
      category: 'schedule',
      probability: 5,
      impact: 5,
      score: 25,
      status: 'identified',
      riskLevel: 'critical',
      priority: 'high',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    assert.equal(risk.riskLevel, 'critical')
    assert.equal(risk.priority, 'high')
  })

  test('RiskResponsePlan：创建含 strategy_type、action_description，status 默认 planned', async ({
    assert,
  }) => {
    const { org, project: project, owner } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '应对计划测试风险',
      description: '测试应对计划创建',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    const plan = await RiskResponsePlan.create({
      organizationId: org.id,
      projectId: project.id,
      riskId: risk.id,
      strategyType: 'mitigate',
      actionDescription: '安排额外培训降低技术风险',
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    // refresh 获取 DB 默认 status = 'planned'
    await plan.refresh()
    assert.equal(plan.strategyType, 'mitigate')
    assert.equal(plan.actionDescription, '安排额外培训降低技术风险')
    assert.equal(plan.status, 'planned')
  })

  test('RiskResponsePlan：所有策略类型均可创建', async ({ assert }) => {
    const { org, project: project, owner } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '策略类型测试风险',
      description: '测试所有策略类型',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    const strategies = ['avoid', 'mitigate', 'transfer', 'accept', 'contingency', 'escalate']
    for (const st of strategies) {
      const plan = await RiskResponsePlan.create({
        organizationId: org.id,
        projectId: project.id,
        riskId: risk.id,
        strategyType: st,
        actionDescription: `策略 ${st} 测试`,
        createdBy: owner.id,
        updatedBy: owner.id,
      })
      assert.equal(plan.strategyType, st)
    }
  })

  test('RiskHistory：创建含 eventType，sourceType 默认 manual', async ({ assert }) => {
    const { org, project: project, owner } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '历史记录测试风险',
      description: '测试历史记录创建',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    const history = await RiskHistory.create({
      organizationId: org.id,
      projectId: project.id,
      riskId: risk.id,
      eventType: 'created',
      actorId: owner.id,
      summary: { title: risk.title },
      occurredAt: DateTime.now(),
    })

    await history.refresh()
    assert.equal(history.eventType, 'created')
    assert.equal(history.sourceType, 'manual')
  })

  test('RiskHistory：多种事件类型可记录', async ({ assert }) => {
    const { org, project: project, owner } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '多事件测试风险',
      description: '测试多种事件类型',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    const eventTypes = [
      'created',
      'field_changed',
      'status_changed',
      'risk_level_changed',
      'reviewed',
      'response_plan_created',
      'response_plan_updated',
      'response_plan_completed',
      'candidate_accepted',
      'candidate_rejected',
      'closed',
      'reopened',
    ]

    for (const et of eventTypes) {
      const h = await RiskHistory.create({
        organizationId: org.id,
        projectId: project.id,
        riskId: risk.id,
        eventType: et,
        actorId: owner.id,
        summary: { event: et },
        occurredAt: DateTime.now(),
      })
      assert.equal(h.eventType, et)
    }
  })

  test('RiskMatrixConfig：project_id 唯一约束生效', async ({ assert }) => {
    const { org, project: project, owner } = await setup()

    await RiskMatrixConfig.create({
      organizationId: org.id,
      projectId: project.id,
      probabilityLevels: 5,
      impactLevels: 5,
      zones: JSON.stringify([
        { name: 'low', minProb: 1, maxProb: 2, minImp: 1, maxImp: 2 },
      ]) as unknown as Record<string, unknown>[],
      isActive: true,
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    try {
      await RiskMatrixConfig.create({
        organizationId: org.id,
        projectId: project.id,
        probabilityLevels: 3,
        impactLevels: 3,
        zones: JSON.stringify([
          { name: 'low', minProb: 1, maxProb: 1, minImp: 1, maxImp: 1 },
        ]) as unknown as Record<string, unknown>[],
        isActive: true,
        createdBy: owner.id,
        updatedBy: owner.id,
      })
      assert.fail('应因唯一约束抛出异常')
    } catch (error: any) {
      // SQLite 唯一约束错误
      assert.include(error.message?.toLowerCase() || error.code?.toLowerCase() || '', 'unique')
    }
  })

  test('RiskMatrixConfig：默认值正确', async ({ assert }) => {
    const { org, project: project, owner } = await setup()

    const config = await RiskMatrixConfig.create({
      organizationId: org.id,
      projectId: project.id,
      zones: JSON.stringify([
        { name: 'low', minProb: 1, maxProb: 2, minImp: 1, maxImp: 2 },
      ]) as unknown as Record<string, unknown>[],
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    await config.refresh()
    assert.equal(config.probabilityLevels, 5)
    assert.equal(config.impactLevels, 5)
    assert.equal(config.defaultBasis, 'inherent')
    assert.equal(config.cellLimit, 5)
    assert.isOk(config.isActive)
  })

  test('RiskSignalCandidate：创建含 idempotency_key，status 默认 pending', async ({ assert }) => {
    const { org, project } = await setup()

    const candidate = await RiskSignalCandidate.create({
      organizationId: org.id,
      projectId: project.id,
      ruleId: 'overdue-task',
      ruleVersion: '1.0',
      severity: 'medium',
      evidence: [
        { type: 'task', id: 1, title: '逾期任务', detail: '逾期 5 天' },
      ] as unknown as Record<string, unknown>[],
      recommendedAction: '审查逾期任务并调整安排',
      confidence: 0.95,
      idempotencyKey: 'overdue-task-1-1',
      expiresAt: DateTime.now().plus({ days: 7 }),
    })

    await candidate.refresh()
    assert.equal(candidate.idempotencyKey, 'overdue-task-1-1')
    assert.equal(candidate.status, 'pending')
  })

  test('RiskKnowledgeTemplate：template_type 可设置 system 或 organization', async ({ assert }) => {
    const { org, owner } = await setup()

    // 系统模板：organization_id = null
    const systemTemplate = await RiskKnowledgeTemplate.create({
      organizationId: null,
      title: '系统模板 - 技术风险',
      description: '内置系统模板',
      category: 'technical',
      source: 'system',
      templateType: 'system',
      isActive: true,
      createdBy: owner.id,
      updatedBy: owner.id,
    })
    assert.equal(systemTemplate.templateType, 'system')
    assert.isNull(systemTemplate.organizationId)

    // 组织模板：organization_id = org.id
    const orgTemplate = await RiskKnowledgeTemplate.create({
      organizationId: org.id,
      title: '组织模板 - 进度风险',
      description: '自定义组织模板',
      category: 'schedule',
      source: 'organization',
      templateType: 'organization',
      isActive: true,
      createdBy: owner.id,
      updatedBy: owner.id,
    })
    assert.equal(orgTemplate.templateType, 'organization')
    assert.equal(orgTemplate.organizationId, org.id)
  })

  test('RiskKnowledgeTemplate：系统模板与组织模板隔离查询', async ({ assert }) => {
    const { org, owner } = await setup()

    // 创建系统模板
    await RiskKnowledgeTemplate.create({
      organizationId: null,
      title: '系统模板',
      description: '系统内置',
      category: 'technical',
      source: 'system',
      templateType: 'system',
      isActive: true,
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    // 创建组织模板
    await RiskKnowledgeTemplate.create({
      organizationId: org.id,
      title: '组织模板',
      description: '组织自定义',
      category: 'schedule',
      source: 'organization',
      templateType: 'organization',
      isActive: true,
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    // 查询系统模板：只看 organization_id IS NULL
    const systemTemplates = await RiskKnowledgeTemplate.query()
      .whereNull('organization_id')
      .where('is_active', true)
    assert.isAtLeast(systemTemplates.length, 1)
    const foundSystem = systemTemplates.find((t) => t.title === '系统模板')
    assert.isDefined(foundSystem)
    assert.equal(foundSystem!.templateType, 'system')

    // 查询组织模板：只看 organization_id = org.id
    const orgTemplates = await RiskKnowledgeTemplate.query()
      .where('organization_id', org.id)
      .where('is_active', true)
    assert.isAtLeast(orgTemplates.length, 1)
    const foundOrg = orgTemplates.find((t) => t.title === '组织模板')
    assert.isDefined(foundOrg)
    assert.equal(foundOrg!.templateType, 'organization')

    // 联合查询（如 listTemplates 的 WHERE organization_id IS NULL OR organization_id = ?）
    const allTemplates = await RiskKnowledgeTemplate.query()
      .where((q) => {
        q.whereNull('organization_id').orWhere('organization_id', org.id)
      })
      .where('is_active', true)
    assert.isAtLeast(allTemplates.length, 2)
  })
})
