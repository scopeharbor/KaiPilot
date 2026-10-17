import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import Project from '#models/project'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import TaskDependency from '#models/task_dependency'
import Milestone from '#models/milestone'
import AiProjectDraft from '#models/ai_project_draft'
import { draftGenerationRunner } from '#services/ai_draft/draft_generation_runner'
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

/** 解析 SSE 文本为 { event, id } 列表。 */
function parseSse(text: string): Array<{ event: string; id: string }> {
  const out: Array<{ event: string; id: string }> = []
  for (const block of text.split('\n\n')) {
    const idLine = block.split('\n').find((l) => l.startsWith('id: '))
    const evLine = block.split('\n').find((l) => l.startsWith('event: '))
    if (evLine)
      out.push({ event: evLine.slice(7).trim(), id: idLine ? idLine.slice(4).trim() : '' })
  }
  return out
}

function parseSsePayloads(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const block of text.split('\n\n')) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .join('\n')
    if (data) out.push(JSON.parse(data) as Record<string, unknown>)
  }
  return out
}

function collectObjectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys)
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key.toLowerCase())
      collectObjectKeys(nested, keys)
    }
  }
  return keys
}

test.group('AI 草案生成 API', (group) => {
  useAuthDatabase(group)

  test('未认证返回 403（rbac_middleware 先于 auth_middleware 判定权限）', async ({ client }) => {
    const res = await client.post(STREAM).json({ context: makeReadyContext() })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('无 ai:trigger 的观察者返回 403', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'PERMISSION_DENIED' } })
  })

  test('入参非法（context 缺 projectType）返回 422', async ({ client }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const res = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: { schemaVersion: '1.0', rawInput: 'x', parsedIntent: {} } })
    res.assertStatus(422)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('成功生成推送 SSE 序列且零正式落库', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const before = await formalWriteCounts()

    const res = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })

    res.assertStatus(200)
    const events = parseSse(res.text())
    const types = events.map((e) => e.event)
    const payloads = parseSsePayloads(res.text())
    // 瞬时通道事件不携带语义 sequence，不参与「严格递增」判定：
    // draft.heartbeat 是保活；generation.output 是 v3-ai-draft-live-output-panel
    // 的模型输出观察通道，按其设计以 sequence=0 广播、绝不落库、不推进语义序列
    // （见 ai_project_drafts_controller 中 pushOutput 的注释）。
    const TRANSIENT_EVENT_TYPES = new Set(['draft.heartbeat', 'generation.output'])
    const semanticIds = events
      .filter((event) => !TRANSIENT_EVENT_TYPES.has(event.event))
      .map((event) => Number(event.id))
    const phases = payloads
      .filter((event) => event.type === 'draft.progress')
      .map((event) => event.phase)
    const completedModules = payloads
      .filter((event) => event.type === 'module.completed')
      .map((event) => event.module)

    assert.equal(res.headers()['content-type'], 'text/event-stream')
    assert.isString(res.headers()['x-draft-id'])
    assert.equal(types[0], 'draft.started', 'SSE 首个语义事件必须先于模型输出')
    assert.include(types, 'draft.started')
    assert.include(types, 'module.completed')
    assert.include(types, 'draft.completed')
    assert.isTrue(
      semanticIds.every((id, index) => index === 0 || id > semanticIds[index - 1]!),
      '持久化语义事件 sequence 必须严格递增',
    )
    assert.includeMembers(phases, [
      'adapter_ready',
      'first_token',
      'receiving',
      'parsing',
      'validating',
      'persisting',
    ])
    assert.includeMembers(completedModules, [
      'charter',
      'wbs',
      'tasks',
      'dependencies',
      'acceptance',
      'resource',
      'risk',
      'milestone',
      'ganttPreview',
    ])
    assert.isBelow(types.indexOf('module.completed'), types.indexOf('draft.completed'))
    const payloadKeys = collectObjectKeys(payloads)
    for (const forbidden of ['rawtext', 'prompt', 'token', 'apikey', 'credential', 'secret']) {
      assert.isFalse(payloadKeys.has(forbidden), `SSE payload 禁止包含 ${forbidden}`)
    }
    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('生成/保存/拒绝/重试端点全程零正式业务落库', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const before = await formalWriteCounts()

    const gen = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    const draftUid = gen.headers()['x-draft-id']

    await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/retry`)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/save`)
      .header('Authorization', `Bearer ${token}`)
    await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/reject`)
      .header('Authorization', `Bearer ${token}`)

    assert.deepEqual(await formalWriteCounts(), before)
  })

  test('客户端 organizationId 不能切换租户上下文 → 404 掩蔽', async ({ client, assert }) => {
    const ownerA = await createUser()
    const ownerB = await createUser()
    await createOrganization(ownerA)
    await createOrganization(ownerB)
    const token = await login(client, ownerA.email)

    // 故意发送契约外的 organizationId，验证服务端拒绝客户端租户切换
    const res = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext(), organizationId: 999999 })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    // 无审计事件（请求被 middleware 拦截，未到达 controller）
    const audit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['AI_DRAFT_GENERATED'])
      .orderBy('id', 'desc')
      .first()
    assert.isNull(audit)
  })

  test('跨组织草案不可见返回 404', async ({ client }) => {
    const ownerA = await createUser()
    await createOrganization(ownerA)
    const ownerB = await createUser()
    await createOrganization(ownerB)

    const tokenB = await login(client, ownerB.email)
    const gen = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${tokenB}`)
      .json({ context: makeReadyContext() })
    const draftUid = gen.headers()['x-draft-id']

    const tokenA = await login(client, ownerA.email)
    const res = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}`)
      .header('Authorization', `Bearer ${tokenA}`)
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })

    const events = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}/events`)
      .header('Authorization', `Bearer ${tokenA}`)
    events.assertStatus(404)
    events.assertBodyContains({ error: { code: 'RESOURCE_NOT_FOUND' } })
  })

  test('SSE 断点续传：Last-Event-ID 只重放后续事件且幂等', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const gen = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    const draftUid = gen.headers()['x-draft-id']
    const allEvents = parseSse(gen.text())
    const cursor = Number(allEvents[2].id)

    const reconnect1 = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}/events`)
      .header('Authorization', `Bearer ${token}`)
      .header('Last-Event-ID', String(cursor))
    reconnect1.assertStatus(200)
    const replay1 = parseSse(reconnect1.text())
    assert.isTrue(
      replay1.every((e) => Number(e.id) > cursor),
      '重放事件的 sequence 必须都大于 cursor',
    )

    // 幂等：同一 cursor 再次重连结果一致。
    const reconnect2 = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}/events`)
      .header('Authorization', `Bearer ${token}`)
      .header('Last-Event-ID', String(cursor))
    assert.deepEqual(
      parseSse(reconnect2.text()).map((e) => e.id),
      replay1.map((e) => e.id),
    )
  })

  test('drafting 但无 runner 的孤儿草案可被读取诊断', async ({ client }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const generated = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    const draftUid = generated.headers()['x-draft-id']

    const session = await AiProjectDraft.findByOrFail('draftUid', draftUid)
    session.status = 'drafting'
    await session.save()
    draftGenerationRunner.cleanupRunner(draftUid)

    const detail = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}`)
      .header('Authorization', `Bearer ${token}`)
    detail.assertStatus(200)
    detail.assertBodyContains({
      data: { draftId: draftUid, status: 'drafting', generationState: 'orphaned' },
    })
  })

  // §6.6: 验证 X-Draft-ID 与 draft.started 在模型返回之前即到达
  test('SSE 通道先于模型调用打开 — X-Draft-ID 与 started 事件先于大块模型输出', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const res = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })

    res.assertStatus(200)
    assert.isString(res.headers()['x-draft-id'], 'X-Draft-ID 必须在响应头中')
    const text = res.text()
    const firstBlock = text.split('\n\n')[0]
    assert.include(firstBlock, 'draft.started', '首个 SSE 事件必须是 draft.started')
    const payloads = parseSsePayloads(text)
    const startedPayload = payloads.find((p: Record<string, unknown>) => p.type === 'draft.started')
    assert.isTrue(startedPayload !== undefined, 'draft.started 事件必须在流中')
  })

  // §6.8: 生成进行中恢复
  test('生成进行中可通过 events 端点恢复并继续尾随', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const gen = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    const draftUid = gen.headers()['x-draft-id']
    assert.isString(draftUid)
    const events = parseSse(gen.text())
    assert.isTrue(events.length > 0, '完整 SSE 事件必须可消费')

    // 取中间 cursor 进行重连
    if (events.length >= 4) {
      const cursor = Number(events[Math.floor(events.length / 2)].id)
      const reconnect = await client
        .get(`/api/v1/ai/project-drafts/${draftUid}/events`)
        .header('Authorization', `Bearer ${token}`)
        .header('Last-Event-ID', String(cursor))
      reconnect.assertStatus(200)
      const replayEvents = parseSse(reconnect.text())
      assert.isTrue(
        replayEvents.every((e) => Number(e.id) > cursor),
        '重放事件的 sequence 必须都大于 cursor',
      )
    }
  })

  // §6.9: 游标不可连续回放
  test('无效游标返回 reset-required', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const gen = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    const draftUid = gen.headers()['x-draft-id']

    // 使用不存在的超大 cursor 应触发 reset-required
    const reconnect = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}/events`)
      .header('Authorization', `Bearer ${token}`)
      .header('Last-Event-ID', '999999')
    reconnect.assertStatus(200)
    const text = reconnect.text()
    const hasResetSignal =
      text.includes('RESET_REQUIRED') ||
      text.includes('reset-required') ||
      text.includes('reset') ||
      text.includes('游标不可续接')
    assert.isTrue(hasResetSignal, '无效 cursor 必须给出 reset 信号')
  })
})

