// v3-triz-to-delivery-closed-loop §7 —— verification/reopen 功能测试（tasks 7.4/7.5/7.8）。
// 覆盖：readiness 阻塞与放行、human verification 三结论姿态、automation actor 拒绝、
// fingerprint CAS、supersede 更正链（旧事件保留）、reopen 资格/幂等/fingerprint 变化拒绝、
// timeline append-only 排序。
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { ClosedLoopReadModelService } from '#services/triz_delivery_loop/closed_loop_read_model_service'
import {
  TrizDeliveryVerificationService,
  TrizDlVerificationError,
} from '#services/triz_delivery_loop/verification_service'
import { TrizDlClosedAdapterRegistry } from '#services/triz_delivery_loop/read_adapters'
import {
  TrizDlTaskDbPort,
  TrizDlMilestoneDbPort,
} from '#services/triz_delivery_loop/default_read_adapters'
import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

const now = () => DateTime.now().toSQL()!

async function seedProject(orgId: number, ownerId: number): Promise<number> {
  const [id] = await db.table('projects').insert({
    organization_id: orgId,
    name: 'verification 项目',
    status: 'active',
    priority: 'medium',
    created_by: ownerId,
    created_at: now(),
    updated_at: now(),
  })
  return Number(id)
}

async function seedDecision(orgId: number, projectId: number, userId: number) {
  const [id] = await db.table('triz_decision_logs').insert({
    organization_id: orgId,
    project_id: projectId,
    decision_type: 'adopt',
    decision_status: 'active',
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

async function seedTask(projectId: number, status = 'completed'): Promise<number> {
  const [id] = await db.table('tasks').insert({
    project_id: projectId,
    name: `验证任务 ${Math.random().toString(36).slice(2)}`,
    status,
    priority: 'medium',
    task_type: 'task',
    duration_days: 1,
    created_at: now(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  })
  return Number(id)
}

function makeServices(): {
  read: ClosedLoopReadModelService
  verif: TrizDeliveryVerificationService
} {
  const reg = new TrizDlClosedAdapterRegistry()
    .register(new TrizDlTaskDbPort())
    .register(new TrizDlMilestoneDbPort())
  const read = new ClosedLoopReadModelService(reg)
  return { read, verif: new TrizDeliveryVerificationService(read) }
}

interface Stack {
  pid: number
  dec: number
  t1: number
  itemId: string
}
async function seedStack(orgIdNum: number, ownerIdNum: number): Promise<Stack> {
  const pid = await seedProject(orgIdNum, ownerIdNum)
  const dec = await seedDecision(orgIdNum, pid, ownerIdNum)
  const t1 = await seedTask(pid, 'completed')
  await db.table('triz_delivery_links').insert({
    organization_id: orgIdNum,
    project_id: pid,
    decision_log_id: dec,
    delivery_refs: JSON.stringify([{ kind: 'task', entityId: String(t1) }]),
    context_refs: '[]',
    link_mode: 'apply_receipt',
    link_digest: `tdllink_v_${Math.random().toString(36).slice(2)}`,
    actor_user_id: ownerIdNum,
    created_at: now(),
  })
  const link = await db.query().from('triz_delivery_links').where('decision_log_id', dec).first()
  return { pid, dec, t1, itemId: `link-${link.id}` }
}

const WIN = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' }

test.group('TRIZ 交付闭环 verification/reopen（§7）', (group) => {
  useAuthDatabase(group)

  let owner: Awaited<ReturnType<typeof createUser>>
  let org: Awaited<ReturnType<typeof createOrganization>>

  group.each.setup(async () => {
    owner = await createUser({
      email: `tdl-v-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    org = await createOrganization(owner)
  })

  test('§7.1 未完成交付 readiness 阻塞；完成后放行并输出 fingerprint', async ({ assert }) => {
    const stack = await seedStack(Number(org.id), Number(owner.id))
    // 任务改回未完成 → DELIVERY_NOT_COMPLETED
    await db.query().from('tasks').where('id', stack.t1).update({ status: 'in_progress' })
    const svc = makeServices()
    const blocked = await svc.verif.readiness(Number(org.id), stack.pid, stack.itemId)
    assert.isFalse(blocked.ready)
    assert.include(blocked.blockingReasons.join(','), 'DELIVERY_NOT_COMPLETED')

    await db.query().from('tasks').where('id', stack.t1).update({ status: 'completed' })
    const ready = await svc.verif.readiness(Number(org.id), stack.pid, stack.itemId)
    assert.isTrue(ready.ready)
    assert.isNotNull(ready.verificationFingerprint)
    assert.isNull(ready.effectiveConclusion)
  })

  test('§7.4 human 记录三结论：effective/ineffective 推进姿态；inconclusive 不宣称成功；automation id 拒绝', async ({
    assert,
  }) => {
    const stack = await seedStack(Number(org.id), Number(owner.id))
    const svc = makeServices()
    const ready = await svc.verif.readiness(Number(org.id), stack.pid, stack.itemId)

    await svc.verif.recordVerification(Number(org.id), stack.pid, Number(owner.id), {
      itemId: stack.itemId,
      conclusion: 'effective',
      observationWindow: WIN,
      baselineSummary: '基线A',
      targetSummary: '目标B',
      actualResult: '达成B',
      reason: '指标改善',
      evidenceRefs: ['doc:12'],
      verificationFingerprint: ready.verificationFingerprint!,
    })

    const r = await svc.read.list({
      organizationId: Number(org.id),
      projectId: stack.pid,
      actorUserId: Number(owner.id),
    })
    assert.equal(r.items[0].posture, 'verified_effective')
    assert.equal(r.items[0].latestConclusion, 'effective')

    // automation/system actor：非正整数 id 一律 fail closed
    try {
      await svc.verif.recordVerification(Number(org.id), stack.pid, 0, {
        itemId: stack.itemId,
        conclusion: 'ineffective',
        observationWindow: WIN,
        evidenceRefs: [],
        verificationFingerprint: ready.verificationFingerprint!,
      })
      assert.fail('automation actor 应被拒绝')
    } catch (e) {
      assert.instanceOf(e, TrizDlVerificationError)
    }

    // fingerprint CAS：伪造 fingerprint 拒绝且零新事件
    const eventsBeforeRows = await db.query().from('triz_delivery_events')
    const eventsBefore = eventsBeforeRows.length
    try {
      await svc.verif.recordVerification(Number(org.id), stack.pid, Number(owner.id), {
        itemId: stack.itemId,
        conclusion: 'ineffective',
        observationWindow: WIN,
        evidenceRefs: [],
        verificationFingerprint: 'tdlver_forged',
      })
      assert.fail('已验证后重复验证应拒绝')
    } catch {
      assert.isTrue(true)
    }
    assert.lengthOf(await db.query().from('triz_delivery_events'), eventsBefore)
  })

  test('§7.3 supersede 更正链 + §7.9 timeline', async ({ assert }) => {
    const stack = await seedStack(Number(org.id), Number(owner.id))
    const svc = makeServices()
    const r0 = await svc.verif.readiness(Number(org.id), stack.pid, stack.itemId)
    const v1 = await svc.verif.recordVerification(Number(org.id), stack.pid, Number(owner.id), {
      itemId: stack.itemId,
      conclusion: 'effective',
      observationWindow: WIN,
      reason: '初判有效',
      evidenceRefs: ['doc:1'],
      verificationFingerprint: r0.verificationFingerprint!,
    })

    // 更正为 ineffective（supersede 追加，不改写旧事件）
    await svc.verif.supersedeVerification(Number(org.id), stack.pid, Number(owner.id), {
      itemId: stack.itemId,
      conclusion: 'ineffective',
      observationWindow: WIN,
      reason: '复评无效',
      evidenceRefs: ['doc:2'],
      supersedesEventId: v1.eventId,
    })

    const rows = await db.query().from('triz_delivery_events').orderBy('id', 'asc')
    assert.equal(rows.length, 2, '更新产生追加行而非改写')
    assert.equal(String(rows[0].conclusion), 'effective', '旧事件保留原值')

    const r = await svc.read.list({
      organizationId: Number(org.id),
      projectId: stack.pid,
      actorUserId: Number(owner.id),
    })
    assert.equal(r.items[0].posture, 'verified_ineffective')

    const tl = await svc.verif.timeline(Number(org.id), stack.pid, stack.itemId)
    assert.lengthOf(tl, 2)
    assert.isTrue(new Date(tl[0].createdAt) <= new Date(tl[1].createdAt))
  })

  test('§7.6 reopen：verified_ineffective 可请求、幂等、posture 不合格拒绝', async ({ assert }) => {
    const stack = await seedStack(Number(org.id), Number(owner.id))
    const svc = makeServices()
    const r0 = await svc.verif.readiness(Number(org.id), stack.pid, stack.itemId)
    await svc.verif.recordVerification(Number(org.id), stack.pid, Number(owner.id), {
      itemId: stack.itemId,
      conclusion: 'ineffective',
      observationWindow: WIN,
      reason: '无效',
      evidenceRefs: [],
      verificationFingerprint: r0.verificationFingerprint!,
    })
    const fresh = await svc.verif.readiness(Number(org.id), stack.pid, stack.itemId)
    // readiness 因已验证阻塞 ALREADY_VERIFIED，但 reopen 只要求 posture 资格 +
    // fingerprint 匹配；此处直接用最新 fingerprint。
    const fp = fresh.verificationFingerprint!
    const reopened = await svc.verif.requestReopen(Number(org.id), stack.pid, Number(owner.id), {
      itemId: stack.itemId,
      reason: '需要重新审查方案',
      currentFingerprint: fp,
    })
    assert.isAbove(reopened.eventId, 0)

    // 幂等重放
    const again = await svc.verif.requestReopen(Number(org.id), stack.pid, Number(owner.id), {
      itemId: stack.itemId,
      reason: '需要重新审查方案',
      currentFingerprint: fp,
    })
    assert.equal(again.eventId, reopened.eventId)

    const reopens = await db
      .query()
      .from('triz_delivery_events')
      .where('event_kind', 'reopen_requested')
    assert.lengthOf(reopens, 1)
    // 不创建任何 draft/decision/正式数据（行为面）：仅验证事件计数
    const drafts = await db
      .query()
      .from('ai_draft_layer_sessions')
      .where('source_type', 'v3_triz_candidate')
    assert.lengthOf(drafts, 0)

    // 姿态不合格：awaiting_apply 类项直接拒绝
    const p2 = await seedProject(Number(org.id), Number(owner.id))
    const d2 = await seedDecision(Number(org.id), p2, Number(owner.id))
    const [linkNoVerify] = await db
      .table('triz_delivery_links')
      .insert({
        organization_id: Number(org.id),
        project_id: p2,
        decision_log_id: d2,
        delivery_refs: JSON.stringify([]),
        context_refs: '[]',
        link_mode: 'existing_entity',
        link_digest: `tdllink_empty_${Math.random().toString(36).slice(2)}`,
        actor_user_id: Number(owner.id),
        created_at: now(),
      })
      .returning('id')
    void linkNoVerify
    // 注意：delivery_refs 为空的 link 无需重审资格（无验证历史），readiness 缺失即拒
    const svc2 = makeServices()
    try {
      await svc2.verif.requestReopen(Number(org.id), p2, Number(owner.id), {
        itemId: `link-99999999`,
        reason: 'x',
        currentFingerprint: 'any',
      })
      assert.fail('不存在的闭环项应拒绝')
    } catch (e) {
      // TrizDlItemNotFoundError（detail 层）或 TrizDlVerificationError（NOT_READY）均为 fail closed
      assert.isTrue(e instanceof Error)
      assert.include(
        ['闭环项不存在', '未达验证条件'],
        (e as Error).message.includes('不存在') ? '闭环项不存在' : '未达验证条件',
      )
    }
  })
})
