import Risk from '#models/risk'
import Task from '#models/task'
import AuditService from '#services/audit_service'
import RiskLevelService from '#services/risk_level_service'
import RiskHistoryService from '#services/risk_history_service'
import RiskReviewService from '#services/risk_review_service'
import RiskResponsePlanService from '#services/risk_response_plan_service'
import RiskWorkbenchService from '#services/risk_workbench_service'
import RiskMatrixConfigService from '#services/risk_matrix_config_service'
import { ProjectRoleName } from '#rbac'
import { ValidationException } from '#exceptions/api_exception'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('RiskLevelService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('level-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project, service: new RiskLevelService() }
  }

  test('computeInherent: score >= 16 返回 critical', async ({ assert }) => {
    const { org, project, service } = await setup()
    const level = await service.computeInherent(org.id, project.id, { probability: 5, impact: 5 })
    assert.equal(level, 'critical')
  })

  test('computeInherent: score >= 10 返回 high', async ({ assert }) => {
    const { org, project, service } = await setup()
    const level = await service.computeInherent(org.id, project.id, { probability: 4, impact: 3 })
    assert.equal(level, 'high')
  })

  test('computeInherent: score >= 4 返回 medium', async ({ assert }) => {
    const { org, project, service } = await setup()
    const level = await service.computeInherent(org.id, project.id, { probability: 2, impact: 2 })
    assert.equal(level, 'medium')
  })

  test('computeInherent: score <= 3 返回 low', async ({ assert }) => {
    const { org, project, service } = await setup()
    const level = await service.computeInherent(org.id, project.id, { probability: 1, impact: 1 })
    assert.equal(level, 'low')
  })

  test('computeInherent: 5x5 网格全覆盖', async ({ assert }) => {
    const { org, project, service } = await setup()
    // 覆盖所有 25 种组合
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        const level = await service.computeInherent(org.id, project.id, {
          probability: p,
          impact: i,
        })
        const score = p * i
        if (score >= 16) assert.equal(level, 'critical', `得分 ${score} 应为 critical`)
        else if (score >= 10) assert.equal(level, 'high', `得分 ${score} 应为 high`)
        else if (score >= 4) assert.equal(level, 'medium', `得分 ${score} 应为 medium`)
        else assert.equal(level, 'low', `得分 ${score} 应为 low`)
      }
    }
  })
})

test.group('RiskReviewService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('review-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const audit = new AuditService()
    const riskHistory = new RiskHistoryService()
    const reviewService = new RiskReviewService(audit, riskHistory)
    return { owner, org, project, audit, riskHistory, reviewService }
  }

  test('review 更新 lastReviewAt 并记录历史', async ({ assert }) => {
    const { owner, org, project, riskHistory, reviewService } = await setup()

    // 先创建风险
    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '复查测试风险',
      description: '测试复查功能',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    // 复查前 lastReviewAt 应为 null
    assert.isUndefined(risk.lastReviewAt)

    // 执行复查
    const updated = await reviewService.review(
      org.id,
      project.id,
      risk.id,
      { conclusion: '风险仍可控', nextAction: '持续监控', notes: '月底复查' },
      owner.id,
    )

    // 复查后 lastReviewAt 不为空
    assert.isNotNull(updated.lastReviewAt)

    // 验证风险历史有 'reviewed' 事件
    const history = await riskHistory.list(org.id, project.id, risk.id)
    const reviewedEvents = history.data.filter((h) => h.eventType === 'reviewed')
    assert.isAtLeast(reviewedEvents.length, 1)
  })

  test('review 支持设置 nextReviewAt', async ({ assert }) => {
    const { owner, org, project, reviewService } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '下次复查测试',
      description: '测试下次复查日期',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    const nextDate = DateTime.now().plus({ days: 30 }).toISO()!
    const updated = await reviewService.review(
      org.id,
      project.id,
      risk.id,
      { conclusion: '可控', nextAction: '观察', nextReviewAt: nextDate },
      owner.id,
    )

    assert.isNotNull(updated.nextReviewAt)
  })

  test('review 对不存在风险抛出 ResourceNotFoundException', async ({ assert }) => {
    const { owner, org, project, reviewService } = await setup()

    try {
      await reviewService.review(
        org.id,
        project.id,
        99999,
        { conclusion: '测试', nextAction: '测试' },
        owner.id,
      )
      assert.fail('应抛出异常')
    } catch (error: any) {
      assert.equal(error.constructor.name, 'ResourceNotFoundException')
    }
  })
})

