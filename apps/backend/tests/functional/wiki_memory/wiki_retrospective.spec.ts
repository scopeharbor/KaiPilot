/**
 * v3-llm-wiki-retrospective-lessons —— 结项复盘（未结项拒绝、统计与簿记发布、保留人写教训、权限、睡眠整理补齐）、
 * AI 提炼教训（只产出待审提议、证据与数字校验、预算、模型不可用、无效输出、串行、HTTP）、
 * 教训晋升（组织空间待审提议与按类型归章、非教训章节 / 派生主张被拒、重复被拒、权限）、
 * 教训召回（只含已发布可见、撤回后不召回、HTTP）与草案读取（附教训、未开启为 null）。全部 fixture，模型由假端口提供。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import AiProjectDraft from '#models/ai_project_draft'
import AuditLog from '#models/audit_log'
import ChangeRequest from '#models/change_request'
import ProjectMember from '#models/project_member'
import ProjectRole from '#models/project_role'
import Task from '#models/task'
import type User from '#models/user'
import WikiIngestModelProvider, {
  type WikiIngestModelPort,
  type WikiIngestModelRequest,
} from '#services/wiki_memory/ingest/wiki_ingest_model_port'
import { WIKI_INGEST_BUDGET_ENV } from '#services/wiki_memory/ingest/wiki_ingest_service'
import WikiConsolidationService from '#services/wiki_memory/lint/wiki_consolidation_service'
import WikiLessonService from '#services/wiki_memory/retrospective/wiki_lesson_service'
import WikiRetrospectiveLessonsService from '#services/wiki_memory/retrospective/wiki_retrospective_lessons_service'
import { ProjectRoleName } from '#start/rbac/roles'
import { orgBearer, useAuthDatabase } from '../auth/_helpers.js'
import {
  API,
  buildWorld,
  dataOf,
  expectStatus,
  resolveSpace,
  type WikiWorld,
} from './_wiki_helpers.js'

async function closeProject(w: WikiWorld, status = 'completed') {
  await db.from('projects').where('id', w.project.id).update({
    status,
    start_date: '2026-09-01',
    end_date: '2026-10-15',
    actual_end_date: '2026-10-19',
    updated_at: DateTime.now().toSQL(),
  })
}

/** 2 个按期 + 1 个晚 4 天（加上 buildWorld 的未开始任务共 4 个）；1 个已批准变更、1 个草稿。 */
async function seedExecution(w: WikiWorld) {
  const t = (name: string, end: string, actual: string) =>
    Task.create({
      projectId: w.project.id,
      name,
      status: 'completed',
      taskType: 'task',
      priority: 'medium',
      endDate: DateTime.fromISO(end),
      actualEndDate: DateTime.fromISO(actual),
    } as never)
  await t('需求评审', '2026-09-05', '2026-09-05')
  await t('证书申请', '2026-09-10', '2026-09-14')
  await t('压测', '2026-10-01', '2026-09-30')
  await ChangeRequest.create({
    organizationId: w.org.id,
    projectId: w.project.id,
    crCode: 'CR-1',
    title: '增加对账报表',
    description: '财务要求',
    changeType: 'scope',
    priority: 'medium',
    status: 'approved',
    requestedBy: w.pm.id,
    approvedAt: DateTime.now(),
  } as never)
  await ChangeRequest.create({
    organizationId: w.org.id,
    projectId: w.project.id,
    crCode: 'CR-2',
    title: '草稿',
    description: '草稿',
    changeType: 'scope',
    priority: 'medium',
    status: 'draft',
    requestedBy: w.pm.id,
  } as never)
}

async function asProjectMember(w: WikiWorld, user: User) {
  const role = await ProjectRole.create({
    projectId: w.project.id,
    name: ProjectRoleName.MEMBER,
    description: 'member',
    permissions: [] as unknown as string[],
    isSystem: true,
  })
  await ProjectMember.create({
    projectId: w.project.id,
    userId: user.id,
    projectRoleId: role.id,
    isActive: true,
  })
}

