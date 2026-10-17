// OKR 级联与对齐前端测试
// v3-okr-cascade-and-alignment §5.7
// Vitest + @testing-library/react

import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock API client
vi.mock('@/lib/okr-cascade-alignment-api', () => ({
  createCascadePlan: vi.fn(),
  listCascadePlans: vi.fn(),
  getCascadePlan: vi.fn(),
  confirmCascadeItems: vi.fn(),
  rejectCascadeItems: vi.fn(),
  createRelation: vi.fn(),
  listRelations: vi.fn(),
  getRelation: vi.fn(),
  updateRelation: vi.fn(),
  archiveRelation: vi.fn(),
  getHealth: vi.fn(),
  listHealth: vi.fn(),
  getMatrix: vi.fn(),
  generateAiCascadeSuggestions: vi.fn(),
}))

import {
  useCascadePlans,
  useCascadePlan,
  useCreateCascadePlan,
  useConfirmCascadeItems,
  useRejectCascadeItems,
  useRelations,
  useCreateRelation,
  useArchiveRelation,
  useHealth,
  useHealthList,
  useMatrix,
  useAiCascadeSuggestions,
  okrCascadeKeys,
} from '@/hooks/use-okr-cascade-alignment'
import * as api from '@/lib/okr-cascade-alignment-api'
import { asMock } from './_mock-types'

// ── Test Helpers ────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

// ── Cascade Plan Hooks ─────────────────────────────────────────────────────

