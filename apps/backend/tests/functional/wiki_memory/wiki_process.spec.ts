/**
 * v3-llm-wiki-process-reality —— 流程实况：任务流转 / 变更审批派生页刷新（样本门槛、三段纯派生新页簿记发布、统计不变不提交、
 * 保留人写声明与解读、组织隔离、权限）、AI 解读差异（只产出待审提议、只写差异章节、证据与数字校验、预算、模型不可用、串行、HTTP），
 * 与草案读取（追加事实并注明依据、只取已发布可见主张、未开启时为 null）。全部 fixture，模型由假端口提供。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import AuditLog from '#models/audit_log'
import User from '#models/user'
import WikiIngestModelProvider, {
  type WikiIngestModelPort,
  type WikiIngestModelRequest,
} from '#services/wiki_memory/ingest/wiki_ingest_model_port'
import { WIKI_INGEST_BUDGET_ENV } from '#services/wiki_memory/ingest/wiki_ingest_service'
import WikiProcessInterpretService from '#services/wiki_memory/process/wiki_process_interpret_service'
import WikiProcessRealityService from '#services/wiki_memory/process/wiki_process_reality_service'
import { useAuthDatabase } from '../auth/_helpers.js'
import {
  API,
  buildWorld,
  createPage,
  dataOf,
  expectStatus,
  pageBody,
  resolveSpace,
  type WikiWorld,
} from './_wiki_helpers.js'

const BASE = DateTime.fromISO('2026-09-01T09:00:00Z')
const SIMPLE = ['not_started', 'in_progress', 'completed']
const REOPENED = ['not_started', 'in_progress', 'completed', 'in_progress', 'completed']

let nextEntity = 10_000

/** 一个对象按状态序列流转，每步间隔 stepDays 天。返回所用对象 ID。 */
async function seedTaskFlow(
  orgId: number,
  projectId: number | null,
  statuses: string[],
  stepDays = 1,
): Promise<number> {
  const id = nextEntity++
  for (let i = 1; i < statuses.length; i++) {
    await AuditLog.create({
      action: 'update',
      severity: 'info',
      userId: null,
      organizationId: orgId,
      projectId,
      entityType: 'task',
      entityId: id,
      metadata: { event: 'TASK_STATUS_CHANGED', from: statuses[i - 1], to: statuses[i] },
      changes: { before: { status: statuses[i - 1] }, after: { status: statuses[i] } },
      createdAt: BASE.plus({ days: i * stepDays }),
    } as never)
  }
  return id
}

const CR_EVENT: Record<string, string> = {
  submitted: 'CHANGE_REQUEST_SUBMITTED',
  under_review: 'CHANGE_REQUEST_UPDATED',
  approved: 'CHANGE_REQUEST_APPROVED',
  rejected: 'CHANGE_REQUEST_REJECTED',
  returned: 'CHANGE_REQUEST_RETURNED',
  implemented: 'CHANGE_REQUEST_IMPLEMENTED',
}

/** 变更请求：每步 [目标状态, 距上一步天数]。 */
async function seedChange(w: WikiWorld, steps: Array<[string, number]>) {
  const id = nextEntity++
  let at = BASE
  let prev = 'draft'
  for (const [to, after] of steps) {
    at = at.plus({ days: after })
    await AuditLog.create({
      action: 'update',
      severity: 'info',
      userId: w.pm.id,
      organizationId: w.org.id,
      projectId: w.project.id,
      entityType: 'change_request',
      entityId: id,
      metadata: { event: CR_EVENT[to], title: '敏感的变更标题' },
      changes: { before: { status: prev }, after: { status: to } },
      createdAt: at,
    } as never)
    prev = to
  }
}

async function seedTasks(w: WikiWorld, simple: number, reopened = 0) {
  for (let i = 0; i < simple; i++) await seedTaskFlow(w.org.id, w.project.id, SIMPLE, 2)
  for (let i = 0; i < reopened; i++) await seedTaskFlow(w.org.id, w.project.id, REOPENED)
}

const service = () => app.container.make(WikiProcessRealityService)

async function page(w: WikiWorld, slug: string) {
  return db.from('wiki_pages').where('organization_id', w.org.id).where('slug', slug).first()
}

async function publishedBody(pageId: number) {
  const p = await db.from('wiki_pages').where('id', pageId).first()
  const r = await db.from('wiki_revisions').where('id', p.published_revision_id).first()
  return r.body_markdown as string
}

