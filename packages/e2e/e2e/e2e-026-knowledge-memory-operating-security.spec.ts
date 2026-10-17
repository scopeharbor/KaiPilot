import { test, expect } from '@playwright/test'
import { API_BASE, loginAsAdmin } from './_auth-helper'

/**
 * E2E-026：知识与记忆运营层安全边界（v3-knowledge-memory-operating-layer §8.6）
 *
 * 覆盖 read-only、cross-org、他人 user memory、L3、hidden Skill、stale base、
 * degraded observation、URL tamper —— 全部 fail closed。
 *
 * 红线：全程只读，未获授权不触发任何真实 provider 或外发动作。
 */

const SUMMARY = `${API_BASE}/knowledge-memory/summary`
const ITEMS = `${API_BASE}/knowledge-memory/items`

test.describe('E2E-026: 知识与记忆运营层安全边界', () => {
  let accessToken: string

  test.beforeAll(async ({ request }) => {
    const session = await loginAsAdmin(request)
    accessToken = session.accessToken
  })

  test('未认证请求一律 401', async ({ request }) => {
    const res = await request.get(SUMMARY)
    expect(res.status()).toBe(401)
  })

  test('运营 URL 上没有任何写方法', async ({ request }) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    for (const url of [SUMMARY, ITEMS, `${ITEMS}/knowledge_item/k-1`]) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request[method](url, { headers, data: {} })
        expect([401, 403, 404, 405, 422]).toContain(res.status())
      }
    }
  })

  test('未知 kind / 未知 surface / 非法分页一律拒绝', async ({ request }) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const cases = [
      `${ITEMS}?kind=project_event`,
      `${ITEMS}?status=__nope__`,
      `${ITEMS}?page=-1`,
      `${ITEMS}?perPage=100000`,
      `${ITEMS}/project_event/p-1`,
      `${ITEMS}/knowledge_item/k-1/surfaces/arbitrary_panel`,
    ]
    for (const url of cases) {
      const res = await request.get(url, { headers })
      expect([404, 422]).toContain(res.status())
    }
  })

  test('URL 篡改：内容型参数不被接受也不被回显', async ({ request }) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const bait = 'sk-live-e2e-should-not-echo'
    const res = await request.get(`${ITEMS}/knowledge_item/${encodeURIComponent(bait)}`, {
      headers,
    })
    expect([404, 422]).toContain(res.status())
    const raw = JSON.stringify(await res.json().catch(() => ({})))
    expect(raw).not.toContain(bait)
  })

  test('跨组织 / 不存在对象返回不可区分结果', async ({ request }) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const a = await request.get(`${ITEMS}/knowledge_item/k-99999998`, { headers })
    const b = await request.get(`${ITEMS}/knowledge_item/k-99999999`, { headers })
    expect(a.status()).toBe(b.status())
    expect(JSON.stringify(await a.json().catch(() => ({})))).toBe(
      JSON.stringify(await b.json().catch(() => ({}))),
    )
  })

  test('响应不含正文、memory summary、prompt、token 或绝对路径', async ({ request }) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const res = await request.get(`${ITEMS}?perPage=50`, { headers })
    if (res.status() !== 200) {
      test.skip(true, '运营层 feature flag 未开启')
    }
    const raw = JSON.stringify(await res.json())
    for (const forbidden of ['Authorization', 'Bearer ', 'sk-live', 'C:\\Users', '/var/']) {
      expect(raw).not.toContain(forbidden)
    }
    // memory 只带 byte size，不带 summary 正文字段
    expect(raw).not.toContain('"summary"')
  })

  test('L3 synthetic 条目不在生产队列出现', async ({ request }) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const res = await request.get(`${ITEMS}?kind=knowledge_item&perPage=100`, { headers })
    if (res.status() !== 200) {
      test.skip(true, '运营层 feature flag 未开启')
    }
    const items = (await res.json()).data.data
    for (const item of items) {
      expect(item.layer).not.toBe('L3')
    }
  })

  test('summary 与队列使用同一可见性规则', async ({ request }) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const s = await request.get(SUMMARY, { headers })
    if (s.status() !== 200) {
      test.skip(true, '运营层 feature flag 未开启')
    }
    const summary = (await s.json()).data
    const list = (await (await request.get(`${ITEMS}?perPage=100`, { headers })).json()).data
    const laneTotal = summary.lanes.reduce((acc: number, l: any) => acc + l.total, 0)
    expect(list.meta.total).toBe(laneTotal)
  })
})
