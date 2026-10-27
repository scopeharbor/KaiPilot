/**
 * v3-llm-wiki-memory-foundation —— 个人空间授权与清空、确定性体检、导出。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Task from '#models/task'
import User from '#models/user'
import WikiPage from '#models/wiki_page'
import WikiSpace from '#models/wiki_space'
import WikiExportService from '#services/wiki_memory/wiki_export_service'
import WikiLintService from '#services/wiki_memory/wiki_lint_service'
import { WikiDlpBlockedError } from '#services/wiki_memory/errors'
import { useAuthDatabase } from '../auth/_helpers.js'
import {
  API,
  buildWorld,
  createPage,
  pageBody,
  resolveSpace,
  expectStatus,
  dataOf,
} from './_wiki_helpers.js'

/** 从 store-only zip 中取出文件名与内容（测试用最小解析）。 */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>()
  let offset = 0
  while (buf.readUInt32LE(offset) === 0x04034b50) {
    const size = buf.readUInt32LE(offset + 18)
    const nameLen = buf.readUInt16LE(offset + 26)
    const extra = buf.readUInt16LE(offset + 28)
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8')
    const start = offset + 30 + nameLen + extra
    files.set(name, buf.subarray(start, start + size).toString('utf8'))
    offset = start + size
  }
  return files
}

test.group('记忆维基 · 个人空间', (group) => {
  useAuthDatabase(group)

  test('个人页默认仅本人可读；组织管理员 404；逐页授权后项目经理只读', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const mine = await dataOf(resolveSpace(client, w.auth.member, 'user'))
    assert.isTrue(mine.canReview)
    const created = await createPage(
      client,
      w.auth.member,
      mine.id,
      'prefs',
      pageBody({ type: 'person', title: '我的偏好', lines: ['- 周报用表格。'] }),
    )
    created.assertStatus(201)
    assert.isTrue(created.body().data.published)
    const pageId = created.body().data.page.id

    for (const who of ['admin', 'pm', 'viewer'] as const) {
      const res = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth[who])
      res.assertStatus(404)
    }
    const spaces = await client.get(`${API}/spaces`).header('authorization', w.auth.admin)
    assert.notInclude(
      spaces.body().data.map((s: any) => s.id),
      mine.id,
    )

    const notOwner = await client
      .put(`${API}/pages/${pageId}/sharing`)
      .header('authorization', w.auth.admin)
      .json({ projectIds: [w.project.id] })
    notOwner.assertStatus(404)
    const share = await client
      .put(`${API}/pages/${pageId}/sharing`)
      .header('authorization', w.auth.member)
      .json({ projectIds: [w.project.id] })
    share.assertStatus(200)
    const asPm = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.pm)
    asPm.assertStatus(200)
    assert.isFalse(asPm.body().data.canEdit)
    assert.isNull(asPm.body().data.sharedWithProjectIds)
    const asAdmin = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.admin)
    asAdmin.assertStatus(200) // 组织管理员是该项目的项目经理（项目创建者）

    const badProject = await client
      .put(`${API}/pages/${pageId}/sharing`)
      .header('authorization', w.auth.member)
      .json({ projectIds: [999999] })
    badProject.assertStatus(400)
    const revoke = await client
      .put(`${API}/pages/${pageId}/sharing`)
      .header('authorization', w.auth.member)
      .json({ projectIds: [] })
    revoke.assertStatus(200)
    await expectStatus(client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.pm), 404)
  })

  test('清空个人空间：正文与主张不可恢复，保留撤回指纹，写低敏审计', async ({ client, assert }) => {
    const w = await buildWorld()
    const mine = await dataOf(resolveSpace(client, w.auth.member, 'user'))
    const body = pageBody({
      type: 'person',
      title: '我的偏好',
      lines: [
        '- 我不喜欢早会。[^c:m]',
        '',
        `[^c:m]: user_statement#${w.member.id} | kind:preference`,
      ],
    })
    await expectStatus(createPage(client, w.auth.member, mine.id, 'prefs', body), 201)
    const otherUserClear = await client
      .post(`${API}/spaces/${mine.id}/clear`)
      .header('authorization', w.auth.admin)
    otherUserClear.assertStatus(404)
    const cleared = await client
      .post(`${API}/spaces/${mine.id}/clear`)
      .header('authorization', w.auth.member)
    cleared.assertStatus(200)
    assert.equal(cleared.body().data.pagesDeleted, 2) // 页面 + 目录

    assert.lengthOf(await db.from('wiki_pages').where('space_id', mine.id), 0)
    assert.lengthOf(await db.from('wiki_claims').where('statement', 'like', '%早会%'), 0)
    assert.lengthOf(await db.from('wiki_revisions').where('body_markdown', 'like', '%早会%'), 0)
    assert.lengthOf(await db.from('wiki_retractions').where('space_id', mine.id), 1)
    const audit = await db
      .from('audit_logs')
      .where('organization_id', w.org.id)
      .where('entity_type', 'wiki_space')
      .first()
    assert.notInclude(JSON.stringify(audit), '早会')

    const again = await createPage(client, w.auth.member, mine.id, 'prefs', body)
    again.assertStatus(409)
    assert.equal(again.body().error.code, 'WIKI_CLAIM_RETRACTED')
  })
})

