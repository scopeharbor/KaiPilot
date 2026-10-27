/**
 * v3-llm-wiki-query-navigation —— 查阅：AI 同事维基工具（经 /ai/tools/execute）、确定性上下文包、影子观测与汇总、归档回答。
 * 全部 fixture，零模型调用。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { WIKI_QUERY_NOTICE } from '@aiproj/types'
import WikiContextPackBuilder from '#services/wiki_memory/query/wiki_context_pack_builder'
import WikiContextShadowService, {
  WIKI_CONTEXT_SHADOW_ENV,
} from '#services/wiki_memory/query/wiki_context_shadow_service'
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

const EXECUTE = '/api/v1/ai/tools/execute'

function execTool(
  client: any,
  bearer: string,
  toolName: string,
  parameters: Record<string, unknown>,
) {
  return client.post(EXECUTE).header('authorization', bearer).json({ toolName, parameters })
}

/** 组织空间：已发布的证书教训（含项目任务来源的主张）、受限页、成员提交的待审新页；项目空间：已发布简报。 */
async function seed(client: any, w: WikiWorld) {
  const orgSpace = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
  const lesson = await dataOf(
    createPage(
      client,
      w.auth.admin,
      orgSpace.id,
      'cert',
      pageBody({
        title: '证书教训',
        type: 'lesson',
        summary: '第三方证书相关经验',
        lines: [
          '- 第三方证书须提前两周申请。[^c:cert]',
          '- 支付联调前先确认证书有效期。[^c:pay]',
          '',
          '## 应对',
          '- 指定专人跟进证书。[^c:owner]',
          '',
          `[^c:cert]: user_statement#${w.admin.id} | kind:rule`,
          `[^c:pay]: task#${w.task.id} | kind:rule`,
          `[^c:owner]: user_statement#${w.admin.id} | kind:decision`,
        ],
      }),
    ),
  )
  const restricted = await dataOf(
    createPage(
      client,
      w.auth.admin,
      orgSpace.id,
      'cert-secret',
      pageBody({
        title: '证书供应商内幕',
        type: 'lesson',
        summary: '证书供应商的内部评价',
        extraFrontmatter: ['restricted: true'],
        lines: ['- 证书供应商甲响应慢。[^c:v]', '', `[^c:v]: user_statement#${w.admin.id}`],
      }),
    ),
  )
  const pending = await dataOf(
    createPage(
      client,
      w.auth.member,
      orgSpace.id,
      'cert-draft',
      pageBody({
        title: '证书草稿经验',
        type: 'lesson',
        lines: ['- 证书草稿主张。[^c:d]', '', `[^c:d]: user_statement#${w.member.id}`],
      }),
    ),
  )
  const projectSpace = await dataOf(resolveSpace(client, w.auth.pm, 'project', w.project.id))
  const brief = await dataOf(
    createPage(
      client,
      w.auth.pm,
      projectSpace.id,
      'project-brief',
      pageBody({
        title: '项目简报',
        type: 'project-brief',
        summary: '支付项目的目标与风险',
        lines: [
          '- 证书风险是当前首要风险。[^c:r]',
          '',
          `[^c:r]: risk#${w.risk.id} | kind:inference`,
        ],
      }),
    ),
  )
  return { orgSpace, projectSpace, lesson, restricted, pending, brief }
}