/** 去掉任务流转派生段及其脚注定义（模拟有人把派生段删掉）。 */
function stripTaskFlowBlock(body: string) {
  return body
    .replace(/<!-- derived:process\.task-flow -->[\s\S]*?<!-- \/derived -->\n/, '')
    .replace(/^\[\^c:pf-[^\n]*\n/gm, '')
}

function refresh(client: any, bearer: string) {
  return client.post(`${API}/process/refresh`).header('authorization', bearer)
}

/** 在已发布正文的指定章节下加一条本人陈述主张。 */
function withClaim(body: string, heading: string, key: string, statement: string, userId: number) {
  return `${body
    .replace(`## ${heading}\n`, `## ${heading}\n\n- ${statement}[^c:${key}]\n`)
    .trimEnd()}\n[^c:${key}]: user_statement#${userId}\n`
}

test.group('记忆维基流程实况 · 刷新', (group) => {
  useAuthDatabase(group)

  test('样本不足不产出；达标后新建三段纯派生页按簿记发布；统计不变不提交', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedTasks(w, 7)
    const first = await dataOf(refresh(client, w.auth.admin))
    assert.equal(first.created, 0)
    assert.equal(first.skipped, 2)
    assert.isNull(await page(w, 'process-task-flow'))

    await seedTasks(w, 1, 2)
    const second = await dataOf(refresh(client, w.auth.admin))
    assert.equal(second.created, 1)
    const pf = await page(w, 'process-task-flow')
    assert.equal(pf.page_type, 'process')
    assert.equal(pf.title, '任务流转：声明与实际')
    const rev = await db.from('wiki_revisions').where('id', pf.published_revision_id).first()
    assert.equal(rev.edit_class, 'bookkeeping')
    assert.equal(rev.author_kind, 'system')
    const body = rev.body_markdown as string
    for (const heading of ['声明的流程（制度怎么写）', '实际的流程（数据怎么说）', '差异与解读'])
      assert.include(body, `## ${heading}`)
    assert.include(body, '走到「已完成」的任务 10 个')
    assert.include(body, '未开始 → 进行中 → 已完成（80%）')
    assert.include(body, '返工：20%')
    assert.include(body, '平均完成 1.2 轮')
    assert.include(body, '进行中 P50 2 天')

    const before = await db.from('wiki_revisions').where('page_id', pf.id).count('* as n')
    const third = await dataOf(refresh(client, w.auth.admin))
    assert.equal(third.unchanged, 1)
    const after = await db.from('wiki_revisions').where('page_id', pf.id).count('* as n')
    assert.equal(Number(after[0].n), Number(before[0].n))
    const audit = await db
      .from('audit_logs')
      .where('organization_id', w.org.id)
      .whereRaw("metadata LIKE '%WIKI_PROCESS_REFRESHED%'")
    assert.lengthOf(audit, 3)
  })

  test('变更审批：退回计两轮、样本门槛 5、派生段不含标题与操作人', async ({ client, assert }) => {
    const w = await buildWorld()
    for (let i = 0; i < 3; i++)
      await seedChange(w, [
        ['submitted', 0],
        ['under_review', 1],
        ['approved', 1],
        ['implemented', 3],
      ])
    await seedChange(w, [
      ['submitted', 0],
      ['under_review', 1],
      ['returned', 3],
      ['submitted', 1],
      ['approved', 2],
    ])
    const early = await dataOf(refresh(client, w.auth.admin))
    assert.equal(early.created, 0)
    await seedChange(w, [
      ['submitted', 0],
      ['rejected', 5],
    ])
    const res = await dataOf(refresh(client, w.auth.admin))
    assert.equal(res.created, 1)
    const pc = await page(w, 'process-change-approval')
    const body = await publishedBody(pc.id)
    assert.include(body, '已有审批结论（批准或驳回）的变更请求 5 个')
    assert.include(body, '等待：P50 2 天、P80 4 天')
    assert.include(body, '批准率 80%；被退回补充过的 20%，平均提交 1.2 轮')
    assert.include(body, '批准到实施：P50 3 天、P80 3 天')
    assert.notInclude(body, '敏感的变更标题')
    assert.notInclude(body, `#${w.pm.id}`)
  })

  test('刷新只替换派生段，保留人写声明与解读', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedTasks(w, 9)
    await dataOf(refresh(client, w.auth.admin))
    const pf = await page(w, 'process-task-flow')
    let body = await publishedBody(pf.id)
    body = withClaim(body, '声明的流程（制度怎么写）', 'd1', '评审一天内完成。', w.admin.id)
    body = withClaim(body, '差异与解读', 'i1', '实际很少返工。', w.admin.id)
    const edit = await expectStatus(
      client
        .post(`${API}/pages/${pf.id}/revisions`)
        .header('authorization', w.auth.admin)
        .json({ body, baseRevisionId: pf.published_revision_id }),
      201,
    )
    assert.isTrue(edit.body().data.published)

    await seedTasks(w, 0, 3)
    const res = await dataOf(refresh(client, w.auth.admin))
    assert.equal(res.updated, 1)
    const next = await publishedBody(pf.id)
    assert.include(next, '评审一天内完成。')
    assert.include(next, '实际很少返工。')
    assert.include(next, '走到「已完成」的任务 12 个')
    assert.include(next, '返工：25%')
    const latest = await db
      .from('wiki_revisions')
      .where('page_id', pf.id)
      .orderBy('id', 'desc')
      .first()
    assert.equal(latest.edit_class, 'bookkeeping')
  })

  test('只统计本组织的状态流转；其他事件不计入', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedTasks(w, 8)
    for (let i = 0; i < 20; i++) await seedTaskFlow(w.otherOrg.id, null, REOPENED)
    await AuditLog.create({
      action: 'update',
      severity: 'info',
      userId: w.admin.id,
      organizationId: w.org.id,
      projectId: w.project.id,
      entityType: 'task',
      entityId: 1,
      metadata: { event: 'TASK_UPDATED', to: 'completed' },
    } as never)
    await dataOf(refresh(client, w.auth.admin))
    const pf = await page(w, 'process-task-flow')
    const body = await publishedBody(pf.id)
    assert.include(body, '走到「已完成」的任务 8 个')
    assert.include(body, '返工：0%')
    assert.isNull(
      await db
        .from('wiki_pages')
        .where('organization_id', w.otherOrg.id)
        .where('slug', 'process-task-flow')
        .first(),
    )
  })

  test('派生段被人删掉时不擅自加回；没有已发布版本时重建；停用页跳过', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedTasks(w, 9)
    await dataOf(refresh(client, w.auth.admin))
    const pf = await page(w, 'process-task-flow')
    const stripped = stripTaskFlowBlock(await publishedBody(pf.id))
    await expectStatus(
      client
        .post(`${API}/pages/${pf.id}/revisions`)
        .header('authorization', w.auth.admin)
        .json({ body: stripped, baseRevisionId: pf.published_revision_id }),
      201,
    )
    await seedTasks(w, 1)
    const kept = await dataOf(refresh(client, w.auth.admin))
    assert.deepInclude(kept, { created: 0, updated: 0, skipped: 2 })
    assert.notInclude(await publishedBody(pf.id), '<!-- derived:process.task-flow -->')

    await db.from('wiki_pages').where('id', pf.id).update({ published_revision_id: null })
    const rebuilt = await dataOf(refresh(client, w.auth.admin))
    assert.equal(rebuilt.updated, 1)
    assert.include(await publishedBody(pf.id), '走到「已完成」的任务 10 个')

    await db.from('wiki_pages').where('id', pf.id).update({ status: 'archived' })
    const archived = await dataOf(refresh(client, w.auth.admin))
    assert.deepInclude(archived, { created: 0, updated: 0, skipped: 2 })
  })

  test('非审阅者 403；未开启维基时禁用', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedTasks(w, 9)
    await expectStatus(refresh(client, w.auth.member), 403)
    assert.isNull(await page(w, 'process-task-flow'))
    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    await expectStatus(refresh(client, w.auth.admin), 503)
  })
})

