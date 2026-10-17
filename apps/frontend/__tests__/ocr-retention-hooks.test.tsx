/**
 * OCR 保留治理——前端 Hooks 测试（v3-ocr-result-persistence-and-retention §7.3）
 *
 * 覆盖：
 * - 策略/状态读取
 * - 清理预览
 * - 清理执行（幂等响应）
 * - hold 设置/释放
 * - 权限错误
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/api-client'
import { ocrRetentionKeys } from '@/hooks/use-ocr-retention'
import {
  useOcrRetentionPolicy,
  useOcrRetentionStatus,
  useOcrAcceptedExtractionRetentionSummaries,
  useOcrRetentionHolds,
  useUpdateOcrRetentionPolicy,
  useOcrCleanupPreview,
  useOcrCleanupExecute,
  useSetOcrRetentionHold,
  useReleaseOcrRetentionHold,
} from '@/hooks/use-ocr-retention'

const mockFetch = vi.mocked(apiFetch)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

beforeEach(() => {
  mockFetch.mockReset()
})

// ── Query Keys ──

describe('ocrRetentionKeys', () => {
  it('produces stable policy key', () => {
    expect(ocrRetentionKeys.policy(10)).toEqual(['ocr-retention', 'policy', 10])
  })

  it('produces stable status key', () => {
    expect(ocrRetentionKeys.status(10)).toEqual(['ocr-retention', 'status', 10])
  })

  it('produces stable accepted-extractions key', () => {
    expect(ocrRetentionKeys.acceptedExtractions(10)).toEqual([
      'ocr-retention',
      'accepted-extractions',
      10,
    ])
  })

  it('produces stable holds key', () => {
    expect(ocrRetentionKeys.holds(10)).toEqual(['ocr-retention', 'holds', 10])
  })

  it('all key share common prefix', () => {
    expect(ocrRetentionKeys.all).toEqual(['ocr-retention'])
  })
})

// ── Policy Reads ──

describe('useOcrRetentionPolicy', () => {
  it('fetches policy on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      data: {
        source: 'system',
        organizationId: 1,
        projectId: 10,
        categories: [],
        bounds: { minDays: 1, maxDays: 3650 },
        policyHash: 'abc123',
        allowedActions: ['view_status'],
      },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrRetentionPolicy(10), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.data.policyHash).toBe('abc123')
  })

  it('disabled when projectId <= 0', () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrRetentionPolicy(0), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

// ── Status Reads ──

describe('useOcrRetentionStatus', () => {
  it('fetches status on mount', async () => {
    mockFetch.mockResolvedValueOnce({
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
        expiringSoon: 2,
        holdActiveCount: 1,
        allowedActions: ['view_status'],
      },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrRetentionStatus(10), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.data.expiringSoon).toBe(2)
  })
})

// ── Accepted Extraction Summaries ──

describe('useOcrAcceptedExtractionRetentionSummaries', () => {
  it('fetches accepted extraction summaries', async () => {
    mockFetch.mockResolvedValueOnce({
      data: [
        {
          extractionId: 501,
          lifecycleState: 'accepted',
          status: 'current',
          sourceHash: 'src',
          candidateHash: 'cnd',
          selectedTextHash: 'sel',
          reviewerId: 7,
          pageRefs: [1, 2],
          retentionDeadline: '2027-08-02T00:00:00.000Z',
          holdActive: false,
          textAvailable: true,
          tombstoneId: null,
          confirmedAt: '2026-08-02T00:00:00.000Z',
          supersededAt: null,
        },
      ],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrAcceptedExtractionRetentionSummaries(10), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.data.length).toBe(1)
    expect(result.current.data?.meta.total).toBe(1)
  })
})

// ── Cleanup Preview Mutation ──

describe('useOcrCleanupPreview', () => {
  it('mutates cleanup preview', async () => {
    mockFetch.mockResolvedValueOnce({
      data: {
        previewHash: 'deadbeef',
        policyHash: 'pol',
        generatedAt: '2026-08-02T00:00:00.000Z',
        eligible: [],
        blocked: [],
        plannedTombstones: 0,
        policyEvidence: { source: 'system', bounds: { minDays: 1, maxDays: 3650 } },
        truncated: false,
        requiresExplicitConfirmation: true,
      },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrCleanupPreview(10), { wrapper })
    const response = await result.current.mutateAsync({})
    expect(response.data.requiresExplicitConfirmation).toBe(true)
  })
})

// ── Cleanup Execute Mutation ──

describe('useOcrCleanupExecute', () => {
  it('executes cleanup with explicit confirmation', async () => {
    mockFetch.mockResolvedValueOnce({
      data: {
        runId: 9001,
        runKey: 'run-001',
        status: 'completed',
        previewHash: 'hash',
        policyHash: 'pol',
        expiredCount: 1,
        redactedCount: 0,
        purgedCount: 2,
        tombstoneCount: 2,
        blockedCount: 0,
        replayed: false,
        startedAt: '2026-08-02T00:00:00.000Z',
        completedAt: '2026-08-02T00:00:01.000Z',
        failureReason: null,
      },
    })
    const { wrapper, qc } = makeWrapper()
    const invSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useOcrCleanupExecute(10), { wrapper })
    const response = await result.current.mutateAsync({
      previewHash: 'hash',
      runKey: 'run-001',
      confirm: true,
    })
    expect(response.data.status).toBe('completed')
    // 成功后应失效状态和 extraction 缓存
    expect(invSpy).toHaveBeenCalled()
  })

  it('handles permission error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrCleanupExecute(10), { wrapper })
    try {
      await result.current.mutateAsync({ previewHash: 'h', runKey: 'r', confirm: true })
      // 不应到达这里
      expect.unreachable('Should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('PERMISSION_DENIED')
    }
  })
})

// ── Hold Mutations ──

describe('useSetOcrRetentionHold', () => {
  it('sets a hold', async () => {
    mockFetch.mockResolvedValueOnce({
      data: {
        holdId: 3001,
        organizationId: 1,
        projectId: 10,
        scopeKind: 'project',
        scopeHash: 'hash',
        reasonCode: 'review_in_progress',
        note: null,
        status: 'active',
        setBy: 7,
        setAt: '2026-08-02T00:00:00.000Z',
        releasedBy: null,
        releasedAt: null,
      },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetOcrRetentionHold(10), { wrapper })
    const response = await result.current.mutateAsync({
      scopeKind: 'project',
      scopeRef: 'project:10',
      reasonCode: 'review_in_progress',
    })
    expect(response.data.status).toBe('active')
  })
})

describe('useReleaseOcrRetentionHold', () => {
  it('releases a hold', async () => {
    mockFetch.mockResolvedValueOnce({
      data: {
        holdId: 3001,
        organizationId: 1,
        projectId: 10,
        scopeKind: 'project',
        scopeHash: 'hash',
        reasonCode: 'review_in_progress',
        note: null,
        status: 'released',
        setBy: 7,
        setAt: '2026-08-01T00:00:00.000Z',
        releasedBy: 7,
        releasedAt: '2026-08-02T00:00:00.000Z',
      },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useReleaseOcrRetentionHold(10), { wrapper })
    const response = await result.current.mutateAsync({ holdId: 3001 })
    expect(response.data.status).toBe('released')
  })
})

// ── Policy Update Mutation ──

describe('useUpdateOcrRetentionPolicy', () => {
  it('updates retention policy', async () => {
    mockFetch.mockResolvedValueOnce({
      data: {
        source: 'project',
        organizationId: 1,
        projectId: 10,
        categories: [{ category: 'candidate_text', retentionDays: 14, actionAfterExpiry: 'purge' }],
        bounds: { minDays: 1, maxDays: 3650 },
        policyHash: 'new_hash',
      },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateOcrRetentionPolicy(10), { wrapper })
    const response = await result.current.mutateAsync({
      categories: [{ category: 'candidate_text', retentionDays: 14, actionAfterExpiry: 'purge' }],
    })
    expect(response.data.policyHash).toBe('new_hash')
  })
})

// ── Holds Query ──

describe('useOcrRetentionHolds', () => {
  it('fetches holds list', async () => {
    mockFetch.mockResolvedValueOnce({
      data: [
        {
          holdId: 3001,
          organizationId: 1,
          projectId: 10,
          scopeKind: 'job',
          scopeHash: 'hash',
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
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrRetentionHolds(10), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.data.length).toBe(1)
    expect(result.current.data?.data[0]?.status).toBe('active')
  })
})

// ── Permission Errors ──

describe('Permission errors', () => {
  it('policy read permission denied does not crash', async () => {
    mockFetch.mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrRetentionPolicy(10), { wrapper })
    await waitFor(() => {
      const isError = result.current.isError
      if (isError) {
        expect(result.current.error.message).toBe('PERMISSION_DENIED')
      }
    })
  })

  it('hold set permission denied propagates error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('PERMISSION_DENIED'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useSetOcrRetentionHold(10), { wrapper })
    try {
      await result.current.mutateAsync({
        scopeKind: 'project',
        scopeRef: 'p:10',
        reasonCode: 'administrative',
      })
      expect.unreachable('Should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('PERMISSION_DENIED')
    }
  })
})

// ── Idempotent Replay ──

describe('Idempotent cleanup replay', () => {
  it('replayed cleanup returns replayed=true', async () => {
    mockFetch.mockResolvedValueOnce({
      data: {
        runId: 9001,
        runKey: 'run-001',
        status: 'completed',
        previewHash: 'hash',
        policyHash: 'pol',
        expiredCount: 1,
        redactedCount: 0,
        purgedCount: 2,
        tombstoneCount: 2,
        blockedCount: 0,
        replayed: true,
        startedAt: '2026-08-02T00:00:00.000Z',
        completedAt: '2026-08-02T00:00:01.000Z',
        failureReason: null,
      },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrCleanupExecute(10), { wrapper })
    const response = await result.current.mutateAsync({
      previewHash: 'hash',
      runKey: 'run-001',
      confirm: true,
    })
    expect(response.data.replayed).toBe(true)
  })
})