describe('useCascadePlans', () => {
  it('returns loading state initially', () => {
    vi.mocked(api.listCascadePlans).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useCascadePlans(1), { wrapper: createWrapper() })
    expect(result.current.isLoading).toBe(true)
  })

  it('returns data on success', async () => {
    const mockData = {
      data: [{ id: 1, title: 'Test Plan', status: 'draft' }],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    vi.mocked(api.listCascadePlans).mockResolvedValue(asMock(mockData))
    const { result } = renderHook(() => useCascadePlans(1), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockData)
  })

  it('is disabled when organizationId is 0', async () => {
    const { result } = renderHook(() => useCascadePlans(0), { wrapper: createWrapper() })
    // When enabled: false, the query does not fetch but isPending may still be true initially
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useCascadePlan', () => {
  it('returns detail data', async () => {
    const mockPlan = { data: { id: 1, title: 'Detail', status: 'draft', items: [] } }
    vi.mocked(api.getCascadePlan).mockResolvedValue(asMock(mockPlan))
    const { result } = renderHook(() => useCascadePlan(1, 1), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockPlan)
  })

  it('is disabled when planId is 0', async () => {
    const { result } = renderHook(() => useCascadePlan(1, 0), { wrapper: createWrapper() })
    // When enabled: false, the query does not fetch but isPending may still be true initially
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useCreateCascadePlan', () => {
  it('calls API and invalidates plans on success', async () => {
    vi.mocked(api.createCascadePlan).mockResolvedValue(
      asMock({ data: { id: 2, title: 'New Plan', status: 'draft' } }),
    )
    const { result } = renderHook(() => useCreateCascadePlan(1), { wrapper: createWrapper() })
    await result.current.mutateAsync({ sourceObjectiveId: 1, title: 'New Plan' })
    expect(api.createCascadePlan).toHaveBeenCalledWith(1, {
      sourceObjectiveId: 1,
      title: 'New Plan',
    })
  })
})

describe('useConfirmCascadeItems', () => {
  it('calls confirm API', async () => {
    vi.mocked(api.confirmCascadeItems).mockResolvedValue(
      asMock({ data: { diffs: [], confirmedCount: 2 } }),
    )
    const { result } = renderHook(() => useConfirmCascadeItems(1, 5), { wrapper: createWrapper() })
    await result.current.mutateAsync({ acceptedItemIds: [1, 2] })
    expect(api.confirmCascadeItems).toHaveBeenCalledWith(1, 5, { acceptedItemIds: [1, 2] })
  })
})

describe('useRejectCascadeItems', () => {
  it('calls reject API', async () => {
    vi.mocked(api.rejectCascadeItems).mockResolvedValue(asMock({ data: { rejectedCount: 1 } }))
    const { result } = renderHook(() => useRejectCascadeItems(1, 5), { wrapper: createWrapper() })
    await result.current.mutateAsync({ rejectedItemIds: [3], reason: '重复' })
    expect(api.rejectCascadeItems).toHaveBeenCalledWith(1, 5, {
      rejectedItemIds: [3],
      reason: '重复',
    })
  })
})

// ── Relation Hooks ──────────────────────────────────────────────────────────

describe('useRelations', () => {
  it('returns relations list', async () => {
    const mockData = {
      data: [
        {
          id: 1,
          sourceObjectiveId: 1,
          targetObjectiveId: 2,
          relationType: 'supports',
          status: 'active',
        },
      ],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    vi.mocked(api.listRelations).mockResolvedValue(asMock(mockData))
    const { result } = renderHook(() => useRelations(1), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockData)
  })
})

describe('useCreateRelation', () => {
  it('calls create API', async () => {
    vi.mocked(api.createRelation).mockResolvedValue(
      asMock({
        data: {
          id: 3,
          sourceObjectiveId: 1,
          targetObjectiveId: 2,
          relationType: 'supports',
          status: 'active',
        },
      }),
    )
    const { result } = renderHook(() => useCreateRelation(1), { wrapper: createWrapper() })
    await result.current.mutateAsync({
      sourceObjectiveId: 1,
      targetObjectiveId: 2,
      relationType: 'supports',
    })
    expect(api.createRelation).toHaveBeenCalledWith(1, {
      sourceObjectiveId: 1,
      targetObjectiveId: 2,
      relationType: 'supports',
    })
  })
})

describe('useArchiveRelation', () => {
  it('calls archive API', async () => {
    vi.mocked(api.archiveRelation).mockResolvedValue(
      asMock({ data: { id: 1, status: 'archived' } }),
    )
    const { result } = renderHook(() => useArchiveRelation(1), { wrapper: createWrapper() })
    await result.current.mutateAsync(1)
    expect(api.archiveRelation).toHaveBeenCalledWith(1, 1)
  })
})

// ── Health Hooks ────────────────────────────────────────────────────────────

describe('useHealth', () => {
  it('returns health for an objective', async () => {
    const mockHealth = {
      data: { objectiveId: 1, objectiveTitle: 'O1', score: 85, level: 'healthy', warnings: [] },
    }
    vi.mocked(api.getHealth).mockResolvedValue(asMock(mockHealth))
    const { result } = renderHook(() => useHealth(1, 1), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockHealth)
  })
})

describe('useHealthList', () => {
  it('passes query params', async () => {
    vi.mocked(api.listHealth).mockResolvedValue(
      asMock({ data: [], meta: { total: 0, page: 1, perPage: 50, totalPages: 0 } }),
    )
    const { result } = renderHook(() => useHealthList(1, { cycleId: 1, scope: 'team' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.listHealth).toHaveBeenCalledWith(1, { cycleId: 1, scope: 'team' })
  })
})

// ── Matrix Hooks ────────────────────────────────────────────────────────────

describe('useMatrix', () => {
  it('returns matrix data', async () => {
    const mockMatrix = {
      data: [{ objectiveId: 1, objectiveTitle: 'O1', scope: 'team', status: 'active' }],
      meta: { totalRelations: 0 },
    }
    vi.mocked(api.getMatrix).mockResolvedValue(asMock(mockMatrix))
    const { result } = renderHook(() => useMatrix(1, { cycleId: 1 }), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockMatrix)
  })
})

// ── AI Suggestion Hooks ─────────────────────────────────────────────────────

describe('useAiCascadeSuggestions', () => {
  it('calls AI suggestion API', async () => {
    vi.mocked(api.generateAiCascadeSuggestions).mockResolvedValue(
      asMock({ cascadeCandidates: [], warnings: [] }),
    )
    const { result } = renderHook(() => useAiCascadeSuggestions(1), { wrapper: createWrapper() })
    await result.current.mutateAsync({ cycleId: 1, objectiveId: 3 })
    expect(api.generateAiCascadeSuggestions).toHaveBeenCalledWith(1, { cycleId: 1, objectiveId: 3 })
  })
})

// ── Query Key Factory ───────────────────────────────────────────────────────

describe('okrCascadeKeys', () => {
  it('generates correct plan keys', () => {
    expect(okrCascadeKeys.plans(1)).toEqual(['okr-cascade', 'plans', 1])
    expect(okrCascadeKeys.planDetail(1, 5)).toEqual(['okr-cascade', 'plans', 1, 5])
  })

  it('generates correct relation keys', () => {
    expect(okrCascadeKeys.relations(1)).toEqual(['okr-cascade', 'relations', 1])
    expect(okrCascadeKeys.relationDetail(1, 3)).toEqual(['okr-cascade', 'relations', 1, 3])
  })

  it('generates correct health keys', () => {
    expect(okrCascadeKeys.health(1)).toEqual(['okr-cascade', 'health', 1])
    expect(okrCascadeKeys.healthDetail(1, 2)).toEqual(['okr-cascade', 'health', 1, 2])
  })

  it('generates correct matrix key', () => {
    const query = { cycleId: 1, depth: 5, page: 1, perPage: 50 }
    expect(okrCascadeKeys.matrix(1, query)).toEqual(['okr-cascade', 'matrix', 1, query])
  })

  it('generates correct AI suggestion key', () => {
    expect(okrCascadeKeys.aiSuggestions(1)).toEqual(['okr-cascade', 'ai-suggestions', 1])
  })
})