function refresh(client: any, bearer: string, projectId: number) {
  return client
    .post(`${API}/projects/${projectId}/retrospective/refresh`)
    .header('authorization', bearer)
}

async function retroPage(w: WikiWorld) {
  return db
    .from('wiki_pages as p')
    .join('wiki_spaces as s', 's.id', 'p.space_id')
    .where('p.organization_id', w.org.id)
    .where('s.scope_kind', 'project')
    .where('s.scope_ref_id', w.project.id)
    .where('p.slug', 'retrospective')
    .select('p.*')
    .first()
}

async function publishedBody(pageId: number) {
  const p = await db.from('wiki_pages').where('id', pageId).first()
  const r = await db.from('wiki_revisions').where('id', p.published_revision_id).first()
  return r.body_markdown as string
}

/** 生成复盘页，并由项目经理在「教训」章节发布一条人写教训。返回页面与教训主张 id。 */
async function retroWithLesson(
  client: any,
  w: WikiWorld,
  lesson = '证书类任务开工前先确认办理周期。',
) {
  await closeProject(w)
  await seedExecution(w)
  await expectStatus(refresh(client, w.auth.pm, w.project.id), 200)
  const page = await retroPage(w)
  const body = await publishedBody(page.id)
  const next = `${body
    .replace('## 教训（经审阅）\n', `## 教训（经审阅）\n\n- ${lesson}[^c:l1]\n`)
    .trimEnd()}\n[^c:l1]: user_statement#${w.pm.id}\n`
  const res = await client
    .post(`${API}/pages/${page.id}/revisions`)
    .header('authorization', w.auth.pm)
    .json({ body: next, baseRevisionId: page.published_revision_id })
  res.assertStatus(201)
  ensure(res.body().data.published === true)
  const claim = await db
    .from('wiki_claims')
    .where('page_id', page.id)
    .where('claim_key', 'l1')
    .where('status', 'active')
    .first()
  return { page, claimId: claim.id as number }
}

function ensure(cond: boolean) {
  if (!cond) throw new Error('前置条件不成立')
}

async function seedDraftType(w: WikiWorld, projectType: string) {
  await AiProjectDraft.create({
    draftUid: `retro-${w.project.id}-${projectType}`,
    organizationId: w.org.id,
    userId: w.pm.id,
    projectId: w.project.id,
    projectType,
    status: 'confirmed',
    schemaVersion: '1.0',
    currentVersion: 1,
    structuredStrategy: 'prompt',
    consistency: 'strict',
    fallbackUsed: false,
    usingRealAdapter: false,
  } as never)
}

// ── 复盘 ────────────────────────────────────────────────────────────────

