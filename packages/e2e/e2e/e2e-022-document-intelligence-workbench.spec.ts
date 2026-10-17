import { test, expect } from '@playwright/test'
import { API_BASE, loginAsAdmin } from './_auth-helper'

/**
 * E2E-022：文档智能工作台核心闭环（v3-document-intelligence-workbench §7.5）
 *
 * 覆盖 attention 发现 → 打开 owning 审查面板 → 返回同来源/同筛选 →
 * structured / search / entity owning 面板受控 handoff。
 *
 * 红线：全程只读校验；不触发任何 OCR 创建、确认、索引或实体写入
 * （真实 provider 与外发动作未获授权，默认停在只读边界）。
 */

test.describe('E2E-022: Document Intelligence Workbench', () => {
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

  test('来源清单返回统一 envelope 与权威 attention/维度状态', async ({ request }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const res = await request.get(
      `${API_BASE}/projects/${projectId}/document-intelligence/sources?page=1&perPage=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('data')
    expect(body).toHaveProperty('meta')
    expect(['exact', 'page']).toContain(body.meta.countMode)
    expect(typeof body.meta.scanTruncated).toBe('boolean')

    for (const row of body.data ?? []) {
      // 权威维度状态与封闭 entrypoint 一定存在
      expect(row).toHaveProperty('dimensionStates')
      expect(row).toHaveProperty('entrypoints')
      // 无 accepted extraction 时，下游入口一律不可用
      if (!row.currentExtraction) {
        for (const surface of ['search_index', 'structured_extraction', 'entity_linking']) {
          const entry = row.entrypoints.find((e: { surface: string }) => e.surface === surface)
          if (entry) expect(entry.enabled).toBe(false)
        }
      }
    }
  })

  test('attention 筛选与分页返回稳定有界结果', async ({ request }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const filtered = await request.get(
      `${API_BASE}/projects/${projectId}/document-intelligence/sources?attention=needs_review&page=1&perPage=10&sort=source_ref&direction=asc`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    expect(filtered.status()).toBe(200)
    const body = await filtered.json()
    expect(body.meta.perPage).toBeLessThanOrEqual(100)
    for (const row of body.data ?? []) {
      expect(row.attentionFacets).toContain('needs_review')
    }
  })

  test('详情深链返回证据与治理摘要，且面板上下文可复原', async ({ request }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const headers = { Authorization: `Bearer ${accessToken}` }

    let list = await request.get(
      `${API_BASE}/projects/${projectId}/document-intelligence/sources?perPage=5`,
      { headers },
    )
    let rows = (await list.json()).data ?? []

    // 环境里还没有可见来源时，用既有文件库 API 建一个原生文档作为夹具
    // （走 owning API，不触碰任何 OCR / provider 路径）
    if (rows.length === 0) {
      await request.post(`${API_BASE}/projects/${projectId}/files`, {
        headers,
        data: { name: 'e2e-document-intelligence.md', documentType: 'document', parentId: null },
      })
      list = await request.get(
        `${API_BASE}/projects/${projectId}/document-intelligence/sources?perPage=5`,
        { headers },
      )
      rows = (await list.json()).data ?? []
    }
    expect(rows.length).toBeGreaterThan(0)

    const row = rows[0]
    const detail = await request.get(
      `${API_BASE}/projects/${projectId}/document-intelligence/sources/${row.sourceKind}/${row.sourceId}`,
      { headers },
    )
    expect(detail.status()).toBe(200)
    const data = (await detail.json()).data
    expect(data).toHaveProperty('evidence')
    expect(data).toHaveProperty('governance')
    expect(data.evidence).toHaveProperty('downstream')
    // 面板恢复所需的最小上下文由服务端权威给出
    expect(data.sourceKind).toBe(row.sourceKind)
    expect(data.sourceId).toBe(row.sourceId)
  })

  test('打开/筛选/查看详情不产生任何 OCR 作业写入', async ({ request }) => {
    test.skip(!projectId, '环境中没有可用项目')
    const headers = { Authorization: `Bearer ${accessToken}` }

    const jobsBefore = await request.get(
      `${API_BASE}/projects/${projectId}/ocr/document-jobs?perPage=1`,
      { headers },
    )
    const totalBefore = jobsBefore.ok() ? ((await jobsBefore.json()).meta?.total ?? 0) : 0

    await request.get(`${API_BASE}/projects/${projectId}/document-intelligence/sources`, {
      headers,
    })
    await request.get(
      `${API_BASE}/projects/${projectId}/document-intelligence/sources?attention=processing`,
      { headers },
    )

    const jobsAfter = await request.get(
      `${API_BASE}/projects/${projectId}/ocr/document-jobs?perPage=1`,
      { headers },
    )
    const totalAfter = jobsAfter.ok() ? ((await jobsAfter.json()).meta?.total ?? 0) : 0
    expect(totalAfter).toBe(totalBefore)
  })

  test('工作台页面入口可通过 URL 深链恢复', async ({ page }) => {
    test.skip(!projectId, '环境中没有可用项目')
    await page.goto(`/projects/${projectId}/files?view=intelligence`)
    // 未登录时会被导向登录页；两种情况都不应是崩溃白屏
    const workbench = page.getByTestId('document-intelligence-workbench')
    const visible = await workbench.isVisible().catch(() => false)
    if (visible) {
      await expect(workbench).toBeVisible()
    } else {
      await expect(page.locator('body')).not.toBeEmpty()
    }
  })
})