test.group('记忆维基查阅 · AI 同事工具', (group) => {
  useAuthDatabase(group)

  test('目录：项目 → 组织顺序，只列已发布页，不建空间，附说明', async ({ client, assert }) => {
    const w = await buildWorld()
    const s = await seed(client, w)
    const before = await db.from('wiki_spaces').where('organization_id', w.org.id).count('* as n')
    const res = await expectStatus(
      execTool(client, w.auth.pm, 'wiki_index', { projectId: w.project.id }),
      200,
    )
    const data = res.body().data
    assert.equal(data.notice, WIKI_QUERY_NOTICE)
    assert.deepEqual(
      data.spaces.map((x: { scopeKind: string }) => x.scopeKind),
      ['project', 'organization'],
    )
    const orgPages = data.spaces[1].pages.map((p: { slug: string }) => p.slug)
    assert.include(orgPages, 'cert')
    assert.notInclude(orgPages, 'cert-draft')
    assert.notInclude(orgPages, 'cert-secret')
    assert.notInclude(orgPages, '_index')
    assert.equal(data.spaces[0].pages[0].pageId, s.brief.page.id)
    const after = await db.from('wiki_spaces').where('organization_id', w.org.id).count('* as n')
    assert.equal(Number(after[0].n), Number(before[0].n))

    // 审阅者（组织管理员）能在目录中看到受限页
    const adminView = await dataOf(execTool(client, w.auth.admin, 'wiki_index', {}))
    const adminOrg = adminView.spaces.find(
      (x: { scopeKind: string }) => x.scopeKind === 'organization',
    )
    assert.include(
      adminOrg.pages.map((p: { slug: string }) => p.slug),
      'cert-secret',
    )
  })

  test('读页：只给已发布版本；待审修订不出现；可只读一节；遮蔽只给布尔', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const s = await seed(client, w)
    await expectStatus(
      client
        .post(`${API}/pages/${s.lesson.page.id}/revisions`)
        .header('authorization', w.auth.member)
        .json({
          body: pageBody({
            title: '证书教训',
            type: 'lesson',
            summary: '第三方证书相关经验',
            lines: ['- 待审的新说法。[^c:new]', '', `[^c:new]: user_statement#${w.member.id}`],
          }),
          baseRevisionId: s.lesson.revision.id,
        }),
      201,
    )
    const pm = await dataOf(execTool(client, w.auth.pm, 'wiki_read', { pageId: s.lesson.page.id }))
    assert.isTrue(pm.published)
    assert.notInclude(JSON.stringify(pm), '待审的新说法')
    assert.sameMembers(
      pm.claims.map((c: { key: string }) => c.key),
      ['cert', 'pay', 'owner'],
    )
    assert.isFalse(pm.hasMaskedContent)

    // 普通成员不在项目里：引用项目任务的主张被遮蔽，只给布尔
    const member = await dataOf(
      execTool(client, w.auth.member, 'wiki_read', { pageId: s.lesson.page.id }),
    )
    assert.isTrue(member.hasMaskedContent)
    assert.notInclude(
      member.claims.map((c: { key: string }) => c.key),
      'pay',
    )
    assert.notInclude(member.body, '证书有效期')

    const section = await dataOf(
      execTool(client, w.auth.pm, 'wiki_read', { pageId: s.lesson.page.id, section: '应对' }),
    )
    assert.equal(section.section, '应对')
    assert.include(section.body, '指定专人跟进证书')
    assert.notInclude(section.body, '提前两周')
    assert.deepEqual(
      section.claims.map((c: { key: string }) => c.key),
      ['owner'],
    )

    // 未发布的页面：published=false 且正文为空
    const draft = await dataOf(
      execTool(client, w.auth.admin, 'wiki_read', { pageId: s.pending.page.id }),
    )
    assert.isFalse(draft.published)
    assert.equal(draft.body, '')
    assert.lengthOf(draft.claims, 0)
  })

  test('非成员读项目页 404；个人页与他组织页 404；未开启时禁用错误', async ({ client, assert }) => {
    const w = await buildWorld()
    const s = await seed(client, w)
    const notMember = await execTool(client, w.auth.member, 'wiki_read', {
      pageId: s.brief.page.id,
    })
    notMember.assertStatus(404)
    assert.notInclude(JSON.stringify(notMember.body()), '项目简报')

    const mine = await dataOf(resolveSpace(client, w.auth.member, 'user', w.member.id))
    const personal = await dataOf(
      createPage(client, w.auth.member, mine.id, 'me', pageBody({ title: '我的偏好' })),
    )
    await expectStatus(
      execTool(client, w.auth.member, 'wiki_read', { pageId: personal.page.id }),
      404,
    )
    await expectStatus(
      execTool(client, w.auth.outsider, 'wiki_read', { pageId: s.lesson.page.id }),
      404,
    )

    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    const disabled = await execTool(client, w.auth.pm, 'wiki_index', {})
    disabled.assertStatus(503)
    assert.equal(disabled.body().error.code, 'FEATURE_DISABLED')
  })

  test('检索：合并项目与组织空间，跳过未发布页；关键词过长被拒', async ({ client, assert }) => {
    const w = await buildWorld()
    const s = await seed(client, w)
    const found = await dataOf(
      execTool(client, w.auth.pm, 'wiki_search', { keyword: '证书', projectId: w.project.id }),
    )
    const ids = found.results.map((r: { pageId: number }) => r.pageId)
    assert.include(ids, s.lesson.page.id)
    assert.notInclude(ids, s.pending.page.id)
    assert.equal(found.notice, WIKI_QUERY_NOTICE)
    await expectStatus(
      execTool(client, w.auth.pm, 'wiki_search', { keyword: '长'.repeat(61) }),
      422,
    )
  })
})

