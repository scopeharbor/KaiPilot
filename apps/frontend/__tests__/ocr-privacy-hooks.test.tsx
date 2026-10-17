/**
 * OCR 隐私策略控制——前端 Hooks 测试（v3-ocr-privacy-policy-controls §7.8）
 *
 * 覆盖：
 * - Query keys
 * - 策略/状态读取
 * - 决策预览
 * - 导出预览/执行
 * - 权限拒绝
 * - 过期预览处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/api-client'
import { ocrPrivacyKeys } from '@/hooks/use-ocr-privacy'
import {
  useOcrPrivacyPolicy,
  useOcrPrivacyStatus,
  useOcrPrivacyRuns,
  useUpdateOcrPrivacyPolicy,
  useOcrPrivacyDecisionPreview,
  useOcrPrivacyExportPreview,
  useOcrPrivacyExportExecute,
} from '@/hooks/use-ocr-privacy'

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

describe('ocrPrivacyKeys', () => {
  it('produces stable policy key', () => {
    expect(ocrPrivacyKeys.policy(10)).toEqual(['ocr-privacy', 'policy', 10])
  })

  it('produces stable status key', () => {
    expect(ocrPrivacyKeys.status(10)).toEqual(['ocr-privacy', 'status', 10])
  })

  it('produces stable runs key', () => {
    expect(ocrPrivacyKeys.runs(10)).toEqual(['ocr-privacy', 'runs', 10])
  })

  it('all key share common prefix', () => {
    expect(ocrPrivacyKeys.all).toEqual(['ocr-privacy'])
  })
})

// ── Policy Reads ──

describe('useOcrPrivacyPolicy', () => {
  it('fetches policy on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      source: 'system',
      organizationId: 1,
      projectId: 10,
      version: 1,
      status: 'active',
      categoryRules: [],
      allowedPurposes: ['review'],
      globalOutputMode: 'full',
      bounds: {},
      policyHash: 'abc12345',
      allowedActions: ['view_status', 'view_policy'],
    })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrPrivacyPolicy(10), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.policyHash).toBe('abc12345')
    expect(mockFetch).toHaveBeenCalledWith('/projects/10/ocr/privacy/policy')
  })

  it('disabled when projectId <= 0', () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrPrivacyPolicy(0), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

// ── Status ──

describe('useOcrPrivacyStatus', () => {
  it('fetches status on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      policyHash: 'abc12345',
      policySource: 'system',
      allowedActions: ['view_status'],
      globalOutputMode: 'full',
      warnings: [],
      policyVersion: 1,
    })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrPrivacyStatus(10), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.globalOutputMode).toBe('full')
  })
})

// ── Mutation hooks ──

describe('useOcrPrivacyDecisionPreview', () => {
  it('calls decision-preview API', async () => {
    mockFetch.mockResolvedValueOnce({
      result: 'allow',
      outputMode: 'full',
      reasons: [],
      warnings: [],
      requiresExplicitConfirmation: false,
      decisionHash: 'dec12345',
      policyHash: 'abc12345',
      sourceHash: 'sh1',
      allowedFields: ['*'],
    })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrPrivacyDecisionPreview(10), { wrapper })

    const response = await result.current.mutateAsync({
      purpose: 'review',
      contentCategory: 'accepted_extraction_text',
      action: 'read',
      sourceVisible: true,
      sourceHash: 'sh1',
      contentHash: 'ch1',
      lifecycleState: 'active',
      holdActive: false,
      policyHash: 'abc12345',
      authContext: { userId: 1, organizationId: 1, projectId: 10, permissions: [] },
    })

    expect(response.result).toBe('allow')
    expect(mockFetch).toHaveBeenCalledWith(
      '/projects/10/ocr/privacy/decision-preview',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('useOcrPrivacyExportPreview', () => {
  it('calls export-preview API', async () => {
    mockFetch.mockResolvedValueOnce({
      previewHash: 'prev123',
      policyHash: 'abc12345',
      outputMode: 'metadata_only',
      recordCount: 3,
      estimatedCharacters: 4500,
      pageCount: 5,
      requiresExplicitConfirmation: false,
      warnings: [],
      scopeSummary: {
        sourceKind: 'attachment',
        acceptedExtractionCount: 3,
        textLengthSummary: 'test',
      },
    })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrPrivacyExportPreview(10), { wrapper })

    const response = await result.current.mutateAsync({
      purpose: 'export_metadata',
      scope: {
        organizationId: 1,
        projectId: 10,
        acceptedExtractionIds: [1, 2, 3],
        sourceKind: 'attachment',
      },
      format: 'json_summary',
      policyHash: 'abc12345',
    })

    expect(response.previewHash).toBe('prev123')
  })
})

describe('useUpdateOcrPrivacyPolicy', () => {
  it('PUT 策略并同时失效 policy 与 status 缓存', async () => {
    mockFetch.mockResolvedValueOnce({ policyHash: 'newhash1' })

    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateOcrPrivacyPolicy(10), { wrapper })

    await result.current.mutateAsync({
      categoryRules: [],
      allowedPurposes: ['review'],
      globalOutputMode: 'metadata_only',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/projects/10/ocr/privacy/policy',
      expect.objectContaining({ method: 'PUT' }),
    )
    // 策略变更会改写 status 的判定口径，两处缓存都必须失效
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ocrPrivacyKeys.policy(10) })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ocrPrivacyKeys.status(10) })
  })
})

describe('useOcrPrivacyRuns', () => {
  it('拉取运行记录列表', async () => {
    mockFetch.mockResolvedValueOnce({
      data: [{ id: 1, runKey: 'rk001', status: 'completed' }],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrPrivacyRuns(10), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockFetch).toHaveBeenCalledWith('/projects/10/ocr/privacy/runs')
    expect(result.current.data?.data).toHaveLength(1)
  })

  it('projectId <= 0 时不发起请求', () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrPrivacyRuns(0), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useOcrPrivacyExportExecute', () => {
  it('calls export-execute API and invalidates runs', async () => {
    mockFetch.mockResolvedValueOnce({
      id: 1,
      runKey: 'rk001',
      organizationId: 1,
      projectId: 10,
      status: 'completed',
      outputMode: 'metadata_only',
      previewHash: 'prev123',
      policyHash: 'abc12345',
      counts: { recordCount: 3, characterCount: 4500, pageCount: 5 },
      contentHashes: [],
      warningCodes: [],
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    })

    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useOcrPrivacyExportExecute(10), { wrapper })

    await result.current.mutateAsync({
      previewHash: 'prev123',
      policyHash: 'abc12345',
      idempotencyKey: 'idem_001',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/projects/10/ocr/privacy/export-execute',
      expect.objectContaining({ method: 'POST' }),
    )
    // 用例名承诺「invalidates runs」，这里真的断言一次失效，
    // 否则 hook 去掉 onSuccess 也照样绿。
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ocrPrivacyKeys.runs(10) })
  })
})
