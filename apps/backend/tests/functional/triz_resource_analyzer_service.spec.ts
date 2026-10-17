import app from '@adonisjs/core/services/app'
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import Task from '#models/task'
import TrizResourceAnalysisInputCollector from '#services/triz_resource_analysis_input_collector'
import TrizResourceAnalyzerService from '#services/triz_resource_analyzer_service'
import TrizResourceAnalyzerPolicy from '#policies/triz_resource_analyzer_policy'
import TrizResourceAnalysisRun from '#models/triz_resource_analysis_run'
import TrizResourceOpportunityCandidate from '#models/triz_resource_opportunity_candidate'
import AuditLog from '#models/audit_log'
import { ProjectRoleName } from '#rbac'
import { test } from '@japa/runner'
import { computeResourceAnalysisInputSignature, type ManualResourceDraft } from '@aiproj/types'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

// ===========================================================================
// 收集器 / 服务 / 策略层测试（v3-triz-resource-analyzer §4.3、§4.9、§3.6）
//
// 收集器：授权来源真实读取、缺失来源 warning、跨组织不泄露、用户草稿、只读无副作用。
// 服务：幂等复用、stale 标记、分页/筛选、审查状态、跨组织掩蔽。
// 策略：view/manage/aiExplain 分离。
// ===========================================================================

function manualDraft(overrides: Partial<ManualResourceDraft> = {}): ManualResourceDraft {
  return {
    label: '合作方闲置测试机',
    resourceKind: 'technical',
    systemScope: 'external_environment',
    origin: 'user_supplied',
    availability: 'high',
    utilizationState: 'idle',
    capacity: '2 台',
    costRating: 'low',
    description: '合作方提供的闲置测试设备',
    ...overrides,
  }
}

async function seedResources(projectId: number) {
  const tasks = []
  for (let i = 0; i < 12; i++) {
    tasks.push(
      await Task.create({
        projectId,
        name: `任务 ${i}`,
        status: 'not_started',
        taskType: 'task',
        priority: 'medium',
      } as any),
    )
  }
  const idle = await Resource.create({
    projectId,
    name: '闲置测试服务器',
    resourceType: 'equipment',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
  } as any)
  const busy = await Resource.create({
    projectId,
    name: '后端工程师',
    resourceType: 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
  } as any)
  await ResourceAllocation.create({
    resourceId: busy.id,
    taskId: tasks[0]!.id,
    allocationType: 'assigned',
    allocationPercent: 120,
  } as any)
  return { idle, busy }
}