test.group('记忆维基查阅 · 上下文包与影子', (group) => {
  useAuthDatabase(group)

  test('上下文包确定性、只含已发布非受限页的可见主张、按整条主张截断', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const s = await seed(client, w)
    const builder = await app.container.make(WikiContextPackBuilder)
    const actor = { user: w.admin, organizationId: w.org.id }
    const input = { projectId: w.project.id, query: '证书延误以前怎么处理' }
    const first = await builder.build(actor, input)
    const second = await builder.build(actor, input)
    assert.deepEqual(first, second)
    const pageIds = first.pages.map((p) => p.pageId)
    assert.include(pageIds, s.lesson.page.id)
    assert.notInclude(pageIds, s.restricted.page.id)
    assert.notInclude(pageIds, s.pending.page.id)
    assert.isFalse(first.truncated)
    assert.isAbove(first.bytes, 0)
    const lesson = first.pages.find((p) => p.pageId === s.lesson.page.id)!
    assert.include(lesson.claims[0]!.sources[0]!, 'user_statement#')

    const small = await builder.build(actor, { ...input, byteBudget: 300 })
    assert.isTrue(small.truncated)
    assert.isAtMost(small.bytes, 300)
    for (const p of small.pages) for (const c of p.claims) assert.isString(c.statement)

    // 不在项目中的成员：项目页不进入，引用项目任务的主张被遮蔽后不进入
    const memberPack = await builder.build(
      { user: w.member, organizationId: w.org.id },
      { projectId: null, query: '证书 支付' },
    )
    const memberClaims = memberPack.pages.flatMap((p) => p.claims.map((c) => c.key))
    assert.notInclude(memberClaims, 'pay')
    assert.notInclude(
      memberPack.pages.map((p) => p.pageId),
      s.brief.page.id,
    )
    const none = await builder.build(actor, { projectId: null, query: '明天天气预报' })
    assert.deepEqual(none, { pages: [], bytes: 0, truncated: false })
  })

  test('影子：只记统计与问题哈希；环境变量关闭、未开启维基时不记录；汇总仅管理者', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    await seed(client, w)
    const shadow = await app.container.make(WikiContextShadowService)
    const query = '证书延误以前怎么处理'
    const base = {
      organizationId: w.org.id,
      actorId: w.pm.id,
      projectId: w.project.id,
      query,
      legacySourcesCount: 3,
      legacyFactsCount: 7,
    }
    assert.isTrue(await shadow.observe(base))
    const rows = await db.from('wiki_context_shadow_records').where('organization_id', w.org.id)
    assert.lengthOf(rows, 1)
    assert.isAbove(Number(rows[0].claims_count), 0)
    assert.equal(Number(rows[0].legacy_sources_count), 3)
    assert.equal(Number(rows[0].legacy_facts_count), 7)
    assert.lengthOf(rows[0].query_hash, 64)
    assert.notInclude(JSON.stringify(rows), '证书')

    const prev = process.env[WIKI_CONTEXT_SHADOW_ENV]
    process.env[WIKI_CONTEXT_SHADOW_ENV] = 'off'
    try {
      assert.isFalse(await shadow.observe(base))
    } finally {
      if (prev === undefined) delete process.env[WIKI_CONTEXT_SHADOW_ENV]
      else process.env[WIKI_CONTEXT_SHADOW_ENV] = prev
    }
    assert.isFalse(await shadow.observe({ ...base, actorId: 999_999 }))
    assert.isFalse(await shadow.observe({ ...base, organizationId: w.otherOrg.id }))

    const summary = await expectStatus(
      client.get(`${API}/shadow-summary`).header('authorization', w.auth.admin),
      200,
    )
    assert.deepInclude(summary.body().data, { days: 30, turns: 1, turnsWithWiki: 1 })
    await expectStatus(
      client.get(`${API}/shadow-summary`).header('authorization', w.auth.member),
      403,
    )

    w.org.settings = { ...(w.org.settings ?? {}), wikiMemoryEnabled: false }
    await w.org.save()
    assert.isFalse(await shadow.observe(base))
  })

  test('影子构建失败只返回 false，不抛出', async ({ assert }) => {
    const w = await buildWorld()
    const shadow = await app.container.make(WikiContextShadowService)
    const broken = Object.create(shadow) as WikiContextShadowService
    ;(broken as unknown as { builder: { build: () => Promise<never> } }).builder = {
      build: async () => {
        throw new Error('boom')
      },
    }
    assert.isFalse(
      await broken.observe({
        organizationId: w.org.id,
        actorId: w.pm.id,
        projectId: w.project.id,
        query: '证书',
        legacySourcesCount: 0,
        legacyFactsCount: 0,
      }),
    )
  })
})

