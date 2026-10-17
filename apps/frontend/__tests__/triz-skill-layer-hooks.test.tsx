/**
 * TRIZ Skill Layer 前端 hooks 测试 (v3-triz-skill-layer-integration §4.10)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock API client
vi.mock('@/lib/api/triz-skill-layer', () => ({
  fetchTrizSkillLayerSummary: vi.fn(),
  fetchTrizSkillLayerDestinations: vi.fn(),
  postTrizSkillLayerRoutePreview: vi.fn(),
  postTrizSkillLayerHandoffPreview: vi.fn(),
}))

import {
  fetchTrizSkillLayerSummary,
  fetchTrizSkillLayerDestinations,
  postTrizSkillLayerRoutePreview,
  postTrizSkillLayerHandoffPreview,
} from '@/lib/api/triz-skill-layer'

import {
  useTrizSkillLayerSummary,
  useTrizSkillLayerDestinations,
  useTrizSkillLayerRoutePreview,
  useTrizSkillLayerHandoffPreview,
  trizSkillLayerKeys,
} from '@/hooks/use-triz-skill-layer'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const mockSummary = {
  data: {
    profiles: [],
    unavailableDestinations: [],
    activationSummary: {
      activeSkillKeys: [],
      advisorySkillKeys: [],
      activationEvidenceRefs: [],
      hasActiveActivations: false,
    },
    stageBindings: [],
    sourceSummaries: [],
    permissionSummary: {
      grantedPermissions: ['triz_skill_layer:view'],
      missingPermissions: [],
      canViewSummary: true,
      canViewDestinations: true,
      canRoutePreview: true,
      canHandoffPreview: true,
      denialWarnings: [],
    },
    featureFlagEnabled: true,
    auditRefs: [],
  },
}

const mockDestinations = {
  data: [],
  meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
}

describe('useTrizSkillLayerSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches summary when enabled', async () => {
    vi.mocked(fetchTrizSkillLayerSummary).mockResolvedValue(mockSummary)
    const { result } = renderHook(() => useTrizSkillLayerSummary('1', true), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockSummary)
    expect(fetchTrizSkillLayerSummary).toHaveBeenCalledWith('1')
  })

  it('does not fetch when disabled', () => {
    vi.mocked(fetchTrizSkillLayerSummary).mockResolvedValue(mockSummary)
    renderHook(() => useTrizSkillLayerSummary('1', false), {
      wrapper: createWrapper(),
    })
    expect(fetchTrizSkillLayerSummary).not.toHaveBeenCalled()
  })

  it('has stable query keys', () => {
    expect(trizSkillLayerKeys.summary('1')).toEqual(['triz-skill-layer', 'summary', '1'])
  })
})

describe('useTrizSkillLayerDestinations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches destinations when enabled', async () => {
    vi.mocked(fetchTrizSkillLayerDestinations).mockResolvedValue(mockDestinations)
    const { result } = renderHook(
      () => useTrizSkillLayerDestinations('1', { page: 1, perPage: 10 }, true),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockDestinations)
    expect(fetchTrizSkillLayerDestinations).toHaveBeenCalledWith('1', { page: 1, perPage: 10 })
  })

  it('does not fetch when disabled', () => {
    vi.mocked(fetchTrizSkillLayerDestinations).mockResolvedValue(mockDestinations)
    renderHook(() => useTrizSkillLayerDestinations('1', undefined, false), {
      wrapper: createWrapper(),
    })
    expect(fetchTrizSkillLayerDestinations).not.toHaveBeenCalled()
  })
})

describe('useTrizSkillLayerRoutePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls route preview API', async () => {
    const mockRouteResult = {
      data: {
        routes: [],
        warnings: [],
        idempotencyKey: 'test-key',
        generatedAt: '2026-01-01T00:00:00Z',
      },
    }
    vi.mocked(postTrizSkillLayerRoutePreview).mockResolvedValue(mockRouteResult)
    const { result } = renderHook(() => useTrizSkillLayerRoutePreview('1'), {
      wrapper: createWrapper(),
    })
    await result.current.mutateAsync({
      stageHint: 'solution_design',
      idempotencyKey: 'test-key',
    })
    expect(postTrizSkillLayerRoutePreview).toHaveBeenCalledWith('1', {
      stageHint: 'solution_design',
      idempotencyKey: 'test-key',
    })
  })
})

describe('useTrizSkillLayerHandoffPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls handoff preview API', async () => {
    const mockHandoffResult = {
      data: {
        destinationKey: 'contradiction_discovery' as const,
        targetModule: 'Contradiction Discovery',
        sourceRefs: [],
        sourceHashes: {},
        hashValidationPassed: true,
        stale: false,
        requiredPermissions: ['triz_contradiction:view'],
        actorId: 1,
        organizationId: 1,
        projectId: 1,
        idempotencyKey: 'test-key',
        previewOnly: true,
        requiresUserConfirmation: true,
        warnings: [],
        canNavigate: true,
      },
    }
    vi.mocked(postTrizSkillLayerHandoffPreview).mockResolvedValue(mockHandoffResult)
    const { result } = renderHook(() => useTrizSkillLayerHandoffPreview('1'), {
      wrapper: createWrapper(),
    })
    await result.current.mutateAsync({
      destinationKey: 'contradiction_discovery',
      actionId: 'action-001',
      idempotencyKey: 'test-key',
    })
    expect(postTrizSkillLayerHandoffPreview).toHaveBeenCalledWith('1', {
      destinationKey: 'contradiction_discovery',
      actionId: 'action-001',
      idempotencyKey: 'test-key',
    })
  })
})
