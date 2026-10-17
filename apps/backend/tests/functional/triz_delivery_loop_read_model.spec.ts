// v3-triz-to-delivery-closed-loop §5 —— read model 功能测试（tasks 5.9–5.12）。
// 覆盖：posture 投影与权威事实一致（awaiting_verification/blocked/superseded/source_stale）、
// revision 漂移 fail closed、软删除不可见化（warning 且零标题/refs 泄露）、
// 无 N+1（task port 整页恰一次调用）、perPage ≤100 边界、跨组织 detail 非泄露。
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  ClosedLoopReadModelService,
  TrizDlItemNotFoundError,
} from '#services/triz_delivery_loop/closed_loop_read_model_service'
import { TrizDlClosedAdapterRegistry } from '#services/triz_delivery_loop/read_adapters'
import type { TrizDlClosedDeliveryPort } from '#services/triz_delivery_loop/read_adapters'
import {
  TrizDlTaskDbPort,
  TrizDlMilestoneDbPort,
} from '#services/triz_delivery_loop/default_read_adapters'
import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

const now = () => DateTime.now().toSQL()!

async function seedProject(orgId: number, ownerId: number): Promise<number> {
  const [id] = await db.table('projects').insert({
    organization_id: orgId,
    name: '闭环 read model 项目',
    description: null,
    status: 'active',
    priority: 'medium',
    created_by: ownerId,
    created_at: now(),
    updated_at: now(),
  })
  return Number(id)
}

async function seedDecision(orgId: number, projectId: number, userId: number, status = 'active') {
  const [id] = await db.table('triz_decision_logs').insert({
    organization_id: orgId,
    project_id: projectId,
    decision_type: 'adopt',
    decision_status: status,
    subject_refs: JSON.stringify([]),
    source_refs: JSON.stringify([]),
    artifact_hashes: JSON.stringify([]),
    reason_summary: 'r',
    reason_hash: 'rh',
    alternative_summary: null,
    supersedes_decision_log_id: null,
    created_by: userId,
    created_at: now(),
  })
  return Number(id)
}

async function seedTask(
  projectId: number,
  status: string,
  opts: { deleted?: boolean; updatedAt?: string } = {},
): Promise<number> {
  const [id] = await db.table('tasks').insert({
    project_id: projectId,
    name: `任务 ${Math.random().toString(36).slice(2)}`,
    status,
    priority: 'medium',
    task_type: 'task',
    duration_days: 1,
    created_at: now(),
    updated_at: opts.updatedAt ?? new Date().toISOString(),
    deleted_at: opts.deleted ? now() : null,
  })
  return Number(id)
}

async function insertLinkRow(
  orgId: number,
  projectId: number,
  decisionLogId: number,
  deliveryRefs: Array<{ kind: string; entityId: string; revisionHint?: string }>,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const [id] = await db.table('triz_delivery_links').insert({
    organization_id: orgId,
    project_id: projectId,
    decision_log_id: decisionLogId,
    delivery_refs: JSON.stringify(deliveryRefs),
    context_refs: '[]',
    link_mode: 'apply_receipt',
    link_digest: `tdllink_rm_${Math.random().toString(36).slice(2)}`,
    actor_user_id: 1,
    created_at: now(),
    ...extra,
  })
  return Number(id)
}

/** spy 包装：计数每个 kind 的 fetchSummaries 调用次数。 */
function makeSpyRegistry(counter: Map<string, number>): {
  registry: TrizDlClosedAdapterRegistry
} {
  const wrap = (port: TrizDlClosedDeliveryPort): TrizDlClosedDeliveryPort => ({
    kind: port.kind,
    fetchSummaries: async (ids, ctx) => {
      counter.set(port.kind, (counter.get(port.kind) ?? 0) + 1)
      return port.fetchSummaries(ids, ctx)
    },
  })
  const registry = new TrizDlClosedAdapterRegistry()
    .register(wrap(new TrizDlTaskDbPort()))
    .register(wrap(new TrizDlMilestoneDbPort()))
  return { registry }
}

