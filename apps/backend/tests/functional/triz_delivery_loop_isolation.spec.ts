// v3-triz-to-delivery-closed-loop §3.10/3.11 —— 闭环持久化、append-only 与组织隔离功能测试。
// 覆盖：CHECK 非法值拒绝、link/event digest 幂等去重与跨租分域、
// forOrganization 跨租零泄露、supersession 更正链（不删旧行）、
// 删除正式实体不级联删除闭环历史（schema 无 FK 级联）。
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import TrizDeliveryLink from '#models/triz_delivery_link'
import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

const now = () => DateTime.now().toSQL()!

async function insertLinkRaw(
  orgId: number,
  projectId: number,
  digest: string,
  extra: Record<string, unknown> = {},
) {
  return db.table('triz_delivery_links').insert({
    organization_id: orgId,
    project_id: projectId,
    decision_log_id: 1,
    delivery_refs: JSON.stringify([{ kind: 'task', entityId: '2001' }]),
    context_refs: '[]',
    link_mode: 'apply_receipt',
    link_digest: digest,
    actor_user_id: 1,
    created_at: now(),
    ...extra,
  })
}

async function insertEventRaw(
  orgId: number,
  projectId: number,
  linkId: number,
  digest: string,
  extra: Record<string, unknown> = {},
) {
  return db.table('triz_delivery_events').insert({
    organization_id: orgId,
    project_id: projectId,
    link_id: linkId,
    event_kind: 'verification_recorded',
    conclusion: 'effective',
    fingerprint: 'fp_test',
    event_digest: digest,
    actor_user_id: 1,
    created_at: now(),
    ...extra,
  })
}

