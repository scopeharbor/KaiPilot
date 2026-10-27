/**
 * v3-llm-wiki-memory-foundation —— 维基 API：开关、认证、空间、页面、审阅、组织隔离、校验。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import Organization from '#models/organization'
import { useAuthDatabase } from '../auth/_helpers.js'
import {
  API,
  buildWorld,
  createPage,
  pageBody,
  resolveSpace,
  dataOf,
  expectStatus,
} from './_wiki_helpers.js'

test.group('记忆维基 · 开关与认证', (group) => {
  useAuthDatabase(group)

  test('开关关闭时全部接口返回 FEATURE_DISABLED，设置接口仍可读', async ({ client, assert }) => {
    const w = await buildWorld()
    w.org.settings = { wikiMemoryEnabled: false }
    await w.org.save()
    const spaces = await client.get(`${API}/spaces`).header('authorization', w.auth.member)
    spaces.assertStatus(503)
    assert.equal(spaces.body().error.code, 'FEATURE_DISABLED')
    const resolve = await resolveSpace(client, w.auth.admin, 'organization')
    resolve.assertStatus(503)
    const settings = await client.get(`${API}/settings`).header('authorization', w.auth.member)
    settings.assertStatus(200)
    assert.deepEqual(settings.body().data, { enabled: false, canManage: false })
  })

  test('只有组织管理员能切换开关', async ({ client, assert }) => {
    const w = await buildWorld()
    const denied = await client
      .put(`${API}/settings`)
      .header('authorization', w.auth.member)
      .json({ enabled: false })
    denied.assertStatus(403)
    const ok = await client
      .put(`${API}/settings`)
      .header('authorization', w.auth.admin)
      .json({ enabled: false })
    ok.assertStatus(200)
    const org = await Organization.findOrFail(w.org.id)
    assert.equal(org.settings?.wikiMemoryEnabled, false)
    const bad = await client
      .put(`${API}/settings`)
      .header('authorization', w.auth.admin)
      .json({ enabled: 'yes' })
    bad.assertStatus(400)
  })

  test('未登录访问被拒（4 个端点）', async ({ client }) => {
    for (const req of [
      client.get(`${API}/spaces`),
      client.post(`${API}/spaces/resolve`).json({ scopeKind: 'organization' }),
      client.get(`${API}/pages/1`),
      client.post(`${API}/revisions/1/publish`),
    ]) {
      const res = await req
      res.assertStatus(401)
    }
  })
})

test.group('记忆维基 · 空间与页面', (group) => {
  useAuthDatabase(group)

  test('组织空间幂等解析；项目空间仅项目成员可解析', async ({ client, assert }) => {
    const w = await buildWorld()
    const a = await resolveSpace(client, w.auth.member, 'organization')
    const b = await resolveSpace(client, w.auth.admin, 'organization')
    a.assertStatus(200)
    assert.equal(a.body().data.id, b.body().data.id)

    const asMember = await resolveSpace(client, w.auth.member, 'project', w.project.id)
    asMember.assertStatus(404)
    const asPm = await resolveSpace(client, w.auth.pm, 'project', w.project.id)
    asPm.assertStatus(200)
    assert.isTrue(asPm.body().data.canReview)
    const again = await resolveSpace(client, w.auth.admin, 'project', w.project.id)
    assert.equal(again.body().data.id, asPm.body().data.id)

    const missing = await resolveSpace(client, w.auth.admin, 'project', 999999)
    missing.assertStatus(404)
    const otherUser = await resolveSpace(client, w.auth.admin, 'user', w.member.id)
    otherUser.assertStatus(404)
  })

  test('审阅者建页即发布，目录以簿记修改刷新并写日志', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const res = await createPage(
      client,
      w.auth.admin,
      space.id,
      'gray',
      pageBody({ title: '灰度发布' }),
    )
    res.assertStatus(201)
    assert.isTrue(res.body().data.published)

    const list = await client
      .get(`${API}/spaces/${space.id}/pages`)
      .header('authorization', w.auth.member)
    list.assertStatus(200)
    const index = list.body().data.find((p: any) => p.pageType === 'index')
    assert.exists(index)
    const indexView = await client
      .get(`${API}/pages/${index.id}`)
      .header('authorization', w.auth.member)
    assert.include(indexView.body().data.body, '[[gray|灰度发布]] — 灰度发布的说明')
    const indexRevision = await db
      .from('wiki_revisions')
      .where('id', indexView.body().data.revision.id)
      .first()
    assert.equal(indexRevision.edit_class, 'bookkeeping')
    assert.equal(indexRevision.author_kind, 'system')

    const log = await client
      .get(`${API}/spaces/${space.id}/log`)
      .header('authorization', w.auth.member)
    assert.match(log.body().data[0].line, /^## \[\d{4}-\d{2}-\d{2}\] publish \| 发布「灰度发布」/)
  })

  test('普通成员提交成为待审提议；审阅者在队列中发布或驳回', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const created = await createPage(
      client,
      w.auth.member,
      space.id,
      'release',
      pageBody({ title: '发布流程' }),
    )
    created.assertStatus(201)
    assert.isFalse(created.body().data.published)
    const pageId = created.body().data.page.id

    const view = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.member)
    assert.isNull(view.body().data.revision)
    assert.equal(view.body().data.body, '')

    const memberQueue = await client
      .get(`${API}/review-queue`)
      .header('authorization', w.auth.member)
    assert.lengthOf(memberQueue.body().data, 0)
    const queue = await client.get(`${API}/review-queue`).header('authorization', w.auth.admin)
    assert.lengthOf(queue.body().data, 1)
    const revisionId = queue.body().data[0].proposals[0].id

    const memberPublish = await client
      .post(`${API}/revisions/${revisionId}/publish`)
      .header('authorization', w.auth.member)
    memberPublish.assertStatus(403)
    const publish = await client
      .post(`${API}/revisions/${revisionId}/publish`)
      .header('authorization', w.auth.admin)
    publish.assertStatus(200)
    assert.equal(publish.body().data.status, 'published')
    const again = await client
      .post(`${API}/revisions/${revisionId}/publish`)
      .header('authorization', w.auth.admin)
    again.assertStatus(409)

    const edit = await client
      .post(`${API}/pages/${pageId}/revisions`)
      .header('authorization', w.auth.member)
      .json({
        body: pageBody({ title: '发布流程', lines: ['- 改动内容。'] }),
        baseRevisionId: revisionId,
      })
    edit.assertStatus(201)
    const reject = await client
      .post(`${API}/revisions/${edit.body().data.revision.id}/reject`)
      .header('authorization', w.auth.admin)
      .json({ reason: '描述不准确' })
    reject.assertStatus(200)
    assert.equal(reject.body().data.rejectReason, '描述不准确')
    const after = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.member)
    assert.equal(after.body().data.revision.id, revisionId)
  })

  test('空的修改说明与驳回原因（请求体解析为 null）按空串处理', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const created = await client
      .post(`${API}/spaces/${space.id}/pages`)
      .header('authorization', w.auth.member)
      .json({ slug: 'empty-summary', body: pageBody({ title: '空说明' }), changeSummary: '' })
    created.assertStatus(201)
    assert.equal(created.body().data.revision.changeSummary, '')
    const reject = await client
      .post(`${API}/revisions/${created.body().data.revision.id}/reject`)
      .header('authorization', w.auth.admin)
      .json({ reason: '' })
    reject.assertStatus(200)
    assert.isNull(reject.body().data.rejectReason)
  })

  test('基线过期的提议不能发布', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const created = await createPage(client, w.auth.admin, space.id, 'p', pageBody({ title: '页' }))
    const pageId = created.body().data.page.id
    const base = created.body().data.revision.id
    const submit = (text: string) =>
      client
        .post(`${API}/pages/${pageId}/revisions`)
        .header('authorization', w.auth.member)
        .json({ body: pageBody({ title: '页', lines: [text] }), baseRevisionId: base })
    const first = await submit('- 甲')
    const second = await submit('- 乙')
    await expectStatus(
      client
        .post(`${API}/revisions/${first.body().data.revision.id}/publish`)
        .header('authorization', w.auth.admin),
      200,
    )
    const stale = await client
      .post(`${API}/revisions/${second.body().data.revision.id}/publish`)
      .header('authorization', w.auth.admin)
    stale.assertStatus(409)
    assert.equal(stale.body().error.code, 'WIKI_STALE_BASE')
    const staleSubmit = await submit('- 丙')
    staleSubmit.assertStatus(409)
  })

  test('只读观察者能读不能提交；目录页不能人工编辑', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    await createPage(client, w.auth.admin, space.id, 'p', pageBody({ title: '页' }))
    const list = await client
      .get(`${API}/spaces/${space.id}/pages`)
      .header('authorization', w.auth.viewer)
    list.assertStatus(200)
    const denied = await createPage(
      client,
      w.auth.viewer,
      space.id,
      'q',
      pageBody({ title: '另一页' }),
    )
    denied.assertStatus(403)

    const index = list.body().data.find((p: any) => p.pageType === 'index')
    const view = await client.get(`${API}/pages/${index.id}`).header('authorization', w.auth.admin)
    assert.isFalse(view.body().data.canEdit)
    const edit = await client
      .post(`${API}/pages/${index.id}/revisions`)
      .header('authorization', w.auth.admin)
      .json({ body: '# 改目录', baseRevisionId: view.body().data.revision.id })
    edit.assertStatus(403)
  })

  test('restricted 页面只对审阅者可见，搜索也不返回', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const secret = await createPage(
      client,
      w.auth.admin,
      space.id,
      'salary',
      pageBody({ title: '薪酬结构', extraFrontmatter: ['restricted: true'] }),
    )
    await createPage(client, w.auth.admin, space.id, 'public', pageBody({ title: '薪酬沟通原则' }))
    const list = await client
      .get(`${API}/spaces/${space.id}/pages`)
      .header('authorization', w.auth.member)
    assert.notInclude(
      list.body().data.map((p: any) => p.slug),
      'salary',
    )
    const view = await client
      .get(`${API}/pages/${secret.body().data.page.id}`)
      .header('authorization', w.auth.member)
    view.assertStatus(404)
    const search = await client
      .get(`${API}/spaces/${space.id}/search?q=薪酬`)
      .header('authorization', w.auth.member)
    assert.deepEqual(
      search.body().data.map((p: any) => p.slug),
      ['public'],
    )
    const adminSearch = await client
      .get(`${API}/spaces/${space.id}/search?q=薪酬`)
      .header('authorization', w.auth.admin)
    assert.sameMembers(
      adminSearch.body().data.map((p: any) => p.slug),
      ['public', 'salary'],
    )
  })

  test('部门空间：本部门成员可读，其他成员 404，部门负责人可审阅', async ({ client, assert }) => {
    const w = await buildWorld()
    const [deptId] = await db
      .table('departments')
      .insert({
        organization_id: w.org.id,
        name: '交付部',
        code: 'D1',
        leader_id: w.pm.id,
        sort_order: 0,
        path: '/1',
        depth: 0,
        created_by: w.admin.id,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
    const id = typeof deptId === 'object' ? (deptId as { id: number }).id : deptId
    await db
      .from('organization_members')
      .where('user_id', w.pm.id)
      .where('organization_id', w.org.id)
      .update({ department_id: id })
    const asPm = await resolveSpace(client, w.auth.pm, 'department', id)
    asPm.assertStatus(200)
    assert.isTrue(asPm.body().data.canReview)
    const asMember = await resolveSpace(client, w.auth.member, 'department', id)
    asMember.assertStatus(404)
    const asAdmin = await resolveSpace(client, w.auth.admin, 'department', id)
    asAdmin.assertStatus(200)
  })
})

test.group('记忆维基 · 组织隔离与校验', (group) => {
  useAuthDatabase(group)

  test('跨组织读取、发布、修订列表、撤回、导出一律 404 且不泄露存在性', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const created = await createPage(client, w.auth.admin, space.id, 'p', pageBody({ title: '页' }))
    const pageId = created.body().data.page.id
    const revisionId = created.body().data.revision.id
    const nonexistent = await client
      .get(`${API}/pages/987654`)
      .header('authorization', w.auth.outsider)
    for (const req of [
      client.get(`${API}/pages/${pageId}`),
      client.get(`${API}/pages/${pageId}/revisions`),
      client.post(`${API}/revisions/${revisionId}/publish`),
      client.get(`${API}/revisions/${revisionId}`),
      client.get(`${API}/spaces/${space.id}/pages`),
      client.get(`${API}/spaces/${space.id}/export`),
      client.post(`${API}/claims/1/retract`).json({}),
    ]) {
      const res = await req.header('authorization', w.auth.outsider)
      res.assertStatus(404)
      assert.equal(res.body().error.code, 'RESOURCE_NOT_FOUND')
      assert.deepEqual(res.body(), nonexistent.body())
    }
  })

  test('请求校验：非法标识、重复标识、分页、时点参数、正文解析错误', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const badSlug = await createPage(
      client,
      w.auth.admin,
      space.id,
      '_index',
      pageBody({ title: '冒充' }),
    )
    badSlug.assertStatus(400)
    await createPage(client, w.auth.admin, space.id, 'dup', pageBody({ title: '一' }))
    const dup = await createPage(client, w.auth.admin, space.id, 'dup', pageBody({ title: '二' }))
    dup.assertStatus(409)
    const paging = await client
      .get(`${API}/spaces/${space.id}/pages?perPage=1000`)
      .header('authorization', w.auth.admin)
    paging.assertStatus(400)
    const asOf = await client
      .get(`${API}/pages/1?asOf=yesterday`)
      .header('authorization', w.auth.admin)
    asOf.assertStatus(400)
    const noType = await createPage(
      client,
      w.auth.admin,
      space.id,
      'x',
      '---\ntitle: 无类型\n---\n正文',
    )
    noType.assertStatus(400)
    const systemType = await createPage(
      client,
      w.auth.admin,
      space.id,
      'y',
      pageBody({ title: '假目录', type: 'index' }),
    )
    systemType.assertStatus(400)
    const broken = await createPage(
      client,
      w.auth.admin,
      space.id,
      'z',
      pageBody({ title: '坏', lines: ['- 没来源[^c:a]'] }),
    )
    broken.assertStatus(400)
    assert.equal(broken.body().error.code, 'VALIDATION_ERROR')
    assert.match(broken.body().error.details.errors[0].message, /缺少脚注定义/)
    const badScope = await client
      .post(`${API}/spaces/resolve`)
      .header('authorization', w.auth.admin)
      .json({ scopeKind: 'galaxy' })
    badScope.assertStatus(400)
  })
})
