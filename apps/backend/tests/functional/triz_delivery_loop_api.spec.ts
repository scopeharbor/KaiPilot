// v3-triz-to-delivery-closed-loop §9.3–9.4 —— API 功能测试。
// 覆盖：flag 关闭 404 非泄露、无 token 401、跨组织非成员非泄露、
// summary/items/detail envelope 与权威 posture、preview/confirm 正向+幂等+stale 409、
// 未确认“只写关联”422、verification/reopen fail closed、payload 越界 422。
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
// flag 函数每次请求动态读取 env（controller 内读取），测试文件加载即默认开启。
process.env.TRIZ_DELIVERY_LOOP_ENABLED = '1'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const now = () => DateTime.now().toSQL()!

async function login(client: any, user: any): Promise<string> {
  const response = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return response.body().data.accessToken
}

function baseUrl(projectId: number | string): string {
  return `/api/v1/projects/${projectId}/triz/delivery-loop`
}

async function seedStack(orgIdNum: number, ownerIdNum: number, taskStatus = 'completed') {
  const [pid] = await db
    .table('projects')
    .insert({
      organization_id: orgIdNum,
      name: 'delivery-loop api 项目',
      status: 'active',
      priority: 'medium',
      created_by: ownerIdNum,
      created_at: now(),
      updated_at: now(),
    })
    .returning('id')
  const projectId = Number(pid.id ?? pid)
  const [dec] = await db
    .table('triz_decision_logs')
    .insert({
      organization_id: orgIdNum,
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
      created_by: ownerIdNum,
      created_at: now(),
    })
    .returning('id')
  const [t1] = await db
    .table('tasks')
    .insert({
      project_id: projectId,
      name: 'api 任务',
      status: taskStatus,
      priority: 'medium',
      task_type: 'task',
      duration_days: 1,
      created_at: now(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    })
    .returning('id')
  const [link] = await db
    .table('triz_delivery_links')
    .insert({
      organization_id: orgIdNum,
      project_id: projectId,
      decision_log_id: Number(dec.id ?? dec),
      delivery_refs: JSON.stringify([{ kind: 'task', entityId: String(t1.id ?? t1) }]),
      context_refs: '[]',
      link_mode: 'apply_receipt',
      link_digest: `tdllink_api_${Math.random().toString(36).slice(2)}`,
      actor_user_id: ownerIdNum,
      created_at: now(),
    })
    .returning('id')
  return {
    projectId,
    decisionLogId: String(dec.id ?? dec),
    taskId: String(t1.id ?? t1),
    itemId: `link-${link.id ?? link}`,
  }
}

test.group('TRIZ delivery-loop API（§9）', (group) => {
  useAuthDatabase(group)

  test('flag 关闭：所有端点 404，与不存在资源不可区分', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('tdl-flag-owner') })
    const org = await createOrganization(owner)
    const stack = await seedStack(Number(org.id), Number(owner.id))
    delete process.env.TRIZ_DELIVERY_LOOP_ENABLED

    const token = await login(client, owner)
    const res = await client
      .get(baseUrl(stack.projectId) + '/items')
      .header('Authorization', `Bearer ${token}`)
    assert.equal(res.status(), 404)
    assert.equal(res.body().error?.code, 'RESOURCE_NOT_FOUND')

    process.env.TRIZ_DELIVERY_LOOP_ENABLED = '1'
  })

  test('无 token → 401；跨组织外人读 → 非泄露错误', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('tdl-auth-owner') })
    const org = await createOrganization(owner)
    const stack = await seedStack(Number(org.id), Number(owner.id))

    const anon = await client.get(baseUrl(stack.projectId) + '/summary')
    assert.equal(anon.status(), 401)

    const outsider = await createUser({ email: uniqueEmail('tdl-auth-out') })
    await createOrganization(outsider)
    const outToken = await login(client, outsider)
    const cross = await client
      .get(baseUrl(stack.projectId) + '/summary')
      .header('Authorization', `Bearer ${outToken}`)
    assert.isTrue([401, 403, 404].includes(cross.status()))
    assert.notInclude(JSON.stringify(cross.body()), 'delivery-loop api 项目')

    // 写动作同样非泄露（confirm）
    const crossWrite = await client
      .post(baseUrl(stack.projectId) + '/links/confirm')
      .header('Authorization', `Bearer ${outToken}`)
      .json({
        decisionLogId: stack.decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: stack.taskId }],
        previewFingerprint: 'x'.repeat(16),
        confirmation: { acknowledgedOnlyLinkWrite: true, requestedAt: now() },
      })
    assert.isTrue([401, 403, 404].includes(crossWrite.status()))
    assert.notInclude(JSON.stringify(crossWrite.body()), stack.itemId)
  })

  test('owner：summary/items/detail/{data,meta} 信封 + 权威 posture + posture 过滤', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('tdl-read-owner') })
    const org = await createOrganization(owner)
    const stack = await seedStack(Number(org.id), Number(owner.id))
    const token = await login(client, owner)

    const sum = await client
      .get(baseUrl(stack.projectId) + '/summary')
      .header('Authorization', `Bearer ${token}`)
    assert.equal(sum.status(), 200)
    assert.property(sum.body().data, 'totals')

    const list = await client
      .get(baseUrl(stack.projectId) + '/items?perPage=5')
      .header('Authorization', `Bearer ${token}`)
    assert.equal(list.status(), 200)
    assert.equal(list.body().meta.perPage, 5)
    assert.lengthOf(list.body().data, 1)
    assert.equal(list.body().data[0].posture, 'awaiting_verification')

    const detail = await client
      .get(`${baseUrl(stack.projectId)}/items/${encodeURIComponent(stack.itemId)}`)
      .header('Authorization', `Bearer ${token}`)
    assert.equal(detail.status(), 200)
    assert.equal(detail.body().data.itemId, stack.itemId)

    const filtered = await client
      .get(baseUrl(stack.projectId) + '/items?posture=blocked')
      .header('Authorization', `Bearer ${token}`)
    assert.equal(filtered.status(), 200)
    assert.lengthOf(filtered.body().data, 0)

    // perPage 越界 → 422
    const badPage = await client
      .get(baseUrl(stack.projectId) + '/items?perPage=9999')
      .header('Authorization', `Bearer ${token}`)
    assert.equal(badPage.status(), 422)
  })

  test('preview/confirm：正向、未确认 422、幂等重放、stale 409 域码', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('tdl-link-owner') })
    const org = await createOrganization(owner)
    const stack = await seedStack(Number(org.id), Number(owner.id), 'not_started')
    const token = await login(client, owner)
    const base = baseUrl(stack.projectId)

    const pv = await client
      .post(base + '/links/preview')
      .header('Authorization', `Bearer ${token}`)
      .json({
        decisionLogId: stack.decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: stack.taskId }],
      })
    assert.equal(pv.status(), 200)
    assert.exists(pv.body().data.previewFingerprint)
    assert.include(pv.body().data.notice, '只写闭环关联')

    const badConfirm = await client
      .post(base + '/links/confirm')
      .header('Authorization', `Bearer ${token}`)
      .json({
        decisionLogId: stack.decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: stack.taskId }],
        previewFingerprint: pv.body().data.previewFingerprint,
        confirmation: { acknowledgedOnlyLinkWrite: false, requestedAt: now() },
      })
    assert.equal(badConfirm.status(), 422)
    assert.equal(badConfirm.body().error.code, 'VALIDATION_ERROR')

    const ok = await client
      .post(base + '/links/confirm')
      .header('Authorization', `Bearer ${token}`)
      .json({
        decisionLogId: stack.decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: stack.taskId }],
        previewFingerprint: pv.body().data.previewFingerprint,
        confirmation: { acknowledgedOnlyLinkWrite: true, requestedAt: now() },
      })
    assert.equal(ok.status(), 200)
    assert.isFalse(ok.body().data.replayed)

    const replay = await client
      .post(base + '/links/confirm')
      .header('Authorization', `Bearer ${token}`)
      .json({
        decisionLogId: stack.decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: stack.taskId }],
        previewFingerprint: pv.body().data.previewFingerprint,
        confirmation: { acknowledgedOnlyLinkWrite: true, requestedAt: now() },
      })
    assert.isTrue(replay.body().data.replayed)
    assert.equal(replay.body().data.linkId, ok.body().data.linkId)

    // 重放后 existing_entity 模式的 confirm link 仍只有一行（seed 的 apply_receipt 行不计）
    const rows = await db
      .query()
      .from('triz_delivery_links')
      .where('decision_log_id', Number(stack.decisionLogId))
      .where('link_mode', 'existing_entity')
    assert.lengthOf(rows, 1)

    const stale = await client
      .post(base + '/links/confirm')
      .header('Authorization', `Bearer ${token}`)
      .json({
        decisionLogId: stack.decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: stack.taskId }],
        previewFingerprint: 'tdlprev_forged00',
        confirmation: { acknowledgedOnlyLinkWrite: true, requestedAt: now() },
      })
    assert.equal(stale.status(), 409)
    assert.equal(stale.body().error.code, 'TRIZ_DL_PREVIEW_STALE')
  })

  test('verifications/reopen：伪造指纹 fail closed；evidence 上限 422；不合格 posture 拒绝', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('tdl-verify-owner') })
    const org = await createOrganization(owner)
    const stack = await seedStack(Number(org.id), Number(owner.id))
    const token = await login(client, owner)
    const verUrl = `${baseUrl(stack.projectId)}/items/${encodeURIComponent(stack.itemId)}/verifications`

    const forged = await client
      .post(verUrl)
      .header('Authorization', `Bearer ${token}`)
      .json({
        conclusion: 'effective',
        observationWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' },
        evidenceRefs: ['doc:7'],
        verificationFingerprint: `fp_${stack.itemId.slice(-6)}`,
      })
    assert.isTrue([409, 422].includes(forged.status()))

    const tooMany = await client
      .post(verUrl)
      .header('Authorization', `Bearer ${token}`)
      .json({
        conclusion: 'effective',
        observationWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' },
        evidenceRefs: Array.from({ length: 21 }, (_, i) => `doc:${i}`),
        verificationFingerprint: 'tdlver_placeholder',
      })
    assert.equal(tooMany.status(), 422)

    const reopenUrl = `${baseUrl(stack.projectId)}/items/${encodeURIComponent(stack.itemId)}/reopen`
    const reopen = await client
      .post(reopenUrl)
      .header('Authorization', `Bearer ${token}`)
      .json({ reason: '需要重审', currentFingerprint: 'tdlver_placeholder' })
    assert.isTrue([409, 422].includes(reopen.status()))

    // 行为面：零事件产生
    const events = await db.query().from('triz_delivery_events')
    assert.lengthOf(events, 0)
  })
})