test.group('记忆维基结项复盘 · 复盘页', (group) => {
  useAuthDatabase(group)

  test('未结项拒绝且不建页；结项后生成纯派生页按簿记发布，含按期比例与延误任务', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedExecution(w)
    const early = await refresh(client, w.auth.pm, w.project.id)
    early.assertStatus(400)
    assert.equal(early.body().error.code, 'VALIDATION_ERROR')
    assert.isNull(await retroPage(w))

    await closeProject(w)
    const first = await dataOf(refresh(client, w.auth.pm, w.project.id))
    assert.deepEqual(first, { created: 1, updated: 0, unchanged: 0, skipped: 0 })
    const page = await retroPage(w)
    assert.equal(page.page_type, 'lesson')
    assert.isNotNull(page.published_revision_id)
    const body = await publishedBody(page.id)
    assert.include(body, '实际结束 2026-10-19，比计划晚 4 天')
    assert.include(body, '任务 4 个，已完成 3 个；有计划与实际完成日的 3 个中按期 67%')
    assert.include(body, '延误最多：「证书申请」4 天')
    assert.include(body, '变更请求 1 个，批准 1 个')
    assert.include(body, '登记风险 1 个，结项时已处置或关闭 0 个、仍未关闭 1 个')

    const again = await dataOf(refresh(client, w.auth.pm, w.project.id))
    assert.equal(again.unchanged, 1)
    const audit = await AuditLog.query()
      .where('organization_id', w.org.id)
      .where('metadata', 'like', '%"created":1%')
      .where('entity_type', 'wiki_space')
      .first()
    assert.isNotNull(audit)
  })

  test('刷新只更新派生段、保留人写教训；已取消与已归档也可生成', async ({ client, assert }) => {
    const w = await buildWorld()
    const { page } = await retroWithLesson(client, w)
    await db
      .from('tasks')
      .where('project_id', w.project.id)
      .where('name', '支付联调')
      .update({ status: 'completed', end_date: '2026-09-20', actual_end_date: '2026-09-30' })
    const s = await dataOf(refresh(client, w.auth.pm, w.project.id))
    assert.equal(s.updated, 1)
    const body = await publishedBody(page.id)
    assert.include(body, '证书类任务开工前先确认办理周期。')
    assert.include(body, '延误最多：「支付联调」10 天、「证书申请」4 天')

    await closeProject(w, 'cancelled')
    await expectStatus(refresh(client, w.auth.pm, w.project.id), 200)
    await closeProject(w, 'archived')
    await expectStatus(refresh(client, w.auth.pm, w.project.id), 200)
  })

  test('权限：项目普通成员 403、外部组织 404、不存在 404、未开启 503', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await closeProject(w)
    await asProjectMember(w, w.member)
    await expectStatus(refresh(client, w.auth.member, w.project.id), 403)
    await expectStatus(refresh(client, w.auth.outsider, w.project.id), 404)
    await expectStatus(refresh(client, w.auth.pm, 999_999), 404)
    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    const off = await refresh(client, w.auth.pm, w.project.id)
    off.assertStatus(503)
    assert.isNull(await retroPage(w))
  })

  test('没有任务时计为跳过；睡眠整理为近期结项项目补齐复盘', async ({ client, assert }) => {
    const w = await buildWorld()
    await closeProject(w)
    await db
      .from('tasks')
      .where('project_id', w.project.id)
      .update({ deleted_at: DateTime.now().toSQL() })
    const empty = await dataOf(refresh(client, w.auth.pm, w.project.id))
    assert.equal(empty.skipped, 1)
    assert.isNull(await retroPage(w))

    await db.from('tasks').where('project_id', w.project.id).update({ deleted_at: null })
    const service = await app.container.make(WikiConsolidationService)
    const summary = await service.consolidate({ user: w.admin, organizationId: w.org.id })
    assert.equal(summary.retrospectives?.created, 1)
    assert.isNotNull(await retroPage(w))
  })
})

// ── AI 提炼教训 ──────────────────────────────────────────────────────────

interface Envelope {
  page: { project: string; facts: string; lessons: Array<{ key: string; statement: string }> }
  evidence: Array<{ ref: string; text: string }>
  allowedSections: string[]
}

class FakeProvider {
  calls = 0
  prompts: Envelope[] = []
  promptNames: Array<string | undefined> = []
  available = true
  rawText: ((env: Envelope) => string) | null = null