// ── AI 解读 ─────────────────────────────────────────────────────────────

interface InterpretEnvelope {
  page: {
    title: string
    declared: Array<{ key: string; statement: string }>
    actual: string
    interpretation: Array<{ key: string; statement: string }>
  }
  evidence: Array<{ ref: string; text: string }>
  allowedSections: string[]
}

class FakeProvider {
  calls = 0
  prompts: InterpretEnvelope[] = []
  promptNames: Array<string | undefined> = []
  available = true
  rawText: ((env: InterpretEnvelope) => string) | null = null

  async create(): Promise<WikiIngestModelPort | null> {
    if (!this.available) return null
    return {
      provider: 'fake',
      model: 'fake-interpret',
      generate: async (req: WikiIngestModelRequest) => {
        this.calls += 1
        this.promptNames.push(req.promptName)
        const env = JSON.parse(
          req.userPrompt.slice(req.userPrompt.indexOf('{')),
        ) as InterpretEnvelope
        this.prompts.push(env)
        const text = this.rawText ? this.rawText(env) : JSON.stringify({ summary: '', ops: [] })
        return { rawText: text, outputTokens: 40 }
      },
    }
  }
}

async function withProvider<T>(fake: FakeProvider, fn: () => Promise<T>): Promise<T> {
  app.container.swap(WikiIngestModelProvider, () => fake as unknown as WikiIngestModelProvider)
  try {
    return await fn()
  } finally {
    app.container.restore(WikiIngestModelProvider)
  }
}

