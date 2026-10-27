/**
 * v3-llm-wiki-planning-dossier —— 计划档案：参照类 / 打法页确定性刷新（样本门槛、按类型、统计不变不提交、保留人写解读、
 * 纯派生新页簿记发布、权限）与草案读取（本类优先、回落全组织、注明依据、只取已发布可见主张、未开启时为 null）。
 * 全部 fixture，零模型调用。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import AiProjectDraft from '#models/ai_project_draft'
import AiProjectDraftVersion from '#models/ai_project_draft_version'
import Task from '#models/task'
import WikiPlanningDossierService from '#services/wiki_memory/dossier/wiki_planning_dossier_service'
import { useAuthDatabase } from '../auth/_helpers.js'
import {
  API,
  buildWorld,
  dataOf,
  expectStatus,
  resolveSpace,
  type WikiWorld,
} from './_wiki_helpers.js'

/** 计划 2 天、实际 actualDays 个工作日（从周一开始）的已完成任务。 */
async function seedCompleted(w: WikiWorld, count: number, actualDays = 3, prefix = '完成任务') {
  const start = DateTime.fromISO('2026-10-05')
  for (let i = 0; i < count; i++) {
    await Task.create({
      projectId: w.project.id,
      name: `${prefix}${i}`,
      status: 'completed',
      taskType: 'task',
      priority: 'medium',
      durationDays: 2,
      actualStartDate: start,
      actualEndDate: start.plus({ days: actualDays - 1 }),
    } as never)
  }
}

/** 把 w.project 登记为一份已转正的活动类草案；AI 原稿含一个被删掉的任务。 */
async function seedConfirmedDraft(w: WikiWorld, projectType = 'event') {
  const session = await AiProjectDraft.create({
    draftUid: `dossier-${w.project.id}`,
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
  await AiProjectDraftVersion.create({
    draftId: session.id,
    version: 1,
    origin: 'generated',
    status: 'active',
    draft: {
      tasks: [
        { id: 't1', name: { value: '需求评审会' }, durationDays: { value: 2 } },
        { id: 't2', name: { value: '支付联调' }, durationDays: { value: 3 } },
      ],
    },
    meta: null,
    validation: null,
  } as never)
}

const service = () => app.container.make(WikiPlanningDossierService)

async function page(w: WikiWorld, slug: string) {
  return db.from('wiki_pages').where('organization_id', w.org.id).where('slug', slug).first()
}

async function publishedBody(pageId: number) {
  const p = await db.from('wiki_pages').where('id', pageId).first()
  const r = await db.from('wiki_revisions').where('id', p.published_revision_id).first()
  return r.body_markdown as string
}

test.group('记忆维基计划档案 · 刷新', (group) => {
  useAuthDatabase(group)

  test('样本不足不产出；达标后系统新建纯派生页并按簿记发布；统计不变不提交', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seedCompleted(w, 7)
    const first = await expectStatus(
      client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin),
      200,
    )
    assert.equal(first.body().data.created, 0)
    assert.isNull(await page(w, 'reference-class-all'))

    await seedCompleted(w, 2, 3, '补充任务')
    const second = await dataOf(
      client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin),
    )
    assert.equal(second.created, 1)
    const rc = await page(w, 'reference-class-all')
    assert.equal(rc.page_type, 'reference-class')
    assert.isNotNull(rc.published_revision_id)
    const rev = await db.from('wiki_revisions').where('id', rc.published_revision_id).first()
    assert.equal(rev.edit_class, 'bookkeeping')
    assert.equal(rev.author_kind, 'system')
    assert.include(rev.body_markdown, '已完成任务 9 个')
    assert.include(rev.body_markdown, '中位偏差 1.5')
    assert.isNull(await page(w, 'reference-class-event'))

    const before = await db.from('wiki_revisions').where('page_id', rc.id).count('* as n')
    const third = await dataOf(
      client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin),
    )
    assert.isAtLeast(third.unchanged, 1)
    const after = await db.from('wiki_revisions').where('page_id', rc.id).count('* as n')
    assert.equal(Number(after[0].n), Number(before[0].n))
    const audit = await db
      .from('audit_logs')
      .where('organization_id', w.org.id)
      .whereRaw("metadata LIKE '%WIKI_DOSSIER_REFRESHED%'")
    assert.lengthOf(audit, 3)
  })

  test('刷新只替换派生段，保留人写解读', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedCompleted(w, 9)
    await dataOf(client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin))
    const rc = await page(w, 'reference-class-all')
    const body = await publishedBody(rc.id)
    const withHuman = body
      .replace(
        '## 解读（人工补充，经审阅）\n',
        '## 解读（人工补充，经审阅）\n\n- 超期主要来自设计返工。[^c:h1]\n',
      )
      .replace(/\n$/, `\n[^c:h1]: user_statement#${w.admin.id}\n`)
    const edit = await expectStatus(
      client
        .post(`${API}/pages/${rc.id}/revisions`)
        .header('authorization', w.auth.admin)
        .json({ body: withHuman, baseRevisionId: rc.published_revision_id }),
      201,
    )
    assert.isTrue(edit.body().data.published)

    await seedCompleted(w, 3, 5, '新任务')
    const res = await dataOf(
      client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin),
    )
    assert.equal(res.updated, 1)
    const next = await publishedBody(rc.id)
    assert.include(next, '超期主要来自设计返工')
    assert.include(next, '已完成任务 12 个')
    const latest = await db
      .from('wiki_revisions')
      .where('page_id', rc.id)
      .orderBy('id', 'desc')
      .first()
    assert.equal(latest.edit_class, 'bookkeeping')
  })

  test('按草案项目类型分类；打法页记录删补任务', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedCompleted(w, 9)
    await seedConfirmedDraft(w, 'event')
    const res = await dataOf(
      client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin),
    )
    assert.equal(res.created, 4)
    for (const slug of [
      'reference-class-all',
      'reference-class-event',
      'playbook-all',
      'playbook-event',
    ])
      assert.isNotNull(await page(w, slug), slug)
    assert.isNull(await page(w, 'reference-class-software'))
    const pbPage = await page(w, 'playbook-event')
    const pb = await publishedBody(pbPage.id)
    assert.include(pb, '草案里常被删掉的任务：需求评审会')
    assert.include(pb, '用户常自己补上的任务：完成任务')
  })

  test('非审阅者 403；未开启维基时禁用', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedCompleted(w, 9)
    await expectStatus(
      client.post(`${API}/dossier/refresh`).header('authorization', w.auth.member),
      403,
    )
    assert.isNull(await page(w, 'reference-class-all'))
    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    await expectStatus(
      client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin),
      503,
    )
  })
})

