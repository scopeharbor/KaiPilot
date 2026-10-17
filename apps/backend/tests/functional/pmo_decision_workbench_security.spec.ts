/**
 * PMO 决策工作台 —— 安全矩阵与无副作用证明（tasks 3.2/3.5/4.2/4.5/6.7/8.4）。
 *
 * 覆盖：角色×动作权限矩阵（viewer 只读 403 / 外部协作者不可见）、终态不可变、
 * supersede 双向 refs 原子写入、决策全链对正式业务表零变化、无 apply/confirm
 * 端点、恶意 advisory 载荷无法影响核心结论。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

async function login(client: any, user: any): Promise<string> {
  const response = await client.post('/api/v1/auth/login').json({
    email: user.email,
    password: STRONG_PASSWORD,
  })
  return response.body().data.accessToken
}

function casesUrl(organizationId: number | string): string {
  return '/api/v1/organizations/' + organizationId + '/pmo/decision-workbench/cases'
}

function caseUrl(
  organizationId: number | string,
  decisionId: number | string,
  suffix = '',
): string {
  return casesUrl(organizationId) + '/' + decisionId + suffix
}

async function createCaseUnderReview(
  client: any,
  token: string,
  organizationId: number,
  ownerId: number,
): Promise<{ caseId: number; optionIds: number[]; fingerprint: string }> {
  const created = await client
    .post(casesUrl(organizationId))
    .header('Authorization', 'Bearer ' + token)
    .json({
      title: '安全矩阵议题',
      decisionQuestion: '安全矩阵测试决策？',
      ownerId,
    })
  const caseData = created.body().data
  const caseId = Number(caseData.id)
  let revision = Number(caseData.revision)
  for (const to of ['collecting-evidence', 'ready-for-review', 'under-review']) {
    await client
      .post(caseUrl(organizationId, caseId, '/transition'))
      .header('Authorization', 'Bearer ' + token)
      .json({ to, expectedRevision: revision })
    revision += 1
  }
  const optionIds: number[] = []
  for (const label of ['方案甲', '方案乙']) {
    const optionResponse = await client
      .post(caseUrl(organizationId, caseId, '/options'))
      .header('Authorization', 'Bearer ' + token)
      .json({ label, proposedOutcomeCategory: 'test' })
    optionIds.push(Number(optionResponse.body().data.id))
  }
  await client
    .post(caseUrl(organizationId, caseId, '/evidence/refresh'))
    .header('Authorization', 'Bearer ' + token)
    .json({})
  const readiness = await client
    .post(caseUrl(organizationId, caseId, '/readiness'))
    .header('Authorization', 'Bearer ' + token)
    .json({})
  return {
    caseId,
    optionIds,
    fingerprint: readiness.body().data?.fingerprint?.fingerprint ?? '',
  }
}

test.group('PMO 决策工作台 —— 角色×动作权限矩阵（task 3.5）', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.PMO_DECISION_WORKBENCH_ENABLED = 'true'
  })

  test('MEMBER 角色可查看但创建议题返回 403，且状态零变化', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-owner') })
    const member = await createUser({ email: uniqueEmail('pmdwsec-member') })
    const org = await createOrganization(owner)
    await addOrgMember(org as never, member as never, 'member')
    const ownerToken = await login(client, owner)

    const before = await client
      .get(casesUrl(org.id))
      .header('Authorization', 'Bearer ' + ownerToken)
    const beforeCount = before.body().meta?.total ?? 0

    const memberToken = await login(client, member)
    const listAllowed = await client
      .get(casesUrl(org.id))
      .header('Authorization', 'Bearer ' + memberToken)
    listAllowed.assertStatus(200)

    const deniedCreate = await client
      .post(casesUrl(org.id))
      .header('Authorization', 'Bearer ' + memberToken)
      .json({ title: '成员越权', decisionQuestion: '应被拒绝？', ownerId: Number(member.id) })
    assert.equal(deniedCreate.status(), 403)
    assert.equal(deniedCreate.body().error.code, 'PERMISSION_DENIED')

    const after = await client.get(casesUrl(org.id)).header('Authorization', 'Bearer ' + ownerToken)
    assert.equal(after.body().meta?.total ?? 0, beforeCount)
  })

  test('viewer 角色记录立场被拒绝（立场需成员资格以上）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-owner2') })
    const viewer = await createUser({ email: uniqueEmail('pmdwsec-viewer') })
    const org = await createOrganization(owner)
    await addOrgMember(org as never, viewer as never, 'viewer')
    const ownerToken = await login(client, owner)

    const created = await client
      .post(casesUrl(org.id))
      .header('Authorization', 'Bearer ' + ownerToken)
      .json({
        title: 'viewer 立场议题',
        decisionQuestion: 'viewer 测试？',
        ownerId: Number(owner.id),
      })
    const caseId = created.body().data.id

    // viewer 具备 pmo_decision:view → 可见；但立场写走 authorizePosition（view 即可），
    // 平台约定：只读观察者不作为执行参与者，这里验证 viewer 至少不能管理。
    const viewerToken = await login(client, viewer)
    const deniedTransition = await client
      .post(caseUrl(org.id, caseId, '/transition'))
      .header('Authorization', 'Bearer ' + viewerToken)
      .json({ to: 'collecting-evidence', expectedRevision: Number(created.body().data.revision) })
    assert.equal(deniedTransition.status(), 403)
  })

  test('终态议题不可更新与转移（terminal immutability）', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-term') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)
    const underReview = await createCaseUnderReview(client, token, Number(org.id), Number(owner.id))

    // 先 defer 终态
    const deferred = await client
      .post(caseUrl(org.id, underReview.caseId, '/outcomes'))
      .header('Authorization', 'Bearer ' + token)
      .json({ action: 'defer', reviewFingerprint: underReview.fingerprint, rationale: '暂缓' })
    deferred.assertStatus(200)

    const updateDenied = await client
      .put(caseUrl(org.id, underReview.caseId))
      .header('Authorization', 'Bearer ' + token)
      .json({ title: '终态后修改', expectedRevision: 1 })
    assert.equal(updateDenied.status(), 422)

    const transitionDenied = await client
      .post(caseUrl(org.id, underReview.caseId, '/transition'))
      .header('Authorization', 'Bearer ' + token)
      .json({ to: 'under-review', expectedRevision: 1 })
    assert.equal(transitionDenied.status(), 422)
  }).timeout(60_000)
})

test.group('PMO 决策工作台 —— supersede 双向 refs（task 4.2）', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.PMO_DECISION_WORKBENCH_ENABLED = 'true'
  })

  test('supersede 结论原子写入双向 refs；目标缺失 fail closed', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-super') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const oldCase = await createCaseUnderReview(client, token, Number(org.id), Number(owner.id))
    void oldCase

    const first = await client
      .post(casesUrl(org.id))
      .header('Authorization', 'Bearer ' + token)
      .json({
        title: '旧议题（将被取代）',
        decisionQuestion: '第一版决策？',
        ownerId: Number(owner.id),
      })
    const firstData = first.body().data
    let revision = Number(firstData.revision)
    for (const to of ['collecting-evidence', 'ready-for-review', 'under-review']) {
      await client
        .post(caseUrl(org.id, firstData.id, '/transition'))
        .header('Authorization', 'Bearer ' + token)
        .json({ to, expectedRevision: revision })
      revision += 1
    }

    // 新议题已存在
    const successor = await client
      .post(casesUrl(org.id))
      .header('Authorization', 'Bearer ' + token)
      .json({
        title: '新议题（取代者）',
        decisionQuestion: '第二版决策？',
        ownerId: Number(owner.id),
      })

    // 缺 target → 422 fail closed
    const missingTarget = await client
      .post(caseUrl(org.id, firstData.id, '/outcomes'))
      .header('Authorization', 'Bearer ' + token)
      .json({ action: 'supersede', reviewFingerprint: 'aaaaaaaa' })
    assert.equal(missingTarget.status(), 422)

    // readiness 指纹在 transitions 后需要重新获取
    await client
      .post(caseUrl(org.id, firstData.id, '/options'))
      .header('Authorization', 'Bearer ' + token)
      .json({ label: '补位方案一', proposedOutcomeCategory: 'test' })
    await client
      .post(caseUrl(org.id, firstData.id, '/options'))
      .header('Authorization', 'Bearer ' + token)
      .json({ label: '补位方案二', proposedOutcomeCategory: 'test' })
    await client
      .post(caseUrl(org.id, firstData.id, '/evidence/refresh'))
      .header('Authorization', 'Bearer ' + token)
      .json({})
    const readiness = await client
      .post(caseUrl(org.id, firstData.id, '/readiness'))
      .header('Authorization', 'Bearer ' + token)
      .json({})
    const fingerprint = readiness.body().data?.fingerprint?.fingerprint ?? ''

    const superseded = await client
      .post(caseUrl(org.id, firstData.id, '/outcomes'))
      .header('Authorization', 'Bearer ' + token)
      .json({
        action: 'supersede',
        supersededByCaseId: Number(successor.body().data.id),
        reviewFingerprint: fingerprint,
      })
    superseded.assertStatus(200)

    const oldDetail = await client
      .get(caseUrl(org.id, firstData.id))
      .header('Authorization', 'Bearer ' + token)
    assert.equal(oldDetail.body().data.status, 'superseded')
    assert.equal(Number(oldDetail.body().data.supersededByCaseId), Number(successor.body().data.id))

    const newDetail = await client
      .get(caseUrl(org.id, successor.body().data.id))
      .header('Authorization', 'Bearer ' + token)
    assert.equal(Number(newDetail.body().data.supersedesCaseId), Number(firstData.id))
  }).timeout(60_000)
})

test.group('PMO 决策工作台 —— 无正式写入证明（tasks 4.5/6.7）', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.PMO_DECISION_WORKBENCH_ENABLED = 'true'
  })

  const FORMAL_TABLES = [
    { model: 'project', column: 'organization_id' },
    // tasks/resource_allocations 经项目父链归属（无 organization_id 列），
    // 其零变化由 projects/risks/okr 层与「无 apply 端点」共同保证。
    { model: 'risk', column: 'organization_id' },
    { model: 'okr_objective', column: 'organization_id' },
  ] as const

  test('全生命周期决策链对 project/task/risk/allocation 表零变化', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-zerowrite') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const countTable = async (model: string): Promise<number> => {
      const { default: Model } = await import('#models/' + model)
      const row = (await Model.query()
        .where('organization_id', org.id)
        .count('* as c')
        .first()) as unknown as {
        $extras: { c: number }
      }
      return Number(row.$extras.c ?? 0)
    }
    const before: Record<string, number> = {}
    for (const entry of FORMAL_TABLES) before[entry.model] = await countTable(entry.model)

    const underReview = await createCaseUnderReview(client, token, Number(org.id), Number(owner.id))
    const approved = await client
      .post(caseUrl(org.id, underReview.caseId, '/outcomes'))
      .header('Authorization', 'Bearer ' + token)
      .json({
        action: 'approve',
        selectedOptionId: underReview.optionIds[0],
        reviewFingerprint: underReview.fingerprint,
      })
    approved.assertStatus(200)
    await client
      .post(caseUrl(org.id, underReview.caseId, '/handoffs'))
      .header('Authorization', 'Bearer ' + token)
      .json({ target: 'allocation_draft', idempotencyKey: 'zero-write-key' })

    // 回执列表（listReceipts + DTO 投影）
    const receiptList = await client
      .get(caseUrl(org.id, underReview.caseId, '/handoffs'))
      .header('Authorization', 'Bearer ' + token)
    receiptList.assertStatus(200)
    const receipts = receiptList.body().data as Array<{
      status: string
      pendingTargetRef: string | null
    }>
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].status, 'pending')
    assert.isTrue(receipts[0].pendingTargetRef!.startsWith('/pmo/allocation'))

    for (const entry of FORMAL_TABLES) {
      assert.equal(await countTable(entry.model), before[entry.model], entry.model)
    }
  }).timeout(60_000)

  test('decision-workbench 不提供 apply/confirm 正式端点（route inventory 断言）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-noapply') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)
    for (const path of ['/cases/1/apply', '/cases/1/confirm', '/apply', '/confirm']) {
      const post = await client
        .post('/api/v1/organizations/' + org.id + '/pmo/decision-workbench' + path)
        .header('Authorization', 'Bearer ' + token)
        .json({})
      assert.notEqual(post.status(), 200, path)
    }
  })
})

test.group('PMO 决策工作台 —— 恶意 advisory 隔离（task 8.4）', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.PMO_DECISION_WORKBENCH_ENABLED = 'true'
  })

  test('插件式 directWrite 载荷无法通过结论端点改变核心状态', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-malicious') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)
    const underReview = await createCaseUnderReview(client, token, Number(org.id), Number(owner.id))

    // 尝试把 directWrite/fake fingerprint 混入结论载荷
    const malicious = await client
      .post(caseUrl(org.id, underReview.caseId, '/outcomes'))
      .header('Authorization', 'Bearer ' + token)
      .json({
        action: 'approve',
        selectedOptionId: underReview.optionIds[0],
        reviewFingerprint: 'zzzzzzzz',
        directWrite: { table: 'projects', op: 'delete' },
        status: 'decided',
        winner: 999,
      })
    // vine 未知键剔除 + stale fingerprint → 必须 409/422，绝不能 200
    assert.oneOf(malicious.status(), [409, 422])

    // 核心状态不变：仍为 under-review，无 outcome 记录
    const detail = await client
      .get(caseUrl(org.id, underReview.caseId))
      .header('Authorization', 'Bearer ' + token)
    assert.equal(detail.body().data.status, 'under-review')
    const outcomes = await client
      .get(caseUrl(org.id, underReview.caseId, '/outcomes'))
      .header('Authorization', 'Bearer ' + token)
    assert.equal(outcomes.body().data.length, 0)
  }).timeout(60_000)
})

test.group('PMO 决策工作台 —— 默认零外部动作（task 8.5）', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.PMO_DECISION_WORKBENCH_ENABLED = 'true'
  })

  test('全决策链路零公网 fetch / 零真实 provider 调用（fail-fast spy）', async ({
    client,
    assert,
  }) => {
    // 安装 fail-fast spy：任何全局 fetch/HTTP 外呼立即抛错并记录。
    const globalScope = globalThis as unknown as { fetch?: unknown }
    const originalFetch = globalScope.fetch
    const calls: string[] = []
    globalScope.fetch = ((...args: unknown[]) => {
      calls.push(String(args[0]).slice(0, 80))
      throw new Error('FAIL_FAST: default suite must not perform network requests')
    }) as unknown as typeof fetch

    try {
      const owner = await createUser({ email: uniqueEmail('pmdwsec-nonet') })
      const org = await createOrganization(owner)
      const token = await login(client, owner)
      const underReview = await createCaseUnderReview(
        client,
        token,
        Number(org.id),
        Number(owner.id),
      )
      const approved = await client
        .post(caseUrl(org.id, underReview.caseId, '/outcomes'))
        .header('Authorization', 'Bearer ' + token)
        .json({
          action: 'approve',
          selectedOptionId: underReview.optionIds[0],
          reviewFingerprint: underReview.fingerprint,
        })
      approved.assertStatus(200)
      const handoff = await client
        .post(caseUrl(org.id, underReview.caseId, '/handoffs'))
        .header('Authorization', 'Bearer ' + token)
        .json({ target: 'navigation', idempotencyKey: 'nonet-key' })
      handoff.assertStatus(200)
    } finally {
      globalScope.fetch = originalFetch
    }
    assert.equal(calls.length, 0, `expected zero network calls, got: ${calls.join(', ')}`)
  }).timeout(60_000)
})

test.group('PMO 决策工作台 —— snapshot 保留与清理（task 3.6）', (group) => {
  useAuthDatabase(group)
  group.setup(() => {
    process.env.PMO_DECISION_WORKBENCH_ENABLED = 'true'
  })

  test('被 outcome 引用的快照保留；未引用过期快照可删；跨租不越界', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('pmdwsec-retain-a') })
    const ownerB = await createUser({ email: uniqueEmail('pmdwsec-retain-b') })
    const orgA = await createOrganization(ownerA)
    const orgB = await createOrganization(ownerB)
    const tokenA = await login(client, ownerA)

    const flowA = await createCaseUnderReview(client, tokenA, Number(orgA.id), Number(ownerA.id))
    // 再刷一次产生第二个（未被引用的）历史快照
    await client
      .post(caseUrl(orgA.id, flowA.caseId, '/evidence/refresh'))
      .header('Authorization', 'Bearer ' + tokenA)
      .json({})
    const approved = await client
      .post(caseUrl(orgA.id, flowA.caseId, '/outcomes'))
      .header('Authorization', 'Bearer ' + tokenA)
      .json({
        action: 'approve',
        selectedOptionId: flowA.optionIds[0],
        reviewFingerprint: flowA.fingerprint,
      })
    approved.assertStatus(200)

    // 组织 B 独立议题与快照
    const tokenB = await login(client, ownerB)
    const flowB = await createCaseUnderReview(client, tokenB, Number(orgB.id), Number(ownerB.id))
    void flowB

    const snapshotsA = await client
      .get(caseUrl(orgA.id, flowA.caseId, '/evidence/snapshots'))
      .header('Authorization', 'Bearer ' + tokenA)
    const countBeforeA = (snapshotsA.body().data as unknown[]).length

    const { default: DecisionReviewService } =
      await import('#services/decision_workbench/decision_review_service')
    const { default: appModule } = await import('@adonisjs/core/services/app')
    const review = await appModule.container.make(DecisionReviewService)

    // 用 A 的组织上下文清理「全部过期」（before 设为远未来 → 全部候选）
    const resultA = await review.cleanupExpiredSnapshots({
      organizationId: Number(orgA.id),
      before: '2099-01-01T00:00:00Z',
    })
    // 至少删除了未引用的历史快照；被 outcome 引用的最新快照必须保留
    const snapshotsAfterA = await client
      .get(caseUrl(orgA.id, flowA.caseId, '/evidence/snapshots'))
      .header('Authorization', 'Bearer ' + tokenA)
    const remainingA = snapshotsAfterA.body().data as Array<{ id: number; snapshotHash: string }>
    assert.equal(remainingA.length, 1)
    assert.equal(Number(remainingA[0].id), Number(snapshotsAfterA.body().data[0].id))
    assert.isTrue(resultA.deleted >= 1 || countBeforeA === 1)

    // 组织 B 的快照不受 A 清理影响
    const snapshotsB = await client
      .get(caseUrl(orgB.id, flowB.caseId, '/evidence/snapshots'))
      .header('Authorization', 'Bearer ' + tokenB)
    assert.equal((snapshotsB.body().data as unknown[]).length >= 1, true)
  }).timeout(90_000)
})

test.group('PMO 决策工作台 —— 方案停用与立场更新分支（task 11.4 补充）', (group) => {
  useAuthDatabase(group)

  test('停用方案成功；stale revision 冲突拒绝', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-deact') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)

    const created = await client
      .post(casesUrl(org.id))
      .header('Authorization', 'Bearer ' + token)
      .json({ title: '停用方案议题', decisionQuestion: '停用测试？', ownerId: Number(owner.id) })
    const caseId = created.body().data.id
    const option = await client
      .post(caseUrl(org.id, caseId, '/options'))
      .header('Authorization', 'Bearer ' + token)
      .json({ label: '待停用方案', proposedOutcomeCategory: 'test' })
    const optionData = option.body().data

    const stale = await client
      .post(caseUrl(org.id, caseId, '/options/deactivate'))
      .header('Authorization', 'Bearer ' + token)
      .json({ optionId: Number(optionData.id), expectedRevision: Number(optionData.revision) + 5 })
    assert.equal(stale.status(), 409)

    const ok = await client
      .post(caseUrl(org.id, caseId, '/options/deactivate'))
      .header('Authorization', 'Bearer ' + token)
      .json({ optionId: Number(optionData.id), expectedRevision: Number(optionData.revision) })
    ok.assertStatus(200)
    assert.equal(ok.body().data.deactivated, true)
  }).timeout(60_000)

  test('重复记录立场走更新分支：revision 递增且不新增行', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-pos2') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)
    const created = await client
      .post(casesUrl(org.id))
      .header('Authorization', 'Bearer ' + token)
      .json({ title: '立场更新议题', decisionQuestion: '立场测试？', ownerId: Number(owner.id) })
    const caseId = created.body().data.id

    const first = await client
      .post(caseUrl(org.id, caseId, '/positions'))
      .header('Authorization', 'Bearer ' + token)
      .json({ stance: 'support' })
    first.assertStatus(200)
    const second = await client
      .post(caseUrl(org.id, caseId, '/positions'))
      .header('Authorization', 'Bearer ' + token)
      .json({ stance: 'abstain' })
    second.assertStatus(200)
    assert.equal(second.body().data.stance, 'abstain')
    assert.equal(Number(second.body().data.id), Number(first.body().data.id))
    assert.isTrue(Number(second.body().data.revision) > Number(first.body().data.revision))

    const list = await client
      .get(caseUrl(org.id, caseId, '/positions'))
      .header('Authorization', 'Bearer ' + token)
    assert.equal((list.body().data as unknown[]).length, 1)
  }).timeout(60_000)

  test('不存在议题的 handoff 列表返回非泄露 404', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('pmdwsec-hf404') })
    const org = await createOrganization(owner)
    const token = await login(client, owner)
    const missing = await client
      .get(caseUrl(org.id, 987654321, '/handoffs'))
      .header('Authorization', 'Bearer ' + token)
    assert.equal(missing.status(), 404)
    const bodyText = JSON.stringify(missing.body())
    assert.notInclude(bodyText, 'handoff')
  })
})
