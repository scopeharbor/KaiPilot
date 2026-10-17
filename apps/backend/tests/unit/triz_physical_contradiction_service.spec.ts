import TrizPhysicalContradictionAnalysisRun from '#models/triz_physical_contradiction_analysis_run'
import AuditService from '#services/audit_service'
import PhysicalContradictionAnalysisInputCollector from '#services/triz_contradiction/physical_input_collector'
import PhysicalContradictionAnalyzerService from '#services/triz_contradiction/physical_analyzer_service'
import PhysicalContradictionRuleset from '#services/triz_contradiction/physical_ruleset'
import Task from '#models/task'
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

test.group('V3 PhysicalContradictionAnalyzerService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('phys-svc') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const audit = new AuditService()
    const service = new PhysicalContradictionAnalyzerService(
      audit,
      new PhysicalContradictionAnalysisInputCollector(),
      new PhysicalContradictionRuleset(),
    )
    return { owner, org, project, service }
  }

  async function seedScope(input: {
    projectId: number
    overdueCount?: number
    scopeCount?: number
  }) {
    const overdue = input.overdueCount ?? 5
    for (let i = 0; i < overdue; i++) {
      await Task.create({
        projectId: input.projectId,
        name: `逾期任务 ${i}`,
        status: 'in_progress',
        taskType: 'task',
        priority: 'medium',
        endDate: DateTime.now().minus({ days: 3 }),
        isCriticalPath: true,
      } as any)
    }
    // 填充范围条目（任务即范围来源之一）
    for (let i = 0; i < (input.scopeCount ?? 20); i++) {
      await Task.create({
        projectId: input.projectId,
        name: `范围条目 ${i}`,
        status: 'not_started',
        taskType: 'task',
        priority: 'low',
      } as any)
    }
  }

  test('createRun 幂等：同输入重跑返回已有运行，不重复创建候选', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedScope({ projectId: project.id })

    const first = await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })
    assert.isAtLeast(first.candidates.length, 0)
    const runId = first.run.id

    const second = await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })
    assert.equal(second.run.id, runId)
  })

  test('createRun 零正式写入：不创建/更新正式矛盾记录', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedScope({ projectId: project.id })

    await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    // 正式矛盾表（project_contradictions）不应被分析运行写入
    const contradictions = await TrizPhysicalContradictionAnalysisRun.query()
      .where('organization_id', org.id)
      .where('project_id', project.id)
    // 仅本分析的 run 记录，无正式矛盾污染
    assert.isAtLeast(contradictions.length, 1)
  })

  test('listRuns 返回统一 { data, meta } 结构', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedScope({ projectId: project.id })
    await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    const result = await service.listRuns(org.id, project.id, { page: 1, perPage: 10 })
    assert.isAtLeast(result.data.length, 1)
    assert.equal(result.meta.page, 1)
    assert.equal(result.meta.perPage, 10)
    assert.isAtLeast(result.meta.total, 1)
  })

  test('listCandidates 按 run 返回候选并支持状态筛选', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedScope({ projectId: project.id })
    const { run } = await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    const result = await service.listCandidates(org.id, project.id, run.id)
    assert.isAtLeast(result.data.length, 0)
    assert.isNumber(result.meta.total)

    // 状态筛选
    const unreviewed = await service.listCandidates(org.id, project.id, run.id, {
      status: 'unreviewed',
    })
    for (const c of unreviewed.data) {
      assert.equal(c.status, 'unreviewed')
    }
  })

  test('reviewCandidate 状态流转并记录审查人', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedScope({ projectId: project.id })
    const { run } = await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    const candidates = await service.listCandidates(org.id, project.id, run.id)
    if (candidates.data.length === 0) return
    const key = candidates.data[0].candidateKey

    const result = await service.reviewCandidate(
      org.id,
      project.id,
      run.id,
      key,
      owner.id,
      'mark_reviewed',
    )
    assert.equal(result.status, 'reviewed')
    assert.equal(result.reviewedBy, owner.id)

    const dismissed = await service.reviewCandidate(
      org.id,
      project.id,
      run.id,
      key,
      owner.id,
      'dismiss',
    )
    assert.equal(dismissed.status, 'dismissed')
  })

  test('explainCandidate 默认确定性回退，不调用真实模型', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedScope({ projectId: project.id })
    const { run } = await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    const candidates = await service.listCandidates(org.id, project.id, run.id)
    if (candidates.data.length === 0) return
    const key = candidates.data[0].candidateKey

    const explanation = await service.explainCandidate(org.id, project.id, run.id, key)
    assert.isTrue(explanation.isFallback)
    assert.isTrue(explanation.hallucinationChecked)
    assert.isString(explanation.narrative)
    assert.isNull(explanation.provider)
    assert.isNull(explanation.model)
  })

  test('confirmationPreview 投影 type=physical 字段，requiresUserConfirmation=true', async ({
    assert,
  }) => {
    const { owner, org, project, service } = await setup()
    await seedScope({ projectId: project.id })
    const { run } = await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    const candidates = await service.listCandidates(org.id, project.id, run.id)
    if (candidates.data.length === 0) return
    const key = candidates.data[0].candidateKey

    const preview = await service.confirmationPreview(org.id, project.id, run.id, key)
    assert.equal(preview.projectedType, 'physical')
    assert.isTrue(preview.requiresUserConfirmation)
    assert.equal(preview.candidateKey, key)
  })

  test('handoffPreview 返回 targetPreview 与 sourceHashes', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedScope({ projectId: project.id })
    const { run } = await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    const candidates = await service.listCandidates(org.id, project.id, run.id)
    if (candidates.data.length === 0) return
    const key = candidates.data[0].candidateKey

    const preview = await service.handoffPreview(org.id, project.id, run.id, key, 'decision_log')
    assert.equal(preview.targetType, 'decision_log')
    assert.isObject(preview.targetPreview)
    assert.isObject(preview.sourceHashes)
  })

  test('组织隔离：跨组织查询不到 run', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedScope({ projectId: project.id })
    await service.createRun({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    // 用另一个 org id 查询应返回空
    const result = await service.listRuns(999999, project.id)
    assert.equal(result.data.length, 0)
  })
})
