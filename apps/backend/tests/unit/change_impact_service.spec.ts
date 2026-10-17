import AuditLog from '#models/audit_log'
import ChangeRequest from '#models/change_request'
import Task from '#models/task'
import AuditService from '#services/audit_service'
import ChangeImpactAnalysisService from '#services/change_impact/analysis_service'
import ChangeImpactInputCollector from '#services/change_impact/input_collector'
import ChangeImpactRuleset from '#services/change_impact/ruleset'
import { ValidationException } from '#exceptions/api_exception'
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
 * 影响分析服务测试（v2-change-management-impact-analysis §5.6 / §10.1）。
 * 覆盖创建、刷新、过期检测、人工确认、审批引用、重复刷新与无自动执行断言。
 */

function makeService(): ChangeImpactAnalysisService {
  return new ChangeImpactAnalysisService(
    new AuditService(),
    new ChangeImpactInputCollector(),
    new ChangeImpactRuleset(),
  )
}

let crSeq = 0
async function makeCr(org: Organization, project: Project, userId: number): Promise<ChangeRequest> {
  crSeq += 1
  return ChangeRequest.create({
    crCode: `CR-SVC-${process.pid}-${crSeq}`,
    organizationId: org.id,
    projectId: project.id,
    requesterId: userId,
    requestedBy: userId,
    title: '服务测试变更',
    changeType: 'scope',
    status: 'draft',
    priority: 'medium',
  })
}