test.group('RiskResponsePlanService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('plan-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const audit = new AuditService()
    const riskHistory = new RiskHistoryService()
    const planService = new RiskResponsePlanService(audit, riskHistory)
    return { owner, org, project, audit, riskHistory, planService }
  }

  test('create 验证关联任务属于项目', async ({ assert }) => {
    const { owner, org, project, planService } = await setup()

    // 创建任务
    const task = await Task.create({
      projectId: project.id,
      name: '项目任务',
    })

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '应对计划风险',
      description: '测试',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    // 关联同一项目任务应成功
    const plan = await planService.create(
      org.id,
      project.id,
      risk.id,
      { strategyType: 'mitigate', actionDescription: '测试', relatedTaskId: task.id },
      owner.id,
    )
    assert.equal(plan.relatedTaskId, task.id)
  })

  test('create 关联其他项目任务抛出 ValidationException', async ({ assert }) => {
    const { owner, org, project: project1, planService } = await setup()

    // 创建第二个项目
    const projectModule = await import('#models/project')
    const project2 = await projectModule.default.create({
      organizationId: org.id,
      name: '其他项目',
      code: `P2-${Date.now()}`,
      createdBy: owner.id,
    })

    // 在项目2创建任务
    const task2 = await Task.create({
      projectId: project2.id,
      name: '其他项目任务',
    })

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project1.id,
      title: '应对计划风险',
      description: '测试跨项目任务',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    try {
      await planService.create(
        org.id,
        project1.id,
        risk.id,
        { strategyType: 'mitigate', actionDescription: '测试', relatedTaskId: task2.id },
        owner.id,
      )
      assert.fail('应抛出 ValidationException')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }
  })

  test('update 完成应对计划不自动关闭风险', async ({ assert }) => {
    const { owner, org, project, planService } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '风险状态测试',
      description: '验证完成应对计划不影响风险状态',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'analyzing',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    const plan = await planService.create(
      org.id,
      project.id,
      risk.id,
      { strategyType: 'mitigate', actionDescription: '测试计划' },
      owner.id,
    )

    // 完成应对计划
    const completed = await planService.update(
      org.id,
      project.id,
      plan.id,
      { status: 'completed', completionEvidence: '已完成' },
      owner.id,
    )
    assert.equal(completed.status, 'completed')
    assert.isNotNull(completed.completedAt)

    // 风险状态应保持不变（不自动关闭）
    const riskReloaded = await Risk.find(risk.id)
    assert.equal(riskReloaded!.status, 'analyzing')
  })
})

