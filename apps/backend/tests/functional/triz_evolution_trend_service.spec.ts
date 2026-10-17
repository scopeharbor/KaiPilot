import app from '@adonisjs/core/services/app'
import Risk from '#models/risk'
import Task from '#models/task'
import TrizEvolutionTrendAnalysisInputCollector from '#services/triz_evolution_trend_input_collector'
import TrizEvolutionTrendAnalysisService from '#services/triz_evolution_trend_analysis_service'
import TrizEvolutionTrendPolicy from '#policies/triz_evolution_trend_policy'
import TrizEvolutionTrendAnalysisRun from '#models/triz_evolution_trend_analysis_run'
import TrizEvolutionTrendRiskCandidate from '#models/triz_evolution_trend_risk_candidate'
import AuditLog from '#models/audit_log'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { computeEvolutionTrendInputSignature } from '@aiproj/types'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

// ===========================================================================
// 收集器 / 服务 / 策略层测试（v3-triz-evolution-trend-analysis §4.3、§4.11、§3.6、§3.8、§6.3）
//
// 收集器：授权来源真实读取、缺失来源 warning、跨组织不泄露、用户信号、只读无副作用。
// 服务：幂等复用、stale 标记、分页/筛选、审查状态、跨组织掩蔽、AI provider 降级。
// 策略：view/manage/aiExplain 分离。
// ===========================================================================

async function seedProjectFacts(projectId: number, organizationId: number, createdBy: number) {
  for (let i = 0; i < 20; i++) {
    await Task.create({
      projectId,
      name: `任务 ${i}`,
      status: i < 4 ? 'blocked' : 'not_started',
      taskType: 'task',
      priority: 'medium',
    } as any)
  }
  await Risk.create({
    organizationId,
    projectId,
    title: '关键技术风险',
    description: '关键路径存在重大技术不确定性',
    category: 'technical',
    probability: 4,
    impact: 5,
    score: 20,
    status: 'identified',
    identifiedAt: DateTime.now(),
    createdBy,
  } as any)
}

