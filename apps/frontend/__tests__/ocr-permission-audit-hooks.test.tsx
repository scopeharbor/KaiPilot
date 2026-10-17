/**
 * OCR 权限/审计——前端 Hooks 测试（v3-ocr-permission-and-audit §7.3）
 *
 * 覆盖：
 * - 权限状态读取（成功 / denied）
 * - 决策预览 mutation + 状态失效
 * - 审计摘要分页
 * - 不信任 client-side 权限（所有判定来自服务端）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/api-client'
import { ocrPermissionAuditKeys } from '@/hooks/use-ocr-permission-audit'
import {
  useOcrPermissionStatus,
  useOcrDecisionPreview,
  useOcrAuditSummaries,
} from '@/hooks/use-ocr-permission-audit'

const mockFetch = vi.mocked(apiFetch)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

const STATUS_FIXTURE = {
  data: {
    projectRef: { type: 'project' as const, id: 1 },
    sourceRef: null,
    artifactRef: null,
    sourceHash: null,
    lifecycleState: 'active',
    retentionState: 'none',
    staleStatus: 'current',
    outputMode: 'full',
    allowedActions: ['metadata_read', 'review_confirm'],
    blockedActions: [],
    decisionHashes: ['h1', 'h2'],
    warnings: [],
    statusHash: 'sh1',
  },
}

const DENIED_STATUS_FIXTURE = {
  data: {
    ...STATUS_FIXTURE.data,
    outputMode: 'blocked',
    allowedActions: [],
    blockedActions: [
      { action: 'review_confirm', reasonCodes: ['permission_missing'], decisionHash: 'h-deny' },
    ],
    statusHash: 'sh-deny',
  },
}

beforeEach(() => {
  mockFetch.mockReset()
})

// ── Query Keys ──

describe('ocrPermissionAuditKeys', () => {
  it('produces stable status key', () => {
    expect(ocrPermissionAuditKeys.status(10)).toEqual(['ocr-permission-audit', 'status', 10, null])
  })

  it('status key includes query when provided', () => {
    const key = ocrPermissionAuditKeys.status(10, { sourceRefId: 5 })
    expect(key).toEqual(['ocr-permission-audit', 'status', 10, { sourceRefId: 5 }])
  })

  it('produces stable audit-summaries key', () => {
    const key = ocrPermissionAuditKeys.auditSummaries(10, { page: 1, perPage: 20 })
    expect(key).toEqual(['ocr-permission-audit', 'audit-summaries', 10, { page: 1, perPage: 20 }])
  })

  it('all key shares common prefix', () => {
    expect(ocrPermissionAuditKeys.all).toEqual(['ocr-permission-audit'])
  })
})

// ── 权限状态 ──

describe('useOcrPermissionStatus', () => {
  it('reads status from server', async () => {
    mockFetch.mockResolvedValueOnce(STATUS_FIXTURE)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrPermissionStatus(1), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.allowedActions).toContain('review_confirm')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/1/ocr/permission-audit/status'),
    )
  })

  it('denied status surfaces blocked actions', async () => {
    mockFetch.mockResolvedValueOnce(DENIED_STATUS_FIXTURE)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrPermissionStatus(1), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.allowedActions).toHaveLength(0)
    expect(result.current.data?.data.blockedActions[0]?.reasonCodes).toContain('permission_missing')
  })
})

// ── 决策预览 ──

describe('useOcrDecisionPreview', () => {
  it('calls preview endpoint and invalidates status on success', async () => {
    mockFetch.mockResolvedValueOnce({
      data: {
        action: 'review_confirm',
        result: 'confirm_required',
        requiresConfirmation: true,
        outputMode: 'full',
        reasonCodes: ['confirmation_required'],
        decisionHash: 'dp1',
      },
    })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useOcrDecisionPreview(1), { wrapper })

    result.current.mutate({ action: 'review_confirm' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/1/ocr/permission-audit/decision-preview'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(invalidateSpy).toHaveBeenCalled()
  })
})

// ── 审计摘要 ──

describe('useOcrAuditSummaries', () => {
  it('paginates audit summaries', async () => {
    mockFetch.mockResolvedValueOnce({
      data: [
        {
          id: 1,
          event: 'ocr.permission.denial',
          action: 'review_confirm',
          result: 'denied',
          reasonCodes: ['permission_missing'],
          actorRef: { type: 'user', id: 2 },
          projectRef: { type: 'project', id: 1 },
          sourceRef: null,
          artifactRef: null,
          sourceHash: null,
          contentHash: null,
          decisionHash: 'h1',
          createdAt: '2026-08-03T10:00:00Z',
          metadata: {},
        },
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrAuditSummaries(1, { page: 1, perPage: 20 }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(1)
    expect(result.current.data?.meta.total).toBe(1)
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('page=1'))
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('perPage=20'))
  })
})
