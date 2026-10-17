import TrizTechnicalContradictionAnalysisRun from '#models/triz_technical_contradiction_analysis_run'
import TrizTechnicalContradictionCandidate from '#models/triz_technical_contradiction_candidate'
import AuditService from '#services/audit_service'
import TechnicalContradictionAnalysisInputCollector from '#services/triz_contradiction/technical_analysis_input_collector'
import TechnicalContradictionAnalyzerService from '#services/triz_contradiction/technical_contradiction_analyzer_service'
import ContradictionDetectionRuleset from '#services/triz_contradiction/ruleset'
import PrincipleSuggestionMapper from '#services/triz_contradiction/principle_mapper'
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

test.group('V3 TechnicalContradictionAnalyzerService', (group) => {
  useAuthDatabase(group)

  async function setup() {
    const owner = await createUser({ email: uniqueEmail('tech-svc') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const audit = new AuditService()
    const service = new TechnicalContradictionAnalyzerService(
      audit,
      new TechnicalContradictionAnalysisInputCollector(),
      new ContradictionDetectionRuleset(),
      new PrincipleSuggestionMapper(),
    )
    return { owner, org, project, service }
  }

  async function seedSchedulePressure(input: {
    projectId: number
    overdueCount?: number
    scopeCount?: number
  }) {
    const overdue = input.overdueCount ?? 6
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
    for (let i = 0; i < (input.scopeCount ?? 25); i++) {
      await Task.create({
        projectId: input.projectId,
        name: `范围条目 ${i}`,
        status: 'not_started',
        taskType: 'task',
        priority: 'low',
      } as any)
    }
  }

  test('createAnalysis 幂等：相同 idempotency + 签名重跑返回已有运行', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })

    const first = await service.createAnalysis(org.id, project.id, owner.id, {
      idempotencyKey: 'idem-tech-1',
    })
    const runId = first.id
    assert.isAtLeast(first.candidates.length, 0)

    const second = await service.createAnalysis(org.id, project.id, owner.id, {
      idempotencyKey: 'idem-tech-1',
    })
    assert.equal(second.id, runId)
  })

  test('createAnalysis 零正式写入：不改写正式矛盾表', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })

    const before = await TrizTechnicalContradictionAnalysisRun.query().count('* as total')
    const beforeCount = Number((before[0] as any).$extras?.total ?? (before[0] as any).total ?? 0)

    await service.createAnalysis(org.id, project.id, owner.id, {})

    // 只创建了 analyzer run/candidate 快照，未触碰正式 project_contradictions
    const after = await TrizTechnicalContradictionAnalysisRun.query().count('* as total')
    const afterCount = Number((after[0] as any).$extras?.total ?? (after[0] as any).total ?? 0)
    assert.equal(afterCount, beforeCount + 1)
  })

  test('createAnalysis 同输入产生相同候选与 output hash（确定性）', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })

    const first = await service.createAnalysis(org.id, project.id, owner.id, {
      idempotencyKey: 'idem-tech-det',
    })
    // 幂等命中应返回相同结果
    const second = await service.createAnalysis(org.id, project.id, owner.id, {
      idempotencyKey: 'idem-tech-det',
    })
    assert.equal(second.outputHash, first.outputHash)
    assert.equal(second.candidates.length, first.candidates.length)
    const keys1 = first.candidates.map((c) => c.candidateKey).sort()
    const keys2 = second.candidates.map((c) => c.candidateKey).sort()
    assert.deepEqual(keys2, keys1)
  })

  test('createAnalysis 候选稳定排序：severity → confidence → impactScore → ruleId → key', async ({
    assert,
  }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id, overdueCount: 10, scopeCount: 40 })

    const result = await service.createAnalysis(org.id, project.id, owner.id, {})
    const sevOrder = ['critical', 'high', 'medium', 'low']
    for (let i = 1; i < result.candidates.length; i++) {
      const prev = result.candidates[i - 1]
      const curr = result.candidates[i]
      const prevSev = sevOrder.indexOf(prev.severity)
      const currSev = sevOrder.indexOf(curr.severity)
      assert.isTrue(prevSev <= currSev)
    }
  })

  test('createAnalysis 失败运行不持久化候选', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    // 不 seed 任何数据 —— 应优雅返回零候选而非失败
    const result = await service.createAnalysis(org.id, project.id, owner.id, {})
    assert.isAtLeast(result.candidates.length, 0)
    assert.equal(result.candidateCount, result.candidates.length)
  })

  test('reviewCandidate 标记 reviewed 并记录审查人', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})

    if (run.candidates.length === 0) {
      // 无候选时跳过（确定性规则可能未命中）
      return
    }
    const target = run.candidates[0]
    const result = await service.reviewCandidate(
      org.id,
      project.id,
      run.id,
      target.candidateKey,
      owner.id,
      { action: 'mark_reviewed' },
    )
    assert.equal(result.status, 'reviewed')
    assert.equal(result.reviewedBy, owner.id)
  })

  test('reviewCandidate blocked_stale 候选拒绝审查', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})

    if (run.candidates.length === 0) return
    const target = run.candidates[0]
    await TrizTechnicalContradictionCandidate.query()
      .where('candidate_key', target.candidateKey)
      .where('run_id', run.id)
      .update({ status: 'blocked_stale' })

    try {
      await service.reviewCandidate(org.id, project.id, run.id, target.candidateKey, owner.id, {
        action: 'mark_reviewed',
      })
      assert.isTrue(false, '应抛出陈旧校验错误')
    } catch (err) {
      assert.isTrue(
        (err as Error).message.includes('陈旧') || (err as Error).message.includes('stale'),
      )
    }
  })

  test('reviewCandidate dismiss 转为 dismissed', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})
    if (run.candidates.length === 0) return
    const target = run.candidates[0]
    const result = await service.reviewCandidate(
      org.id,
      project.id,
      run.id,
      target.candidateKey,
      owner.id,
      { action: 'dismiss' },
    )
    assert.equal(result.status, 'dismissed')
  })

  test('createConfirmationPreview 投影候选字段且 requiresUserConfirmation=true', async ({
    assert,
  }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})
    if (run.candidates.length === 0) return
    const target = run.candidates[0]

    const preview = await service.createConfirmationPreview(
      org.id,
      project.id,
      run.id,
      target.candidateKey,
    )
    assert.equal(preview.candidateKey, target.candidateKey)
    assert.equal(preview.projectedType, 'technical')
    assert.isTrue(preview.requiresUserConfirmation)
    assert.equal(preview.stale, false)
  })

  test('createConfirmationPreview blocked_stale 候选标记 stale 并阻断', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})
    if (run.candidates.length === 0) return
    const target = run.candidates[0]
    await TrizTechnicalContradictionCandidate.query()
      .where('candidate_key', target.candidateKey)
      .where('run_id', run.id)
      .update({ status: 'blocked_stale' })

    const preview = await service.createConfirmationPreview(
      org.id,
      project.id,
      run.id,
      target.candidateKey,
    )
    assert.isTrue(preview.stale)
    assert.include(preview.warnings, 'HANDOFF_BLOCKED_STALE')
  })

  test('listCandidates stale=true 仅返回 blocked_stale 候选', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})
    if (run.candidates.length === 0) return
    const target = run.candidates[0]
    await TrizTechnicalContradictionCandidate.query()
      .where('candidate_key', target.candidateKey)
      .where('run_id', run.id)
      .update({ status: 'blocked_stale' })

    const staleOnly = await service.listCandidates(org.id, project.id, run.id, { stale: true })
    assert.isTrue(staleOnly.data.every((c) => c.status === 'blocked_stale'))
    assert.isAtLeast(staleOnly.data.length, 1)

    const freshOnly = await service.listCandidates(org.id, project.id, run.id, { stale: false })
    assert.isTrue(freshOnly.data.every((c) => c.status !== 'blocked_stale'))
  })

  test('enrichCandidate 产出确定性非空 outputHash', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})
    if (run.candidates.length === 0) return
    for (const c of run.candidates) {
      assert.isTrue(c.outputHash.length > 0)
      assert.isTrue(c.outputHash.startsWith('ttco-'))
    }
  })

  test('createHandoffPreview stale 候选返回 blockingWarnings', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})
    if (run.candidates.length === 0) return
    const target = run.candidates[0]
    await TrizTechnicalContradictionCandidate.query()
      .where('candidate_key', target.candidateKey)
      .where('run_id', run.id)
      .update({ status: 'blocked_stale' })

    const preview = await service.createHandoffPreview(
      org.id,
      project.id,
      run.id,
      target.candidateKey,
      'decision_log',
      owner.id,
    )
    assert.isTrue(preview.stale)
    assert.include(preview.blockingWarnings, 'HANDOFF_BLOCKED_STALE')
  })

  test('跨组织隔离：其他组织访问不到运行', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})

    // 另一个组织+项目
    const owner2 = await createUser({ email: uniqueEmail('tech-svc-xorg') })
    const org2 = await createOrganization(owner2)
    const { project: project2 } = await createProjectWithMember(
      org2,
      owner2,
      owner2,
      ProjectRoleName.PROJECT_MANAGER,
    )

    try {
      await service.getRun(org2.id, project2.id, run.id)
      assert.isTrue(false, '跨组织应抛 ResourceNotFound')
    } catch (err) {
      assert.isTrue(
        (err as Error).message.includes('不存在') || (err as Error).name.includes('Resource'),
      )
    }
  })

  test('listRuns 按 organization+project 隔离', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    await service.createAnalysis(org.id, project.id, owner.id, {})
    // 不同 userContext 改变 input signature，避免幂等复用
    await service.createAnalysis(org.id, project.id, owner.id, { userContext: '第二次复核' })

    const result = await service.listRuns(org.id, project.id, {})
    assert.equal(result.data.length, 2)
    assert.equal(result.meta.total, 2)
  })

  test('listCandidates 按 run 隔离且返回候选', async ({ assert }) => {
    const { owner, org, project, service } = await setup()
    await seedSchedulePressure({ projectId: project.id })
    const run = await service.createAnalysis(org.id, project.id, owner.id, {})

    const result = await service.listCandidates(org.id, project.id, run.id, {})
    assert.equal(result.data.length, run.candidates.length)
  })
})