test.group('记忆维基查阅 · 归档回答', (group) => {
  useAuthDatabase(group)

  const answer = {
    title: '证书延误怎么办',
    question: '证书延误以前怎么处理的？',
    answer: '根据维基：提前两周申请[^c:fake]，见 [[cert]]。\n\n[^c:fake]: task#1 | kind:rule',
  }

  test('审阅者存入也停在待审；正文清洗；日志与审计；重复 409', async ({ client, assert }) => {
    const w = await buildWorld()
    const res = await expectStatus(
      client.post(`${API}/file-back`).header('authorization', w.auth.admin).json(answer),
      201,
    )
    const data = res.body().data
    assert.equal(data.revision.status, 'proposed')
    assert.equal(data.revision.authorKind, 'ai')
    assert.equal(data.revision.editClass, 'knowledge')
    const page = await db.from('wiki_pages').where('id', data.pageId).first()
    assert.equal(page.page_type, 'answer')
    assert.isNull(page.published_revision_id)
    const rev = await db.from('wiki_revisions').where('id', data.revision.id).first()
    assert.notInclude(rev.body_markdown, '[^c:')
    assert.notInclude(rev.body_markdown, '[[')
    assert.include(rev.body_markdown, '> 证书延误以前怎么处理的？')
    const space = await db.from('wiki_spaces').where('id', data.spaceId).first()
    assert.equal(space.scope_kind, 'organization')
    const log = await db
      .from('wiki_log_entries')
      .where('space_id', data.spaceId)
      .where('op', 'file_back')
    assert.lengthOf(log, 1)
    const audit = await db
      .from('audit_logs')
      .where('organization_id', w.org.id)
      .whereRaw("metadata LIKE '%WIKI_ANSWER_FILED%'")
    assert.isAbove(audit.length, 0)

    const dup = await client
      .post(`${API}/file-back`)
      .header('authorization', w.auth.admin)
      .json(answer)
    dup.assertStatus(409)
    assert.equal(dup.body().error.code, 'WIKI_ANSWER_EXISTS')
  })

  test('存到项目空间；观察者无提交权限 403；禁止内容 400；空回答 400', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const res = await expectStatus(
      client
        .post(`${API}/file-back`)
        .header('authorization', w.auth.pm)
        .json({ ...answer, projectId: w.project.id }),
      201,
    )
    const space = await db.from('wiki_spaces').where('id', res.body().data.spaceId).first()
    assert.equal(space.scope_kind, 'project')
    assert.equal(Number(space.scope_ref_id), w.project.id)

    await expectStatus(
      client.post(`${API}/file-back`).header('authorization', w.auth.viewer).json(answer),
      403,
    )
    await expectStatus(
      client
        .post(`${API}/file-back`)
        .header('authorization', w.auth.admin)
        .json({ ...answer, answer: '密钥是 api_key=sk-abcdef1234567890abcdef' }),
      400,
    )
    await expectStatus(
      client
        .post(`${API}/file-back`)
        .header('authorization', w.auth.admin)
        .json({ ...answer, answer: '[^c:x]' }),
      400,
    )
    await expectStatus(
      client
        .post(`${API}/file-back`)
        .header('authorization', w.auth.member)
        .json({ ...answer, projectId: w.project.id }),
      404,
    )
  })
})
