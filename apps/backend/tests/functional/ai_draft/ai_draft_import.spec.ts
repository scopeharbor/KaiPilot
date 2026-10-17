import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import Project from '#models/project'
import ProjectMember from '#models/project_member'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import TaskDependency from '#models/task_dependency'
import Milestone from '#models/milestone'
import AiProjectDraft from '#models/ai_project_draft'
import AiProjectDraftVersion from '#models/ai_project_draft_version'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

const STREAM = '/api/v1/ai/project-drafts/stream'

function makeReadyContext(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0',
    rawInput: '开发一个面向运营人员的内部审批系统，减少重复录入。',
    parsedIntent: {
      schemaVersion: '1.0',
      projectType: 'software',
      projectName: '内部审批系统',
      objectives: ['减少重复录入'],
      deliverables: [],
      timeline: { startDate: null, deadline: null, durationDays: null },
      constraints: [],
      entities: [],
      overallConfidence: 0.72,
    },
    resolvedFields: {},
    assumptions: {},
    unresolvedCriticalFields: [],
    unansweredOptionalFields: [],
    ...overrides,
  }
}

async function login(client: any, email: string) {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function formalWriteCounts() {
  const count = async (q: any) => {
    const row = await q.count('* as total')
    return Number(row[0].$extras.total)
  }
  return {
    projects: await count(Project.query()),
    tasks: await count(Task.query()),
    wbsNodes: await count(WbsNode.query()),
    dependencies: await count(TaskDependency.query()),
    milestones: await count(Milestone.query()),
  }
}

/**
 * 仅供导入事务测试使用：把离线生成版本标成「测试已验证来源」。
 * 生产路径没有这个入口；fallback 的拒绝行为由独立用例覆盖。
 */
async function markAsProviderVerifiedFixture(draftUid: string) {
  const session = await AiProjectDraft.query().where('draft_uid', draftUid).firstOrFail()
  const version = await AiProjectDraftVersion.query()
    .where('draft_id', session.id)
    .where('status', 'active')
    .firstOrFail()
  if (!version.meta) throw new Error('TEST_FIXTURE_META_MISSING')
  version.meta = {
    ...version.meta,
    provider: 'test-verified-provider',
    model: 'test-verified-model',
    usingRealAdapter: true,
    fallbackUsed: false,
    confirmability: { status: 'confirmable', reasons: [] },
    provenance: {
      ...(version.meta.provenance ?? {
        requestedStrategy: version.meta.structuredStrategy,
        effectiveStrategy: version.meta.structuredStrategy,
        requestedModel: 'test-verified-model',
        responseModel: 'test-verified-model',
        provider: 'test-verified-provider',
        fallbackUsed: false,
      }),
      provider: 'test-verified-provider',
      requestedModel: 'test-verified-model',
      responseModel: 'test-verified-model',
      fallbackUsed: false,
    },
  }
  await version.save()
}

/** 生成草案并返回 { draftUid, draft }。 */
async function generateDraft(client: any, token: string, providerVerified = false) {
  const gen = await client
    .post(STREAM)
    .header('Authorization', `Bearer ${token}`)
    .json({ context: makeReadyContext() })
  gen.assertStatus(200)
  const draftUid = gen.headers()['x-draft-id'] as string
  if (providerVerified) await markAsProviderVerifiedFixture(draftUid)
  const detail = await client
    .get(`/api/v1/ai/project-drafts/${draftUid}`)
    .header('Authorization', `Bearer ${token}`)
  return { draftUid, draft: detail.body().data.draft }
}

test.group('AI 草案确认导入 —— 权限与全量', (group) => {
  useAuthDatabase(group)

  test('无 ai:confirm 的成员确认返回 403 且零正式落库', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const token = await login(client, member.email)

    const { draftUid } = await generateDraft(client, token)
    const before = await formalWriteCounts()

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ version: 1, mode: 'all', acknowledgedWarnings: true })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('全部接受：单事务创建项目及关联数据并回填会话', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid, draft } = await generateDraft(client, token, true)

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ version: 1, mode: 'all', acknowledgedWarnings: true })
    res.assertStatus(201)

    const body = res.body().data
    assert.isNumber(body.projectId)
    assert.deepEqual(body.createdCounts, {
      wbsNodes: 7,
      tasks: 5,
      dependencies: 4,
      milestones: 2,
      acceptanceCriteria: 2,
      risks: draft.riskHints.length,
    })

    // 正式表实际写入（WBS 含合成根节点）。
    const counts = await formalWriteCounts()
    assert.equal(counts.projects, 1)
    assert.equal(counts.tasks, 5)
    assert.equal(counts.wbsNodes, 8)
    assert.equal(counts.dependencies, 4)
    assert.equal(counts.milestones, 2)

    const project = await Project.findOrFail(body.projectId)
    assert.equal(project.category, 'software')
    assert.equal(project.name, draft.charter.title.value)
    assert.isUndefined(project.settings?.workingCalendar)
    assert.equal(project.settings?.source, 'ai_draft')
    // 创建者登记为项目成员。
    const membership = await ProjectMember.query()
      .where('project_id', project.id)
      .where('user_id', owner.id)
      .first()
    assert.isNotNull(membership)

    // 会话回填 projectId + 状态 confirmed。
    const detail = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}`)
      .header('Authorization', `Bearer ${token}`)
    detail.assertBodyContains({ data: { status: 'confirmed' } })
  })

  test('生成附带计划体检；确认导入把封网窗口带进项目设置，日历接口返回给前端', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token, true)

    const session = await AiProjectDraft.query().where('draft_uid', draftUid).firstOrFail()
    const version = await AiProjectDraftVersion.query()
      .where('draft_id', session.id)
      .where('status', 'active')
      .firstOrFail()
    const insights = version.meta!.planInsights!
    assert.equal(insights.version, '1.0')
    assert.equal(insights.scheduleConfidence.method, 'pert_monte_carlo')
    assert.isArray(insights.stageGates.gates)
    // 夹具描述里没有封网约束：注入一个窗口，验证导入与日历接口链路。
    const window = { start: '2026-12-11', end: '2027-01-10', label: '封网：年底结算' }
    version.meta = {
      ...version.meta!,
      planInsights: {
        ...insights,
        workCalendar: { ...insights.workCalendar, changeFreezeWindows: [window] },
      },
    }
    await version.save()

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ version: 1, mode: 'all', acknowledgedWarnings: true })
    res.assertStatus(201)
    const project = await Project.findOrFail(res.body().data.projectId)
    assert.deepEqual(project.settings?.changeFreezeWindows, [window])
    // 封网不改工作日：工作日历仍须走项目设置端点由人确认。
    assert.isUndefined(project.settings?.workingCalendar)

    const calendar = await client
      .get(`/api/v1/projects/${project.id}/calendar`)
      .header('Authorization', `Bearer ${token}`)
      .qs({ view: 'month', anchorDate: '2026-12-15' })
    calendar.assertStatus(200)
    assert.deepEqual(calendar.body().workingCalendar.changeFreezeWindows, [window])
  })

  test('确认导入写 AI_DRAFT_CONFIRMED 审计，仅元数据不含草案正文', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token, true)

    await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ version: 1, mode: 'all', acknowledgedWarnings: true })

    const audit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['AI_DRAFT_CONFIRMED'])
      .orderBy('id', 'desc')
      .firstOrFail()
    const serialized = JSON.stringify(audit.metadata)
    assert.notInclude(serialized, 'charter')
    assert.notInclude(serialized, 'OA 审批')
    assert.property(audit.metadata as Record<string, unknown>, 'createdCounts')
    assert.equal(audit.entityType, 'project')
    assert.include(serialized, '"confirmedVia":"user"')
  })

  test('AI 同事全自动转正：审计标记「由 AI 同事全自动转正」；未知发起方式拒绝', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token, true)

    const bad = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ version: 1, mode: 'all', acknowledgedWarnings: true, confirmedVia: 'robot' })
    bad.assertStatus(422)

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        version: 1,
        mode: 'all',
        acknowledgedWarnings: true,
        confirmedVia: 'ai_colleague_autopilot',
      })
    res.assertStatus(201)
    const audit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['AI_DRAFT_CONFIRMED'])
      .orderBy('id', 'desc')
      .firstOrFail()
    const serialized = JSON.stringify(audit.metadata)
    assert.include(serialized, '"confirmedVia":"ai_colleague_autopilot"')
    assert.include(serialized, '由 AI 同事全自动转正')
  })
})

test.group('AI 草案确认导入 —— 校验关卡', (group) => {
  useAuthDatabase(group)

  test('离线 fallback 即使结构合法也禁止确认且零正式落库', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token)
    const before = await formalWriteCounts()

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ version: 1, mode: 'all', acknowledgedWarnings: true })

    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
    assert.include(JSON.stringify(res.body()), 'Fallback')
    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('warning 未显式确认被拒绝且零正式落库', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid, draft } = await generateDraft(client, token, true)
    const before = await formalWriteCounts()

    // 确定性 fallback 生成的草案本身零问题；显式清空一个关键路径任务的负责人，
    // 制造 VE-004（关键任务须有负责人，warning 级、不可自动修正），以命中「warning 未确认」关卡。
    const criticalTaskId = draft.tasks[0].id
    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        version: 1,
        mode: 'all',
        acknowledgedWarnings: false,
        modifications: [{ path: `tasks[${criticalTaskId}].assigneeHint`, value: '' }],
      })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('blocking（空任务选择）禁止确认且零正式落库', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token, true)
    const before = await formalWriteCounts()

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        version: 1,
        mode: 'partial',
        acknowledgedWarnings: true,
        selection: {
          taskIds: [],
          wbsNodeIds: [],
          acceptanceIds: [],
          milestoneIds: [],
          unselectedStrategy: 'discard',
        },
      })
    res.assertStatus(422)
    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('版本过期确认返回 422', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token, true)
    const before = await formalWriteCounts()

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({ version: 99, mode: 'all', acknowledgedWarnings: true })
    res.assertStatus(422)
    assert.deepEqual(await formalWriteCounts(), before)
  })
})

test.group('AI 草案确认导入 —— 部分接受与事务', (group) => {
  useAuthDatabase(group)

  test('部分接受：仅导入选中子集并过滤悬空依赖', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token, true)

    const res = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        version: 1,
        mode: 'partial',
        acknowledgedWarnings: true,
        selection: {
          taskIds: ['t-p1-1', 't-p1-2', 't-p2-1', 't-p2-2'],
          wbsNodeIds: [],
          acceptanceIds: ['a-1', 'a-2'],
          milestoneIds: ['m-1', 'm-2'],
          riskHintIds: [],
          unselectedStrategy: 'discard',
        },
      })
    res.assertStatus(201)
    assert.deepEqual(res.body().data.createdCounts, {
      wbsNodes: 6,
      tasks: 4,
      dependencies: 3,
      milestones: 2,
      acceptanceCriteria: 2,
      risks: 0,
    })
    const counts = await formalWriteCounts()
    assert.equal(counts.tasks, 4)
    assert.equal(counts.wbsNodes, 7) // 6 + 合成根
    assert.equal(counts.dependencies, 3)
  })

  test('未选策略决定会话收尾状态：save_as_draft → saved', async ({ client }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token, true)

    await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        version: 1,
        mode: 'partial',
        acknowledgedWarnings: true,
        selection: {
          taskIds: ['t-p1-1', 't-p1-2'],
          wbsNodeIds: [],
          acceptanceIds: ['a-1'],
          milestoneIds: ['m-1'],
          unselectedStrategy: 'save_as_draft',
        },
      })

    const detail = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}`)
      .header('Authorization', `Bearer ${token}`)
    detail.assertBodyContains({ data: { status: 'saved' } })
  })

  test('导入中途失败整体回滚（里程碑写入抛错）', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid } = await generateDraft(client, token, true)
    const before = await formalWriteCounts()

    const original = Milestone.create
    ;(Milestone as any).create = () => {
      throw new Error('boom-rollback')
    }
    try {
      await client
        .post(`/api/v1/ai/project-drafts/${draftUid}/confirm`)
        .header('Authorization', `Bearer ${token}`)
        .json({ version: 1, mode: 'all', acknowledgedWarnings: true })
    } finally {
      ;(Milestone as any).create = original
    }

    // 项目/WBS/任务/依赖全部随事务回滚。
    assert.deepEqual(await formalWriteCounts(), before)
  })
})