test.group('记忆维基 · 确定性体检', (group) => {
  useAuthDatabase(group)

  test('断链自动改纯文字（簿记发布）；来源被删后关闭主张有效期并写日志；孤页记发现', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const doomed = await Task.create({
      projectId: w.project.id,
      name: '将被删除',
      status: 'not_started',
      taskType: 'task',
      priority: 'medium',
    } as never)
    const page = await createPage(
      client,
      w.auth.admin,
      space.id,
      'a',
      pageBody({
        title: '甲',
        lines: [
          '- 参考 [[missing|不存在的页]]。',
          '- 依据任务。[^c:t]',
          '',
          `[^c:t]: task#${doomed.id}`,
        ],
      }),
    )
    await createPage(
      client,
      w.auth.admin,
      space.id,
      'b',
      pageBody({ title: '乙', lines: ['- 见 [[a]]。'] }),
    )
    const pageId = page.body().data.page.id

    await db.from('tasks').where('id', doomed.id).update({ deleted_at: DateTime.now().toSQL() })
    const memberLint = await client
      .post(`${API}/spaces/${space.id}/lint`)
      .header('authorization', w.auth.member)
    memberLint.assertStatus(403)
    const lint = await client
      .post(`${API}/spaces/${space.id}/lint`)
      .header('authorization', w.auth.admin)
    lint.assertStatus(200)
    const summary = lint.body().data
    assert.equal(summary.closedClaims, 1)
    assert.equal(summary.orphanPages, 1)

    const claim = await db
      .from('wiki_claims')
      .where('page_id', pageId)
      .where('claim_key', 't')
      .first()
    assert.equal(claim.invalid_reason, 'source_deleted')
    assert.isNotNull(claim.valid_to)
    const log = await client
      .get(`${API}/spaces/${space.id}/log`)
      .header('authorization', w.auth.admin)
    assert.match(log.body().data[0].line, /\] lint \| 体检：.*关闭主张 1/)

    // 来源已删除导致写入校验失败：断链修复留待人工（不阻断体检）
    const view = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.admin)
    assert.include(view.body().data.body, '[[missing|不存在的页]]')

    const findings = await client
      .get(`${API}/spaces/${space.id}/lint-findings?status=all`)
      .header('authorization', w.auth.admin)
    const kinds = findings.body().data.map((f: any) => f.findingKind)
    assert.includeMembers(kinds, ['source_deleted', 'orphan_page'])
  })

  test('无来源问题时断链被自动清理为纯文字并作为簿记修改发布；体检无需任何 AI 连接', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    assert.lengthOf(await db.from('ai_connections').where('organization_id', w.org.id), 0)
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const page = await createPage(
      client,
      w.auth.admin,
      space.id,
      'a',
      pageBody({ title: '甲', lines: ['- 参考 [[missing|旧页面]] 与 [[gone]]。'] }),
    )
    const pageId = page.body().data.page.id
    const lint = await client
      .post(`${API}/spaces/${space.id}/lint`)
      .header('authorization', w.auth.admin)
    assert.equal(lint.body().data.fixedBrokenLinks, 2)
    const view = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.member)
    assert.include(view.body().data.body, '参考 旧页面 与 gone。')
    const latest = await db
      .from('wiki_revisions')
      .where('page_id', pageId)
      .orderBy('id', 'desc')
      .first()
    assert.equal(latest.edit_class, 'bookkeeping')
    assert.equal(latest.author_kind, 'system')
    assert.equal(latest.status, 'published')
  })

  test('过期页记为发现，重新发布后自动关闭', async ({ assert, client }) => {
    const w = await buildWorld()
    const spaceDto = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const res = await createPage(
      client,
      w.auth.admin,
      spaceDto.id,
      'old',
      pageBody({ title: '旧', extraFrontmatter: ['staleAfterDays: 1'] }),
    )
    const space = await WikiSpace.findOrFail(spaceDto.id)
    const lint = await app.container.make(WikiLintService)
    const later = DateTime.now().plus({ days: 3 })
    const first = await lint.run(space, null, later)
    assert.equal(first.stalePages, 1)
    const page = await WikiPage.findOrFail(res.body().data.page.id)
    page.lastPublishedAt = later
    await page.save()
    const second = await lint.run(space, null, later)
    assert.equal(second.stalePages, 0)
    const finding = await db
      .from('wiki_lint_findings')
      .where('dedupe_key', `stale:${page.id}`)
      .first()
    assert.equal(finding.status, 'fixed')
  })
})