async function makeProjectContext() {
  const owner = await createUser({ email: uniqueEmail('res-svc') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    ProjectRoleName.PROJECT_MANAGER,
  )
  return { owner, org, project }
}

test.group('TrizResourceAnalysisInputCollector', (group) => {
  useAuthDatabase(group)

  test('读取授权项目来源并产出真实计数与来源 hash', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)

    const collector = await app.container.make(TrizResourceAnalysisInputCollector)
    const out = await collector.collect({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    assert.equal(out.projectName, '测试项目')
    assert.equal(out.taskTotal, 12)
    assert.equal(out.memberCount, 1)
    assert.equal(out.projectResourceCount, 2)
    assert.isNotNull(out.resourceUtilization)
    assert.isString(out.sourceHashes.project_resources)

    // 120% 分配必须判为 overloaded（而非 fully_utilized）
    const busy = out.projectResourceSummary.find((r) => r.label === '后端工程师')
    assert.isDefined(busy)
    assert.equal(busy!.utilizationState, 'overloaded')
    assert.equal(out.resourceOverloadCount, 1)

    // 无分配的资源判为 idle
    const idle = out.projectResourceSummary.find((r) => r.label === '闲置测试服务器')
    assert.equal(idle!.utilizationState, 'idle')
  })

  test('无正式资源且无用户草稿时给出 INSUFFICIENT_RESOURCE_SOURCE 警告', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()

    const collector = await app.container.make(TrizResourceAnalysisInputCollector)
    const out = await collector.collect({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    assert.include(
      out.warnings.map((w) => w.code),
      'INSUFFICIENT_RESOURCE_SOURCE',
    )
  })

  test('用户补充草稿被原样带入且不触发资源不足警告', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()

    const collector = await app.container.make(TrizResourceAnalysisInputCollector)
    const out = await collector.collect({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
      manualResourceDrafts: [manualDraft()],
    })

    assert.lengthOf(out.manualResourceDrafts, 1)
    assert.equal(out.manualResourceDrafts[0]!.origin, 'user_supplied')
    assert.notInclude(
      out.warnings.map((w) => w.code),
      'INSUFFICIENT_RESOURCE_SOURCE',
    )
  })

  test('跨组织项目不返回任何计数、标签与 hash', async ({ assert }) => {
    const { project } = await makeProjectContext()
    await seedResources(project.id)

    const otherOwner = await createUser({ email: uniqueEmail('res-other') })
    const otherOrg = await createOrganization(otherOwner)

    const collector = await app.container.make(TrizResourceAnalysisInputCollector)
    const out = await collector.collect({
      organizationId: otherOrg.id,
      projectId: project.id,
      actorId: otherOwner.id,
    })

    assert.equal(out.projectName, '')
    assert.equal(out.taskTotal, 0)
    assert.equal(out.projectResourceCount, 0)
    assert.lengthOf(out.projectResourceSummary, 0)
    assert.deepEqual(out.sourceHashes, {})
    assert.include(
      out.warnings.map((w) => w.code),
      'PERMISSION_RESTRICTED',
    )
    assert.notInclude(JSON.stringify(out), '闲置测试服务器')
  })

  test('收集过程不写入任何正式数据', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)

    const countFormalRows = async () => {
      const tasks = await Task.query().where('project_id', project.id)
      const resources = await Resource.query().where('project_id', project.id)
      const allocations = await ResourceAllocation.query()
      return { tasks: tasks.length, resources: resources.length, allocations: allocations.length }
    }
    const before = await countFormalRows()

    const collector = await app.container.make(TrizResourceAnalysisInputCollector)
    await collector.collect({
      organizationId: org.id,
      projectId: project.id,
      actorId: owner.id,
    })

    assert.deepEqual(await countFormalRows(), before)
  })

  test('相同来源两次收集产出相同输入签名', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)

    const collector = await app.container.make(TrizResourceAnalysisInputCollector)
    const args = { organizationId: org.id, projectId: project.id, actorId: owner.id }
    const first = await collector.collect(args)
    const second = await collector.collect(args)

    assert.equal(
      computeResourceAnalysisInputSignature(first),
      computeResourceAnalysisInputSignature(second),
    )
  })
})

