/**
 * v3-llm-wiki-memory-foundation —— 主张与来源、读时遮蔽、双时态、回滚、撤回墓碑。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import KnowledgeItem from '#models/knowledge_item'
import Task from '#models/task'
import { createProjectWithMember } from '../auth/_helpers.js'
import { ProjectRoleName } from '#start/rbac/roles'
import {
  API,
  buildWorld,
  createPage,
  dataOf,
  expectStatus,
  pageBody,
  resolveSpace,
} from './_wiki_helpers.js'
import { useAuthDatabase } from '../auth/_helpers.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.group('记忆维基 · 主张与来源校验', (group) => {
  useAuthDatabase(group)

  test('来源必须存在、同组织、非 L3', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const { project: otherProject } = await createProjectWithMember(
      w.otherOrg,
      w.outsider,
      w.outsider,
      ProjectRoleName.OWNER,
    )
    const otherOrgTask = await Task.create({
      projectId: otherProject.id,
      name: '别人的任务',
      status: 'not_started',
      taskType: 'task',
      priority: 'medium',
    } as never)
    const l3 = await KnowledgeItem.create({
      organizationId: w.org.id,
      layer: 'L3',
      layerMeta: {} as never,
      title: '合成样本',
      content: '合成',
      status: 'active',
      domain: '评测',
      purpose: '评测',
      complexity: null,
      provenance: { sources: [] } as never,
      reviewHistory: [] as never,
      isSynthetic: true,
      syntheticMethod: 'x' as never,
      createdBy: w.admin.id,
      updatedBy: null,
      lastReferencedAt: null,
      retentionDays: null,
    } as never)
    const cases: Array<[string, RegExp]> = [
      ['task#999999', /不存在或不属于本组织/],
      [`task#${otherOrgTask.id}`, /不存在或不属于本组织/],
      [`knowledge_item#${l3.id}`, /L3 合成知识/],
      ['derived_query#anything', /不存在或不属于本组织/],
    ]
    for (const [source, message] of cases) {
      const res = await createPage(
        client,
        w.auth.admin,
        space.id,
        `p${Math.random().toString(36).slice(2, 8)}`,
        pageBody({ title: '测试', lines: ['- 一条陈述。[^c:a]', '', `[^c:a]: ${source}`] }),
      )
      res.assertStatus(400)
      assert.match(res.body().error.message, message)
    }
    const ok = await createPage(
      client,
      w.auth.admin,
      space.id,
      'ok',
      pageBody({
        title: '测试',
        lines: [
          '- 一条陈述。[^c:a]',
          '',
          `[^c:a]: task#${w.task.id}, user_statement#${w.member.id}`,
        ],
      }),
    )
    ok.assertStatus(201)
    const claim = await db.from('wiki_claims').where('page_id', ok.body().data.page.id).first()
    assert.equal(claim.evidence_count, 2)
    assert.notProperty(claim, 'confidence')
  })

  test('读时遮蔽：非项目成员看到占位，响应不含来源标题与 ID；项目成员看到标签', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const created = await createPage(
      client,
      w.auth.admin,
      space.id,
      'lessons',
      pageBody({
        type: 'lesson',
        title: '证书教训',
        lines: [
          '- 第三方证书须提前两周申请。[^c:cert]',
          '- 联调前先确认环境。[^c:env]',
          '',
          `[^c:cert]: risk#${w.risk.id}`,
          `[^c:env]: user_statement#${w.admin.id}`,
        ],
      }),
    )
    const pageId = created.body().data.page.id
    const asMember = await client
      .get(`${API}/pages/${pageId}`)
      .header('authorization', w.auth.member)
    asMember.assertStatus(200)
    const raw = JSON.stringify(asMember.body())
    assert.isTrue(asMember.body().data.hasMaskedContent)
    assert.include(asMember.body().data.body, '（此条需更高权限）')
    assert.notInclude(raw, '提前两周')
    assert.notInclude(raw, `risk#${w.risk.id}`)
    assert.notInclude(raw, '第三方证书延误')
    assert.include(asMember.body().data.body, '联调前先确认环境')
    assert.deepEqual(
      asMember.body().data.claims.find((c: any) => c.claimKey === 'cert'),
      { claimKey: 'cert', masked: true },
    )

    const asPm = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.pm)
    assert.isFalse(asPm.body().data.hasMaskedContent)
    const cert = asPm.body().data.claims.find((c: any) => c.claimKey === 'cert')
    assert.equal(cert.sources[0].label, `风险 #${w.risk.id}`)
    assert.include(asPm.body().data.body, '提前两周')
  })

  test('全部主张被遮蔽时仍标明存在遮蔽内容，不伪装为空', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const created = await createPage(
      client,
      w.auth.admin,
      space.id,
      'all-masked',
      pageBody({ title: '全遮蔽', lines: ['- 甲。[^c:a]', '', `[^c:a]: task#${w.task.id}`] }),
    )
    const view = await client
      .get(`${API}/pages/${created.body().data.page.id}`)
      .header('authorization', w.auth.member)
    assert.isTrue(view.body().data.hasMaskedContent)
    assert.isNotEmpty(view.body().data.body)
    const detail = await client
      .get(`${API}/revisions/${created.body().data.revision.id}`)
      .header('authorization', w.auth.member)
    assert.notInclude(detail.body().data.body, `task#${w.task.id}`)
  })
})

test.group('记忆维基 · 知识条目与维基页面作为来源', (group) => {
  useAuthDatabase(group)

  test('L1 知识条目对有 knowledge:view 的成员可见；引用受限维基页的主张对成员遮蔽', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const l1 = await KnowledgeItem.create({
      organizationId: w.org.id,
      layer: 'L1',
      layerMeta: {} as never,
      title: '发布规范',
      content: '规范正文',
      status: 'active',
      domain: '交付',
      purpose: '规范',
      complexity: null,
      provenance: { sources: [] } as never,
      reviewHistory: [] as never,
      isSynthetic: false,
      syntheticMethod: null,
      createdBy: w.admin.id,
      updatedBy: null,
      lastReferencedAt: null,
      retentionDays: null,
    } as never)
    const secret = await createPage(
      client,
      w.auth.admin,
      space.id,
      'secret',
      pageBody({ title: '内部薪酬', extraFrontmatter: ['restricted: true'] }),
    )
    const secretId = secret.body().data.page.id
    const page = await createPage(
      client,
      w.auth.admin,
      space.id,
      'mixed',
      pageBody({
        title: '混合来源',
        lines: [
          '- 按规范发布。[^c:k]',
          '- 参考内部结构。[^c:p]',
          '',
          `[^c:k]: knowledge_item#${l1.id}`,
          `[^c:p]: wiki_page#${secretId}`,
        ],
      }),
    )
    page.assertStatus(201)
    const asMember = await client
      .get(`${API}/pages/${page.body().data.page.id}`)
      .header('authorization', w.auth.member)
    const claims = asMember.body().data.claims
    assert.equal(
      claims.find((c: { claimKey: string }) => c.claimKey === 'k').sources[0].label,
      `知识条目 #${l1.id}`,
    )
    assert.deepEqual(
      claims.find((c: { claimKey: string }) => c.claimKey === 'p'),
      { claimKey: 'p', masked: true },
    )
    const asAdmin = await client
      .get(`${API}/pages/${page.body().data.page.id}`)
      .header('authorization', w.auth.admin)
    assert.isFalse(asAdmin.body().data.hasMaskedContent)
    const badId = await createPage(
      client,
      w.auth.admin,
      space.id,
      'bad',
      pageBody({ title: '坏', lines: ['- 甲。[^c:a]', '', '[^c:a]: project#abc'] }),
    )
    badId.assertStatus(400)
  })
})

test.group('记忆维基 · 双时态与回滚', (group) => {
  useAuthDatabase(group)

  test('取代时旧主张关闭有效期但保留；时点查询返回当时的主张', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const v1 = await createPage(
      client,
      w.auth.admin,
      space.id,
      'freeze',
      pageBody({
        title: '冻结窗口',
        lines: ['- 每周五冻结发布。[^c:freeze]', '', `[^c:freeze]: user_statement#${w.admin.id}`],
      }),
    )
    const pageId = v1.body().data.page.id
    await sleep(1100)
    const t1 = new Date().toISOString()
    await sleep(1100)
    const v2 = await client
      .post(`${API}/pages/${pageId}/revisions`)
      .header('authorization', w.auth.admin)
      .json({
        body: pageBody({
          title: '冻结窗口',
          lines: ['- 每周四冻结发布。[^c:freeze]', '', `[^c:freeze]: user_statement#${w.admin.id}`],
        }),
        baseRevisionId: v1.body().data.revision.id,
      })
    v2.assertStatus(201)

    const rows = await db.from('wiki_claims').where('page_id', pageId).orderBy('id', 'asc')
    assert.lengthOf(rows, 2)
    assert.equal(rows[0].status, 'superseded')
    assert.isNotNull(rows[0].valid_to)
    assert.isNotNull(rows[0].superseded_at)
    assert.equal(rows[1].supersedes_claim_id, rows[0].id)

    const now = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.member)
    assert.equal(now.body().data.claims[0].statement, '每周四冻结发布。')
    const then = await client
      .get(`${API}/pages/${pageId}?asOf=${encodeURIComponent(t1)}`)
      .header('authorization', w.auth.member)
    then.assertStatus(200)
    assert.equal(then.body().data.claims[0].statement, '每周五冻结发布。')
    assert.include(then.body().data.body, '每周五')
    assert.equal(then.body().data.revision.id, v1.body().data.revision.id)

    const before = await client
      .get(`${API}/pages/${pageId}?asOf=${encodeURIComponent('2000-01-01T00:00:00Z')}`)
      .header('authorization', w.auth.member)
    assert.isNull(before.body().data.revision)
    assert.lengthOf(before.body().data.claims, 0)
  })

  test('回滚生成新的已发布修订，不删除中间修订；非审阅者不能回滚', async ({ client, assert }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const v1 = await createPage(
      client,
      w.auth.admin,
      space.id,
      'r',
      pageBody({ title: '页', lines: ['- 第一版'] }),
    )
    const pageId = v1.body().data.page.id
    const v2 = await client
      .post(`${API}/pages/${pageId}/revisions`)
      .header('authorization', w.auth.admin)
      .json({
        body: pageBody({ title: '页', lines: ['- 第二版'] }),
        baseRevisionId: v1.body().data.revision.id,
      })
    const denied = await client
      .post(`${API}/pages/${pageId}/rollback`)
      .header('authorization', w.auth.member)
      .json({ revisionId: v1.body().data.revision.id })
    denied.assertStatus(403)
    const rolled = await client
      .post(`${API}/pages/${pageId}/rollback`)
      .header('authorization', w.auth.admin)
      .json({ revisionId: v1.body().data.revision.id })
    rolled.assertStatus(200)
    assert.notEqual(rolled.body().data.id, v1.body().data.revision.id)
    const revisionRows = await db
      .from('wiki_revisions')
      .where('page_id', pageId)
      .orderBy('id', 'asc')
    const statuses = revisionRows.map((r) => r.status)
    assert.deepEqual(statuses, ['superseded', 'superseded', 'published'])
    const view = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.member)
    assert.include(view.body().data.body, '第一版')
    const same = await client
      .post(`${API}/pages/${pageId}/rollback`)
      .header('authorization', w.auth.admin)
      .json({ revisionId: rolled.body().data.id })
    same.assertStatus(409)
    assert.exists(v2.body().data.revision.id)
  })
})

test.group('记忆维基 · 撤回墓碑', (group) => {
  useAuthDatabase(group)

  test('撤回写墓碑并生成级联提议；同一主张再次出现被拒，解除后可再写', async ({
    client,
    assert,
  }) => {
    const w = await buildWorld()
    const space = await dataOf(resolveSpace(client, w.auth.admin, 'organization'))
    const lines = [
      '- 周五不发布。[^c:rule]',
      '- 其他说明。',
      '',
      `[^c:rule]: user_statement#${w.admin.id} | kind:rule`,
    ]
    const created = await createPage(
      client,
      w.auth.admin,
      space.id,
      'rules',
      pageBody({ title: '发布规矩', lines }),
    )
    const pageId = created.body().data.page.id
    const view = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.admin)
    const claimId = view.body().data.claims[0].id

    const denied = await client
      .post(`${API}/claims/${claimId}/retract`)
      .header('authorization', w.auth.member)
      .json({})
    denied.assertStatus(403)
    const retract = await client
      .post(`${API}/claims/${claimId}/retract`)
      .header('authorization', w.auth.admin)
      .json({ reason: '没有这条规矩' })
    retract.assertStatus(200)
    assert.isNumber(retract.body().data.proposalId)

    const after = await client.get(`${API}/pages/${pageId}`).header('authorization', w.auth.member)
    assert.notInclude(after.body().data.body, '周五不发布')
    assert.lengthOf(after.body().data.claims, 0)

    const queue = await client.get(`${API}/review-queue`).header('authorization', w.auth.admin)
    assert.equal(queue.body().data[0].proposals[0].authorKind, 'system')
    assert.equal(queue.body().data[0].proposals[0].editClass, 'knowledge')

    const readd = await createPage(
      client,
      w.auth.admin,
      space.id,
      'rules2',
      pageBody({
        title: '新规矩',
        lines: ['- 周五 不发布！[^c:x]', '', `[^c:x]: user_statement#${w.admin.id}`],
      }),
    )
    readd.assertStatus(409)
    assert.equal(readd.body().error.code, 'WIKI_CLAIM_RETRACTED')

    // 组织空间墓碑也作用于项目空间
    const projectSpace = await dataOf(resolveSpace(client, w.auth.pm, 'project', w.project.id))
    const inProject = await createPage(
      client,
      w.auth.pm,
      projectSpace.id,
      'p',
      pageBody({
        title: '项目规矩',
        lines: ['- 周五不发布[^c:y]', '', `[^c:y]: user_statement#${w.pm.id}`],
      }),
    )
    inProject.assertStatus(409)

    const list = await client
      .get(`${API}/spaces/${space.id}/retractions`)
      .header('authorization', w.auth.admin)
    const retractionId = list.body().data[0].id
    const memberLift = await client
      .delete(`${API}/retractions/${retractionId}`)
      .header('authorization', w.auth.member)
    memberLift.assertStatus(403)
    await expectStatus(
      client.delete(`${API}/retractions/${retractionId}`).header('authorization', w.auth.admin),
      200,
    )
    const again = await createPage(
      client,
      w.auth.admin,
      space.id,
      'rules3',
      pageBody({
        title: '新规矩',
        lines: ['- 周五不发布。[^c:x]', '', `[^c:x]: user_statement#${w.admin.id}`],
      }),
    )
    again.assertStatus(201)
  })
})