async function makeProjectContext() {
  const owner = await createUser({ email: uniqueEmail('et-svc') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

test.group('TrizEvolutionTrendAnalysisInputCollector', (group) => {
  useAuthDatabase(group)

  test('读取授权项目来源并产出真实计数与来源 hash', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const collector = await app.container.make(TrizEvolutionTrendAnalysisInputCollector)
    const out = await collector.collect({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    assert.equal(out.projectName, '测试项目')
    assert.equal(out.taskTotal, 20)
    assert.isAtLeast(out.memberCount, 1)
    assert.isAtLeast(out.distinctRoleCount, 1)
    assert.isString(out.sourceHashes.tasks_wbs)
    assert.isString(out.sourceHashes.members)
    assert.isString(out.sourceHashes.risks)
    // 5 个被阻塞任务应触发 averageBlockedWaitDays 非空
    assert.isNotNull(out.averageBlockedWaitDays)
    assert.equal(out.blockedTaskCount, 4)
  })

  test('跨组织项目不返回任何计数、标签与 hash', async ({ assert }) => {
    const { project } = await makeProjectContext()
    await seedProjectFacts(project.id, 1, 1)

    const otherOwner = await createUser({ email: uniqueEmail('et-other') })
    const otherOrg = await createOrganization(otherOwner)

    const collector = await app.container.make(TrizEvolutionTrendAnalysisInputCollector)
    const out = await collector.collect({
      organizationId: otherOrg.id,
      projectId: project.id,
      actorId: otherOwner.id,
    })

    assert.equal(out.projectName, '')
    assert.equal(out.taskTotal, 0)
    assert.equal(out.memberCount, 0)
    assert.deepEqual(out.sourceHashes, {})
    assert.include(
      out.warnings.map((w) => w.code),
      'PERMISSION_RESTRICTED',
    )
    assert.notInclude(JSON.stringify(out), '测试项目')
  })

  test('收集过程不写入任何正式数据', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const countFormalRows = async () => {
      const tasks = await Task.query().where('project_id', project.id)
      const risks = await Risk.query().where('project_id', project.id)
      return { tasks: tasks.length, risks: risks.length }
    }
    const before = await countFormalRows()

    const collector = await app.container.make(TrizEvolutionTrendAnalysisInputCollector)
    await collector.collect({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    assert.deepEqual(await countFormalRows(), before)
  })

  test('相同来源两次收集产出相同输入签名', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const collector = await app.container.make(TrizEvolutionTrendAnalysisInputCollector)
    const args = { organizationId: org.id, projectId: project.id, actorId: owner.id }
    const first = await collector.collect(args)
    const second = await collector.collect(args)

    assert.equal(
      computeEvolutionTrendInputSignature(first),
      computeEvolutionTrendInputSignature(second),
    )
  })

  test('用户补充趋势信号被原样带入', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()

    const collector = await app.container.make(TrizEvolutionTrendAnalysisInputCollector)
    const out = await collector.collect({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      manualTrendSignals: [
        {
          trendId: 'ideality_increase',
          direction: 'declining',
          signal: '用户补充的外部信号',
          sourceNote: null,
        },
      ],
    })

    assert.lengthOf(out.manualTrendSignals, 1)
    assert.equal(out.manualTrendSignals[0]!.trendId, 'ideality_increase')
  })
})

test.group('TrizEvolutionTrendAnalysisService', (group) => {
  useAuthDatabase(group)

  test('幂等：相同输入复用同一 run，不重复落库', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const service = await app.container.make(TrizEvolutionTrendAnalysisService)
    const first = await service.createRun(org.id, project.id, owner.id, {})
    const second = await service.createRun(org.id, project.id, owner.id, {})

    assert.equal(first.run.id, second.run.id)
    assert.equal(first.run.outputHash, second.run.outputHash)
    const runs = await TrizEvolutionTrendAnalysisRun.query().where('project_id', project.id)
    assert.lengthOf(runs, 1)
  })

  test('输入变化时旧 run 被标 stale，候选被阻断', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const service = await app.container.make(TrizEvolutionTrendAnalysisService)
    const first = await service.createRun(org.id, project.id, owner.id, {
      idempotencyKey: 'fixed-key-et',
    })

    // 来源变化：新增任务
    await Task.create({
      projectId: project.id,
      name: '新增任务',
      status: 'not_started',
      taskType: 'task',
      priority: 'medium',
    } as any)

    const second = await service.createRun(org.id, project.id, owner.id, {
      idempotencyKey: 'fixed-key-et',
    })

    assert.notEqual(first.run.id, second.run.id)
    const stale = await TrizEvolutionTrendAnalysisRun.findOrFail(first.run.id)
    assert.equal(stale.status, 'stale')

    const blocked = await TrizEvolutionTrendRiskCandidate.query().where('run_id', first.run.id)
    for (const candidate of blocked) {
      assert.equal(candidate.status, 'blocked_stale')
    }
  })

  test('候选与评分读取支持分页与筛选，并保持稳定排序', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const service = await app.container.make(TrizEvolutionTrendAnalysisService)
    const created = await service.createRun(org.id, project.id, owner.id, {})

    const page = await service.listRisks(org.id, project.id, created.run.id, {
      page: 1,
      perPage: 2,
    })
    assert.isAtMost(page.data.length, 2)
    assert.equal(page.meta.page, 1)
    assert.isAtLeast(page.meta.total, 1)

    const trendsPage = await service.listTrends(org.id, project.id, created.run.id, {})
    assert.lengthOf(trendsPage.data, 8)

    const all = await service.listRisks(org.id, project.id, created.run.id, {})
    const again = await service.listRisks(org.id, project.id, created.run.id, {})
    assert.deepEqual(
      all.data.map((r) => r.riskKey),
      again.data.map((r) => r.riskKey),
    )
  })

  test('审查写入状态与审查人，且不改动候选评分', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const service = await app.container.make(TrizEvolutionTrendAnalysisService)
    const created = await service.createRun(org.id, project.id, owner.id, {})
    const target = created.risks[0]!

    const reviewed = await service.reviewRisk(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
      { action: 'mark_reviewed' },
    )

    assert.equal(reviewed.status, 'reviewed')
    assert.equal(reviewed.reviewedBy, owner.id)
    assert.equal(reviewed.impactScore, target.impactScore)
    assert.equal(reviewed.severity, target.severity)
    assert.equal(reviewed.riskKey, target.riskKey)
  })

  test('跨组织读取被掩蔽为空/不存在', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const service = await app.container.make(TrizEvolutionTrendAnalysisService)
    const created = await service.createRun(org.id, project.id, owner.id, {})

    const otherOwner = await createUser({ email: uniqueEmail('et-mask') })
    const otherOrg = await createOrganization(otherOwner)

    assert.isNull(await service.getRun(otherOrg.id, project.id, created.run.id))
    const masked = await service.listRisks(otherOrg.id, project.id, created.run.id, {})
    assert.lengthOf(masked.data, 0)
    assert.equal(masked.meta.total, 0)
  })

  test('历史对比：无基线时 baselineRunId 为 null 且预测抑制', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const service = await app.container.make(TrizEvolutionTrendAnalysisService)
    const created = await service.createRun(org.id, project.id, owner.id, {})

    const comparison = await service.historyComparison(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      {},
    )
    assert.isNull(comparison.baselineRunId)
    assert.isTrue(comparison.forecastSuppressed)
    assert.isNull(comparison.forecast)
  })

  test('历史对比：有基线时产出趋势 delta', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const service = await app.container.make(TrizEvolutionTrendAnalysisService)
    const first = await service.createRun(org.id, project.id, owner.id, {
      idempotencyKey: 'baseline-et',
    })
    // 改变输入使第二次不命中幂等
    await Task.create({
      projectId: project.id,
      name: '变化任务',
      status: 'not_started',
      taskType: 'task',
      priority: 'medium',
    } as any)
    const second = await service.createRun(org.id, project.id, owner.id, {
      idempotencyKey: 'baseline-et',
    })

    const comparison = await service.historyComparison(
      org.id,
      project.id,
      owner.id,
      second.run.id,
      { baselineRunId: first.run.id },
    )
    assert.equal(comparison.baselineRunId, first.run.id)
    assert.isAtLeast(comparison.trendDeltas.length, 1)
  })

  test('AI 说明默认走确定性回退且不改动候选事实', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)

    const service = await app.container.make(TrizEvolutionTrendAnalysisService)
    const created = await service.createRun(org.id, project.id, owner.id, {})
    const target = created.risks[0]!

    const explained = await service.explainRisk(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )

    assert.isTrue(explained.explanation.isFallback)
    assert.isNull(explained.explanation.provider)
    assert.isNull(explained.explanation.model)

    const after = await service.getRisk(org.id, project.id, created.run.id, target.id!)
    assert.equal(after!.impactScore, target.impactScore)
    assert.equal(after!.outputHash, target.outputHash)
    assert.equal(after!.status, 'unreviewed')
  })
})

