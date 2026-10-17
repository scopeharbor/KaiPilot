import ProjectContradiction from '#models/project_contradiction'
import Task from '#models/task'
import AuditService from '#services/audit_service'
import ContradictionInputCollector from '#services/triz_contradiction/input_collector'
import AiContradictionExplanationService from '#services/triz_contradiction/ai_explanation_service'
import PrincipleSuggestionMapper from '#services/triz_contradiction/principle_mapper'
import ProjectContradictionService from '#services/triz_contradiction/project_contradiction_service'
import ContradictionDetectionRuleset from '#services/triz_contradiction/ruleset'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type { ContradictionAiExplanation } from '@aiproj/types'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('V2 TRIZ ProjectContradictionService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('triz-service') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const audit = new AuditService()
    const service = new ProjectContradictionService(
      audit,
      new ContradictionInputCollector(),
      new ContradictionDetectionRuleset(),
      new PrincipleSuggestionMapper(),
    )
    const ai = new AiContradictionExplanationService(audit, service)
    return { owner, org, project, service, ai }
  }

  async function addOverdueTask(projectId: number, name = '逾期关键任务') {
    return Task.create({
      projectId,
      name,
      status: 'in_progress',
      taskType: 'task',
      priority: 'medium',
      endDate: DateTime.now().minus({ days: 3 }),
    })
  }

  test('createOrUpdate 幂等创建并在签名一致时不重复新建', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await addOverdueTask(project.id)

    const first = await service.createOrUpdate(org.id, project.id, owner.id)
    assert.isAbove(first.created, 0)
    assert.equal(first.ruleVersion, '1.0.0')

    const second = await service.createOrUpdate(org.id, project.id, owner.id)
    assert.equal(second.created, 0)
    assert.isAbove(second.unchanged, 0)

    const rows = await ProjectContradiction.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
    assert.equal(rows.length, first.created)
  })

  test('confirm 与 dismiss 执行状态流转并记录字段', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await addOverdueTask(project.id)
    await service.refresh(org.id, project.id, owner.id)

    const record = await ProjectContradiction.query()
      .where('project_id', project.id)
      .where('status', 'draft')
      .firstOrFail()

    const confirmed = await service.confirm(org.id, project.id, record.id, owner.id)
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.confirmedBy, owner.id)
    assert.isNotNull(confirmed.confirmedAt)

    const dismissed = await service.dismiss(org.id, project.id, record.id, owner.id, '人工判定噪声')
    assert.equal(dismissed.status, 'dismissed')
    assert.equal(dismissed.dismissReason, '人工判定噪声')
    assert.equal(dismissed.dismissedBy, owner.id)
  })

  test('computeStale 在输入变化后标记 stale', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await addOverdueTask(project.id)
    await service.refresh(org.id, project.id, owner.id)

    await addOverdueTask(project.id, '新增逾期任务')
    const stale = await service.computeStale(org.id, project.id)
    assert.equal(stale.isStale, true)

    const latest = await ProjectContradiction.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .firstOrFail()
    assert.equal(latest.stale, true)
  })

  test('AI 解释使用 fake/fallback 成本摘要且不调用真实模型', async ({ assert }) => {
    const { owner, org, project, service, ai } = await setup()
    await addOverdueTask(project.id)
    await service.refresh(org.id, project.id, owner.id)

    const record = await ProjectContradiction.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .firstOrFail()

    const explanation = await ai.explain({
      organizationId: org.id,
      projectId: project.id,
      contradictionId: record.id,
      userId: owner.id,
    })

    assert.equal(explanation.provider, 'fake')
    assert.equal(explanation.needsConfirmation, true)
    assert.equal(explanation.hallucinationChecked, true)
    assert.isString(explanation.cost?.inputHash)
    assert.isString(explanation.cost?.outputRef)
  })

  test('AI 解释引用不可追溯参数或原理时降级为规则摘要', async ({ assert }) => {
    const { owner, org, project, service, ai } = await setup()
    await addOverdueTask(project.id)
    await service.refresh(org.id, project.id, owner.id)

    const record = await ProjectContradiction.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
      .firstOrFail()
    const guard = ai as unknown as {
      validateTraceability: (
        contradiction: ProjectContradiction,
        explanation: ContradictionAiExplanation,
      ) => ContradictionAiExplanation
    }

    const checked = guard.validateTraceability(record, {
      narrative: '编造的解释',
      isFallback: false,
      hallucinationChecked: true,
      degradedReason: null,
      referencedPrincipleIds: ['inversion'],
      referencedParameterKeys: ['duration'],
      confidence: 0.8,
      provider: 'fake',
      model: 'fixture',
      needsConfirmation: true,
    })

    assert.equal(checked.isFallback, true)
    assert.equal(checked.degradedReason, 'AI 草稿引用了不可追溯的参数或发明原理')
  })
})