  async create(): Promise<WikiIngestModelPort | null> {
    if (!this.available) return null
    return {
      provider: 'fake',
      model: 'fake-lessons',
      generate: async (req: WikiIngestModelRequest) => {
        this.calls += 1
        this.promptNames.push(req.promptName)
        const env = JSON.parse(req.userPrompt.slice(req.userPrompt.indexOf('{'))) as Envelope
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

async function draftLessons(w: WikiWorld, pageId: number) {
  const service = await app.container.make(WikiRetrospectiveLessonsService)
  const run = await service.trigger({ user: w.pm, organizationId: w.org.id }, pageId)
  return service.execute(run.id, pageId)
}

const add = (statement: string, sources: string[]) => ({
  op: 'add',
  section: '教训（经审阅）',
  statement,
  sources,
  kind: 'inference',
})

test.group('记忆维基结项复盘 · AI 提炼教训', (group) => {
  useAuthDatabase(group)

  test('只产出待审提议；证据含派生段、风险与变更；证据外数字被拦下', async ({ client, assert }) => {
    const w = await buildWorld()
    await closeProject(w)
    await seedExecution(w)
    await expectStatus(refresh(client, w.auth.pm, w.project.id), 200)
    const page = await retroPage(w)
    const fake = new FakeProvider()
    fake.rawText = () =>
      JSON.stringify({
        summary: '两条教训',
        ops: [
          add('证书类任务按期率只有 67%，开工前先确认办理周期。', [
            'derived_query#project.retrospective',
          ]),
          add('第三方证书风险要指定负责人跟进。', [`risk#${w.risk.id}`]),
          add('下次预留 21 天缓冲。', ['derived_query#project.retrospective']),
        ],
      })
    const run = await withProvider(fake, () => draftLessons(w, page.id))
    assert.equal(run.status, 'succeeded')
    assert.equal(run.runKind, 'retrospective_lessons')
    assert.equal(run.opsAccepted, 2)
    assert.equal(run.opsRejected, 1)
    assert.equal(run.proposalsCreated, 1)
    assert.deepEqual(fake.promptNames, ['wiki.retrospective.lessons'])
    const refs = fake.prompts[0]!.evidence.map((e) => e.ref)
    assert.includeMembers(refs, ['derived_query#project.retrospective', `risk#${w.risk.id}`])
    assert.isTrue(refs.some((r) => r.startsWith('change_request#')))
    assert.isFalse(fake.prompts[0]!.evidence.some((e) => e.text.includes('草稿')))
    assert.deepEqual(fake.prompts[0]!.allowedSections, ['教训（经审阅）'])

    const proposals = await db
      .from('wiki_revisions')
      .where('page_id', page.id)
      .where('status', 'proposed')
    assert.lengthOf(proposals, 1)
    assert.equal(proposals[0].author_kind, 'ai')
    assert.include(proposals[0].body_markdown, '第三方证书风险要指定负责人跟进。')
    assert.notInclude(await publishedBody(page.id), '指定负责人')
  })

  test('预算用尽、模型不可用、无效输出、空操作；串行；非复盘页与非审阅者被拒；HTTP 202', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await closeProject(w)
    await seedExecution(w)
    await expectStatus(refresh(client, w.auth.pm, w.project.id), 200)
    const page = await retroPage(w)
    const fake = new FakeProvider()

    process.env[WIKI_INGEST_BUDGET_ENV] = '10'
    try {
      const budget = await withProvider(fake, () => draftLessons(w, page.id))
      assert.equal(budget.status, 'budget_exhausted')
      assert.equal(fake.calls, 0)
    } finally {
      delete process.env[WIKI_INGEST_BUDGET_ENV]
    }
    fake.available = false
    const unavailable = await withProvider(fake, () => draftLessons(w, page.id))
    assert.equal(unavailable.status, 'model_unavailable')
    fake.available = true
    fake.rawText = () => '不是 JSON'
    const invalid = await withProvider(fake, () => draftLessons(w, page.id))
    assert.equal(invalid.errorCode, 'MODEL_OUTPUT_INVALID')
    fake.rawText = null
    const none = await withProvider(fake, () => draftLessons(w, page.id))
    assert.equal(none.status, 'succeeded')
    assert.equal(none.proposalsCreated, 0)

    await asProjectMember(w, w.member)
    await expectStatus(
      client.post(`${API}/pages/${page.id}/lessons`).header('authorization', w.auth.member),
      403,
    )
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const other = await client
      .post(`${API}/spaces/${space.id}/pages`)
      .header('authorization', w.auth.admin)
      .json({ slug: 'x', body: '---\ntype: concept\ntitle: 别的页\n---\n## 内容\n- 无。' })
    await expectStatus(
      client
        .post(`${API}/pages/${other.body().data.page.id}/lessons`)
        .header('authorization', w.auth.admin),
      400,
    )

    const service = await app.container.make(WikiRetrospectiveLessonsService)
    const queued = await service.trigger({ user: w.pm, organizationId: w.org.id }, page.id)
    await expectStatus(
      client.post(`${API}/pages/${page.id}/lessons`).header('authorization', w.auth.pm),
      409,
    )
    await db.from('wiki_ingest_runs').where('id', queued.id).update({ status: 'succeeded' })
    await withProvider(fake, async () => {
      const accepted = await client
        .post(`${API}/pages/${page.id}/lessons`)
        .header('authorization', w.auth.pm)
      accepted.assertStatus(202)
      assert.equal(accepted.body().data.runKind, 'retrospective_lessons')
      for (let i = 0; i < 50; i++) {
        const row = await db.from('wiki_ingest_runs').where('id', accepted.body().data.id).first()
        if (row.status !== 'queued' && row.status !== 'running') break
        await new Promise((r) => setTimeout(r, 50))
      }
    })
  })
})

// ── 晋升与召回 ───────────────────────────────────────────────────────────

function promote(client: any, bearer: string, claimId: number) {
  return client.post(`${API}/claims/${claimId}/promote`).header('authorization', bearer)
}

async function lessonsPage(w: WikiWorld) {
  return db
    .from('wiki_pages as p')
    .join('wiki_spaces as s', 's.id', 'p.space_id')
    .where('p.organization_id', w.org.id)
    .where('s.scope_kind', 'organization')
    .where('p.slug', 'lessons')
    .select('p.*')
    .first()
}

async function publishProposal(client: any, w: WikiWorld, revisionId: number) {
  await expectStatus(
    client.post(`${API}/revisions/${revisionId}/publish`).header('authorization', w.auth.admin),
    200,
  )
}

test.group('记忆维基结项复盘 · 晋升与召回', (group) => {
  useAuthDatabase(group)

  test('晋升产生组织空间待审提议并按类型归章；重复被拒；发布后可召回', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedDraftType(w, 'software')
    const { claimId } = await retroWithLesson(client, w)

    const res = await promote(client, w.auth.pm, claimId)
    res.assertStatus(201)
    const lp = await lessonsPage(w)
    assert.equal(res.body().data.pageId, lp.id)
    assert.isNull(lp.published_revision_id)
    const proposal = await db.from('wiki_revisions').where('id', res.body().data.revisionId).first()
    assert.equal(proposal.status, 'proposed')
    assert.equal(proposal.author_kind, 'human')
    assert.include(proposal.body_markdown, '## 软件类')
    assert.include(
      proposal.body_markdown,
      '证书类任务开工前先确认办理周期（来自「测试项目」复盘）。',
    )
    assert.include(proposal.body_markdown, `user_statement#${w.pm.id} | kind:inference`)

    // 未发布：召回不到
    const before = await dataOf(
      client
        .get(`${API}/lessons/recall?q=证书申请延误&projectId=${w.project.id}`)
        .header('authorization', w.auth.member),
    )
    assert.lengthOf(before, 0)

    await publishProposal(client, w, proposal.id)
    const dup = await promote(client, w.auth.pm, claimId)
    dup.assertStatus(409)
    assert.lengthOf(
      await db.from('wiki_revisions').where('page_id', lp.id).where('status', 'proposed'),
      0,
    )

    const hits = await dataOf(
      client
        .get(
          `${API}/lessons/recall?q=${encodeURIComponent('第三方证书办理延误')}&projectId=${w.project.id}`,
        )
        .header('authorization', w.auth.member),
    )
    assert.lengthOf(hits, 1)
    assert.equal(hits[0].section, '软件类')
    assert.include(hits[0].statement, '证书类任务开工前先确认办理周期')
    assert.equal(hits[0].pageId, lp.id)
    const unrelated = await dataOf(
      client
        .get(`${API}/lessons/recall?q=${encodeURIComponent('年会场地')}`)
        .header('authorization', w.auth.member),
    )
    assert.lengthOf(unrelated, 0)
    await expectStatus(
      client
        .get(`${API}/lessons/recall?q=x&projectId=999999`)
        .header('authorization', w.auth.member),
      404,
    )
    const empty = await dataOf(
      client.get(`${API}/lessons/recall`).header('authorization', w.auth.member),
    )
    assert.lengthOf(empty, 0)

    const audit = await AuditLog.query()
      .where('organization_id', w.org.id)
      .where('metadata', 'like', '%lessonsPageId%')
      .first()
    assert.isNotNull(audit)

    // 撤回后不再召回
    const lessonClaim = await db
      .from('wiki_claims')
      .where('page_id', lp.id)
      .where('status', 'active')
      .first()
    await expectStatus(
      client
        .post(`${API}/claims/${lessonClaim.id}/retract`)
        .header('authorization', w.auth.admin)
        .json({ reason: '不适用' }),
      200,
    )
    const gone = await dataOf(
      client
        .get(`${API}/lessons/recall?q=${encodeURIComponent('第三方证书办理延误')}`)
        .header('authorization', w.auth.member),
    )
    assert.lengthOf(gone, 0)
  })

  test('只能晋升复盘页教训章节的有效主张；非审阅者 403；没有类型归入全组织', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const { page } = await retroWithLesson(client, w)
    const derived = await db
      .from('wiki_claims')
      .where('page_id', page.id)
      .where('claim_key', 'pr-tasks')
      .where('status', 'active')
      .first()
    const bad = await promote(client, w.auth.pm, derived.id)
    bad.assertStatus(400)
    assert.equal(bad.body().error.code, 'VALIDATION_ERROR')

    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const other = await client
      .post(`${API}/spaces/${space.id}/pages`)
      .header('authorization', w.auth.admin)
      .json({
        slug: 'rules',
        body: `---\ntype: concept\ntitle: 规矩\n---\n## 内容\n- 周五不发布。[^c:r]\n\n[^c:r]: user_statement#${w.admin.id}\n`,
      })
    const otherClaim = await db
      .from('wiki_claims')
      .where('page_id', other.body().data.page.id)
      .first()
    await expectStatus(promote(client, w.auth.admin, otherClaim.id), 400)

    const lesson = await db
      .from('wiki_claims')
      .where('page_id', page.id)
      .where('claim_key', 'l1')
      .where('status', 'active')
      .first()
    await asProjectMember(w, w.member)
    await expectStatus(promote(client, w.auth.member, lesson.id), 403)
    await expectStatus(promote(client, w.auth.outsider, lesson.id), 404)
    await expectStatus(promote(client, w.auth.pm, 999_999), 404)

    const res = await promote(client, w.auth.pm, lesson.id)
    res.assertStatus(201)
    const proposal = await db.from('wiki_revisions').where('id', res.body().data.revisionId).first()
    assert.include(proposal.body_markdown, '## 全组织')
  })

  test('草案读取：附同类教训；没有相关教训或未开启维基时为 null', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedDraftType(w, 'software')
    const { claimId } = await retroWithLesson(client, w)
    const res = await promote(client, w.auth.pm, claimId)
    await publishProposal(client, w, res.body().data.revisionId)

    const service = await app.container.make(WikiLessonService)
    const actor = { user: w.member, organizationId: w.org.id }
    const found = await service.lessonsForDraft(
      actor,
      'software',
      '做一个需要第三方证书办理的支付项目',
    )
    assert.isNotNull(found)
    assert.match(found!.facts[0]!, /^历史教训（组织教训库·软件类）：证书类任务开工前先确认办理周期/)
    assert.deepEqual(found!.lessons[0]!.section, '软件类')
    assert.isNull(await service.lessonsForDraft(actor, 'software', '年会场地布置'))

    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    assert.isNull(await service.lessonsForDraft(actor, 'software', '第三方证书办理'))
    await expectStatus(
      client
        .get(`${API}/lessons/recall?q=证书`)
        .header('authorization', await orgBearer(w.member, w.org.id)),
      503,
    )
  })
})
