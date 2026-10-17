/**
 * Health Diagnosis — Hooks & API Client Tests
 *
 * v2-ai-project-health-diagnosis / 7.6
 *
 * 覆盖：API 函数构造、query keys 结构、mutation 函数触发
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  healthDiagnosisKeys,
  useLatestDiagnosis,
  useCreateDiagnosis,
  useDiagnosisList,
} from '@/lib/api/use-health-diagnosis'
import { getLatestDiagnosis, createDiagnosis, listDiagnoses } from '@/lib/api/health-diagnosis'
import type { HealthDiagnosis, HealthDiagnosisListItem } from '@aiproj/types'

vi.mock('@/lib/api/health-diagnosis', () => ({
  getLatestDiagnosis: vi.fn(),
  createDiagnosis: vi.fn(),
  listDiagnoses: vi.fn(),
  getDiagnosis: vi.fn(),
  refreshDiagnosis: vi.fn(),
  generateAiDraft: vi.fn(),
  confirmDiagnosis: vi.fn(),
  rejectDiagnosis: vi.fn(),
  confirmStaleDiagnosis: vi.fn(),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('healthDiagnosisKeys', () => {
  it('all key is stable', () => {
    expect(healthDiagnosisKeys.all).toEqual(['health-diagnoses'])
  })

  it('latest key includes project id', () => {
    expect(healthDiagnosisKeys.latest(42)).toEqual(['health-diagnoses', 'latest', 42])
  })

  it('list key includes project id and page', () => {
    expect(healthDiagnosisKeys.list(42, 1)).toEqual(['health-diagnoses', 'list', 42, 1])
  })

  it('detail key includes project id and diagnosis id', () => {
    expect(healthDiagnosisKeys.detail(42, 99)).toEqual(['health-diagnoses', 'detail', 42, 99])
  })
})

describe('useLatestDiagnosis', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when no diagnosis exists', async () => {
    vi.mocked(getLatestDiagnosis).mockResolvedValue(null)

    const { result } = renderHook(() => useLatestDiagnosis(1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('returns diagnosis when available', async () => {
    const mockDiagnosis: Partial<HealthDiagnosis> = {
      id: 1,
      status: 'confirmed',
      summary: null,
      aiDraft: null,
      warnings: [],
      stale: false,
      staleReason: null,
    }
    vi.mocked(getLatestDiagnosis).mockResolvedValue(mockDiagnosis as HealthDiagnosis)

    const { result } = renderHook(() => useLatestDiagnosis(1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe(1)
    expect(result.current.data?.status).toBe('confirmed')
  })

  it('not enabled when project id is missing', () => {
    const { result } = renderHook(() => useLatestDiagnosis(0), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useDiagnosisList', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns paginated list', async () => {
    const items: HealthDiagnosisListItem[] = [
      {
        id: 1,
        projectId: 1,
        status: 'confirmed',
        overallScore: 85,
        overallLabel: 'healthy',
        ruleVersion: '1.0',
        inputSignature: 'abc',
        stale: false,
        generatedBy: 1,
        generatedAt: '2026-07-15T00:00:00Z',
        confirmedBy: 1,
        confirmedAt: '2026-07-15T00:00:00Z',
        severity: 'ok',
      },
    ]
    vi.mocked(listDiagnoses).mockResolvedValue({
      data: items,
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })

    const { result } = renderHook(() => useDiagnosisList(1, 1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(1)
    expect(result.current.data?.meta.total).toBe(1)
  })
})

describe('useCreateDiagnosis mutation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createDiagnosis with project id', async () => {
    const mockResult: Partial<HealthDiagnosis> = { id: 1, status: 'pending' }
    vi.mocked(createDiagnosis).mockResolvedValue(mockResult as HealthDiagnosis)

    const { result } = renderHook(() => useCreateDiagnosis(1), { wrapper })
    result.current.mutate(undefined)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(createDiagnosis).toHaveBeenCalledWith(1, undefined)
  })
})