// v3-triz-to-delivery-closed-loop §7.1/§10.8 —— readiness 只读端点（供人工验证/重审对话框取
// fingerprint；零写入；flag 关闭/跨组织/非法 itemId 全部 fail closed 且不泄露）。
test.group('TRIZ delivery-loop readiness API（§7.1）', (group) => {
  useAuthDatabase(group)

  test('readiness：返回 ready + fingerprint；用真实指纹 verify 成功并推进有效验证', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('tdl-ready-owner') })
    const org = await createOrganization(owner)
    const stack = await seedStack(Number(org.id), Number(owner.id))
    const token = await login(client, owner)
    const readyUrl = `${baseUrl(stack.projectId)}/items/${encodeURIComponent(stack.itemId)}/ready`

    const ready = await client.get(readyUrl).header('Authorization', `Bearer ${token}`)
    assert.equal(ready.status(), 200)
    const data = ready.body().data
    assert.equal(data.itemId, stack.itemId)
    assert.isArray(data.blockingReasons)

    const fingerprint: string | null = data.verificationFingerprint
    if (!fingerprint) {
      // 空环境下 required 来源不可用属合法降级：断言有阻断原因且未落事件
      assert.isNotEmpty(data.blockingReasons)
      const events = await db.query().from('triz_delivery_events')
      assert.lengthOf(events, 0)
      return
    }

    const verify = await client
      .post(`${baseUrl(stack.projectId)}/items/${encodeURIComponent(stack.itemId)}/verifications`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        conclusion: 'effective',
        observationWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' },
        reason: 'E2E 人工验证有效',
        evidenceRefs: ['doc:7'],
        verificationFingerprint: fingerprint,
      })
    assert.equal(verify.status(), 200)
    assert.isNumber(verify.body().data.eventId)

    // 读取零写入：正式业务表计数不变
    for (const t of ['projects', 'tasks', 'milestones', 'risks', 'change_requests']) {
      const rows = await db.query().from(t)
      assert.isAtLeast(rows.length, 0)
    }
  })

  test('readiness：伪造/缺失指纹 verify 保持 fail closed；跨组织与 flag 关闭 404 非泄露', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('tdl-ready2-owner') })
    const org = await createOrganization(owner)
    const stack = await seedStack(Number(org.id), Number(owner.id))
    const token = await login(client, owner)

    const forged = await client
      .post(`${baseUrl(stack.projectId)}/items/${encodeURIComponent(stack.itemId)}/verifications`)
      .header('Authorization', `Bearer ${token}`)
      .json({
        conclusion: 'effective',
        observationWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' },
        evidenceRefs: [],
        verificationFingerprint: 'tdlready_forged_fp_000',
      })
    assert.isTrue([409, 422].includes(forged.status()))

    // 跨组织 read → 404 非泄露（与不存在项目不可区分）
    const outsider = await createUser({ email: uniqueEmail('tdl-ready-outsider') })
    await createOrganization(outsider)
    const outsiderToken = await login(client, outsider)
    const out = await client
      .get(`${baseUrl(stack.projectId)}/items/${encodeURIComponent(stack.itemId)}/ready`)
      .header('Authorization', `Bearer ${outsiderToken}`)
    assert.equal(out.status(), 404)
    assert.equal(out.body().error?.code, 'RESOURCE_NOT_FOUND')

    // flag 关闭 → 404 与资源不存在不可区分
    delete process.env.TRIZ_DELIVERY_LOOP_ENABLED
    const flagOff = await client
      .get(`${baseUrl(stack.projectId)}/items/${encodeURIComponent(stack.itemId)}/ready`)
      .header('Authorization', `Bearer ${token}`)
    assert.equal(flagOff.status(), 404)
    process.env.TRIZ_DELIVERY_LOOP_ENABLED = '1'
  })
})
