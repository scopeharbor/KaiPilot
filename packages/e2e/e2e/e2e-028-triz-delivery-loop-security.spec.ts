import { test, expect } from '@playwright/test'
import { API_BASE, loginAsAdmin } from './_auth-helper'

/**
 * E2E-028：TRIZ 到交付闭环 负例与 fail-closed 边界（v3-triz-to-delivery-closed-loop §11.10）。
 *
 * 覆盖：未认证 401、读端点禁写方法、伪造指纹 409、evidence 越界 422、
 * 取消 preview 零写入（不产生 link）、plugin 降级不阻塞核心读取面。
 * 跨租/权限非泄露、automation deny 由 japa 层（triz_delivery_loop_api/e2e/isolation）
 * 覆盖，此处不重复。
 *
 * feature flag 关闭时整组跳过；不依赖真实 provider / 外发动作。
 */

test.describe('E2E-028: TRIZ 交付闭环 安全负例', () => {
  let session: Awaited<ReturnType<typeof loginAsAdmin>>
  let token: string
  let orgId: number
  let enabled = false
  let projectId = 0
  let taskId = ''
  let decisionLogId = ''

  test.beforeAll(async ({ request }) => {
    session = await loginAsAdmin(request)
    token = session.accessToken
    orgId = session.currentOrganizationId
    const headers = { Authorization: `Bearer ${token}` }
    const stamp = Date.now().toString(36)

    const created = await request.post(`${API_BASE}/organizations/${orgId}/projects`, {
      headers,
      data: { name: `E2E-028 负例项目 ${stamp}`, status: 'active', priority: 'medium' },
    })
    expect([200, 201]).toContain(created.status())
    projectId = Number(((await created.json()).data ?? {}).id)

    const probe = await request.get(
      `${API_BASE}/projects/${projectId}/triz/delivery-loop/summary`,
      { headers },
    )
    enabled = probe.status() === 200
    if (!enabled) return

    const task = await request.post(`${API_BASE}/projects/${projectId}/tasks`, {
      headers,
      data: { name: `E2E-028 任务 ${stamp}`, startDate: '2026-08-01', status: 'completed' },
    })
    expect(task.status()).toBe(201)
    taskId = String(((await task.json()).data ?? {}).id)

    const decision = await request.post(`${API_BASE}/projects/${projectId}/triz-decision-logs`, {
      headers,
      data: {
        decisionType: 'adopt',
        subjectRefs: [
          {
            kind: 'analysis_artifact',
            id: `artifact-${stamp}`,
            version: '1',
            summaryLevel: 'low',
            visibility: 'internal',
          },
        ],
        sourceRefs: [{ kind: 'contradiction', id: `contra-${stamp}`, hash: `hash-${stamp}` }],
        artifactHashes: [],
        reasonSummary: 'E2E-028 负例决策',
      },
    })
    expect(
      decision.status(),
      `decision create body: ${JSON.stringify(await decision.json())}`,
    ).toBe(201)
    const body = await decision.json()
    decisionLogId = String(body.data?.decisionLogId ?? body.data?.id ?? '')
  })

  test('未认证请求一律 401', async ({ request }) => {
    test.skip(!enabled, '交付闭环 feature flag 未开启')
    const res = await request.get(`${API_BASE}/projects/${projectId}/triz/delivery-loop/summary`)
    expect(res.status()).toBe(401)
  })

  test('只读端点不得接受写方法', async ({ request }) => {
    test.skip(!enabled, '交付闭环 feature flag 未开启')
    const headers = { Authorization: `Bearer ${token}` }
    const urls = [
      `${API_BASE}/projects/${projectId}/triz/delivery-loop/summary`,
      `${API_BASE}/projects/${projectId}/triz/delivery-loop/items`,
    ]
    for (const url of urls) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request[method](url, { headers, data: {} })
        expect([401, 403, 404, 405, 422]).toContain(res.status())
      }
    }
  })

  test('取消 preview（不 confirm）零写入：不产生任何 link 行', async ({ request }) => {
    test.skip(!enabled, '交付闭环 feature flag 未开启')
    const headers = { Authorization: `Bearer ${token}` }
    const base = `${API_BASE}/projects/${projectId}/triz/delivery-loop`

    const preview = await request.post(`${base}/links/preview`, {
      headers,
      data: {
        decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: taskId }],
      },
    })
    expect(preview.status()).toBe(200)
    // 不调用 confirm —— 取消路径
    const items = await request.get(`${base}/items?perPage=100`, { headers })
    const list = ((await items.json()).data ?? []) as Array<{ decisionLogId: string }>
    expect(list.find((i) => i.decisionLogId === decisionLogId)).toBeFalsy()
  })

  test('伪造 link confirm 指纹 → 409；evidence 越界 → 422；伪造验证指纹 → 409', async ({
    request,
  }) => {
    test.skip(!enabled, '交付闭环 feature flag 未开启')
    const headers = { Authorization: `Bearer ${token}` }
    const base = `${API_BASE}/projects/${projectId}/triz/delivery-loop`

    const forgedConfirm = await request.post(`${base}/links/confirm`, {
      headers,
      data: {
        decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: taskId }],
        previewFingerprint: 'e2e-forged-preview-fp',
        confirmation: { acknowledgedOnlyLinkWrite: true, requestedAt: new Date().toISOString() },
      },
    })
    expect([409, 422]).toContain(forgedConfirm.status())

    // 正常 preview 建立真实指纹，再在 verification 上伪造指纹
    const preview = await request.post(`${base}/links/preview`, {
      headers,
      data: {
        decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: taskId }],
      },
    })
    const previewData = (await preview.json()).data
    const confirm = await request.post(`${base}/links/confirm`, {
      headers,
      data: {
        decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: taskId }],
        previewFingerprint: previewData.previewFingerprint,
        confirmation: { acknowledgedOnlyLinkWrite: true, requestedAt: new Date().toISOString() },
      },
    })
    expect(confirm.status()).toBe(200)
    const itemId = String((await confirm.json()).data.itemId ?? (await confirm.json()).data.linkId)

    const forgedVerify = await request.post(
      `${base}/items/${encodeURIComponent(`link-${itemId}`)}/verifications`,
      {
        headers,
        data: {
          conclusion: 'effective',
          observationWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' },
          evidenceRefs: [],
          verificationFingerprint: 'e2e-forged-verify-fp',
        },
      },
    )
    expect([409, 422]).toContain(forgedVerify.status())

    const overflow = await request.post(
      `${base}/items/${encodeURIComponent(`link-${itemId}`)}/verifications`,
      {
        headers,
        data: {
          conclusion: 'effective',
          observationWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' },
          evidenceRefs: Array.from({ length: 21 }, (_, i) => `doc:${i}`),
          verificationFingerprint: 'e2e-forged-verify-fp',
        },
      },
    )
    expect(overflow.status()).toBe(422)
  })

  test('插件/advisory 降级不阻塞核心读取面（summary/items 仍可用）', async ({ request }) => {
    test.skip(!enabled, '交付闭环 feature flag 未开启')
    const headers = { Authorization: `Bearer ${token}` }
    const base = `${API_BASE}/projects/${projectId}/triz/delivery-loop`
    // advisory 从未接入真实插件/模型：默认 fallback 不产生 provider/network 调用。
    // 核心闭环读取（本 change 唯一生产入口）不受 advisory 区影响。
    const summary = await request.get(`${base}/summary`, { headers })
    const items = await request.get(`${base}/items?perPage=5`, { headers })
    expect(summary.status()).toBe(200)
    expect(items.status()).toBe(200)
    const s = await summary.json()
    expect(s).toHaveProperty('data')
    expect(typeof s.data.totals === 'object' || typeof s.data.visibleItemCount === 'number').toBe(
      true,
    )
  })
})
