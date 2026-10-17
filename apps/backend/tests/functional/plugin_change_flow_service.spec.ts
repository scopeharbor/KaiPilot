/**
 * v3-plugin-approval-change-flow —— PluginChangeRequestService 功能测试（tasks 2.3/2.4）。
 *
 * 覆盖要求：
 * - 状态机推进（previewed 分流 / approve / reject / withdraw / expire）
 * - CAS 并发决策（approve 竞态只有一个成功）
 * - 终态幂等（rejected/withdrawn/applied 上重复操作稳定返回 already-decided）
 * - 一次性句柄消费与重放防护（伪造/过期/stale/跨组织）
 * - apply 失败落 failed 且可经重新预览幂等重试（领域提交不重复应用）
 * - 审计失败整体回滚（fail-closed，无 applied 事件、无审计残留）
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createOrganization, createUser } from '../unit/ai/_helpers.js'
import AuditLog from '#models/audit_log'
import PluginChangeRequestService, {
  appendTrustedChangeAuditReceipt,
  type ChangeApplyDelegate,
} from '#services/plugin_change_request_service'
import {
  computeChangeDiffDigest,
  createFixtureChangeRequest,
  type PluginChangeCanonicalDiff,
} from '@aiproj/types'

function buildService(): PluginChangeRequestService {
  return new PluginChangeRequestService()
}

/** 断言 ChangeFlowResult 成功，失败时携带稳定错误码与信息（便于定位）。 */
function expectOk<T>(
  assert: any,
  res: { ok: true; data: T } | { ok: false; code: string; message: string },
): T {
  if (!res.ok) {
    throw new Error(`expected ok, got code=${res.code} message=${res.message}`)
  }
  assert.isTrue(true)
  return res.data
}

/** 组装创建输入（diff 来自共享 fixtures，digest 与契约一致）。 */
async function seedRequest(
  service: PluginChangeRequestService,
  organizationId: number,
  requesterRef: string,
  overrides?: Partial<{
    diff: PluginChangeCanonicalDiff
    approvalRequired: boolean
    ttlSeconds: number
  }>,
) {
  const diff = overrides?.diff ?? (createFixtureChangeRequest().diff as PluginChangeCanonicalDiff)
  const normalizedDiff: PluginChangeCanonicalDiff = { ...diff, pluginId: diff.pluginId }
  return await service.create({
    organizationId,
    projectId: null,
    kind: normalizedDiff.kind,
    pluginId: normalizedDiff.pluginId,
    requestedBy: requesterRef,
    targetRevision: 'release-102',
    diff: normalizedDiff,
    permissionDigest: 'perm-digest-fixture',
    compatibilityDigest: normalizedDiff.compatibilityDigestAfter ?? 'compat-digest-fixture',
    approvalRequired: overrides?.approvalRequired ?? true,
    ttlSeconds: overrides?.ttlSeconds,
  })
}

/** 标准成功 delegate：领域提交 + 同事务可信审计 receipt。 */
function makeOkDelegate(counter: { calls: number }): ChangeApplyDelegate {
  return async ({ request, trx, executorRef }) => {
    counter.calls += 1
    return await appendTrustedChangeAuditReceipt({
      organizationId: request.organizationId,
      projectId: request.projectId,
      userId: null,
      action: 'apply',
      requestUid: request.requestUid,
      metadata: { kind: request.kind, executorRef },
      client: trx,
    })
  }
}