test.group('TrizResourceAnalyzerService', (group) => {
  useAuthDatabase(group)

  test('幂等：相同输入复用同一 run，不重复落库', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)

    const service = await app.container.make(TrizResourceAnalyzerService)
    const first = await service.createRun(org.id, project.id, owner.id, {})
    const second = await service.createRun(org.id, project.id, owner.id, {})

    assert.equal(first.run.id, second.run.id)
    assert.equal(first.run.outputHash, second.run.outputHash)
    const runs = await TrizResourceAnalysisRun.query().where('project_id', project.id)
    assert.lengthOf(runs, 1)
  })

  test('输入变化时旧 run 被标 stale，候选被阻断', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)

    const service = await app.container.make(TrizResourceAnalyzerService)
    const first = await service.createRun(org.id, project.id, owner.id, {
      idempotencyKey: 'fixed-key',
    })

    // 来源变化：新增一个资源
    await Resource.create({
      projectId: project.id,
      name: '新增设计师',
      resourceType: 'human',
      role: 'member',
      status: 'active',
      dailyCapacityHours: 8,
    } as any)

    const second = await service.createRun(org.id, project.id, owner.id, {
      idempotencyKey: 'fixed-key',
    })

    assert.notEqual(first.run.id, second.run.id)
    const stale = await TrizResourceAnalysisRun.findOrFail(first.run.id)
    assert.equal(stale.status, 'stale')

    const blocked = await TrizResourceOpportunityCandidate.query().where('run_id', first.run.id)
    for (const candidate of blocked) {
      assert.equal(candidate.status, 'blocked_stale')
    }
  })

  test('候选与快照读取支持分页与筛选，并保持稳定排序', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)

    const service = await app.container.make(TrizResourceAnalyzerService)
    const created = await service.createRun(org.id, project.id, owner.id, {})

    const page = await service.listOpportunities(org.id, project.id, created.run.id, {
      page: 1,
      perPage: 2,
    })
    assert.isAtMost(page.data.length, 2)
    assert.equal(page.meta.page, 1)
    assert.isAtLeast(page.meta.total, 1)

    const humanOnly = await service.listResources(org.id, project.id, created.run.id, {
      resourceKind: 'human',
    })
    for (const snapshot of humanOnly.data) {
      assert.equal(snapshot.resourceKind, 'human')
    }

    const all = await service.listOpportunities(org.id, project.id, created.run.id, {})
    const again = await service.listOpportunities(org.id, project.id, created.run.id, {})
    assert.deepEqual(
      all.data.map((o) => o.opportunityKey),
      again.data.map((o) => o.opportunityKey),
    )
  })

  test('审查写入状态与审查人，且不改动机会评分', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)

    const service = await app.container.make(TrizResourceAnalyzerService)
    const created = await service.createRun(org.id, project.id, owner.id, {})
    const target = created.opportunities[0]!

    const reviewed = await service.reviewOpportunity(
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
    assert.equal(reviewed.opportunityKey, target.opportunityKey)
  })

  test('跨组织读取被掩蔽为空/不存在', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)

    const service = await app.container.make(TrizResourceAnalyzerService)
    const created = await service.createRun(org.id, project.id, owner.id, {})

    const otherOwner = await createUser({ email: uniqueEmail('res-mask') })
    const otherOrg = await createOrganization(otherOwner)

    assert.isNull(await service.getRun(otherOrg.id, project.id, created.run.id))
    const masked = await service.listOpportunities(otherOrg.id, project.id, created.run.id, {})
    assert.lengthOf(masked.data, 0)
    assert.equal(masked.meta.total, 0)
  })

  test('AI 说明默认走确定性回退且不改动候选事实', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)

    const service = await app.container.make(TrizResourceAnalyzerService)
    const created = await service.createRun(org.id, project.id, owner.id, {})
    const target = created.opportunities[0]!

    const explained = await service.explainOpportunity(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )

    assert.isTrue(explained.explanation.isFallback)
    assert.isNull(explained.explanation.provider)
    assert.isNull(explained.explanation.model)

    const after = await service.getOpportunity(org.id, project.id, created.run.id, target.id!)
    assert.equal(after!.impactScore, target.impactScore)
    assert.equal(after!.outputHash, target.outputHash)
    assert.equal(after!.status, 'unreviewed')
  })
})

test.group('TrizResourceAnalyzerService — 规模上界', (group) => {
  useAuthDatabase(group)

  test('100 资源 / 300 分配的收集+规则+落库在本地预算内完成', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()

    const tasks = []
    for (let i = 0; i < 30; i++) {
      tasks.push(
        await Task.create({
          projectId: project.id,
          name: `批量任务 ${i}`,
          status: 'not_started',
          taskType: 'task',
          priority: 'medium',
        } as any),
      )
    }
    for (let i = 0; i < 100; i++) {
      const resource = await Resource.create({
        projectId: project.id,
        name: `批量资源 ${i}`,
        resourceType: i % 2 === 0 ? 'human' : 'equipment',
        role: 'member',
        status: 'active',
        dailyCapacityHours: 8,
      } as any)
      // 每 3 个资源里 2 个带分配，制造闲置/饱和/超载的混合分布
      if (i % 3 !== 0) {
        await ResourceAllocation.create({
          resourceId: resource.id,
          taskId: tasks[i % tasks.length]!.id,
          allocationType: 'assigned',
          allocationPercent: i % 3 === 1 ? 60 : 130,
        } as any)
      }
    }

    const service = await app.container.make(TrizResourceAnalyzerService)
    const started = Date.now()
    const created = await service.createRun(org.id, project.id, owner.id, {})
    const elapsed = Date.now() - started

    assert.isAtLeast(created.resources.length, 100)
    assert.isAtLeast(created.opportunities.length, 1)
    // 本地 SQLite 预算：远低于此阈值即可，超过说明出现了 N+1 或平方级扫描
    assert.isBelow(elapsed, 20_000, `资源分析耗时 ${elapsed}ms 超出本地预算`)
  })
})

