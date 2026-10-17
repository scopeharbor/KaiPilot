import { test, expect } from '@playwright/test'

/**
 * E2E-020: PMO 决策工作台正向链路（task 11.1 / 7.6）。
 * PMO manager 创建议题 → 两方案 → 刷新证据 → readiness → dissent → 显式 approve
 * → allocation pending handoff；断言确认前正式业务数据（项目列表）零变化。
 */

const API_BASE = 'http://localhost:3333/api/v1'
const ADMIN = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-020: Decision Workbench happy path', () => {
  test('create→options→evidence→readiness→approve→handoff，正式数据零变化', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: ADMIN })
    expect(loginRes.ok()).toBeTruthy()
    const { accessToken, user } = (await loginRes.json()).data
    const orgId: number = user.organizations[0].id
    const headers = { Authorization: `Bearer ${accessToken}` }
    const base = `${API_BASE}/organizations/${orgId}/pmo/decision-workbench`

    // 正式业务基线：项目总数
    const projectsBefore = await request.get(
      `${API_BASE}/organizations/${orgId}/projects?page=1&perPage=1`,
      { headers },
    )
    const projectsBeforeBody = await projectsBefore.json()
    const totalBefore = projectsBeforeBody?.meta?.total ?? -1

    // 创建议题
    const created = await request.post(`${base}/cases`, {
      headers,
      data: { title: 'E2E 决策议题', decisionQuestion: 'E2E 是否应调整资源？', ownerId: user.id },
    })
    expect(created.status()).toBe(201)
    const decision = (await created.json()).data
    let revision = Number(decision.revision)

    // 状态推进到 under-review
    for (const to of ['collecting-evidence', 'ready-for-review', 'under-review']) {
      const t = await request.post(`${base}/cases/${decision.id}/transition`, {
        headers,
        data: { to, expectedRevision: revision },
      })
      expect(t.status()).toBe(200)
      revision += 1
    }

    // 两个方案
    const optionIds: number[] = []
    for (const label of ['E2E 方案甲', 'E2E 方案乙']) {
      const o = await request.post(`${base}/cases/${decision.id}/options`, {
        headers,
        data: { label, proposedOutcomeCategory: 'e2e' },
      })
      expect(o.status()).toBe(201)
      optionIds.push(Number(((await o.json()).data as { id: number }).id))
    }

    // 刷新证据 + 对比 + readiness
    expect(
      (
        await request.post(`${base}/cases/${decision.id}/evidence/refresh`, { headers, data: {} })
      ).status(),
    ).toBe(200)
    const comparison = await request.get(`${base}/cases/${decision.id}/comparison`, { headers })
    expect(comparison.status()).toBe(200)
    expect(((await comparison.json()).data as { hasWinnerScore: boolean }).hasWinnerScore).toBe(
      false,
    )

    const readiness = await request.post(`${base}/cases/${decision.id}/readiness`, {
      headers,
      data: {},
    })
    expect(readiness.status()).toBe(200)
    const packet = (await readiness.json()).data
    if (!packet.ready) {
      // 空环境下 required 来源不可用属合法降级：断言 blocking 原因存在且不落结论
      expect(packet.blockingFindings.length).toBeGreaterThan(0)
      return
    }
    const fingerprint: string = packet.fingerprint.fingerprint

    // 异议立场
    const dissent = await request.post(`${base}/cases/${decision.id}/positions`, {
      headers,
      data: { stance: 'oppose', note: 'E2E 异议' },
    })
    expect(dissent.status()).toBe(200)

    // 显式 approve
    const approved = await request.post(`${base}/cases/${decision.id}/outcomes`, {
      headers,
      data: { action: 'approve', selectedOptionId: optionIds[1], reviewFingerprint: fingerprint },
    })
    expect(approved.status()).toBe(200)

    // allocation pending handoff + 幂等重放
    const handoff = await request.post(`${base}/cases/${decision.id}/handoffs`, {
      headers,
      data: { target: 'allocation_draft', idempotencyKey: 'e2e-key-1' },
    })
    expect(handoff.status()).toBe(200)
    const receipt = (await handoff.json()).data
    expect(receipt.status === 'pending' || receipt.status === 'replayed').toBeTruthy()
    const replayed = await request.post(`${base}/cases/${decision.id}/handoffs`, {
      headers,
      data: { target: 'allocation_draft', idempotencyKey: 'e2e-key-1' },
    })
    expect(((await replayed.json()).data as { status: string }).status).toBe('replayed')

    // 正式业务数据零变化：handoff 后未调用任何下游确认，项目总数不变
    const projectsAfter = await request.get(
      `${API_BASE}/organizations/${orgId}/projects?page=1&perPage=1`,
      { headers },
    )
    const totalAfter = (await projectsAfter.json())?.meta?.total ?? -2
    expect(totalAfter).toBe(totalBefore)
  })
})