test.group('RiskHistoryService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('hist-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const riskHistory = new RiskHistoryService()
    return { owner, org, project, riskHistory }
  }

  test('record 和 list 正常写入和读取', async ({ assert }) => {
    const { owner, org, project, riskHistory } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '历史记录风险',
      description: '测试历史记录',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    // 写入两条记录
    await riskHistory.record({
      organizationId: org.id,
      projectId: project.id,
      riskId: risk.id,
      eventType: 'created',
      actorId: owner.id,
      summary: { title: risk.title },
    })

    await riskHistory.record({
      organizationId: org.id,
      projectId: project.id,
      riskId: risk.id,
      eventType: 'field_changed',
      actorId: owner.id,
      summary: { changed: 'probability' },
      sourceType: 'manual',
    })

    const result = await riskHistory.list(org.id, project.id, risk.id)
    assert.lengthOf(result.data, 2)
    assert.equal(result.meta.total, 2)
    assert.equal(result.data[0]!.eventType, 'field_changed') // 按 occurred_at desc
  })

  test('record 自动设置 sourceType 默认为 manual', async ({ assert }) => {
    const { owner, org, project, riskHistory } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '来源测试风险',
      description: '测试来源默认值',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    const entry = await riskHistory.record({
      organizationId: org.id,
      projectId: project.id,
      riskId: risk.id,
      eventType: 'created',
      actorId: owner.id,
      summary: { title: risk.title },
    })

    assert.equal(entry.sourceType, 'manual')
  })

  test('listByProject 按项目查询历史', async ({ assert }) => {
    const { owner, org, project, riskHistory } = await setup()

    const risk = await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '项目历史风险',
      description: '测试按项目查询',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      status: 'identified',
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    await riskHistory.record({
      organizationId: org.id,
      projectId: project.id,
      riskId: risk.id,
      eventType: 'created',
      actorId: owner.id,
      summary: {},
    })

    const result = await riskHistory.listByProject(org.id, project.id)
    assert.isAtLeast(result.data.length, 1)
  })
})

test.group('RiskWorkbenchService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('wb-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { owner, org, project, service: new RiskWorkbenchService() }
  }

  test('getSummary 空项目返回正确计数', async ({ assert }) => {
    const { org, project, service } = await setup()
    const summary = await service.getSummary(org.id, project.id)

    assert.equal(summary.totalRisks, 0)
    assert.equal(summary.openRisks, 0)
    assert.equal(summary.highRiskCount, 0)
    assert.equal(summary.criticalRiskCount, 0)
    assert.equal(summary.overdueReviewCount, 0)
    assert.equal(summary.incompleteResponsePlans, 0)
    assert.equal(summary.trend30d.created, 0)
    assert.equal(summary.trend30d.closed, 0)
    assert.isNull(summary.healthScore)
    assert.isEmpty(summary.topRisks)
  })

  test('getSummary 返回正确的风险统计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 创建不同等级、状态的风险
    const riskData = [
      { title: '高风险 1', riskLevel: 'high', score: 15, status: 'identified' },
      { title: '高风险 2', riskLevel: 'high', score: 12, status: 'analyzing' },
      { title: '关键风险', riskLevel: 'critical', score: 20, status: 'mitigating' },
      { title: '中风险', riskLevel: 'medium', score: 6, status: 'identified' },
      { title: '低风险（已关闭）', riskLevel: 'low', score: 2, status: 'closed' },
    ]

    for (const rd of riskData) {
      await Risk.create({
        organizationId: org.id,
        projectId: project.id,
        title: rd.title,
        description: rd.title,
        category: 'technical',
        probability: Math.ceil(rd.score / 5) || 1,
        impact: Math.min(rd.score, 5) || 1,
        score: rd.score,
        riskLevel: rd.riskLevel,
        priority: 'normal',
        status: rd.status,
        identifiedAt: DateTime.now(),
        createdBy: owner.id,
        updatedBy: owner.id,
      })
    }

    const summary = await service.getSummary(org.id, project.id)
    assert.equal(summary.totalRisks, 5)
    assert.equal(summary.openRisks, 4) // 4 open, 1 closed
    assert.equal(summary.highRiskCount, 2)
    assert.equal(summary.criticalRiskCount, 1)
    assert.lengthOf(summary.topRisks, 3) // 2 high + 1 critical
    assert.isNotNull(summary.healthScore)
  })

  test('getSummary 逾期复查计数正确', async ({ assert }) => {
    const { owner, org, project, service } = await setup()

    // 创建有复查日期的风险（已过期）
    await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '已逾期复查风险',
      description: '复查已逾期',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      riskLevel: 'medium',
      priority: 'normal',
      status: 'identified',
      nextReviewAt: DateTime.now().minus({ days: 10 }),
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    // 创建有复查日期但未过期的风险
    await Risk.create({
      organizationId: org.id,
      projectId: project.id,
      title: '未逾期复查风险',
      description: '复查未逾期',
      category: 'technical',
      probability: 3,
      impact: 3,
      score: 9,
      riskLevel: 'medium',
      priority: 'normal',
      status: 'identified',
      nextReviewAt: DateTime.now().plus({ days: 10 }),
      identifiedAt: DateTime.now(),
      createdBy: owner.id,
      updatedBy: owner.id,
    })

    const summary = await service.getSummary(org.id, project.id)
    assert.equal(summary.overdueReviewCount, 1)
  })
})

