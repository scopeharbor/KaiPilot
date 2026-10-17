import AuditLog from '#models/audit_log'
import ChangeImpactAnalysis from '#models/change_impact_analysis'
import ChangeImpactItem from '#models/change_impact_item'
import ChangeRequest from '#models/change_request'
import Task from '#models/task'
import AuditService from '#services/audit_service'
import AiExplanationService from '#services/change_impact/ai_explanation_service'
import ChangeImpactAnalysisService from '#services/change_impact/analysis_service'
import ChangeImpactInputCollector from '#services/change_impact/input_collector'
import ChangeImpactRuleset from '#services/change_impact/ruleset'
import { ProjectRoleName } from '#rbac'
import type Organization from '#models/organization'
import type Project from '#models/project'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

/**
 * AI 影响解释反幻觉与 fake provider 测试
 * （v2-change-management-impact-analysis §7.4 / §7.5）。
 *
 * 断言：AI 不覆盖确定性严重度、不自动确认/审批、不写正式计划数据；
 * 默认测试不调用真实模型（走规则降级，provider 为空）。
 */

let crSeq = 0
async function makeCr(org: Organization, project: Project, userId: number): Promise<ChangeRequest> {
  crSeq += 1
  return ChangeRequest.create({
    crCode: `CR-AI-${process.pid}-${crSeq}`,
    organizationId: org.id,
    projectId: project.id,
    requesterId: userId,
    requestedBy: userId,
    title: 'AI 解释测试变更',
    changeType: 'scope',
    status: 'draft',
    priority: 'medium',
  })
}

async function setup() {
  const owner = await createUser({ email: uniqueEmail('ci-ai') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  const analysisService = new ChangeImpactAnalysisService(
    new AuditService(),
    new ChangeImpactInputCollector(),
    new ChangeImpactRuleset(),
  )
  const aiService = new AiExplanationService(new AuditService())
  return { owner, org, project, analysisService, aiService }
}

test.group('AiExplanationService 反幻觉 / fake provider', (group) => {
  useAuthDatabase(group)

  test('生成待确认建议，默认走规则降级（不调用真实模型）', async ({ assert }) => {
    const { owner, org, project, analysisService, aiService } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await analysisService.createAnalysis(org.id, project.id, cr.id, owner.id)

    const explanation = await aiService.generateExplanation(analysis.id, project.id, owner.id)

    assert.isTrue(explanation.needsConfirmation, 'AI 建议必须待确认')
    assert.equal(explanation.confidence, 0.7)
    assert.isString(explanation.summary)
    assert.isAbove(explanation.summary.length, 0)
    // fake/降级：无真实 provider/model/token 成本
    assert.isNull(explanation.provider, '默认测试不得调用真实模型（provider 应为空）')
    assert.isNull(explanation.model)
    assert.isNull(explanation.tokenCost)
  })

  test('AI 不覆盖确定性影响项严重度', async ({ assert }) => {
    const { owner, org, project, analysisService, aiService } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await analysisService.createAnalysis(org.id, project.id, cr.id, owner.id)

    // 注入一条确定性影响项
    await ChangeImpactItem.create({
      analysisId: analysis.id,
      entityType: 'task',
      entityId: 7,
      dimension: 'schedule',
      severity: 'high',
      score: 8,
      propagationPath: null,
      depth: 1,
      ruleId: 'R001',
      evidence: '确定性证据',
      requiresReview: true,
      isVisible: true,
    })

    await aiService.generateExplanation(analysis.id, project.id, owner.id)

    const item = await ChangeImpactItem.query()
      .where('analysis_id', analysis.id)
      .where('entity_id', 7)
      .firstOrFail()
    assert.equal(item.severity, 'high', 'AI 解释不得修改确定性严重度')
    assert.equal(item.score, 8)
    assert.equal(item.ruleId, 'R001')
  })

  test('AI 不自动确认分析、不自动审批', async ({ assert }) => {
    const { owner, org, project, analysisService, aiService } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await analysisService.createAnalysis(org.id, project.id, cr.id, owner.id)

    await aiService.generateExplanation(analysis.id, project.id, owner.id)

    const reloaded = await ChangeImpactAnalysis.findOrFail(analysis.id)
    assert.isNull(reloaded.confirmedBy, 'AI 生成不得自动确认分析')
    assert.isNull(reloaded.confirmedAt)
    // AI 建议本身也标记待确认
    assert.isTrue(reloaded.aiExplanation?.needsConfirmation)

    const reloadedCr = await ChangeRequest.findOrFail(cr.id)
    assert.equal(reloadedCr.status, 'draft', 'AI 生成不得自动推进审批状态')
    assert.isNull(reloadedCr.approveRefAnalysisId)
  })

  test('AI 生成不写正式计划数据（任务不变）', async ({ assert }) => {
    const { owner, org, project, analysisService, aiService } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const task = await Task.create({
      projectId: project.id,
      name: 'AI 计划保护任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    const analysis = await analysisService.createAnalysis(org.id, project.id, cr.id, owner.id)

    await aiService.generateExplanation(analysis.id, project.id, owner.id)

    const reloadedTask = await Task.findOrFail(task.id)
    assert.equal(reloadedTask.name, 'AI 计划保护任务')
    assert.equal(reloadedTask.status, 'not_started')

    // 审计事件已记录
    const logs = await AuditLog.query().where('entity_type', 'change_impact_analysis')
    assert.isTrue(logs.some((l) => l.metadata?.event === 'CHANGE_IMPACT_AI_EXPLANATION_GENERATED'))
  })
})