test.group('AI 同事全自动 —— 模型修正阻断项（ai-fix，零写入）', (group) => {
  useAuthDatabase(group)

  test('依赖成环 → 模型提出修改 → 合并后重算无阻断；不落版本、不导入', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid, draft } = await generateDraft(client, token, true)
    const deps = draft.dependencies as Array<{
      id: string
      predecessorId: string
      successorId: string
    }>
    assert.isAtLeast(deps.length, 2, '夹具至少有两条依赖')
    const [first, second] = deps as [(typeof deps)[0], (typeof deps)[0]]
    // 把第二条依赖改成第一条的反向 → 依赖成环（阻断）
    const cycle = [
      { path: `dependencies[${second.id}].predecessorId`, value: first.successorId },
      { path: `dependencies[${second.id}].successorId`, value: first.predecessorId },
    ]
    const fixModule = await import('#services/ai_draft/ai_draft_fix_service')
    const AiDraftFixService = fixModule.default
    const original = AiDraftFixService.prototype.propose
    const calls: unknown[] = []
    AiDraftFixService.prototype.propose = async function (input) {
      calls.push(input)
      return {
        modifications: [
          { path: `dependencies[${second.id}].predecessorId`, value: second.predecessorId },
          { path: `dependencies[${second.id}].successorId`, value: second.successorId },
        ],
        operations: [],
        reasons: ['把成环的依赖改回原方向'],
        model: 'test/fix-model',
      }
    }
    const before = await formalWriteCounts()
    const session = await AiProjectDraft.query().where('draft_uid', draftUid).firstOrFail()
    try {
      const res = await client
        .post(`/api/v1/ai/project-drafts/${draftUid}/ai-fix`)
        .header('Authorization', `Bearer ${token}`)
        .json({ modifications: cycle })
      res.assertStatus(200)
      const data = res.body().data
      assert.lengthOf(calls, 1)
      const blockingSent = (calls[0] as { blocking: Array<{ ruleId: string }> }).blocking
      assert.isTrue(blockingSent.some((issue) => /VE-002|HL-007/.test(issue.ruleId)))
      assert.equal(data.model, 'test/fix-model')
      assert.lengthOf(data.applied, 2)
      assert.deepEqual(
        data.modifications.map((mod: { path: string }) => mod.path).sort(),
        cycle.map((mod) => mod.path).sort(),
      )
      assert.isFalse(
        data.report.blocking.some((issue: { ruleId: string }) =>
          /VE-002|HL-007/.test(issue.ruleId),
        ),
      )
    } finally {
      AiDraftFixService.prototype.propose = original
    }
    // 零写入：版本号不变、没有导入
    await session.refresh()
    assert.equal(session.currentVersion, 1)
    assert.deepEqual(await formalWriteCounts(), before)
  })
})