test.group('AI 草案 API 审计与生命周期', (group) => {
  useAuthDatabase(group)

  test('生成写 AI_DRAFT_GENERATED 审计，仅元数据不含输入/PII', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)
    const rawInput = '开发面向张三使用的系统，处理身份证资料并满足隐私合规要求约束条件。'

    await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext({ rawInput }) })

    const audit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['AI_DRAFT_GENERATED'])
      .orderBy('id', 'desc')
      .firstOrFail()
    const serialized = JSON.stringify(audit.metadata)
    assert.notInclude(serialized, '张三')
    assert.notInclude(serialized, '身份证')
    assert.notInclude(serialized, '"charter":')
    assert.notInclude(serialized, rawInput)
    assert.deepInclude(audit.metadata, { event: 'AI_DRAFT_GENERATED', projectType: 'software' })
    assert.property(audit.metadata as Record<string, unknown>, 'moduleCounts')
    assert.property(audit.metadata as Record<string, unknown>, 'stages')
    assert.property(audit.metadata as Record<string, unknown>, 'confirmability')
    assert.property(audit.metadata as Record<string, unknown>, 'provenance')
    assert.property(audit.metadata as Record<string, unknown>, 'repairCount')
    const metaText = JSON.stringify(audit.metadata)
    assert.notMatch(metaText, /api[_-]?key|authorization|sk-[a-z0-9]{12,}|bearer\s+/i)
  })

  test('权限拒绝写 PERMISSION_DENIED 审计', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser()
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })

    const audit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['PERMISSION_DENIED'])
      .where('entity_type', 'ai_project_draft')
      .orderBy('id', 'desc')
      .first()
    assert.isNotNull(audit)
  })

  test('保存草稿与拒绝分别写 AI_DRAFT_SAVED / AI_DRAFT_REJECTED', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const gen = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    const draftUid = gen.headers()['x-draft-id']

    const saved = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/save`)
      .header('Authorization', `Bearer ${token}`)
    saved.assertStatus(200)
    saved.assertBodyContains({ data: { status: 'saved' } })

    const rejected = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/reject`)
      .header('Authorization', `Bearer ${token}`)
    rejected.assertStatus(200)
    rejected.assertBodyContains({ data: { status: 'rejected' } })

    const savedAudit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['AI_DRAFT_SAVED'])
      .first()
    const rejectedAudit = await AuditLog.query()
      .whereRaw(`json_extract(metadata, '$.event') = ?`, ['AI_DRAFT_REJECTED'])
      .first()
    assert.isNotNull(savedAudit)
    assert.isNotNull(rejectedAudit)
  })

  test('retry 生成新版本并续接事件序列', async ({ client, assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const token = await login(client, owner.email)

    const gen = await client
      .post(STREAM)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    const draftUid = gen.headers()['x-draft-id']
    const firstEvents = parseSse(gen.text())
    const lastSeq = Math.max(...firstEvents.map((e) => Number(e.id)))

    const retry = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/retry`)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    retry.assertStatus(200)
    // 流式重试与首次生成同通道：heartbeat / generation.output 是序列外瞬时事件
    // （sequence 独立或恒 0），续接判定只看语义事件（与上方 SSE 链路测试同口径）。
    const TRANSIENT = new Set(['draft.heartbeat', 'generation.output'])
    const retryEvents = parseSse(retry.text()).filter((e) => !TRANSIENT.has(e.event))
    assert.isTrue(
      retryEvents.every((e) => Number(e.id) > lastSeq),
      'retry 语义事件 sequence 必须续接在首版本之后',
    )

    const detail = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}`)
      .header('Authorization', `Bearer ${token}`)
    detail.assertBodyContains({ data: { version: 2 } })

    // 再次重试仍复用同一会话：draftUid 不变、版本续增为 3（不新建草案会话）。
    const retry2 = await client
      .post(`/api/v1/ai/project-drafts/${draftUid}/retry`)
      .header('Authorization', `Bearer ${token}`)
      .json({ context: makeReadyContext() })
    retry2.assertStatus(200)
    assert.equal(retry2.headers()['x-draft-id'], draftUid)
    const detail2 = await client
      .get(`/api/v1/ai/project-drafts/${draftUid}`)
      .header('Authorization', `Bearer ${token}`)
    detail2.assertBodyContains({ data: { version: 3 } })
  })
})