test.group('TrizEvolutionTrendAnalysisService — 说明 provider 与降级', (group) => {
  useAuthDatabase(group)

  async function makeRunWithCandidate() {
    const { owner, org, project } = await makeProjectContext()
    await seedProjectFacts(project.id, org.id, owner.id)
    const service = await app.container.make(TrizEvolutionTrendAnalysisService)
    const created = await service.createRun(org.id, project.id, owner.id, {})
    return { owner, org, project, service, created, target: created.risks[0]! }
  }

  async function assertFactsUnchanged(
    service: TrizEvolutionTrendAnalysisService,
    orgId: number,
    projectId: number,
    runId: number,
    target: { id?: number; impactScore: number; outputHash: string; riskKey: string },
    assert: any,
  ) {
    const after = await service.getRisk(orgId, projectId, runId, target.id!)
    assert.equal(after!.impactScore, target.impactScore)
    assert.equal(after!.outputHash, target.outputHash)
    assert.equal(after!.riskKey, target.riskKey)
    assert.equal(after!.status, 'unreviewed')
  }

  test('注入 provider 成功时返回模型说明与成本摘要', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()

    service.setExplanationProvider({
      async generate(input) {
        return {
          narrative: '该候选可通过重新分配角色与拆分任务缓解，需人工确认后执行。',
          referencedTrendKeys: input.allowedSourceHashes.slice(0, 0),
          referencedRiskKeys: [],
          provider: 'fake',
          model: 'fake-model',
          promptTokens: 500,
          completionTokens: 120,
          latencyMs: 80,
        }
      },
    })

    const explained = await service.explainRisk(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )
    assert.isFalse(explained.explanation.isFallback)
    assert.isTrue(explained.explanation.hallucinationChecked)
    assert.equal(explained.explanation.provider, 'fake')
    assert.equal(explained.explanation.cost!.promptTokens, 500)
    await assertFactsUnchanged(service, org.id, project.id, created.run.id, target, assert)
  })

  test('预算硬上限触发时阻断调用并降级', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    const original = process.env.AIPROJ_TRIZ_EVOLUTION_TREND_AI_BUDGET_USD
    process.env.AIPROJ_TRIZ_EVOLUTION_TREND_AI_BUDGET_USD = '0'

    let called = false
    service.setExplanationProvider({
      async generate() {
        called = true
        return { narrative: '不应被调用', referencedTrendKeys: [], referencedRiskKeys: [] }
      },
    })

    try {
      const explained = await service.explainRisk(
        org.id,
        project.id,
        owner.id,
        created.run.id,
        target.id!,
      )
      assert.isFalse(called, '预算阻断后不得发起 provider 调用')
      assert.isTrue(explained.explanation.isFallback)
      assert.include(explained.explanation.degradedReason ?? '', '预算')
      assert.isNull(explained.explanation.cost)
      await assertFactsUnchanged(service, org.id, project.id, created.run.id, target, assert)
    } finally {
      if (original === undefined) delete process.env.AIPROJ_TRIZ_EVOLUTION_TREND_AI_BUDGET_USD
      else process.env.AIPROJ_TRIZ_EVOLUTION_TREND_AI_BUDGET_USD = original
    }
  })

  test('引用未授权趋势 key 时反幻觉校验拦截并降级', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    service.setExplanationProvider({
      async generate() {
        return {
          narrative: '某未授权趋势也需关注。',
          referencedTrendKeys: ['trk-not-authorized'],
          referencedRiskKeys: [],
        }
      },
    })

    const explained = await service.explainRisk(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )
    assert.isTrue(explained.explanation.isFallback)
    assert.include(explained.explanation.degradedReason ?? '', '未授权')
    assert.notInclude(explained.explanation.referencedTrendKeys, 'trk-not-authorized')
    await assertFactsUnchanged(service, org.id, project.id, created.run.id, target, assert)
  })

  test('AI 输出含外部事实时反幻觉拦截并降级', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    service.setExplanationProvider({
      async generate() {
        return {
          narrative: '建议参考 GitHub 上的开源方案与 AWS 定价。',
          referencedTrendKeys: [],
          referencedRiskKeys: [],
        }
      },
    })

    const explained = await service.explainRisk(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )
    assert.isTrue(explained.explanation.isFallback)
    assert.include(explained.explanation.degradedReason ?? '', '外部事实')
    await assertFactsUnchanged(service, org.id, project.id, created.run.id, target, assert)
  })

  test('provider 抛错时降级而非失败', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    service.setExplanationProvider({
      async generate() {
        throw new Error('provider timeout')
      },
    })

    const explained = await service.explainRisk(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )
    assert.isTrue(explained.explanation.isFallback)
    await assertFactsUnchanged(service, org.id, project.id, created.run.id, target, assert)
  })

  test('说明审计记录 attempt 与 fallback 且不落 prompt/模型输出', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    service.setExplanationProvider({
      async generate() {
        return {
          narrative: '模型生成的敏感正文不应进入审计。',
          referencedTrendKeys: ['trk-not-authorized'],
          referencedRiskKeys: [],
        }
      },
    })

    await service.explainRisk(org.id, project.id, owner.id, created.run.id, target.id!)

    const logs = await AuditLog.query().where('project_id', project.id)
    const events = logs.map((log) =>
      String((log.metadata as { event?: string } | null)?.event ?? ''),
    )
    assert.include(events, 'TRIZ_EVOLUTION_TREND_AI_EXPLANATION_ATTEMPT')
    assert.include(events, 'TRIZ_EVOLUTION_TREND_AI_EXPLANATION_FALLBACK')

    const aiLogs = logs.filter((log) =>
      String((log.metadata as { event?: string } | null)?.event ?? '').startsWith(
        'TRIZ_EVOLUTION_TREND_AI_',
      ),
    )
    for (const log of aiLogs) {
      const meta = JSON.stringify(log.metadata ?? {})
      assert.notInclude(meta, '模型生成的敏感正文')
      assert.notInclude(meta, 'trk-not-authorized')
    }
  })
})