async function setup() {
  const owner = await createUser({ email: uniqueEmail('ci-svc') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project, service: makeService() }
}

test.group('ChangeImpactAnalysisService', (group) => {
  useAuthDatabase(group)

  test('createAnalysis 保存快照并回填变更请求当前分析引用', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const cr = await makeCr(org, project, owner.id)

    const analysis = await service.createAnalysis(org.id, project.id, cr.id, owner.id)

    assert.equal(analysis.status, 'completed')
    assert.equal(analysis.ruleVersion, '2.0.0')
    assert.isString(analysis.inputSignature)

    const reloadedCr = await ChangeRequest.findOrFail(cr.id)
    assert.equal(Number(reloadedCr.currentImpactAnalysisId), analysis.id)

    // 审计事件
    const logs = await AuditLog.query().where('entity_type', 'change_impact_analysis')
    assert.isTrue(logs.some((l) => l.metadata?.event === 'CHANGE_IMPACT_ANALYSIS_CREATED'))
  })

  test('refreshAnalysis 创建新快照并保留旧快照', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const cr = await makeCr(org, project, owner.id)

    const first = await service.createAnalysis(org.id, project.id, cr.id, owner.id)
    const refreshed = await service.refreshAnalysis(org.id, project.id, cr.id, owner.id)

    assert.notEqual(refreshed.id, first.id)
    const { data, meta } = await service.listAnalyses(project.id, cr.id)
    assert.equal(meta.total, 2, '旧快照应保留')
    assert.equal(data[0].id, refreshed.id, '列表按时间倒序，最新在前')
  })

  test('detectStale：新分析非过期，markStale 后判为过期', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await service.createAnalysis(org.id, project.id, cr.id, owner.id)

    const fresh = await service.detectStale(analysis.id, project.id)
    assert.isFalse(fresh.isStale)

    await service.markStale(analysis.id, project.id, '手动标记过期')
    const stale = await service.detectStale(analysis.id, project.id)
    assert.isTrue(stale.isStale)
  })

  test('detectStale：关联任务变更后基于输入签名判为过期', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const task = await Task.create({
      projectId: project.id,
      name: '签名任务',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    const cr = await makeCr(org, project, owner.id)
    cr.relatedTaskIds = [task.id]
    await cr.save()

    const analysis = await service.createAnalysis(org.id, project.id, cr.id, owner.id)
    task.name = '签名任务已变更'
    await task.save()

    const stale = await service.detectStale(analysis.id, project.id)
    assert.isTrue(stale.isStale)
    assert.include(stale.reason ?? '', '项目事实')
  })

  test('confirmAnalysis 记录人工确认与审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await service.createAnalysis(org.id, project.id, cr.id, owner.id)

    const confirmed = await service.confirmAnalysis(analysis.id, project.id, owner.id, '已复核')
    assert.equal(confirmed.confirmedBy, owner.id)
    assert.isNotNull(confirmed.confirmedAt)

    const logs = await AuditLog.query().where('entity_type', 'change_impact_analysis')
    assert.isTrue(logs.some((l) => l.metadata?.event === 'CHANGE_IMPACT_ANALYSIS_CONFIRMED'))
  })

  test('confirmStaleAnalysis 标记 stale 并记录原因', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await service.createAnalysis(org.id, project.id, cr.id, owner.id)

    const result = await service.confirmStaleAnalysis(analysis.id, project.id, owner.id, '继续沿用')
    assert.equal(result.status, 'stale')
    assert.equal(result.confirmReason, '继续沿用')
  })

  test('referenceForApproval：未过期分析写入审批引用与审计', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await service.createAnalysis(org.id, project.id, cr.id, owner.id)

    await service.referenceForApproval(org.id, project.id, cr.id, analysis.id, owner.id)

    const reloadedCr = await ChangeRequest.findOrFail(cr.id)
    assert.equal(Number(reloadedCr.approveRefAnalysisId), analysis.id)
    assert.equal(reloadedCr.impactAnalysisConfirmStatus, 'confirmed')

    const logs = await AuditLog.query().where('entity_type', 'change_impact_analysis')
    assert.isTrue(logs.some((l) => l.metadata?.event === 'CHANGE_IMPACT_APPROVE_REFERENCED'))
  })

  test('referenceForApproval：过期分析无确认理由被阻断，有理由则标记 confirmed_stale', async ({
    assert,
  }) => {
    const { owner, org, project, service } = await setup()
    const cr = await makeCr(org, project, owner.id)
    const analysis = await service.createAnalysis(org.id, project.id, cr.id, owner.id)
    await service.markStale(analysis.id, project.id, '过期')

    // 无确认理由 → 阻断
    try {
      await service.referenceForApproval(org.id, project.id, cr.id, analysis.id, owner.id)
      assert.fail('过期分析无确认理由时应阻断审批引用')
    } catch (error) {
      assert.instanceOf(error, ValidationException)
    }

    // 阻断后不得写入审批引用
    let reloadedCr = await ChangeRequest.findOrFail(cr.id)
    assert.isNull(reloadedCr.approveRefAnalysisId)

    // 有确认理由 → 通过，标记 confirmed_stale
    await service.referenceForApproval(
      org.id,
      project.id,
      cr.id,
      analysis.id,
      owner.id,
      '风险可控继续使用',
    )
    reloadedCr = await ChangeRequest.findOrFail(cr.id)
    assert.equal(Number(reloadedCr.approveRefAnalysisId), analysis.id)
    assert.equal(reloadedCr.impactAnalysisConfirmStatus, 'confirmed_stale')
  })

  test('无自动执行：create/refresh/reference 不新增或修改任务、依赖', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    const cr = await makeCr(org, project, owner.id)

    // 预置任务
    const taskA = await Task.create({
      projectId: project.id,
      name: '既有任务A',
      status: 'not_started',
      priority: 'medium',
      taskType: 'task',
    })
    const beforeCount = await Task.query().where('project_id', project.id).count('* as total')
    const beforeTotal = Number(
      (beforeCount[0] as unknown as { $extras: { total: number } }).$extras.total,
    )

    const analysis = await service.createAnalysis(org.id, project.id, cr.id, owner.id)
    await service.refreshAnalysis(org.id, project.id, cr.id, owner.id)
    const latest = await ChangeRequest.findOrFail(cr.id)
    await service.referenceForApproval(
      org.id,
      project.id,
      cr.id,
      Number(latest.currentImpactAnalysisId),
      owner.id,
    )

    const afterCount = await Task.query().where('project_id', project.id).count('* as total')
    const afterTotal = Number(
      (afterCount[0] as unknown as { $extras: { total: number } }).$extras.total,
    )
    assert.equal(afterTotal, beforeTotal, '影响分析不得新增/删除任务')

    const reloadedTask = await Task.findOrFail(taskA.id)
    assert.equal(reloadedTask.name, '既有任务A', '影响分析不得修改任务字段')
    assert.equal(reloadedTask.status, 'not_started')
    void analysis
  })
})
