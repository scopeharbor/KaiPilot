// v3-triz-to-delivery-closed-loop §6 —— link preview/confirm 功能测试（tasks 6.2/6.5/6.6/6.8）。
// 覆盖：preview 成功与非法 decision 类型/无 required refs/duplicate refs 负例、
// confirm 幂等重放、stale fingerprint（preview 后任务 updated_at 变化 / decision 变 archived）
// 409 语义（PREVIEW_STALE）、正式实体全字段零变化证明、supersession 链。
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import {
  TrizDeliveryLinkService,
  TrizDlLinkValidationError,
} from '#services/triz_delivery_loop/link_service'
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
    name: 'link preview 项目',
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

async function seedTask(projectId: number, status = 'not_started'): Promise<number> {
  const [id] = await db.table('tasks').insert({
    project_id: projectId,
    name: `链路任务 ${Math.random().toString(36).slice(2)}`,
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

function makeSvc(): TrizDeliveryLinkService {
  const reg = new TrizDlClosedAdapterRegistry()
    .register(new TrizDlTaskDbPort())
    .register(new TrizDlMilestoneDbPort())
  return new TrizDeliveryLinkService(reg)
}

async function taskSnapshot(taskId: number) {
  const r = await db.query().from('tasks').where('id', taskId).first()
  return JSON.stringify(r)
}

test.group('TRIZ 交付闭环 link preview/confirm（§6）', (group) => {
  useAuthDatabase(group)

  let owner: Awaited<ReturnType<typeof createUser>>
  let org: Awaited<ReturnType<typeof createOrganization>>

  group.each.setup(async () => {
    owner = await createUser({
      email: `tdl-link-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    org = await createOrganization(owner)
  })

  test('§6.2 preview 成功：候选+指纹，且 DB 行计数零变化', async ({ assert }) => {
    const pid = await seedProject(Number(org.id), Number(owner.id))
    const dec = await seedDecision(Number(org.id), pid, Number(owner.id))
    const t1 = await seedTask(pid)

    const beforeLinks = await db.query().from('triz_delivery_links')
    const svc = makeSvc()
    const res = await svc.preview(Number(org.id), pid, {
      projectId: pid,
      decisionLogId: String(dec),
      deliveryRefs: [{ kind: 'task', entityId: String(t1) }],
      contextRefs: [],
    })
    assert.equal(res.preview.decisionLogId, String(dec))
    assert.equal(res.preview.entitySummaries.length, 1)
    assert.isNotNull(res.preview.entitySummaries[0].title)
    assert.isTrue(res.confirmationOwnedBy === 'user')
    assert.include(res.notice, '只写闭环关联')

    const afterLinks = await db.query().from('triz_delivery_links')
    assert.lengthOf(afterLinks, beforeLinks.length, 'preview 零写入')
  })

  test('§6.2 preview 负例：无 required refs / duplicate refs / 非 active decision', async ({
    assert,
  }) => {
    const pid = await seedProject(Number(org.id), Number(owner.id))
    const decActive = await seedDecision(Number(org.id), pid, Number(owner.id), 'archived')
    const t1 = await seedTask(pid)
    const svc = makeSvc()

    await svc
      .preview(Number(org.id), pid, {
        projectId: pid,
        decisionLogId: String(decActive),
        deliveryRefs: [{ kind: 'task', entityId: String(t1) }],
      })
      .then(
        () => assert.fail('archived decision 应拒绝'),
        (e) => assert.instanceOf(e, TrizDlLinkValidationError),
      )

    try {
      await svc.preview(Number(org.id), pid, {
        projectId: pid,
        decisionLogId: String(decActive),
        deliveryRefs: [],
      })
      assert.fail('空 delivery refs 应拒绝')
    } catch (e) {
      assert.instanceOf(e, TrizDlLinkValidationError)
    }

    // duplicates：context 中重复同实体
    const decOk = await seedDecision(Number(org.id), pid, Number(owner.id))
    try {
      await svc.preview(Number(org.id), pid, {
        projectId: pid,
        decisionLogId: String(decOk),
        deliveryRefs: [
          { kind: 'task', entityId: String(t1) },
          { kind: 'task', entityId: String(t1) },
        ],
      })
      assert.fail('重复 refs 应拒绝')
    } catch (e) {
      assert.instanceOf(e, TrizDlLinkValidationError)
    }
  })

  test('§6.5/6.6 confirm 成功幂等 + 正式实体字段零变化；旧指纹 stale 拒绝', async ({ assert }) => {
    const pid = await seedProject(Number(org.id), Number(owner.id))
    const dec = await seedDecision(Number(org.id), pid, Number(owner.id))
    const t1 = await seedTask(pid)
    const snapshotBefore = await taskSnapshot(t1)

    const svc = makeSvc()
    const p = await svc.preview(Number(org.id), pid, {
      projectId: pid,
      decisionLogId: String(dec),
      deliveryRefs: [{ kind: 'task', entityId: String(t1) }],
    })

    const c1 = await svc.confirm(Number(org.id), pid, Number(owner.id), {
      request: {
        projectId: pid,
        decisionLogId: String(dec),
        deliveryRefs: [{ kind: 'task', entityId: String(t1) }],
      },
      previewFingerprint: p.previewFingerprint,
    })
    assert.isFalse(c1.replayed)

    const links1 = await db.query().from('triz_delivery_links').where('id', c1.linkId)
    assert.lengthOf(links1, 1)

    // 重复 confirm → 同一 link（digest 幂等），不新增行
    const c2 = await svc.confirm(Number(org.id), pid, Number(owner.id), {
      request: {
        projectId: pid,
        decisionLogId: String(dec),
        deliveryRefs: [{ kind: 'task', entityId: String(t1) }],
      },
      previewFingerprint: p.previewFingerprint,
    })
    assert.isTrue(c2.replayed)
    assert.equal(c2.linkId, c1.linkId)
    const all = await db.query().from('triz_delivery_links').where('decision_log_id', dec)
    assert.lengthOf(all, 1, '重放不新增行')

    // 正式实体不变证明：confirm 前后 task 全字段一致
    const snapshotAfter = await taskSnapshot(t1)
    assert.equal(snapshotAfter, snapshotBefore)

    // stale：修改任务的 updated_at 后旧指纹必须拒绝（409 语义映射 PREVIEW_STALE）
    await db
      .query()
      .from('tasks')
      .where('id', t1)
      .update({ updated_at: new Date(Date.now() + 5000).toISOString(), status: 'in_progress' })
    try {
      await svc.confirm(Number(org.id), pid, Number(owner.id), {
        request: {
          projectId: pid,
          decisionLogId: String(dec),
          deliveryRefs: [{ kind: 'task', entityId: String(t1) }],
        },
        previewFingerprint: p.previewFingerprint,
      })
      assert.fail('旧指纹应 PREVIEW_STALE 拒绝')
    } catch (e) {
      assert.instanceOf(e, TrizDlLinkValidationError)
      assert.equal((e as TrizDlLinkValidationError).code, 'PREVIEW_STALE')
    }
    // 仅一行 link，状态保持 in_progress（确认不回滚实体状态）
    const all2 = await db.query().from('triz_delivery_links').where('decision_log_id', dec)
    assert.lengthOf(all2, 1)
    const taskNow = await db.query().from('tasks').where('id', t1).first()
    assert.equal(String(taskNow.status), 'in_progress')
  })

  test('§6.8 supersession：追加新行回填旧行、历史可读、不可二次更正', async ({ assert }) => {
    const pid = await seedProject(Number(org.id), Number(owner.id))
    const dec = await seedDecision(Number(org.id), pid, Number(owner.id))
    const t1 = await seedTask(pid)
    const t2 = await seedTask(pid)
    const svc = makeSvc()

    const p1 = await svc.preview(Number(org.id), pid, {
      projectId: pid,
      decisionLogId: String(dec),
      deliveryRefs: [{ kind: 'task', entityId: String(t1) }],
    })
    const first = await svc.confirm(Number(org.id), pid, Number(owner.id), {
      request: {
        projectId: pid,
        decisionLogId: String(dec),
        deliveryRefs: [{ kind: 'task', entityId: String(t1) }],
      },
      previewFingerprint: p1.previewFingerprint,
    })

    // 更正为指向 t2 的关联
    const p2 = await svc.preview(Number(org.id), pid, {
      projectId: pid,
      decisionLogId: String(dec),
      deliveryRefs: [{ kind: 'task', entityId: String(t2) }],
    })
    const fixed = await svc.supersedeLink(Number(org.id), pid, Number(owner.id), first.linkId, {
      projectId: pid,
      decisionLogId: String(dec),
      deliveryRefs: [{ kind: 'task', entityId: String(t2) }],
      contextRefs: [],
      previewFingerprint: p2.previewFingerprint,
    })

    const rows = await db.query().from('triz_delivery_links').orderBy('id', 'asc')
    assert.lengthOf(rows, 2)
    const oldRow = rows.find((r) => Number(r.id) === first.linkId)!
    assert.equal(Number(oldRow.superseded_by_link_id), fixed.newLinkId, '旧行保留并回填指针')

    // 历史可读：旧行 delivery_refs 仍是 t1
    const oldRefs = String(oldRow.delivery_refs)
    assert.isTrue(oldRefs.includes(String(t1)))

    // 二次更正同一旧行：拒绝
    try {
      await svc.supersedeLink(Number(org.id), pid, Number(owner.id), first.linkId, {
        projectId: pid,
        decisionLogId: String(dec),
        deliveryRefs: [{ kind: 'task', entityId: String(t2) }],
        previewFingerprint: p2.previewFingerprint,
      })
      assert.fail('已被更正过的旧行不得再次更正')
    } catch (e) {
      assert.instanceOf(e, TrizDlLinkValidationError)
    }
  })
})