// ---------------------------------------------------------------------------
// 可选说明 provider 路径（§6.1–§6.3）。全部使用 fake provider，绝不调用真实模型。
// ---------------------------------------------------------------------------

test.group('TrizResourceAnalyzerService — 说明 provider 与降级', (group) => {
  useAuthDatabase(group)

  /** 建一个带候选的运行，返回服务与首个候选。 */
  async function makeRunWithCandidate() {
    const { owner, org, project } = await makeProjectContext()
    await seedResources(project.id)
    const service = await app.container.make(TrizResourceAnalyzerService)
    const created = await service.createRun(org.id, project.id, owner.id, {})
    return { owner, org, project, service, created, target: created.opportunities[0]! }
  }

  /** 断言候选的确定性事实未被说明流程改写。 */
  async function assertFactsUnchanged(
    service: TrizResourceAnalyzerService,
    orgId: number,
    projectId: number,
    runId: number,
    target: { id?: number; impactScore: number; outputHash: string; opportunityKey: string },
    assert: any,
  ) {
    const after = await service.getOpportunity(orgId, projectId, runId, target.id!)
    assert.equal(after!.impactScore, target.impactScore)
    assert.equal(after!.outputHash, target.outputHash)
    assert.equal(after!.opportunityKey, target.opportunityKey)
    assert.equal(after!.status, 'unreviewed')
  }

  test('注入 provider 成功时返回模型说明与成本摘要', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    let seenPrompt = ''

    service.setExplanationProvider({
      async generate(input) {
        seenPrompt = input.promptSummary
        return {
          narrative: '该候选可通过重新分配闲置算力缓解，需人工确认后执行。',
          referencedResourceKeys: input.allowedResourceHashes.slice(0, 1),
          provider: 'fake',
          model: 'fake-model',
          promptTokens: 800,
          completionTokens: 200,
          latencyMs: 120,
        }
      },
    })

    const explained = await service.explainOpportunity(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )

    assert.isFalse(explained.explanation.isFallback)
    assert.isTrue(explained.explanation.hallucinationChecked)
    assert.isNull(explained.explanation.degradedReason)
    assert.equal(explained.explanation.provider, 'fake')
    assert.equal(explained.explanation.cost!.promptTokens, 800)
    // Context Packet 只带低敏字段：无资源标签、无成员信息
    assert.notInclude(seenPrompt, '闲置测试服务器')
    assert.notInclude(seenPrompt, '后端工程师')
    await assertFactsUnchanged(service, org.id, project.id, created.run.id, target, assert)
  })

  test('预算硬上限触发时阻断调用并降级', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    const original = process.env.AIPROJ_TRIZ_RESOURCE_AI_BUDGET_USD
    process.env.AIPROJ_TRIZ_RESOURCE_AI_BUDGET_USD = '0'

    let called = false
    service.setExplanationProvider({
      async generate() {
        called = true
        return { narrative: '不应被调用', referencedResourceKeys: [] }
      },
    })

    try {
      const explained = await service.explainOpportunity(
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
      if (original === undefined) delete process.env.AIPROJ_TRIZ_RESOURCE_AI_BUDGET_USD
      else process.env.AIPROJ_TRIZ_RESOURCE_AI_BUDGET_USD = original
    }
  })

  test('结构化输出不合契约时降级为确定性说明', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    service.setExplanationProvider({
      async generate() {
        return { narrative: '   ', referencedResourceKeys: [] }
      },
    })

    const explained = await service.explainOpportunity(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )

    assert.isTrue(explained.explanation.isFallback)
    assert.include(explained.explanation.degradedReason ?? '', '结构化契约')
    await assertFactsUnchanged(service, org.id, project.id, created.run.id, target, assert)
  })

  test('引用未授权来源时反幻觉校验拦截并降级', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    service.setExplanationProvider({
      async generate() {
        return {
          narrative: '外部合作方还有一批闲置服务器可用。',
          referencedResourceKeys: ['hash-not-authorized'],
        }
      },
    })

    const explained = await service.explainOpportunity(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )

    assert.isTrue(explained.explanation.isFallback)
    assert.include(explained.explanation.degradedReason ?? '', '未授权来源')
    // 降级说明只引用确定性授权 hash，模型编造的 key 不进入结果
    assert.notInclude(explained.explanation.referencedResourceKeys, 'hash-not-authorized')
    assert.notInclude(explained.explanation.narrative, '外部合作方')
    await assertFactsUnchanged(service, org.id, project.id, created.run.id, target, assert)
  })

  test('provider 抛错时降级而非失败', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    service.setExplanationProvider({
      async generate() {
        throw new Error('provider timeout')
      },
    })

    const explained = await service.explainOpportunity(
      org.id,
      project.id,
      owner.id,
      created.run.id,
      target.id!,
    )

    assert.isTrue(explained.explanation.isFallback)
    assert.include(explained.explanation.degradedReason ?? '', '结构化契约')
    await assertFactsUnchanged(service, org.id, project.id, created.run.id, target, assert)
  })

  test('说明审计记录 attempt 与 fallback 且不落 prompt/模型输出', async ({ assert }) => {
    const { org, project, owner, service, created, target } = await makeRunWithCandidate()
    service.setExplanationProvider({
      async generate() {
        return {
          narrative: '模型生成的敏感正文不应进入审计。',
          referencedResourceKeys: ['hash-not-authorized'],
        }
      },
    })

    await service.explainOpportunity(org.id, project.id, owner.id, created.run.id, target.id!)

    const logs = await AuditLog.query().where('project_id', project.id)
    const events = logs.map((log) =>
      String((log.metadata as { event?: string } | null)?.event ?? ''),
    )
    assert.include(events, 'TRIZ_RESOURCE_AI_EXPLANATION_ATTEMPT')
    assert.include(events, 'TRIZ_RESOURCE_AI_EXPLANATION_FALLBACK')

    const aiLogs = logs.filter((log) =>
      String((log.metadata as { event?: string } | null)?.event ?? '').startsWith(
        'TRIZ_RESOURCE_AI_',
      ),
    )
    for (const log of aiLogs) {
      const meta = JSON.stringify(log.metadata ?? {})
      assert.notInclude(meta, '模型生成的敏感正文')
      assert.notInclude(meta, '授权来源 hash')
      assert.notInclude(meta, 'hash-not-authorized')
    }
  })
})