test.group('AI 同事全自动 —— 结构性修正（增删任务 / 依赖，落新草案版本）', (group) => {
  useAuthDatabase(group)

  test('删除成环的依赖 → 落新草案版本、字段修改并入、无阻断；旧版本号拒绝；仍不导入正式表', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const { draftUid, draft } = await generateDraft(client, token, true)
    const deps = draft.dependencies as Array<{
      id: string
      predecessorId: string
      successorId: string
    }>
    const [first, second] = deps as [(typeof deps)[0], (typeof deps)[0]]
    const cycle = [
      { path: `dependencies[${second.id}].predecessorId`, value: first.successorId },
      { path: `dependencies[${second.id}].successorId`, value: first.predecessorId },
    ]
    const fixModule = await import('#services/ai_draft/ai_draft_fix_service')
    const AiDraftFixService = fixModule.default
    const original = AiDraftFixService.prototype.propose
    AiDraftFixService.prototype.propose = async function () {
      return {
        modifications: [],
        operations: [{ op: 'remove_dependency' as const, dependencyId: second.id }],
        reasons: ['删除造成环路的依赖'],
        model: 'test/fix-model',
      }
    }
    const before = await formalWriteCounts()
    try {
      const res = await client
        .post(`/api/v1/ai/project-drafts/${draftUid}/ai-fix`)
        .header('Authorization', `Bearer ${token}`)
        .json({ version: 1, modifications: cycle })
      res.assertStatus(200)
      const data = res.body().data
      assert.equal(data.version, 2)
      assert.deepEqual(data.modifications, [])
      assert.lengthOf(data.operations, 1)
      assert.isFalse(
        data.report.blocking.some((issue: { ruleId: string }) =>
          /VE-002|HL-007/.test(issue.ruleId),
        ),
      )

      const stale = await client
        .post(`/api/v1/ai/project-drafts/${draftUid}/ai-fix`)
        .header('Authorization', `Bearer ${token}`)
        .json({ version: 1 })
      stale.assertStatus(422)
      assert.deepInclude(stale.body().error.details, { expected: 2, received: 1 })
    } finally {
      AiDraftFixService.prototype.propose = original
    }
    const session = await AiProjectDraft.query().where('draft_uid', draftUid).firstOrFail()
    assert.equal(session.currentVersion, 2)
    const active = await AiProjectDraftVersion.query()
      .where('draft_id', session.id)
      .where('status', 'active')
      .firstOrFail()
    assert.equal(active.origin, 'modified')
    const ids = (active.draft!.dependencies ?? []).map((dep) => dep.id)
    assert.notInclude(ids, second.id)
    assert.deepEqual(await formalWriteCounts(), before)
  })
})