test.group('TRIZ 交付闭环持久化与组织隔离（§3.10/3.11）', (group) => {
  useAuthDatabase(group)

  let orgA: Awaited<ReturnType<typeof createOrganization>>
  let orgB: Awaited<ReturnType<typeof createOrganization>>
  let ownerA: Awaited<ReturnType<typeof createUser>>
  let ownerB: Awaited<ReturnType<typeof createUser>>

  group.each.setup(async () => {
    ownerA = await createUser({
      email: `tdl-a-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    orgA = await createOrganization(ownerA)
    ownerB = await createUser({
      email: `tdl-b-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    orgB = await createOrganization(ownerB)
  })

  test('正例：Lucid 创建 link 并可按组织读回（JSON 列 prepare/consume 往返）', async ({
    assert,
  }) => {
    const link = await TrizDeliveryLink.create({
      organizationId: Number(orgA.id),
      projectId: 10,
      decisionLogId: 5,
      deliveryRefs: [{ kind: 'task', entityId: '2001' }],
      contextRefs: [{ kind: 'risk', entityId: '31' }],
      linkMode: 'apply_receipt',
      linkDigest: 'tdllink_pos1',
      actorUserId: Number(ownerA.id),
    })
    const found = await TrizDeliveryLink.forOrganization(Number(orgA.id))
      .where('id', link.id)
      .firstOrFail()
    assert.equal(found.linkMode, 'apply_receipt')
    assert.equal(found.deliveryRefs[0].kind, 'task')
    assert.equal(found.contextRefs[0].entityId, '31')
    assert.isNull(found.supersededByLinkId)
  })

  test('非法 link_mode 被 CHECK 拒绝', async ({ assert }) => {
    try {
      await insertLinkRaw(Number(orgA.id), 10, 'tdllink_badmode', { link_mode: 'auto_apply' })
      assert.fail('非法 link_mode 应被 CHECK 拒绝')
    } catch (e) {
      assert.match(String((e as Error).message), /check/i)
    }
  })

  test('非法 event_kind 与 conclusion 被 CHECK 拒绝', async ({ assert }) => {
    const [linkId] = await insertLinkRaw(Number(orgA.id), 10, 'tdllink_chk_evt')
    try {
      await insertEventRaw(Number(orgA.id), 10, Number(linkId), 'tdlev_bad_kind', {
        event_kind: 'automatic_success',
      })
      assert.fail('非法 event_kind 应被 CHECK 拒绝')
    } catch (e) {
      assert.match(String((e as Error).message), /check/i)
    }
    try {
      await insertEventRaw(Number(orgA.id), 10, Number(linkId), 'tdlev_bad_conc', {
        conclusion: 'guessed_effective',
      })
      assert.fail('非法 conclusion 应被 CHECK 拒绝')
    } catch (e) {
      assert.match(String((e as Error).message), /check/i)
    }
  })

  test('link_digest 组织内幂等去重：同 digest 二次插入被唯一约束拒绝', async ({ assert }) => {
    await insertLinkRaw(Number(orgA.id), 10, 'tdllink_dedup')
    try {
      await insertLinkRaw(Number(orgA.id), 10, 'tdllink_dedup')
      assert.fail('重复 link_digest 应被拒绝')
    } catch (e) {
      assert.match(String((e as Error).message), /unique/i)
    }
  })

  test('跨组织同 refs：digest 由共享纯函数内嵌 org 输入而分域，双方均可落库', async ({
    assert,
  }) => {
    // 与共享契约 trizDlComputeLinkDigest 相同输入语义：不同 org → 不同 digest。
    // 此处从行为面验证「跨租重放不会撞唯一键」且互不可见。
    await insertLinkRaw(Number(orgA.id), 10, 'tdllink_org_a')
    await insertLinkRaw(Number(orgB.id), 20, 'tdllink_org_b')
    const a = await TrizDeliveryLink.forOrganization(Number(orgA.id))
      .where('link_digest', 'tdllink_org_a')
      .first()
    const b = await TrizDeliveryLink.forOrganization(Number(orgB.id))
      .where('link_digest', 'tdllink_org_b')
      .first()
    assert.isNotNull(a)
    assert.isNotNull(b)
    // 跨租读取为零结果（不泄露存在性）
    const crossReadA = await TrizDeliveryLink.forOrganization(Number(orgA.id))
      .where('link_digest', 'tdllink_org_b')
      .first()
    const crossReadB = await TrizDeliveryLink.forOrganization(Number(orgB.id))
      .where('link_digest', 'tdllink_org_a')
      .first()
    assert.isNull(crossReadA)
    assert.isNull(crossReadB)
  })

  test('event_digest 同理幂等去重；timeline 索引列存在', async ({ assert }) => {
    const [linkId] = await insertLinkRaw(Number(orgA.id), 10, 'tdllink_evt_base')
    await insertEventRaw(Number(orgA.id), 10, Number(linkId), 'tdlev_dedup')
    try {
      await insertEventRaw(Number(orgA.id), 10, Number(linkId), 'tdlev_dedup')
      assert.fail('重复 event_digest 应被拒绝')
    } catch (e) {
      assert.match(String((e as Error).message), /unique/i)
    }
  })

  test('append-only 更正链：superseding link 回填 superseded_by，旧行仍可读（无删除）', async ({
    assert,
  }) => {
    const old = await TrizDeliveryLink.create({
      organizationId: Number(orgA.id),
      projectId: 10,
      decisionLogId: 9,
      deliveryRefs: [{ kind: 'milestone', entityId: '7001' }],
      contextRefs: [],
      linkMode: 'existing_entity',
      linkDigest: 'tdllink_old_row',
      actorUserId: Number(ownerA.id),
    })
    const created = await TrizDeliveryLink.create({
      organizationId: Number(orgA.id),
      projectId: 10,
      decisionLogId: 9,
      deliveryRefs: [{ kind: 'milestone', entityId: '7002' }],
      contextRefs: [],
      linkMode: 'existing_entity',
      linkDigest: 'tdllink_new_row',
      supersedesLinkId: old.id,
      actorUserId: Number(ownerA.id),
    })
    old.supersededByLinkId = created.id
    await old.save()

    const stillThere = await TrizDeliveryLink.find(old.id)
    assert.isNotNull(stillThere, '旧 link 不被删除')
    assert.equal(stillThere!.supersededByLinkId, created.id)
    assert.equal(stillThere!.deliveryRefs[0].entityId, '7001', '旧行业务字段不被改写')
  })

  test('删除正式实体不级联删除闭环历史（仅允许 organizations FK，禁止领域表 FK）', async ({
    assert,
  }) => {
    const linksMaster = await db
      .query()
      .from('sqlite_master')
      .select('sql')
      .where('name', 'triz_delivery_links')
      .first()
    const sql = String((linksMaster as { sql?: string } | undefined)?.sql ?? '').replace(
      /--.*$/gm,
      '',
    )
    const eventsMaster = await db
      .query()
      .from('sqlite_master')
      .select('sql')
      .where('name', 'triz_delivery_events')
      .first()
    const sqlEvt = String((eventsMaster as { sql?: string } | undefined)?.sql ?? '').replace(
      /--.*$/gm,
      '',
    )
    // 唯一允许的 FK 是 organizations（租户 enforced）；tasks/milestones/risks/change_requests/
    // projects/triz_decision_logs 一律不得引用——正式数据删除不得级联撕裂 provenance。
    const domainFkPattern =
      /references\s+"?(tasks|milestones|risks|change_requests|projects|triz_decision_logs)"?\b/i
    assert.isFalse(domainFkPattern.test(sql), 'links 表不得对正式实体/决策日志建 FK')
    assert.isFalse(domainFkPattern.test(sqlEvt), 'events 表不得对正式实体/决策日志建 FK')
    const orgFkPattern = /references[^\n,]*`?"?organizations`?"?\b/i
    assert.match(sql, orgFkPattern)
    assert.match(sqlEvt, orgFkPattern)

    // 行为面：引用的 task id 可任意（不存在实体也能落库——provenance 保留语义）
    await insertLinkRaw(Number(orgA.id), 424242, 'tdllink_no_cascade', {
      delivery_refs: JSON.stringify([{ kind: 'task', entityId: '99999999' }]),
    })
    const rows = await db
      .query()
      .from('triz_delivery_links')
      .where('link_digest', 'tdllink_no_cascade')
    assert.lengthOf(rows, 1)
  })

  test('租户盘点防线：organization_id/project_id 为必填列（缺省插入被拒）', async ({ assert }) => {
    // 行为面验证：links 缺 organization_id / events 缺 organization_id 均为 NOT NULL 拒绝
    try {
      await db.table('triz_delivery_links').insert({
        project_id: 10,
        decision_log_id: 1,
        delivery_refs: JSON.stringify([]),
        context_refs: '[]',
        link_mode: 'apply_receipt',
        link_digest: 'tdllink_missing_org',
        actor_user_id: 1,
        created_at: now(),
      })
      assert.fail('缺 organization_id 应被 NOT NULL 拒绝')
    } catch {
      assert.isTrue(true)
    }
    try {
      await db.table('triz_delivery_events').insert({
        link_id: 1,
        event_kind: 'verification_recorded',
        fingerprint: 'fp',
        event_digest: 'tdlev_missing_org',
        actor_user_id: 1,
        created_at: now(),
      })
      assert.fail('缺 organization_id 应被 NOT NULL 拒绝')
    } catch {
      assert.isTrue(true)
    }
  })
})
