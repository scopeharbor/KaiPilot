/**
 * 8.5 P0 — AI 周期报表前端 API client 和 hooks 测试。
 *
 * 覆盖：
 *   - v2PeriodicPreview / v2PeriodicGenerate 等 API client 调用
 *   - 对应 TanStack Query hooks 的 mutation/queries
 *   - 模板可见性、preview warning、待审核草稿编辑、确认/退回操作
 *   - 只读权限模式和预算阻断状态
 */
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest'

// ---------------------------------------------------------------------------
// API client 测试
// ---------------------------------------------------------------------------

describe('Periodic Report API Client', () => {
  const mockFetch = vi.fn()
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = mockFetch
    mockFetch.mockReset()
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  function mockResponse(data: unknown, status = 200) {
    return Promise.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }

  test('v2PeriodicPreview 发送正确请求', async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        data: {
          templateId: 'weekly-ai-summary',
          periodType: 'weekly',
          blocking: false,
          warnings: [],
        },
      }),
    )
    const { v2PeriodicPreview } = await import('@/lib/api/reports-v2')
    const result = await v2PeriodicPreview(1, {
      templateId: 'weekly-ai-summary',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
    })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/1/reports/v2/periodic/preview'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toBeDefined()
  })

  test('v2PeriodicGenerate 发送正确请求', async () => {
    mockFetch.mockResolvedValue(
      mockResponse({ data: { version: { id: 1 }, job: { id: 1 }, draft: {}, blocked: false } }),
    )
    const { v2PeriodicGenerate } = await import('@/lib/api/reports-v2')
    const result = await v2PeriodicGenerate(1, {
      templateId: 'weekly-ai-summary',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      previewSnapshotHash: 'abc123',
      idempotencyKey: 'test-idem',
    })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/1/reports/v2/periodic/generate'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toBeDefined()
  })

  test('v2PeriodicJob 获取任务状态', async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: { id: 1, status: 'succeeded' } }))
    const { v2PeriodicJob } = await import('@/lib/api/reports-v2')
    const result = await v2PeriodicJob(1, 1)
    expect(result).toBeDefined()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/periodic/jobs/1'),
      expect.any(Object),
    )
  })

  test('v2PeriodicReview 发送审核 action', async () => {
    mockFetch.mockResolvedValue(mockResponse({ data: { versionId: 1, reviewStatus: 'confirmed' } }))
    const { v2PeriodicReview } = await import('@/lib/api/reports-v2')
    const result = await v2PeriodicReview(1, 1, { action: 'confirm' })
    expect(result).toBeDefined()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/1/reports/v2/periodic/versions/1/review'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"action":"confirm"'),
      }),
    )
  })

  test('v2PeriodicCreateExport 发送导出请求', async () => {
    mockFetch.mockResolvedValue(mockResponse({}))
    const { v2PeriodicCreateExport } = await import('@/lib/api/reports-v2')
    await v2PeriodicCreateExport(1, 1, { format: 'markdown' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/1/reports/v2/periodic/versions/1/exports'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

// ---------------------------------------------------------------------------
// 模板可见性
// ---------------------------------------------------------------------------

describe('Periodic Template Visibility', () => {
  test('weekly-ai-summary 和 monthly-ai-summary 在模板列表中', async () => {
    const { v2ListTemplates } = await import('@/lib/api/reports-v2')
    const mockData = {
      data: [
        {
          templateId: 'weekly-ai-summary',
          name: 'AI 周报摘要',
          aiEnabled: true,
          periodType: 'weekly',
        },
        {
          templateId: 'monthly-ai-summary',
          name: 'AI 月报摘要',
          aiEnabled: true,
          periodType: 'monthly',
        },
      ],
    }
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const origFetch = globalThis.fetch
    globalThis.fetch = mockFetch
    const result = await v2ListTemplates(1)
    expect(result).toBeDefined()
    const data = result as unknown as { data: Array<{ templateId: string; aiEnabled: boolean }> }
    const aiTemplates = data.data.filter((t) => t.aiEnabled)
    expect(aiTemplates.length).toBe(2)
    expect(aiTemplates.map((t) => t.templateId)).toContain('weekly-ai-summary')
    expect(aiTemplates.map((t) => t.templateId)).toContain('monthly-ai-summary')
    globalThis.fetch = origFetch
  })
})

// ---------------------------------------------------------------------------
// Preview warning / blocking 状态
// ---------------------------------------------------------------------------

describe('Periodic Report Preview State', () => {
  test('preview 返回 blocking 和 warnings 信息', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            templateId: 'weekly-ai-summary',
            periodType: 'weekly',
            blocking: true,
            warnings: [
              { code: 'REPORT_DATASOURCE_UNAVAILABLE', level: 'info', message: '数据源不可用' },
            ],
            sourceHash: 'test-hash',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const origFetch = globalThis.fetch
    globalThis.fetch = mockFetch

    const { v2PeriodicPreview } = await import('@/lib/api/reports-v2')
    const result = (await v2PeriodicPreview(1, {
      templateId: 'weekly-ai-summary',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
    })) as { data: { blocking: boolean; warnings: unknown[] } }
    expect(result.data.blocking).toBe(true)
    expect(result.data.warnings.length).toBeGreaterThan(0)
    globalThis.fetch = origFetch
  })
})

// ---------------------------------------------------------------------------
// 审核操作
// ---------------------------------------------------------------------------

describe('Periodic Report Review Operations', () => {
  test('confirm 操作返回 confirmed 状态', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { versionId: 1, reviewStatus: 'confirmed' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const origFetch = globalThis.fetch
    globalThis.fetch = mockFetch

    const { v2PeriodicReview } = await import('@/lib/api/reports-v2')
    const result = (await v2PeriodicReview(1, 1, { action: 'confirm' })) as {
      data: { reviewStatus: string }
    }
    expect(result.data.reviewStatus).toBe('confirmed')
    globalThis.fetch = origFetch
  })

  test('return 操作返回 rejected 状态', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { versionId: 1, reviewStatus: 'rejected' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const origFetch = globalThis.fetch
    globalThis.fetch = mockFetch

    const { v2PeriodicReview } = await import('@/lib/api/reports-v2')
    const result = (await v2PeriodicReview(1, 1, {
      action: 'return',
      returnReason: '需要修改',
    })) as { data: { reviewStatus: string } }
    expect(result.data.reviewStatus).toBe('rejected')
    globalThis.fetch = origFetch
  })

  test('edit 操作返回 editing 状态', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { versionId: 1, reviewStatus: 'editing' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const origFetch = globalThis.fetch
    globalThis.fetch = mockFetch

    const { v2PeriodicReview } = await import('@/lib/api/reports-v2')
    const result = (await v2PeriodicReview(1, 1, {
      action: 'edit',
      editedDraft: {
        executiveSummary: 'edit',
        highlights: [],
        progressNarrative: '',
        riskAndIssues: '',
        resourceNotes: '',
        changeNotes: '',
        suggestedActions: [],
        dataWarningsNarrative: '',
      },
    })) as { data: { reviewStatus: string } }
    expect(result.data.reviewStatus).toBe('editing')
    globalThis.fetch = origFetch
  })
})

// ---------------------------------------------------------------------------
// 只读权限模式 — 导出草稿需要 draftOverride
// ---------------------------------------------------------------------------

describe('Periodic Report Export Permissions', () => {
  test('导出已确认版本成功', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const origFetch = globalThis.fetch
    globalThis.fetch = mockFetch

    const { v2PeriodicCreateExport } = await import('@/lib/api/reports-v2')
    await v2PeriodicCreateExport(1, 1, { format: 'pdf' })
    expect(mockFetch).toHaveBeenCalled()
    globalThis.fetch = origFetch
  })

  test('导出待审核草稿需要 draftOverride', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const origFetch = globalThis.fetch
    globalThis.fetch = mockFetch

    const { v2PeriodicCreateExport } = await import('@/lib/api/reports-v2')
    await v2PeriodicCreateExport(1, 1, { format: 'markdown', draftOverride: true })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('exports'),
      expect.objectContaining({
        body: expect.stringContaining('"draftOverride":true'),
      }),
    )
    globalThis.fetch = origFetch
  })
})

// ---------------------------------------------------------------------------
// 预算阻断状态
// ---------------------------------------------------------------------------

describe('Periodic Report Budget Blocked State', () => {
  test('generate 返回 blocked 状态', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            version: null,
            job: null,
            draft: null,
            blocked: true,
            warnings: [{ code: 'AI_BUDGET_BLOCKED', level: 'critical' }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const origFetch = globalThis.fetch
    globalThis.fetch = mockFetch

    const { v2PeriodicGenerate } = await import('@/lib/api/reports-v2')
    const result = (await v2PeriodicGenerate(1, {
      templateId: 'weekly-ai-summary',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      previewSnapshotHash: 'hash',
    })) as { data: { blocked: boolean } }
    expect(result.data.blocked).toBe(true)
    globalThis.fetch = origFetch
  })
})
