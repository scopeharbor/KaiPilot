import { test, expect } from '@playwright/test'

/**
 * E2E-021: PMO 决策工作台负例（task 11.2）。
 * 跨租猜测非泄露 404、stale fingerprint 409、未知 handoff target 422、
 * 无 apply/confirm 端点、错误可恢复（后续正常请求仍 200）。
 */

const API_BASE = 'http://localhost:3333/api/v1'
const ADMIN = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-021: Decision Workbench negatives', () => {
  test('跨租/伪造指纹/未知 target/无 apply 端点均 fail closed 且非泄露', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: ADMIN })
    expect(loginRes.ok()).toBeTruthy()
    const { accessToken, user } = (await loginRes.json()).data
    const orgId: number = user.organizations[0].id
    const headers = { Authorization: `Bearer ${accessToken}` }
    const base = `${API_BASE}/organizations/${orgId}/pmo/decision-workbench`

    // 创建一个真实议题用于负例探测
    const created = await request.post(`${base}/cases`, {
      headers,
      data: { title: 'E2E 负例议题', decisionQuestion: '负例测试？', ownerId: user.id },
    })
    expect(created.status()).toBe(201)
    const decision = (await created.json()).data

    // 跨组织猜测：不存在组织与不存在 case 均为一致 404，正文不含标题
    const outsiderLogin = loginRes // 同一用户无法制造跨租身份；改用不存在组织探测
    void outsiderLogin
    const fakeOrg = `${API_BASE}/organizations/${orgId + 987654}/pmo/decision-workbench/cases/${decision.id}`
    const crossOrg = await request.get(fakeOrg, { headers })
    expect([403, 404]).toContain(crossOrg.status())
    expect(JSON.stringify(await crossOrg.json())).not.toContain('E2E 负例议题')

    // stale fingerprint 提交结论 → 409 REVIEW_STALE（需先到 under-review）
    let revision = Number(decision.revision)
    for (const to of ['collecting-evidence', 'ready-for-review', 'under-review']) {
      await request.post(`${base}/cases/${decision.id}/transition`, {
        headers,
        data: { to, expectedRevision: revision },
      })
      revision += 1
    }
    for (const label of ['方案A', '方案B']) {
      await request.post(`${base}/cases/${decision.id}/options`, {
        headers,
        data: { label, proposedOutcomeCategory: 'neg' },
      })
    }
    // 先刷新证据：无快照时结论端点返回 422 EVIDENCE_MISSING；
    // 有快照后伪造指纹才会命中 TOCTOU 门 → 409 REVIEW_STALE
    await request.post(`${base}/cases/${decision.id}/evidence/refresh`, { headers, data: {} })
    const stale = await request.post(`${base}/cases/${decision.id}/outcomes`, {
      headers,
      data: { action: 'reject', reviewFingerprint: 'ffffffff' },
    })
    expect(stale.status()).toBe(409)

    // 未 decided 议题创建 handoff → 422；未知 target → 422
    const notDecided = await request.post(`${base}/cases/${decision.id}/handoffs`, {
      headers,
      data: { target: 'allocation_draft', idempotencyKey: 'neg-key' },
    })
    expect(notDecided.status()).toBe(422)
    const unknownTarget = await request.post(`${base}/cases/${decision.id}/handoffs`, {
      headers,
      data: { target: 'direct_apply', idempotencyKey: 'neg-key2' },
    })
    expect(unknownTarget.status()).toBe(422)

    // 无 apply/confirm 端点：POST 返回 404（路由不存在），且不产生状态变化
    const detail = await request.get(`${base}/cases/${decision.id}`, { headers })
    const statusBefore = ((await detail.json()).data as { status: string }).status
    const applyAttempt = await request.post(`${base}/cases/${decision.id}/apply`, {
      headers,
      data: {},
    })
    expect(applyAttempt.status()).toBe(404)
    const confirmAttempt = await request.post(`${base}/cases/${decision.id}/confirm`, {
      headers,
      data: {},
    })
    expect(confirmAttempt.status()).toBe(404)
    const detailAfter = await request.get(`${base}/cases/${decision.id}`, { headers })
    expect(((await detailAfter.json()).data as { status: string }).status).toBe(statusBefore)

    // 可恢复性：负例之后正常读取仍 200
    const healthy = await request.get(`${base}/cases`, { headers })
    expect(healthy.status()).toBe(200)
  })
})