/** 建好任务流转页，并在声明段发布一条本人陈述。 */
async function processPageWithDeclared(client: any, w: WikiWorld) {
  await seedTasks(w, 8, 2)
  await dataOf(refresh(client, w.auth.admin))
  const pf = await page(w, 'process-task-flow')
  const body = withClaim(
    await publishedBody(pf.id),
    '声明的流程（制度怎么写）',
    'd1',
    '任务验收一次通过。',
    w.admin.id,
  )
  await expectStatus(
    client
      .post(`${API}/pages/${pf.id}/revisions`)
      .header('authorization', w.auth.admin)
      .json({ body, baseRevisionId: pf.published_revision_id }),
    201,
  )
  return page(w, 'process-task-flow')
}

async function interpret(w: WikiWorld, pageId: number) {
  const svc = await app.container.make(WikiProcessInterpretService)
  const admin = await User.findOrFail(w.admin.id)
  const run = await svc.trigger({ user: admin, organizationId: w.org.id }, pageId)
  return svc.execute(run.id, pageId)
}

test.group('记忆维基流程实况 · AI 解读', (group) => {
  useAuthDatabase(group)

  test('只产出待审提议，只写差异章节；来源与数字须出自证据', async ({ client, assert }) => {
    const w = await buildWorld()
    const pf = await processPageWithDeclared(client, w)
    const derivedRef = 'derived_query#process.task-flow'
    const userRef = `user_statement#${w.admin.id}`
    const fake = new FakeProvider()
    fake.rawText = () =>
      JSON.stringify({
        summary: '声明与实际不一致',
        ops: [
          {
            op: 'add',
            section: '差异与解读',
            statement:
              '制度说验收一次通过，但实际 20% 的任务完成后被重新打开，可能是验收标准不清。',
            sources: [derivedRef, userRef],
            kind: 'inference',
          },
          {
            op: 'add',
            section: '声明的流程（制度怎么写）',
            statement: '验收要两轮。',
            sources: [derivedRef],
          },
          {
            op: 'add',
            section: '差异与解读',
            statement: '返工让工期多出 37 天。',
            sources: [derivedRef],
          },
          { op: 'update', claimKey: 'd1', statement: '验收两轮。', sources: [userRef] },
          {
            op: 'add',
            section: '差异与解读',
            statement: '编造的来源。',
            sources: ['task#999999'],
          },
        ],
      })
    const before = await db.from('wiki_pages').where('id', pf.id).first()
    const run = await withProvider(fake, () => interpret(w, pf.id))
    assert.equal(run.status, 'succeeded')
    assert.equal(run.runKind, 'process_interpret')
    assert.equal(run.opsAccepted, 1)
    assert.equal(run.opsRejected, 4)
    assert.equal(run.proposalsCreated, 1)
    assert.deepEqual(fake.promptNames, ['wiki.process.interpret'])

    const env = fake.prompts[0]!
    assert.deepEqual(env.allowedSections, ['差异与解读'])
    assert.deepEqual(
      env.page.declared.map((c) => c.statement),
      ['任务验收一次通过。'],
    )
    assert.include(env.page.actual, '返工：20%')
    assert.sameMembers(
      env.evidence.map((e) => e.ref),
      [derivedRef, userRef],
    )

    const after = await db.from('wiki_pages').where('id', pf.id).first()
    assert.equal(after.published_revision_id, before.published_revision_id)
    const proposal = await db
      .from('wiki_revisions')
      .where('page_id', pf.id)
      .orderBy('id', 'desc')
      .first()
    assert.equal(proposal.status, 'proposed')
    assert.equal(proposal.author_kind, 'ai')
    assert.equal(proposal.edit_class, 'knowledge')
    const proposed = proposal.body_markdown as string
    const interp = proposed.slice(proposed.indexOf('## 差异与解读'))
    assert.include(interp, '实际 20% 的任务完成后被重新打开')
    assert.notInclude(proposed, '验收要两轮')
    assert.notInclude(proposed, '37 天')
    assert.include(proposed, '任务验收一次通过。')

    const audit = await db
      .from('audit_logs')
      .where('organization_id', w.org.id)
      .whereRaw("metadata LIKE '%WIKI_PROCESS_INTERPRETED%'")
    assert.lengthOf(audit, 1)
    assert.notInclude(JSON.stringify(audit), '重新打开')
  })

  test('预算用尽不调用模型；没有模型；无效输出；没有合规操作时不产生提议', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const pf = await processPageWithDeclared(client, w)
    const fake = new FakeProvider()

    process.env[WIKI_INGEST_BUDGET_ENV] = '10'
    try {
      const run = await withProvider(fake, () => interpret(w, pf.id))
      assert.equal(run.status, 'budget_exhausted')
      assert.equal(fake.calls, 0)
    } finally {
      delete process.env[WIKI_INGEST_BUDGET_ENV]
    }

    fake.available = false
    const none = await withProvider(fake, () => interpret(w, pf.id))
    assert.equal(none.status, 'model_unavailable')

    fake.available = true
    fake.rawText = () => '这不是 JSON'
    const invalid = await withProvider(fake, () => interpret(w, pf.id))
    assert.equal(invalid.status, 'failed')
    assert.equal(invalid.errorCode, 'MODEL_OUTPUT_INVALID')

    fake.rawText = null
    const empty = await withProvider(fake, () => interpret(w, pf.id))
    assert.equal(empty.status, 'succeeded')
    assert.equal(empty.proposalsCreated, 0)
    assert.equal(empty.tokensUsed > 0, true)
    const proposals = await db
      .from('wiki_revisions')
      .where('page_id', pf.id)
      .where('status', 'proposed')
    assert.lengthOf(proposals, 0)
  })

  test('派生段被删掉的页面记为没有原料；页面停用时也不调用模型', async ({ client, assert }) => {
    const w = await buildWorld()
    const pf = await processPageWithDeclared(client, w)
    const body = stripTaskFlowBlock(await publishedBody(pf.id))
    await expectStatus(
      client
        .post(`${API}/pages/${pf.id}/revisions`)
        .header('authorization', w.auth.admin)
        .json({ body, baseRevisionId: pf.published_revision_id }),
      201,
    )
    const fake = new FakeProvider()
    const run = await withProvider(fake, () => interpret(w, pf.id))
    assert.equal(run.status, 'no_events')
    assert.equal(fake.calls, 0)

    const svc = await app.container.make(WikiProcessInterpretService)
    const admin = await User.findOrFail(w.admin.id)
    const queued = await svc.trigger({ user: admin, organizationId: w.org.id }, pf.id)
    await db.from('wiki_pages').where('id', pf.id).update({ status: 'archived' })
    const archived = await withProvider(fake, () => svc.execute(queued.id, pf.id))
    assert.equal(archived.status, 'no_events')
    assert.equal(fake.calls, 0)
  })

  test('HTTP：非流程页 400、非审阅者 403、跨组织 404、进行中 409、成功 202 并可轮询', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const pf = await processPageWithDeclared(client, w)
    const orgSpace = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const concept = await dataOf(
      createPage(client, w.auth.admin, orgSpace.id, 'glossary', pageBody({ title: '术语' })),
    )
    await expectStatus(
      client
        .post(`${API}/pages/${concept.page.id}/interpret`)
        .header('authorization', w.auth.admin),
      400,
    )
    await expectStatus(
      client.post(`${API}/pages/${pf.id}/interpret`).header('authorization', w.auth.member),
      403,
    )
    await expectStatus(
      client.post(`${API}/pages/${pf.id}/interpret`).header('authorization', w.auth.outsider),
      404,
    )

    const svc = await app.container.make(WikiProcessInterpretService)
    const admin = await User.findOrFail(w.admin.id)
    const pending = await svc.trigger({ user: admin, organizationId: w.org.id }, pf.id)
    await expectStatus(
      client.post(`${API}/pages/${pf.id}/interpret`).header('authorization', w.auth.admin),
      409,
    )
    await db
      .from('wiki_ingest_runs')
      .where('id', pending.id)
      .update({ status: 'failed', finished_at: DateTime.now().toSQL() })

    const fake = new FakeProvider()
    await withProvider(fake, async () => {
      const accepted = await expectStatus(
        client.post(`${API}/pages/${pf.id}/interpret`).header('authorization', w.auth.admin),
        202,
      )
      assert.equal(accepted.body().data.runKind, 'process_interpret')
      assert.equal(accepted.body().data.status, 'queued')
      let runs: any[] = []
      for (let i = 0; i < 50; i++) {
        const res = await client
          .get(`${API}/spaces/${orgSpace.id}/ingest-runs`)
          .header('authorization', w.auth.admin)
        runs = res.body().data
        if (runs[0] && !['queued', 'running'].includes(runs[0].status)) break
        await new Promise((r) => setTimeout(r, 100))
      }
      assert.equal(runs[0].status, 'succeeded')
      assert.equal(runs[0].runKind, 'process_interpret')
    })

    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    await expectStatus(
      client.post(`${API}/pages/${pf.id}/interpret`).header('authorization', w.auth.admin),
      503,
    )
  })
})

