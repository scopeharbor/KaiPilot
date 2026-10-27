/**
 * v3-llm-wiki-person-space —— 个人空间：本人估算校准（只统计本人、只本人刷新、默认仅本人、逐页授权）、
 * 从 AI 记忆导入偏好（只产出本人审阅的提议、不读他人、禁止类别 / 墓碑 / 重复跳过）、授权给我的个人页。全部 fixture，零模型调用。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import CopilotMemoryEntry from '#models/copilot_memory_entry'
import Task from '#models/task'
import type User from '#models/user'
import WikiRetraction from '#models/wiki_retraction'
import { claimFingerprint } from '#services/wiki_memory/wiki_revision_service'
import { useAuthDatabase } from '../auth/_helpers.js'
import { API, buildWorld, dataOf, expectStatus, type WikiWorld } from './_wiki_helpers.js'

/** 本人负责、计划 2 天、实际 actualDays 个工作日（从周一开始）的已完成任务。 */
async function seedAssigned(w: WikiWorld, assignee: User, count: number, actualDays = 3) {
  const start = DateTime.fromISO('2026-10-05')
  for (let i = 0; i < count; i++) {
    await Task.create({
      projectId: w.project.id,
      name: `任务${assignee.id}-${i}`,
      status: 'completed',
      taskType: 'task',
      priority: 'medium',
      durationDays: 2,
      assigneeId: assignee.id,
      assigneeType: 'user',
      actualStartDate: start,
      actualEndDate: start.plus({ days: actualDays - 1 }),
    } as never)
  }
}

let memSeq = 0
async function seedMemory(
  w: WikiWorld,
  actor: User,
  summary: string,
  overrides: Partial<{
    memoryScope: 'user' | 'project' | 'organization'
    status: 'candidate' | 'confirmed' | 'edited' | 'possibly_outdated' | 'invalidated'
  }> = {},
) {
  return CopilotMemoryEntry.create({
    organizationId: w.org.id,
    projectId: overrides.memoryScope === 'project' ? w.project.id : null,
    actorId: actor.id,
    entryId: `wiki-person-${++memSeq}`,
    memoryScope: overrides.memoryScope ?? 'user',
    summary,
    confidence: 0.8,
    confidenceSource: 'single_observation',
    basisSessionDbId: null,
    status: overrides.status ?? 'confirmed',
    validityTier: 'medium',
    observedAt: DateTime.now().minus({ days: 1 }),
    lastConfirmedAt: null,
    retentionExpiresAt: null,
  } as never)
}

function refreshEstimate(client: any, bearer: string) {
  return client.post(`${API}/me/estimate-calibration/refresh`).header('authorization', bearer)
}

function importMemory(client: any, bearer: string) {
  return client.post(`${API}/me/import-memory`).header('authorization', bearer)
}

async function personalPage(w: WikiWorld, owner: User, slug: string) {
  return db
    .from('wiki_pages as p')
    .join('wiki_spaces as s', 's.id', 'p.space_id')
    .where('p.organization_id', w.org.id)
    .where('s.scope_kind', 'user')
    .where('s.scope_ref_id', owner.id)
    .where('p.slug', slug)
    .select('p.*')
    .first()
}