test.group('PluginChangeRequestService', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  test('创建 draft 请求并记录 requested 决策事件', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const row = await seedRequest(service, org.id, String(user.id))
    assert.equal(row.state, 'draft')
    assert.equal(row.rowVersion, 1)
    assert.equal(row.approvalRequired, true)

    const decisions = await service.listDecisions(org.id, row.id)
    assert.equal(decisions.length, 1)
    assert.equal(decisions[0].event, 'requested')
    assert.equal(decisions[0].toState, 'draft')
  })

  test('previewed 按策略分流：需审批 → pending-approval；免审批 → awaiting-confirmation', async ({
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const a = await seedRequest(service, org.id, String(user.id), { approvalRequired: true })
    const ra = await service.attachPreview(org.id, a.requestUid)
    assert.isTrue(ra.ok)
    if (ra.ok) assert.equal(ra.data.state, 'pending-approval')

    const b = await seedRequest(service, org.id, String(user.id), { approvalRequired: false })
    const rb = await service.attachPreview(org.id, b.requestUid, { approvalRequired: false })
    assert.isTrue(rb.ok)
    if (rb.ok) assert.equal(rb.data.state, 'awaiting-confirmation')
  })

  test('maker-checker：发起人自批被拒；检查者批准通过并留痕', async ({ assert }) => {
    const user = await createUser()
    const checker = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const row = await seedRequest(service, org.id, String(user.id))
    await service.attachPreview(org.id, row.requestUid)

    const selfRes = await service.approve(org.id, row.requestUid, String(user.id), 'idem-self-1')
    assert.isFalse(selfRes.ok)
    if (!selfRes.ok) assert.equal(selfRes.code, 'plugin-change-self-approval-denied')

    const okRes = await service.approve(org.id, row.requestUid, String(checker.id), 'idem-ok-1')
    assert.isTrue(okRes.ok)
    if (okRes.ok) {
      assert.equal(okRes.data.state, 'approved')
      assert.equal(okRes.data.approvedBy, String(checker.id))
    }

    const decisions = await service.listDecisions(org.id, row.id)
    const approved = decisions.find((d) => d.event === 'approved')
    assert.isOk(approved)
    // 幂等键相同的事件不会重复插入
    await service.approve(org.id, row.requestUid, String(checker.id), 'idem-ok-1')
    const decisionsAgain = await service.listDecisions(org.id, row.id)
    assert.equal(decisionsAgain.filter((d) => d.event === 'approved').length, 1)
  })

  test('reject 进入终态；后续确认稳定返回 already-decided', async ({ assert }) => {
    const user = await createUser()
    const checker = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const row = await seedRequest(service, org.id, String(user.id))
    await service.attachPreview(org.id, row.requestUid)
    const rej = await service.reject(org.id, row.requestUid, String(checker.id), 'idem-rj-1')
    assert.isTrue(rej.ok)
    if (rej.ok) assert.equal(rej.data.state, 'rejected')

    const again = await service.reject(org.id, row.requestUid, String(checker.id), 'idem-rj-2')
    assert.isFalse(again.ok)
    if (!again.ok) assert.equal(again.code, 'plugin-change-already-decided')

    const confirmAttempt = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    assert.isFalse(confirmAttempt.ok)
    if (!confirmAttempt.ok) assert.equal(confirmAttempt.code, 'plugin-change-already-decided')
  })

  test('发起人在提交前撤回：后续确认被拒绝且目标状态不变', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const row = await seedRequest(service, org.id, String(user.id), { approvalRequired: false })
    await service.attachPreview(org.id, row.requestUid)

    const wd = await service.withdraw(org.id, row.requestUid, String(user.id))
    assert.isTrue(wd.ok)
    if (wd.ok) assert.equal(wd.data.state, 'withdrawn')

    const handle = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    assert.isFalse(handle.ok)
    if (!handle.ok) assert.equal(handle.code, 'plugin-change-already-decided')

    // 非发起人不能撤回他人请求
    const other = await createUser()
    const otherOrg = org // 同组织
    const r2 = await seedRequest(service, otherOrg.id, String(other.id))
    await service.attachPreview(otherOrg.id, r2.requestUid)
    const wd2 = await service.withdraw(otherOrg.id, r2.requestUid, String(user.id))
    assert.isFalse(wd2.ok)
    if (!wd2.ok) assert.equal(wd2.code, 'plugin-change-permission-denied')
  })

  test('完整 happy path：审批 → 句柄 → 确认应用 → receipt 回填；重放句柄返回 already-decided', async ({
    assert,
  }) => {
    const user = await createUser()
    const checker = await createUser()
    const org = await createOrganization(user)
    const service = buildService()
    const counter = { calls: 0 }

    const row = await seedRequest(service, org.id, String(user.id))
    await service.attachPreview(org.id, row.requestUid)
    await service.approve(org.id, row.requestUid, String(checker.id), 'idem-hp-1')

    // 审批 ≠ 确认：approved 状态下安装目标零变化（这里以状态尚未 applied 断言）
    const afterApprove = await service.getByUid(org.id, row.requestUid)
    assert.equal(afterApprove.state, 'approved')

    const handleRes = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    const handle = expectOk(assert, handleRes)

    const applyRes = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(user.id),
      handle: handle.handle,
      applyDelegate: makeOkDelegate(counter),
    })
    if (!applyRes.ok)
      throw new Error('apply failed code=' + applyRes.code + ' msg=' + applyRes.message)
    if (applyRes.ok) {
      assert.equal(applyRes.data.request.state, 'applied')
      assert.equal(applyRes.data.receipt.auditLogId > 0, true)
    }
    assert.equal(counter.calls, 1)

    // applied 决策事件回填 receipt
    const decisions = await service.listDecisions(org.id, row.id)
    const appliedEvent = decisions.find((d) => d.event === 'applied')
    assert.isOk(appliedEvent)
    assert.isNotNull(appliedEvent!.auditLogId)

    // 重放同一句柄：终态幂等
    const replay = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(user.id),
      handle: handle.handle,
      applyDelegate: makeOkDelegate(counter),
    })
    assert.isFalse(replay.ok)
    if (!replay.ok) assert.equal(replay.code, 'plugin-change-already-decided')
    assert.equal(counter.calls, 1, '领域提交不得重复执行')
  })

  test('伪造句柄与漂移绑定统一映射 stale；非被授权执行者被拒（permission-denied）', async ({
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const row = await seedRequest(service, org.id, String(user.id), { approvalRequired: false })
    const pv = await service.attachPreview(org.id, row.requestUid)
    expectOk(assert, pv)
    const handleRes = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    const realHandle = expectOk(assert, handleRes)

    const forged = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(user.id),
      handle: 'chg-cfm-000000000000-2',
      applyDelegate: makeOkDelegate({ calls: 0 }),
    })
    assert.isFalse(forged.ok)
    if (!forged.ok) assert.equal(forged.code, 'plugin-change-stale')

    // 非被授权执行者持真实句柄：permission-denied
    const stranger = await createUser()
    const strangerAttempt = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(stranger.id),
      handle: realHandle.handle,
      applyDelegate: makeOkDelegate({ calls: 0 }),
    })
    assert.isFalse(strangerAttempt.ok)
    if (!strangerAttempt.ok) assert.equal(strangerAttempt.code, 'plugin-change-permission-denied')

    // stale 失败后请求保持 awaiting-confirmation，可重新签发完成
    const stillValid = await service.getByUid(org.id, row.requestUid)
    assert.equal(stillValid.state, 'awaiting-confirmation')
    const reissue = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    const reissueOk = expectOk(assert, reissue)
    const done = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(user.id),
      handle: reissueOk.handle,
      applyDelegate: makeOkDelegate({ calls: 0 }),
    })
    if (!done.ok) throw new Error('confirm failed code=' + done.code + ' msg=' + done.message)
  })

  test('签发后状态漂移（rowVersion 前进）→ stale，要求重新预览', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const row = await seedRequest(service, org.id, String(user.id), { approvalRequired: false })
    await service.attachPreview(org.id, row.requestUid)
    const handleRes = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    const issuedHandle = expectOk(assert, handleRes)

    // 模拟并发修改：直接前进 rowVersion（例如另一管理员更新了绑定元数据）
    const current = await service.getByUid(org.id, row.requestUid)
    const { default: dbModule } = await import('@adonisjs/lucid/services/db')
    await dbModule
      .from('plugin_change_requests')
      .where('id', current.id)
      .update({ row_version: current.rowVersion + 5 })

    const res = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(user.id),
      handle: issuedHandle.handle,
      applyDelegate: makeOkDelegate({ calls: 0 }),
    })
    assert.isFalse(res.ok)
    if (!res.ok) assert.equal(res.code, 'plugin-change-stale')

    // 重新预览后可用新句柄完成
    const rePreview = await service.attachPreview(org.id, row.requestUid)
    // 当前状态已是 awaiting-confirmation，重复 preview 属非法转移 → 直接重新签发即可
    assert.isFalse(rePreview.ok)

    const freshHandle = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    // rowVersion 已漂移，旧绑定失效后新签发基于新行版本，可正常确认
    const freshHandleOk = expectOk(assert, freshHandle)
    const done = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(user.id),
      handle: freshHandleOk.handle,
      applyDelegate: makeOkDelegate({ calls: 0 }),
    })
    if (!done.ok) throw new Error('confirm failed code=' + done.code + ' msg=' + done.message)
  })

  test('跨组织不可区分：他组织查询同一 requestUid 抛出未找到', async ({ assert }) => {
    const user = await createUser()
    const orgA = await createOrganization(user)
    const otherUser = await createUser()
    const orgB = await createOrganization(otherUser)
    const service = buildService()

    const row = await seedRequest(service, orgA.id, String(user.id))

    let threw = false
    try {
      await service.getByUid(orgB.id, row.requestUid)
    } catch {
      threw = true
    }
    assert.isTrue(threw, '跨组织读取应不可区分地失败')

    // 未找到语义以异常呈现（Controller 层统一映射 404）
    let crossThrew = false
    try {
      await service.issueConfirmHandle(orgB.id, row.requestUid, String(otherUser.id))
    } catch {
      crossThrew = true
    }
    assert.isTrue(crossThrew, '跨组织签发应不可区分地失败')
  })

  test('过期请求 fail closed：签发句柄返回 expired 且状态置 expired', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const row = await seedRequest(service, org.id, String(user.id), {
      approvalRequired: false,
      ttlSeconds: -60,
    })
    const res = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    assert.isFalse(res.ok)
    if (!res.ok) assert.equal(res.code, 'plugin-change-expired')

    const expiredRow = await service.getByUid(org.id, row.requestUid)
    assert.equal(expiredRow.state, 'expired')
  })

  test('apply 失败落 failed；重新预览后幂等重试成功且领域只应用一次', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()
    let attempts = 0

    const failingDelegate: ChangeApplyDelegate = async () => {
      attempts += 1
      throw new Error('simulated domain failure')
    }

    const row = await seedRequest(service, org.id, String(user.id), { approvalRequired: false })
    await service.attachPreview(org.id, row.requestUid)
    const h1 = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    const h1ok = expectOk(assert, h1)

    const failed = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(user.id),
      handle: h1ok.handle,
      applyDelegate: failingDelegate,
    })
    assert.isFalse(failed.ok)
    if (!failed.ok) assert.equal(failed.code, 'plugin-change-apply-failed')

    const failedRow = await service.getByUid(org.id, row.requestUid)
    assert.equal(failedRow.state, 'failed')
    assert.equal(attempts, 1)

    // 重试路径：failed --previewed--> awaiting-confirmation --> 新句柄 --> applied
    const rePreview = await service.attachPreview(org.id, row.requestUid)
    assert.isTrue(rePreview.ok)
    if (rePreview.ok) assert.equal(rePreview.data.state, 'awaiting-confirmation')

    const h2 = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    const h2ok = expectOk(assert, h2)

    const counter = { calls: 0 }
    const retry = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(user.id),
      handle: h2ok.handle,
      applyDelegate: makeOkDelegate(counter),
    })
    if (!retry.ok) throw new Error('retry failed code=' + retry.code + ' msg=' + retry.message)
    assert.equal(attempts, 1, '失败的首次尝试不应产生部分应用')
    assert.equal(counter.calls, 1)
  })

  test('审计失败整体回滚：无 applied 事件、无审计残留、状态回退为 failed 前的原始失败语义', async ({
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    // delegate 在同事务内先写审计再抛错 → 整个事务必须回滚
    const auditThenThrowDelegate: ChangeApplyDelegate = async ({ request, trx }) => {
      await appendTrustedChangeAuditReceipt({
        organizationId: request.organizationId,
        projectId: request.projectId,
        userId: null,
        action: 'apply',
        requestUid: request.requestUid,
        metadata: { note: 'should-be-rolled-back' },
        client: trx,
      })
      throw new Error('audit boundary simulation failure')
    }

    const row = await seedRequest(service, org.id, String(user.id), { approvalRequired: false })
    await service.attachPreview(org.id, row.requestUid)
    const h = await service.issueConfirmHandle(org.id, row.requestUid, String(user.id))
    const hok = expectOk(assert, h)

    const res = await service.confirmAndApply({
      organizationId: org.id,
      requestUid: row.requestUid,
      executorRef: String(user.id),
      handle: hok.handle,
      applyDelegate: auditThenThrowDelegate,
    })
    assert.isFalse(res.ok)
    if (!res.ok) assert.equal(res.code, 'plugin-change-apply-failed')

    // 无残留审计（同事务回滚）
    const audits = await AuditLog.query()
      .where('entityType', 'plugin_change_request')
      .where('entityType', 'plugin_change_request')
    assert.equal(audits.length, 0, '回滚后不应有审计残留')

    // 无 applied 事件
    const decisions = await service.listDecisions(org.id, row.id)
    assert.isUndefined(decisions.find((d) => d.event === 'applied'))
    // 有 failed 事件
    assert.isOk(decisions.find((d) => d.event === 'failed'))
  })

  test('并发 approve 竞态：CAS 保证仅一个成功', async ({ assert }) => {
    const user = await createUser()
    const c1 = await createUser()
    const c2 = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const row = await seedRequest(service, org.id, String(user.id))
    await service.attachPreview(org.id, row.requestUid)

    const [r1, r2] = await Promise.all([
      service.approve(org.id, row.requestUid, String(c1.id), 'race-1'),
      service.approve(org.id, row.requestUid, String(c2.id), 'race-2'),
    ])

    const outcomes = [r1, r2].map((r) => (r.ok ? 'ok' : r.code)).sort()
    assert.deepEqual(outcomes, ['ok', 'plugin-change-stale'])
  })

  test('契约 digest 一致性：create 落库的 diffDigest 与共享纯函数一致', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const service = buildService()

    const diff = createFixtureChangeRequest().diff as PluginChangeCanonicalDiff
    const row = await seedRequest(service, org.id, String(user.id), { diff })
    assert.equal(row.diffDigest, computeChangeDiffDigest(diff))
  })
})