// ── 草案读取 ────────────────────────────────────────────────────────────

test.group('记忆维基流程实况 · 草案读取', (group) => {
  useAuthDatabase(group)

  test('追加实际流转与审批等待并注明依据；只取已发布可见主张', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedTasks(w, 6, 2)
    for (let i = 0; i < 5; i++)
      await seedChange(w, [
        ['submitted', 0],
        ['approved', 2 + i],
      ])
    await dataOf(refresh(client, w.auth.admin))

    // 声明段：一条本人陈述（可见）与一条引用项目任务的主张（成员不可见）
    const pf = await page(w, 'process-task-flow')
    let body = withClaim(
      await publishedBody(pf.id),
      '声明的流程（制度怎么写）',
      'd1',
      '评审一天内完成。',
      w.admin.id,
    )
    body = `${body
      .replace(
        '- 评审一天内完成。[^c:d1]',
        '- 评审一天内完成。[^c:d1]\n- 支付联调要双人评审。[^c:d2]',
      )
      .trimEnd()}\n[^c:d2]: task#${w.task.id}\n`
    await expectStatus(
      client
        .post(`${API}/pages/${pf.id}/revisions`)
        .header('authorization', w.auth.admin)
        .json({ body, baseRevisionId: pf.published_revision_id }),
      201,
    )
    // 项目经理在组织空间只能提议：待审内容不进入
    const current = await page(w, 'process-task-flow')
    await expectStatus(
      client
        .post(`${API}/pages/${pf.id}/revisions`)
        .header('authorization', w.auth.pm)
        .json({
          body: withClaim(await publishedBody(pf.id), '差异与解读', 'p1', '待审的解读。', w.pm.id),
          baseRevisionId: current.published_revision_id,
        }),
      201,
    )

    const svc = await service()
    const result = await svc.processForDraft({ user: w.member, organizationId: w.org.id })
    assert.isNotNull(result)
    const joined = result!.facts.join('\n')
    assert.include(joined, '约 25% 的任务完成后被重新打开或退回')
    assert.include(joined, '组织维基「任务流转：声明与实际」，8 个样本')
    assert.include(joined, '实际等待 P50 4 天、P80 5 天')
    assert.include(joined, '「变更审批：声明与实际」，5 个样本')
    assert.include(joined, '本组织流程（组织维基，经审阅）：评审一天内完成。')
    assert.notInclude(joined, '支付联调要双人评审')
    assert.notInclude(joined, '待审的解读')
    assert.deepEqual(result!.processReality, {
      taskFlow: { label: '任务流转：声明与实际', samples: 8, reworkRate: 25, blockedRate: 0 },
      changeApproval: {
        label: '变更审批：声明与实际',
        samples: 5,
        waitP50Days: 4,
        waitP80Days: 5,
        returnRate: 0,
      },
    })
  })

  test('未开启维基、没有流程页、页面停用或跨组织时返回 null', async ({ client, assert }) => {
    const w = await buildWorld()
    const svc = await service()
    const actor = { user: w.pm, organizationId: w.org.id }
    assert.isNull(await svc.processForDraft(actor))
    await seedTasks(w, 9)
    await dataOf(refresh(client, w.auth.admin))
    assert.isNotNull(await svc.processForDraft(actor))
    assert.isNull(await svc.processForDraft({ user: w.outsider, organizationId: w.otherOrg.id }))
    await db
      .from('wiki_pages')
      .where('organization_id', w.org.id)
      .where('slug', 'process-task-flow')
      .update({ status: 'archived' })
    assert.isNull(await svc.processForDraft(actor))
    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    assert.isNull(await svc.processForDraft(actor))
  })
})