test.group('RiskMatrixConfigService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('matrix-owner') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const audit = new AuditService()
    const configService = new RiskMatrixConfigService(audit)
    return { owner, org, project, audit, configService }
  }

  test('upsert 创建默认配置', async ({ assert }) => {
    const { owner, org, project, configService } = await setup()

    const config = await configService.upsert(org.id, project.id, {}, owner.id)

    assert.equal(config.probabilityLevels, 5)
    assert.equal(config.impactLevels, 5)
    assert.equal(config.defaultBasis, 'inherent')
    assert.equal(config.cellLimit, 5)
    assert.isTrue(config.isActive)
  })

  test('upsert 概率等级低于 2 抛出 ValidationException', async ({ assert }) => {
    const { owner, org, project, configService } = await setup()

    try {
      await configService.upsert(org.id, project.id, { probabilityLevels: 1 }, owner.id)
      assert.fail('应抛出 ValidationException')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }
  })

  test('upsert 概率等级高于 10 抛出 ValidationException', async ({ assert }) => {
    const { owner, org, project, configService } = await setup()

    try {
      await configService.upsert(org.id, project.id, { probabilityLevels: 11 }, owner.id)
      assert.fail('应抛出 ValidationException')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }
  })

  test('upsert 影响等级低于 2 抛出 ValidationException', async ({ assert }) => {
    const { owner, org, project, configService } = await setup()

    try {
      await configService.upsert(org.id, project.id, { impactLevels: 1 }, owner.id)
      assert.fail('应抛出 ValidationException')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }
  })

  test('upsert 影响等级高于 10 抛出 ValidationException', async ({ assert }) => {
    const { owner, org, project, configService } = await setup()

    try {
      await configService.upsert(org.id, project.id, { impactLevels: 11 }, owner.id)
      assert.fail('应抛出 ValidationException')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }
  })

  test('upsert cellLimit 小于 1 抛出 ValidationException', async ({ assert }) => {
    const { owner, org, project, configService } = await setup()

    try {
      await configService.upsert(org.id, project.id, { cellLimit: 0 }, owner.id)
      assert.fail('应抛出 ValidationException')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }
  })

  test('upsert 可更新已存在的配置', async ({ assert }) => {
    const { owner, org, project, configService } = await setup()

    await configService.upsert(org.id, project.id, {}, owner.id)

    const updated = await configService.upsert(
      org.id,
      project.id,
      { probabilityLevels: 3, impactLevels: 4, cellLimit: 10 },
      owner.id,
    )

    assert.equal(updated.probabilityLevels, 3)
    assert.equal(updated.impactLevels, 4)
    assert.equal(updated.cellLimit, 10)
  })

  test('get 返回默认配置当无配置时', async ({ assert }) => {
    const configService = new RiskMatrixConfigService(new AuditService())
    const defaults = configService.getDefaultConfig()

    assert.equal(defaults.probabilityLevels, 5)
    assert.equal(defaults.impactLevels, 5)
    assert.equal(defaults.defaultBasis, 'inherent')
    assert.equal(defaults.cellLimit, 5)
  })

  test('upsert 空 zones 数组抛出 ValidationException', async ({ assert }) => {
    const { owner, org, project, configService } = await setup()

    try {
      await configService.upsert(org.id, project.id, { zones: [] }, owner.id)
      assert.fail('应抛出 ValidationException')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }
  })
})