test.group('TrizResourceAnalyzerPolicy', (group) => {
  useAuthDatabase(group)

  test('项目经理具备 view 与 manage', async ({ assert }) => {
    const { owner, org, project } = await makeProjectContext()
    const policy = await app.container.make(TrizResourceAnalyzerPolicy)

    assert.isTrue(await policy.view(owner, org.id, project.id))
    assert.isTrue(await policy.manage(owner, org.id, project.id))
  })

  test('普通成员只有 view，无 manage', async ({ assert }) => {
    const { org, project } = await makeProjectContext()
    const member = await createUser({ email: uniqueEmail('res-member') })
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

    const policy = await app.container.make(TrizResourceAnalyzerPolicy)
    assert.isTrue(await policy.view(member, org.id, project.id))
    assert.isFalse(await policy.manage(member, org.id, project.id))
  })

  test('非项目成员两项权限都没有', async ({ assert }) => {
    const { org, project } = await makeProjectContext()
    const outsider = await createUser({ email: uniqueEmail('res-outsider') })
    await addOrgMember(org, outsider, 'viewer')

    const policy = await app.container.make(TrizResourceAnalyzerPolicy)
    assert.isFalse(await policy.view(outsider, org.id, project.id))
    assert.isFalse(await policy.manage(outsider, org.id, project.id))
    assert.isFalse(await policy.aiExplain(outsider, org.id, project.id))
  })
})