test.group('TRIZ 交付闭环 read model（§5.9-5.12）', (group) => {
  useAuthDatabase(group)

  let owner: Awaited<ReturnType<typeof createUser>>
  let org: Awaited<ReturnType<typeof createOrganization>>

  group.each.setup(async () => {
    owner = await createUser({
      email: `tdl-rm-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    org = await createOrganization(owner)
  })

  test('完成交付 → awaiting_verification；blocked → blocked；同事实恒等投影', async ({
    assert,
  }) => {
    const pid = await seedProject(Number(org.id), Number(owner.id))
    const dec = await seedDecision(Number(org.id), pid, Number(owner.id))
    const t1 = await seedTask(pid, 'completed')
    await insertLinkRow(Number(org.id), pid, dec, [{ kind: 'task', entityId: String(t1) }])

    const svc = new ClosedLoopReadModelService(makeSpyRegistry(new Map()).registry)
    // 探针（调试）：直接调用 port 检查批量查询是否命中
    const probe = await new TrizDlTaskDbPort().fetchSummaries([String(t1)], {
      organizationId: Number(org.id),
      projectId: pid,
    })
    console.log('PROBE_PORT_RESULT', JSON.stringify([...probe.entries()]))
    const r1 = await svc.list({
      organizationId: Number(org.id),
      projectId: pid,
      actorUserId: Number(owner.id),
    })
    assert.lengthOf(r1.items, 1)
    assert.equal(r1.items[0].posture, 'awaiting_verification')

    const r2 = await svc.list({
      organizationId: Number(org.id),
      projectId: pid,
      actorUserId: Number(owner.id),
    })
    assert.equal(r2.items[0].posture, r1.items[0].posture)

    const tBlocked = await seedTask(pid, 'blocked')
    await insertLinkRow(Number(org.id), pid, dec, [{ kind: 'task', entityId: String(tBlocked) }])
    const r3 = await svc.list({
      organizationId: Number(org.id),
      projectId: pid,
      actorUserId: Number(owner.id),
    })
    assert.isNotNull(r3.items.find((i) => i.posture === 'blocked'))
  })

  test('superseded link → superseded；decision 非 active → source_stale', async ({ assert }) => {
    const pid = await seedProject(Number(org.id), Number(owner.id))
    const t1 = await seedTask(pid, 'in_progress')
    const decActive = await seedDecision(Number(org.id), pid, Number(owner.id))
    const linkA = await insertLinkRow(Number(org.id), pid, decActive, [
      { kind: 'task', entityId: String(t1) },
    ])
    const decArchived = await seedDecision(Number(org.id), pid, Number(owner.id), 'archived')
    const linkB = await insertLinkRow(Number(org.id), pid, decArchived, [
      { kind: 'task', entityId: String(t1) },
    ])
    await db
      .query()
      .from('triz_delivery_links')
      .where('id', linkA)
      .update({ superseded_by_link_id: linkB })

    const svc = new ClosedLoopReadModelService(makeSpyRegistry(new Map()).registry)
    const r = await svc.list({
      organizationId: Number(org.id),
      projectId: pid,
      actorUserId: Number(owner.id),
    })
    const postures = new Map(r.items.map((i) => [i.itemId, i.posture]))
    assert.equal(postures.get(`link-${linkA}`), 'superseded')
    assert.equal(postures.get(`link-${linkB}`), 'source_stale')
  })

  test('revision 漂移 → source_stale；软删除 ref → blocked + TRIZ_DL_HIDDEN_ENTITY 且 refs 清空', async ({
    assert,
  }) => {
    const pid = await seedProject(Number(org.id), Number(owner.id))
    const dec = await seedDecision(Number(org.id), pid, Number(owner.id))
    const svc = new ClosedLoopReadModelService(makeSpyRegistry(new Map()).registry)

    // drift：revisionHint 为旧值
    const tFresh = await seedTask(pid, 'completed')
    const row = await db.query().from('tasks').where('id', tFresh).first()
    const staleHint = new Date(new Date(String(row.updated_at)).getTime() - 60_000).toISOString()
    await insertLinkRow(Number(org.id), pid, dec, [
      { kind: 'task', entityId: String(tFresh), revisionHint: staleHint },
    ])

    // soft-deleted
    const tDeleted = await seedTask(pid, 'completed', { deleted: true })
    await insertLinkRow(Number(org.id), pid, dec, [{ kind: 'task', entityId: String(tDeleted) }])

    const r = await svc.list({
      organizationId: Number(org.id),
      projectId: pid,
      actorUserId: Number(owner.id),
    })
    const stale = r.items.find((i) => i.posture === 'source_stale')
    assert.isNotNull(stale, 'revision 漂移应投为 source_stale')

    const blocked = r.items.find((i) => i.posture === 'blocked')
    assert.isNotNull(blocked, '软删除 required ref → blocked')
    assert.include(blocked!.warningCodes.join(','), 'TRIZ_DL_HIDDEN_ENTITY')
    assert.lengthOf(blocked!.deliveryRefs, 0)
  })

  test('无 N+1：8 links 各 1 task ref，task port 整页仅调用一次；未涉 kind 零调用', async ({
    assert,
  }) => {
    const pid = await seedProject(Number(org.id), Number(owner.id))
    const dec = await seedDecision(Number(org.id), pid, Number(owner.id))
    for (let i = 0; i < 8; i += 1) {
      const t = await seedTask(pid, 'in_progress')
      await insertLinkRow(Number(org.id), pid, dec, [{ kind: 'task', entityId: String(t) }])
    }
    const counter = new Map<string, number>()
    const svc = new ClosedLoopReadModelService(makeSpyRegistry(counter).registry)
    const r = await svc.list({
      organizationId: Number(org.id),
      projectId: pid,
      actorUserId: Number(owner.id),
    })
    assert.lengthOf(r.items, 8)
    assert.equal(counter.get('task'), 1)
    assert.isUndefined(counter.get('milestone'))
  })

  test('perPage ≤100；跨组织 detail 抛 TrizDlItemNotFoundError（非泄露）；本组织 detail 正常', async ({
    assert,
  }) => {
    const pid = await seedProject(Number(org.id), Number(owner.id))
    const dec = await seedDecision(Number(org.id), pid, Number(owner.id))
    const t = await seedTask(pid, 'not_started')
    const linkId = await insertLinkRow(Number(org.id), pid, dec, [
      { kind: 'task', entityId: String(t) },
    ])

    const svc = new ClosedLoopReadModelService(makeSpyRegistry(new Map()).registry)
    const over = await svc.list({
      organizationId: Number(org.id),
      projectId: pid,
      actorUserId: Number(owner.id),
      perPage: 500,
    })
    assert.isAtMost(over.meta.perPage, 100)

    const otherOwner = await createUser({
      email: `tdl-other-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    const otherOrg = await createOrganization(otherOwner)
    try {
      await svc.detail(`link-${linkId}`, { organizationId: Number(otherOrg.id), projectId: pid })
      assert.fail('跨组织 detail 应不存在')
    } catch (e) {
      assert.instanceOf(e, TrizDlItemNotFoundError)
    }

    const own = await svc.detail(`link-${linkId}`, {
      organizationId: Number(org.id),
      projectId: pid,
    })
    assert.equal(own.itemId, `link-${linkId}`)
    assert.lengthOf(own.entitySummaries, 1)
    assert.equal(own.entitySummaries[0].posture, 'not_started')
  })
})