test.group('记忆维基个人空间 · 估算校准', (group) => {
  useAuthDatabase(group)

  test('只统计本人负责的任务；样本不足不产出；按簿记发布；统计不变不提交', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedAssigned(w, w.member, 4)
    await seedAssigned(w, w.admin, 20, 2)
    const first = await dataOf(refreshEstimate(client, w.auth.member))
    assert.deepInclude(first, { created: 0, skipped: 1 })
    assert.isNull(await personalPage(w, w.member, 'estimate-calibration'))

    await seedAssigned(w, w.member, 2, 5)
    const second = await dataOf(refreshEstimate(client, w.auth.member))
    assert.equal(second.created, 1)
    const page = await personalPage(w, w.member, 'estimate-calibration')
    assert.equal(page.page_type, 'person')
    assert.equal(page.owner_user_id, w.member.id)
    assert.isNull(page.shared_with_project_ids_json)
    const rev = await db.from('wiki_revisions').where('id', page.published_revision_id).first()
    assert.equal(rev.edit_class, 'bookkeeping')
    assert.equal(rev.author_kind, 'system')
    assert.include(rev.body_markdown, '你负责并已完成的任务 6 个')
    assert.include(rev.body_markdown, '实际 ÷ 计划的中位数 1.5')
    assert.include(rev.body_markdown, '按时或提前完成的占 0%')

    const third = await dataOf(refreshEstimate(client, w.auth.member))
    assert.equal(third.unchanged, 1)
    const revisions = await db.from('wiki_revisions').where('page_id', page.id).count('* as n')
    assert.equal(Number(revisions[0].n), 1)
    const audit = await db
      .from('audit_logs')
      .where('organization_id', w.org.id)
      .whereRaw("metadata LIKE '%WIKI_PERSON_ESTIMATE_REFRESHED%'")
    assert.lengthOf(audit, 3)
  })

  test('默认仅本人可读；管理员刷新只作用于自己；授权项目后该项目经理只读', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedAssigned(w, w.member, 6)
    await dataOf(refreshEstimate(client, w.auth.member))
    const page = await personalPage(w, w.member, 'estimate-calibration')
    for (const bearer of [w.auth.admin, w.auth.pm, w.auth.viewer, w.auth.outsider])
      await expectStatus(client.get(`${API}/pages/${page.id}`).header('authorization', bearer), 404)

    // 管理员刷新：只统计管理员自己（没有任务）→ 不产出，也不碰成员的页
    const adminRun = await dataOf(refreshEstimate(client, w.auth.admin))
    assert.deepInclude(adminRun, { created: 0, skipped: 1 })
    assert.isNull(await personalPage(w, w.admin, 'estimate-calibration'))
    const revisions = await db.from('wiki_revisions').where('page_id', page.id).count('* as n')
    assert.equal(Number(revisions[0].n), 1)

    await expectStatus(
      client
        .put(`${API}/pages/${page.id}/sharing`)
        .header('authorization', w.auth.member)
        .json({ projectIds: [w.project.id] }),
      200,
    )
    const asPm = await expectStatus(
      client.get(`${API}/pages/${page.id}`).header('authorization', w.auth.pm),
      200,
    )
    assert.isFalse(asPm.body().data.canEdit)
    assert.include(asPm.body().data.body, '你负责并已完成的任务 6 个')
    await expectStatus(
      client.get(`${API}/pages/${page.id}`).header('authorization', w.auth.viewer),
      404,
    )
  })

  test('未开启维基时禁用', async ({ client }) => {
    const w = await buildWorld()
    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    await expectStatus(refreshEstimate(client, w.auth.member), 503)
    await expectStatus(importMemory(client, w.auth.member), 503)
  })
})

test.group('记忆维基个人空间 · 授权给我', (group) => {
  useAuthDatabase(group)

  test('只列授权给我担任项目经理的项目的页面；不含本人、未授权与受限页', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedAssigned(w, w.member, 6)
    await seedAssigned(w, w.viewer, 6)
    await dataOf(refreshEstimate(client, w.auth.member))
    await dataOf(refreshEstimate(client, w.auth.viewer))
    await seedAssigned(w, w.pm, 6)
    await dataOf(refreshEstimate(client, w.auth.pm))
    const memberPage = await personalPage(w, w.member, 'estimate-calibration')
    const pmPage = await personalPage(w, w.pm, 'estimate-calibration')

    const empty = await dataOf(
      client.get(`${API}/shared-with-me`).header('authorization', w.auth.pm),
    )
    assert.deepEqual(empty, [])

    await expectStatus(
      client
        .put(`${API}/pages/${memberPage.id}/sharing`)
        .header('authorization', w.auth.member)
        .json({ projectIds: [w.project.id] }),
      200,
    )
    // 项目经理把自己的页授权给自己的项目：不出现在自己的列表里
    await expectStatus(
      client
        .put(`${API}/pages/${pmPage.id}/sharing`)
        .header('authorization', w.auth.pm)
        .json({ projectIds: [w.project.id] }),
      200,
    )
    const listed = await expectStatus(
      client.get(`${API}/shared-with-me`).header('authorization', w.auth.pm),
      200,
    )
    const rows = listed.body().data
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].page.id, memberPage.id)
    assert.equal(rows[0].page.title, '我的估算校准')
    assert.deepEqual(rows[0].projectIds, [w.project.id])
    assert.isString(rows[0].ownerName)
    assert.equal(listed.body().meta.total, 1)

    // 非项目经理与他组织用户看不到
    for (const bearer of [w.auth.viewer, w.auth.member, w.auth.outsider]) {
      const other = await dataOf(
        client.get(`${API}/shared-with-me`).header('authorization', bearer),
      )
      assert.notInclude(
        other.map((r: any) => r.page.id),
        memberPage.id,
      )
    }

    await db.from('wiki_pages').where('id', memberPage.id).update({ sensitivity: 'restricted' })
    const restricted = await dataOf(
      client.get(`${API}/shared-with-me`).header('authorization', w.auth.pm),
    )
    assert.deepEqual(restricted, [])
  })
})