test.group('TrizEvolutionTrendPolicy', (group) => {
  useAuthDatabase(group)

  test('项目经理具备 view 与 manage', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    const policy = await app.container.make(TrizEvolutionTrendPolicy)

    assert.isTrue(await policy.view(owner, org.id, project.id))
    assert.isTrue(await policy.manage(owner, org.id, project.id))
  })

  test('普通成员只有 view，无 manage', async ({ assert }) => {
    const { org, project } = await makeProjectContext()
    const member = await createUser({ email: uniqueEmail('et-member') })
    await addOrgMember(org, member, 'member')

    const { default: ProjectMember } = await import('#models/project_member')
    const { default: ProjectRole } = await import('#models/project_role')
    const role = await ProjectRole.create({
      projectId: project.id,
      name: ProjectRoleName.MEMBER,
      description: ProjectRoleName.MEMBER,
      permissions: [] as unknown as string[],
      isSystem: true,
    })
    await ProjectMember.create({
      projectId: project.id,
      userId: member.id,
      projectRoleId: role.id,
      isActive: true,
    })

    const policy = await app.container.make(TrizEvolutionTrendPolicy)
    assert.isTrue(await policy.view(member, org.id, project.id))
    assert.isFalse(await policy.manage(member, org.id, project.id))
  })

  test('非项目成员两项权限都没有', async ({ assert }) => {
    const { org, project } = await makeProjectContext()
    const outsider = await createUser({ email: uniqueEmail('et-outsider') })
    await addOrgMember(org, outsider, 'viewer')

    const policy = await app.container.make(TrizEvolutionTrendPolicy)
    assert.isFalse(await policy.view(outsider, org.id, project.id))
    assert.isFalse(await policy.manage(outsider, org.id, project.id))
    assert.isFalse(await policy.aiExplain(outsider, org.id, project.id))
  })
})
