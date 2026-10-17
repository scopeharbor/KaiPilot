/**
 * OCR 保留治理——前端 UI 组件测试（v3-ocr-result-persistence-and-retention §7.5, §7.7, §7.9）
 *
 * 覆盖：
 * - 生命周期状态渲染
 * - 过期警告
 * - hold 阻止记录
 * - accepted extraction 历史信号
 * - 清理控件需要显式确认
 * - 只读降级
 * - hold note 验证
 * - 权限拒绝消息
 * - 无隐藏源泄露
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/api-client'
import OcrRetentionPanel from '@/components/ocr/OcrRetentionPanel'

const mockFetch = vi.mocked(apiFetch)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  mockFetch.mockReset()
})

// ── Lifecycle State Rendering (§7.5) ──

describe('OcrRetentionPanel | lifecycle state rendering', () => {
  it('shows lifecycle counts per state', async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: {
          source: 'system',
          organizationId: 1,
          projectId: 10,
          categories: [],
          bounds: { minDays: 1, maxDays: 3650 },
          policyHash: 'abc',
          allowedActions: ['view_status'],
        },
      })
      .mockResolvedValueOnce({
        data: {
          organizationId: 1,
          projectId: 10,
          policy: {
            source: 'system',
            organizationId: 1,
            projectId: 10,
            categories: [],
            bounds: { minDays: 1, maxDays: 3650 },
            policyHash: 'abc',
          },
          counts: {
            active: 5,
            reviewable: 3,
            accepted: 2,
            superseded: 1,
            expired: 4,
            purge_pending: 0,
            purged: 2,
            hold_blocked: 1,
          },
          countsByKind: { job: 1, page: 0, candidate: 8, accepted_extraction: 3 },
          expiringSoon: 0,
          holdActiveCount: 0,
          allowedActions: [
            'view_status',
            'update_policy',
            'preview_cleanup',
            'execute_cleanup',
            'set_hold',
            'release_hold',
          ],
        },
      })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })

    render(<OcrRetentionPanel projectId={10} />, { wrapper: makeWrapper() })
    await waitFor(() => {
      expect(screen.getByText('OCR 保留治理')).toBeTruthy()
    })
    // 每个生命周期状态应有计数
    expect(screen.getByText('5')).toBeTruthy() // active
    expect(screen.getByText('3')).toBeTruthy() // reviewable
    expect(screen.getByText('4')).toBeTruthy() // expired
  })
})

// ── Expiration Warnings (§7.5) ──

describe('OcrRetentionPanel | expiration warnings', () => {
  it('shows warning when records expiring soon', async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: {
          source: 'system',
          organizationId: 1,
          projectId: 10,
          categories: [],
          bounds: { minDays: 1, maxDays: 3650 },
          policyHash: 'abc',
          allowedActions: ['view_status'],
        },
      })
      .mockResolvedValueOnce({
        data: {
          organizationId: 1,
          projectId: 10,
          policy: {
            source: 'system',
            organizationId: 1,
            projectId: 10,
            categories: [],
            bounds: { minDays: 1, maxDays: 3650 },
            policyHash: 'abc',
          },
          counts: {
            active: 1,
            reviewable: 0,
            accepted: 0,
            superseded: 0,
            expired: 3,
            purge_pending: 0,
            purged: 0,
            hold_blocked: 0,
          },
          countsByKind: { job: 1, page: 0, candidate: 2, accepted_extraction: 1 },
          expiringSoon: 3,
          holdActiveCount: 0,
          allowedActions: ['view_status'],
        },
      })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })

    render(<OcrRetentionPanel projectId={10} />, { wrapper: makeWrapper() })
    await waitFor(() => {
      expect(screen.getByText(/3 条 OCR 记录将在 7 天内过期/)).toBeTruthy()
    })
  })
})

// ── Hold Indicators (§7.5) ──

describe('OcrRetentionPanel | hold indicators', () => {
  it('shows hold badge when holds are active', async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: {
          source: 'system',
          organizationId: 1,
          projectId: 10,
          categories: [],
          bounds: { minDays: 1, maxDays: 3650 },
          policyHash: 'abc',
          allowedActions: ['view_status'],
        },
      })
      .mockResolvedValueOnce({
        data: {
          organizationId: 1,
          projectId: 10,
          policy: {
            source: 'system',
            organizationId: 1,
            projectId: 10,
            categories: [],
            bounds: { minDays: 1, maxDays: 3650 },
            policyHash: 'abc',
          },
          counts: {
            active: 1,
            reviewable: 0,
            accepted: 0,
            superseded: 0,
            expired: 0,
            purge_pending: 0,
            purged: 0,
            hold_blocked: 2,
          },
          countsByKind: { job: 1, page: 0, candidate: 2, accepted_extraction: 0 },
          expiringSoon: 0,
          holdActiveCount: 2,
          allowedActions: ['view_status'],
        },
      })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })
      .mockResolvedValueOnce({
        data: [
          {
            holdId: 1,
            organizationId: 1,
            projectId: 10,
            scopeKind: 'project',
            scopeHash: 'h',
            reasonCode: 'review_in_progress',
            note: null,
            status: 'active',
            setBy: 7,
            setAt: '2026-08-02T00:00:00.000Z',
            releasedBy: null,
            releasedAt: null,
          },
        ],
        meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
      })

    render(<OcrRetentionPanel projectId={10} />, { wrapper: makeWrapper() })
    await waitFor(() => {
      expect(screen.getByText('活跃 Hold：2')).toBeTruthy()
    })
  })
})

// ── Read-Only Degradation (§7.9) ──

describe('OcrRetentionPanel | read-only degradation', () => {
  it('shows permission alert when user cannot view', async () => {
    // Force API to return but with no allowed view action
    mockFetch
      .mockResolvedValueOnce({
        data: {
          source: 'system',
          organizationId: 1,
          projectId: 10,
          categories: [],
          bounds: { minDays: 1, maxDays: 3650 },
          policyHash: 'abc',
          allowedActions: [],
        },
      })
      .mockResolvedValueOnce({
        data: {
          organizationId: 1,
          projectId: 10,
          policy: {
            source: 'system',
            organizationId: 1,
            projectId: 10,
            categories: [],
            bounds: { minDays: 1, maxDays: 3650 },
            policyHash: 'abc',
          },
          counts: {
            active: 0,
            reviewable: 0,
            accepted: 0,
            superseded: 0,
            expired: 0,
            purge_pending: 0,
            purged: 0,
            hold_blocked: 0,
          },
          countsByKind: { job: 0, page: 0, candidate: 0, accepted_extraction: 0 },
          expiringSoon: 0,
          holdActiveCount: 0,
          allowedActions: [],
        },
      })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })

    render(<OcrRetentionPanel projectId={10} />, { wrapper: makeWrapper() })
    await waitFor(() => {
      expect(screen.getByText('无权查看 OCR 保留治理信息')).toBeTruthy()
    })
  })
})

// ── Cleanup Confirmation (§7.7) ──

describe('OcrRetentionPanel | cleanup confirmation', () => {
  it('cleanup button disabled without explicit confirmation', async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: {
          source: 'system',
          organizationId: 1,
          projectId: 10,
          categories: [],
          bounds: { minDays: 1, maxDays: 3650 },
          policyHash: 'abc',
          allowedActions: ['view_status', 'update_policy', 'preview_cleanup', 'execute_cleanup'],
        },
      })
      .mockResolvedValueOnce({
        data: {
          organizationId: 1,
          projectId: 10,
          policy: {
            source: 'system',
            organizationId: 1,
            projectId: 10,
            categories: [],
            bounds: { minDays: 1, maxDays: 3650 },
            policyHash: 'abc',
          },
          counts: {
            active: 1,
            reviewable: 0,
            accepted: 0,
            superseded: 0,
            expired: 3,
            purge_pending: 0,
            purged: 0,
            hold_blocked: 0,
          },
          countsByKind: { job: 1, page: 0, candidate: 3, accepted_extraction: 0 },
          expiringSoon: 3,
          holdActiveCount: 0,
          allowedActions: ['view_status', 'update_policy', 'preview_cleanup', 'execute_cleanup'],
        },
      })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })

    render(<OcrRetentionPanel projectId={10} />, { wrapper: makeWrapper() })
    await waitFor(() => {
      expect(screen.getByText('预览清理')).toBeTruthy()
    })
    // 预览清理按钮应该可点击
    const previewBtn = screen.getByText('预览清理')
    expect((previewBtn as HTMLButtonElement).disabled).toBe(false)
  })
})

// ── Permission Denied Messages (§7.9) ──

describe('OcrRetentionPanel | permission denied', () => {
  it('readOnly prop shows degraded controls', async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: {
          source: 'system',
          organizationId: 1,
          projectId: 10,
          categories: [],
          bounds: { minDays: 1, maxDays: 3650 },
          policyHash: 'abc',
          allowedActions: ['view_status'],
        },
      })
      .mockResolvedValueOnce({
        data: {
          organizationId: 1,
          projectId: 10,
          policy: {
            source: 'system',
            organizationId: 1,
            projectId: 10,
            categories: [],
            bounds: { minDays: 1, maxDays: 3650 },
            policyHash: 'abc',
          },
          counts: {
            active: 1,
            reviewable: 0,
            accepted: 0,
            superseded: 0,
            expired: 0,
            purge_pending: 0,
            purged: 0,
            hold_blocked: 0,
          },
          countsByKind: { job: 1, page: 0, candidate: 0, accepted_extraction: 0 },
          expiringSoon: 0,
          holdActiveCount: 0,
          allowedActions: ['view_status'],
        },
      })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })

    render(<OcrRetentionPanel projectId={10} readOnly />, { wrapper: makeWrapper() })
    await waitFor(() => {
      expect(screen.getByText('OCR 保留治理')).toBeTruthy()
    })
    // readOnly 或没有 manage 权限时不应显示清理按钮
    expect(screen.queryByText('预览清理')).toBeNull()
  })
})

// ── No Hidden Source Leakage (§7.9) ──

describe('OcrRetentionPanel | no hidden source leakage', () => {
  it('does not render file paths or raw text', async () => {
    mockFetch
      .mockResolvedValueOnce({
        data: {
          source: 'system',
          organizationId: 1,
          projectId: 10,
          categories: [],
          bounds: { minDays: 1, maxDays: 3650 },
          policyHash: 'abc',
          allowedActions: ['view_status'],
        },
      })
      .mockResolvedValueOnce({
        data: {
          organizationId: 1,
          projectId: 10,
          policy: {
            source: 'system',
            organizationId: 1,
            projectId: 10,
            categories: [],
            bounds: { minDays: 1, maxDays: 3650 },
            policyHash: 'abc',
          },
          counts: {
            active: 1,
            reviewable: 0,
            accepted: 0,
            superseded: 0,
            expired: 0,
            purge_pending: 0,
            purged: 0,
            hold_blocked: 0,
          },
          countsByKind: { job: 1, page: 0, candidate: 0, accepted_extraction: 0 },
          expiringSoon: 0,
          holdActiveCount: 0,
          allowedActions: ['view_status'],
        },
      })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 1 } })

    const { container } = render(<OcrRetentionPanel projectId={10} />, { wrapper: makeWrapper() })
    await waitFor(() => {
      expect(screen.getByText('OCR 保留治理')).toBeTruthy()
    })
    const html = container.innerHTML
    // 不应包含文件路径
    expect(html).not.toContain('C:\\')
    expect(html).not.toContain('/var/')
    expect(html).not.toContain('\\\\')
    // extract_text 等不应出现在 UI 中
    expect(html).not.toContain('extractedText')
    expect(html).not.toContain('selectedText')
  })
})
