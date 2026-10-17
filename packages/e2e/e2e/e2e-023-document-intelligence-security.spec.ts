import { test, expect } from '@playwright/test'
import { API_BASE, loginAsAdmin } from './_auth-helper'

/**
 * E2E-023：文档智能工作台安全边界（v3-document-intelligence-workbench §7.6）
 *
 * 覆盖 read-only、cross-org、hidden source、非法 deep-link tamper、
 * 无界查询与写方法旁路——全部 fail closed。
 *
 * 红线：全程只读，未获授权不触发任何真实 provider 或外发动作。
 */

test.describe('E2E-023: Document Intelligence Security Boundaries', () => {
  let accessToken: string
  let projectId: number | null = null

  test.beforeAll(async ({ request }) => {
    const session = await loginAsAdmin(request)
    accessToken = session.accessToken
    const orgId = session.currentOrganizationId
    const res = await request.get(`${API_BASE}/organizations/${orgId}/projects?perPage=5`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const projects = res.ok() ? ((await res.json()).data ?? []) : []
    projectId = projects[0]?.id ?? null
  })

  test('未认证请求一律 401', async ({ request }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const res = await request.get(`${API_BASE}/projects/${projectId}/document-intelligence/sources`)
    expect(res.status()).toBe(401)
  })

  test('跨组织 / 不存在项目返回同一非泄露结果', async ({ request }) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const missing = await request.get(
      `${API_BASE}/projects/99999999/document-intelligence/sources`,
      { headers },
    )
    expect([403, 404]).toContain(missing.status())
    const raw = JSON.stringify(await missing.json().catch(() => ({})))
    expect(raw).not.toContain('.pdf')
    expect(raw).not.toContain('latestJob')
    expect(raw).not.toContain('currentExtraction')
  })

  test('deep-link tamper：未知参数 / 非法枚举 / 负 ID / 无界页大小全部拒绝', async ({
    request,
  }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const headers = { Authorization: `Bearer ${accessToken}` }
    const base = `${API_BASE}/projects/${projectId}/document-intelligence/sources`

    for (const qs of [
      '?evilParam=1',
      '?attention=everything',
      '?perPage=100000',
      '?page=-3',
      '?sourceKind=../../etc/passwd',
      `?search=${encodeURIComponent('<script>alert(1)</script>')}`,
    ]) {
      const res = await request.get(`${base}${qs}`, { headers })
      expect(res.status(), `查询 ${qs} 应被拒绝`).toBe(422)
    }

    // 非法 sourceKind / 负 sourceId 的 deep link
    expect((await request.get(`${base}/evil_kind/1`, { headers })).status()).toBe(422)
    expect((await request.get(`${base}/attachment/-1`, { headers })).status()).toBe(422)
  })

  test('hidden / 不存在来源的 deep link fail closed 且不泄露存在性', async ({ request }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const headers = { Authorization: `Bearer ${accessToken}` }
    const base = `${API_BASE}/projects/${projectId}/document-intelligence/sources`

    const a = await request.get(`${base}/attachment/987654321`, { headers })
    const b = await request.get(`${base}/attachment/987654322`, { headers })
    expect(a.status()).toBe(404)
    expect(b.status()).toBe(404)
    expect(JSON.stringify(await a.json())).toBe(JSON.stringify(await b.json()))
  })

  test('工作台 URL 无写方法旁路', async ({ request }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const headers = { Authorization: `Bearer ${accessToken}` }
    const base = `${API_BASE}/projects/${projectId}/document-intelligence/sources`

    for (const call of [
      request.post(base, { headers, data: {} }),
      request.patch(base, { headers, data: {} }),
      request.delete(base, { headers }),
    ]) {
      const res = await call
      expect(res.status()).toBeGreaterThanOrEqual(400)
      expect(res.status()).not.toBe(200)
    }
  })

  test('响应不含全文、secret、token 或绝对路径', async ({ request }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const headers = { Authorization: `Bearer ${accessToken}` }
    const res = await request.get(
      `${API_BASE}/projects/${projectId}/document-intelligence/sources?perPage=20`,
      { headers },
    )
    expect(res.status()).toBe(200)
    const raw = JSON.stringify(await res.json())
    for (const forbidden of [
      'Authorization',
      'Bearer ',
      'sk-',
      'api_key',
      'apiKey',
      'selectedText',
      'searchableText',
      'candidateText',
      'C:\\',
      '/var/lib/',
    ]) {
      expect(raw, `响应不得包含 ${forbidden}`).not.toContain(forbidden)
    }
  })
})