test.group('记忆维基个人空间 · 导入 AI 记忆', (group) => {
  useAuthDatabase(group)

  test('只产出本人审阅的待审提议；不读他人与非用户级；失效、敏感类别跳过', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedMemory(w, w.member, '周报用表格')
    await seedMemory(w, w.member, '回复用中文', { status: 'candidate' })
    await seedMemory(w, w.member, '旧的偏好', { status: 'invalidated' })
    await seedMemory(w, w.member, '周五要接孩子，下午不排会')
    await seedMemory(w, w.member, '项目里用敏捷看板', { memoryScope: 'project' })
    await seedMemory(w, w.pm, '别人的偏好')

    const res = await dataOf(importMemory(client, w.auth.member))
    assert.equal(res.imported, 2)
    assert.equal(res.skipped, 1)
    const page = await personalPage(w, w.member, 'preferences')
    assert.equal(page.id, res.pageId)
    assert.isNull(page.published_revision_id)
    const proposal = await db.from('wiki_revisions').where('id', res.revisionId).first()
    assert.equal(proposal.status, 'proposed')
    assert.equal(proposal.author_kind, 'ai')
    assert.equal(proposal.edit_class, 'knowledge')
    const body = proposal.body_markdown as string
    assert.include(body, '周报用表格。')
    assert.include(body, '回复用中文。')
    assert.include(body, `user_statement#${w.member.id} | kind:preference`)
    for (const absent of ['旧的偏好', '接孩子', '敏捷看板', '别人的偏好'])
      assert.notInclude(body, absent)

    // Copilot 记忆不被修改
    const entries = await CopilotMemoryEntry.query().where('actor_id', w.member.id)
    assert.lengthOf(entries, 5)

    // 其他人看不到这份提议
    await expectStatus(
      client.get(`${API}/pages/${page.id}`).header('authorization', w.auth.admin),
      404,
    )

    // 本人确认后发布；再次导入没有新条目 → 不产生提议
    await expectStatus(
      client
        .post(`${API}/revisions/${res.revisionId}/publish`)
        .header('authorization', w.auth.member),
      200,
    )
    const again = await dataOf(importMemory(client, w.auth.member))
    // 已有的 2 条 + 敏感类别 1 条
    assert.deepEqual(again, { imported: 0, skipped: 3, pageId: page.id, revisionId: null })
    const audit = await db
      .from('audit_logs')
      .where('organization_id', w.org.id)
      .whereRaw("metadata LIKE '%WIKI_PERSON_MEMORY_IMPORTED%'")
    assert.lengthOf(audit, 2)
    assert.notInclude(JSON.stringify(audit), '周报用表格')
  })

  test('已撤回的说法不再导入；在已发布页上追加时以其为基线', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedMemory(w, w.member, '周报用表格')
    const first = await dataOf(importMemory(client, w.auth.member))
    await expectStatus(
      client
        .post(`${API}/revisions/${first.revisionId}/publish`)
        .header('authorization', w.auth.member),
      200,
    )
    const page = await personalPage(w, w.member, 'preferences')
    await WikiRetraction.create({
      organizationId: w.org.id,
      spaceId: page.space_id,
      claimFingerprint: claimFingerprint('不要 emoji。'),
      reason: '本人撤回',
      retractedBy: w.member.id,
    })
    await seedMemory(w, w.member, '不要 emoji')
    await seedMemory(w, w.member, '开会前一天提醒')
    const res = await dataOf(importMemory(client, w.auth.member))
    assert.equal(res.imported, 1)
    const proposal = await db.from('wiki_revisions').where('id', res.revisionId).first()
    assert.equal(proposal.base_revision_id, page.published_revision_id)
    const body = proposal.body_markdown as string
    assert.include(body, '周报用表格。')
    assert.include(body, '开会前一天提醒。')
    assert.notInclude(body, 'emoji')
  })

  test('没有可导入的记忆时不建页面', async ({ client, assert }) => {
    const w = await buildWorld()
    const res = await dataOf(importMemory(client, w.auth.member))
    assert.deepEqual(res, { imported: 0, skipped: 0, pageId: null, revisionId: null })
    assert.isNull(await personalPage(w, w.member, 'preferences'))
  })
})