test.group('记忆维基计划档案 · 草案读取', (group) => {
  useAuthDatabase(group)

  test('用本类档案并注明依据；回落全组织；只取已发布可见的经验主张', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedCompleted(w, 9)
    await seedConfirmedDraft(w, 'event')
    await dataOf(client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin))

    // 在全组织参照类页写一条经审阅解读（发布）与一条引用项目任务的解读（成员不可见）
    const rc = await page(w, 'reference-class-all')
    const rcBody = await publishedBody(rc.id)
    const body = rcBody
      .replace(
        '## 解读（人工补充，经审阅）\n',
        '## 解读（人工补充，经审阅）\n\n- 联调前先冻结接口。[^c:h1]\n- 支付联调最容易超期。[^c:h2]\n',
      )
      .replace(/\n$/, `\n[^c:h1]: user_statement#${w.admin.id}\n[^c:h2]: task#${w.task.id}\n`)
    await expectStatus(
      client
        .post(`${API}/pages/${rc.id}/revisions`)
        .header('authorization', w.auth.admin)
        .json({ body, baseRevisionId: rc.published_revision_id }),
      201,
    )
    // 非审阅者（项目经理在组织空间只能提议）提交的待审提议不应进入
    const publishedNow = await publishedBody(rc.id)
    const pending = `${publishedNow.trimEnd()}\n[^c:h3]: user_statement#${w.pm.id}\n`.replace(
      '- 联调前先冻结接口。[^c:h1]',
      '- 联调前先冻结接口。[^c:h1]\n- 待审的说法。[^c:h3]',
    )

    const current = await page(w, 'reference-class-all')
    await expectStatus(
      client
        .post(`${API}/pages/${rc.id}/revisions`)
        .header('authorization', w.auth.pm)
        .json({ body: pending, baseRevisionId: current.published_revision_id }),
      201,
    )

    const svc = await service()
    const event = await svc.dossierForDraft({ user: w.pm, organizationId: w.org.id }, 'event')
    assert.isNotNull(event)
    assert.deepEqual(event!.durationFactor, {
      factor: 1.5,
      basis: '依据：参照类「活动类项目任务工期参照类」· 9 个样本',
    })
    assert.deepEqual(event!.referenceClass, {
      label: '活动类项目任务工期参照类',
      samples: 9,
      p50Days: 3,
      p80Days: 3,
    })
    assert.isTrue(event!.facts.some((f) => f.includes('需求评审会')))

    const research = await svc.dossierForDraft(
      { user: w.member, organizationId: w.org.id },
      'research',
    )
    assert.equal(research!.referenceClass!.label, '全组织任务工期参照类')
    const joined = research!.facts.join('\n')
    assert.include(joined, '本组织经验（组织维基，经审阅）：联调前先冻结接口。')
    assert.notInclude(joined, '支付联调最容易超期')
    assert.notInclude(joined, '待审的说法')
  })

  test('未开启维基或没有档案页时返回 null（草案沿用现场计算）', async ({ assert }) => {
    const w = await buildWorld()
    const svc = await service()
    const actor = { user: w.pm, organizationId: w.org.id }
    assert.isNull(await svc.dossierForDraft(actor, 'software'))
    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    assert.isNull(await svc.dossierForDraft(actor, 'software'))
  })

  test('组织空间不可读或页面停用时不读取', async ({ client, assert }) => {
    const w = await buildWorld()
    await seedCompleted(w, 9)
    await dataOf(client.post(`${API}/dossier/refresh`).header('authorization', w.auth.admin))
    await db
      .from('wiki_pages')
      .where('organization_id', w.org.id)
      .where('slug', 'reference-class-all')
      .update({ status: 'archived' })
    const svc = await service()
    assert.isNull(await svc.dossierForDraft({ user: w.pm, organizationId: w.org.id }, null))
    // 他组织用户看不到本组织档案
    await dataOf(resolveSpace(client, w.auth.outsider, 'organization'))
    assert.isNull(
      await svc.dossierForDraft({ user: w.outsider, organizationId: w.otherOrg.id }, null),
    )
  })
})
