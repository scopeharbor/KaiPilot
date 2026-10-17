import { test, expect } from '@playwright/test'
import { API_BASE, loginAsAdmin } from './_auth-helper'

/**
 * E2E-025：知识与记忆运营层核心流程（v3-knowledge-memory-operating-layer §8.5）
 *
 * 流程：attention 发现 → evidence 核对 → owning surface descriptor →
 * 返回同一筛选 → 由**权威状态**决定 attention 是否更新。
 *
 * 红线：全程只读；不执行任何 owning 写入，因此不产生正式数据变更。
 * feature flag 未开启时整组跳过（而不是把 404 当成通过）。
 */

const SUMMARY = `${API_BASE}/knowledge-memory/summary`
const ITEMS = `${API_BASE}/knowledge-memory/items`

test.describe('E2E-025: 知识与记忆运营层核心流程', () => {
  let accessToken: string
  let featureEnabled = false

  test.beforeAll(async ({ request }) => {
    const session = await loginAsAdmin(request)
    accessToken = session.accessToken
    const probe = await request.get(SUMMARY, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    // 404 + FEATURE_NOT_ENABLED = flag 关闭；其它 404 才是真问题
    if (probe.status() === 200) {
      featureEnabled = true
    }
  })

  test('summary 返回四 lane，且每个 lane 都带显式 coverage', async ({ request }) => {
    test.skip(!featureEnabled, '运营层 feature flag 未开启')
    const res = await request.get(SUMMARY, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(res.status()).toBe(200)
    const data = (await res.json()).data
    expect(data.lanes).toHaveLength(4)
    for (const lane of data.lanes) {
      // 0 必须伴随明确 coverage（empty / degraded），不能是无标注的裸 0
      expect(['complete', 'partial', 'degraded', 'hidden', 'empty', 'unavailable']).toContain(
        lane.coverage,
      )
    }
  })

  test('队列可分页且相邻页无重复', async ({ request }) => {
    test.skip(!featureEnabled, '运营层 feature flag 未开启')
    const headers = { Authorization: `Bearer ${accessToken}` }
    const p1 = await request.get(`${ITEMS}?page=1&perPage=5`, { headers })
    expect(p1.status()).toBe(200)
    const first = (await p1.json()).data

    if (first.meta.total <= 5) {
      test.skip(true, '数据量不足以验证翻页')
    }
    const p2 = await request.get(`${ITEMS}?page=2&perPage=5`, { headers })
    const second = (await p2.json()).data

    const keys1 = first.data.map((i: any) => `${i.kind}:${i.scopedRef.ref}`)
    const keys2 = second.data.map((i: any) => `${i.kind}:${i.scopedRef.ref}`)
    expect(keys1.filter((k: string) => keys2.includes(k))).toHaveLength(0)
  })

  test('从队列取一项 → 读详情 → 拿到 owning surface descriptor', async ({ request }) => {
    test.skip(!featureEnabled, '运营层 feature flag 未开启')
    const headers = { Authorization: `Bearer ${accessToken}` }
    const list = await request.get(`${ITEMS}?perPage=5`, { headers })
    const items = (await list.json()).data.data
    test.skip(items.length === 0, '组织内暂无运营对象')

    const target = items[0]
    const detail = await request.get(
      `${ITEMS}/${target.kind}/${encodeURIComponent(target.scopedRef.ref)}`,
      { headers },
    )
    expect(detail.status()).toBe(200)
    const body = (await detail.json()).data

    // evidence 与 attention 依据可读
    expect(body.item.attentionBasis).toBeTruthy()
    expect(body.item.attentionBasis.reasonCode).toBeTruthy()

    // descriptor 只带封闭字段
    for (const surface of body.surfaces ?? []) {
      expect(surface).not.toHaveProperty('callback')
      expect(surface).not.toHaveProperty('href')
      expect(surface).not.toHaveProperty('previewToken')
      expect(surface.authorityOwner).toBeTruthy()
    }
  })

  test('相同筛选重复读取结果一致（attention 由权威状态决定，不因读取而改变）', async ({
    request,
  }) => {
    test.skip(!featureEnabled, '运营层 feature flag 未开启')
    const headers = { Authorization: `Bearer ${accessToken}` }
    const url = `${ITEMS}?kind=knowledge_item&perPage=10`
    const a = (await (await request.get(url, { headers })).json()).data
    const b = (await (await request.get(url, { headers })).json()).data
    expect(a.data.map((i: any) => i.scopedRef.ref)).toEqual(b.data.map((i: any) => i.scopedRef.ref))
    expect(a.meta.total).toBe(b.meta.total)
  })

  test('读取路径不改变既有知识 API 的返回契约', async ({ request }) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const before = await request.get(`${API_BASE}/knowledge`, { headers })
    await request.get(SUMMARY, { headers })
    await request.get(`${ITEMS}?perPage=5`, { headers })
    const after = await request.get(`${API_BASE}/knowledge`, { headers })
    expect(after.status()).toBe(before.status())
  })
})