test.group('记忆维基 · 导出', (group) => {
  useAuthDatabase(group)

  test('审阅者导出 Markdown 文件夹：含目录与日志，按导出者权限遮蔽，写审计', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const mine = await dataOf(resolveSpace(client, w.auth.pm, 'user'))
    await expectStatus(
      createPage(
        client,
        w.auth.pm,
        mine.id,
        'notes',
        pageBody({
          type: 'person',
          title: '工作笔记',
          lines: ['- 证书要早办。[^c:r]', '- 公开说明。', '', `[^c:r]: risk#${w.risk.id}`],
        }),
      ),
      201,
    )
    // 离开项目后再导出：该来源对导出者不可见
    await db.from('project_members').where('user_id', w.pm.id).update({ is_active: false })

    const memberExport = await client
      .get(`${API}/spaces/${mine.id}/export`)
      .header('authorization', w.auth.member)
    memberExport.assertStatus(404)
    const res = await client
      .get(`${API}/spaces/${mine.id}/export`)
      .header('authorization', w.auth.pm)
    res.assertStatus(200)
    assert.equal(res.header('content-type'), 'application/zip')
    assert.include(res.header('content-disposition'), `wiki-space-${mine.id}.zip`)
    // HTTP 客户端会按文本解码二进制，内容断言直接取服务产物
    const exporter = await app.container.make(WikiExportService)
    exporter.dlp = { preflight: async () => true }
    const pmUser = await User.findOrFail(w.pm.id)
    const { zip } = await exporter.exportSpace({ user: pmUser, organizationId: w.org.id }, mine.id)
    const files = unzip(zip)
    assert.sameMembers([...files.keys()], ['_index.md', 'notes.md', '_log.md'])
    const notes = files.get('notes.md')!
    assert.include(notes, 'title: 工作笔记')
    assert.include(notes, '（此条需更高权限）')
    assert.notInclude(notes, '证书要早办')
    assert.notInclude(notes, `risk#${w.risk.id}`)
    assert.include(files.get('_log.md')!, 'publish |')
    const audit = await db
      .from('audit_logs')
      .where('action', 'export')
      .where('entity_type', 'wiki_space')
      .first()
    assert.exists(audit)
  })

  test('DLP 预检不放行时拒绝导出', async ({ assert }) => {
    const w = await buildWorld()
    const exporter = await app.container.make(WikiExportService)
    exporter.dlp = { preflight: async () => false }
    const user = await User.findOrFail(w.admin.id)
    const space = await WikiSpace.create({
      organizationId: w.org.id,
      scopeKind: 'organization',
      scopeRefId: w.org.id,
      title: '组织维基',
      createdBy: user.id,
    })
    await assert.rejects(
      () => exporter.exportSpace({ user, organizationId: w.org.id }, space.id),
      WikiDlpBlockedError as never,
    )
  })
})
