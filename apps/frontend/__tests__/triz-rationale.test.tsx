'use client'

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPermissions = vi.hoisted(() => ({ value: {} as Record<string, boolean> }))

// Mock the API module
vi.mock('@/lib/api/triz-rationale', () => ({
  trizRationaleApi: {
    detail: vi.fn(),
    feedback: vi.fn(),
    handoff: vi.fn(),
    dashboardSummary: vi.fn(),
  },
  trizRationaleKeys: {
    all: ['triz-rationale'],
    detail: (pid: number, tt: string, ti: string) => ['triz-rationale', 'detail', pid, tt, ti],
    dashboardSummary: (pid: number) => ['triz-rationale', 'dashboard', pid],
  },
}))

// Mock usePermissions
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    can: vi.fn((perm: string) => {
      return mockPermissions.value[perm] ?? true
    }),
  }),
}))

import { TrizRationalePanel } from '@/components/ai-copilot/TrizRationalePanel'
import { trizRationaleApi } from '@/lib/api/triz-rationale'
import type { TrizRecommendationRationale } from '@aiproj/types'

const detailMock = vi.mocked(trizRationaleApi.detail)

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const mockRationale: TrizRecommendationRationale = {
  id: 'contradiction_c1',
  organizationId: 1,
  projectId: 1,
  sourceType: 'contradiction',
  sourceRefs: [
    { sourceType: 'contradiction', id: 'c1', hash: 'abc123', summary: '工期与成本矛盾' },
  ],
  sourceHashes: ['abc123'],
  contradictionSummary: '工期与成本矛盾',
  parameterTensions: [
    {
      improvingParameter: 'duration',
      improvingParameterName: '工期',
      worseningParameter: 'cost',
      worseningParameterName: '成本',
      severity: 'high',
    },
  ],
  principleMappings: [
    {
      principleId: 'P1',
      principleName: '分割原理',
      rationale: '将工期拆分为多个阶段',
      relevance: 'high',
      applicability: '适用于分阶段交付',
      nonApplicability: '不适用于一次性交付项目',
    },
  ],
  evidenceRefs: [{ label: 'parameter', description: '工期数据', sourceHash: 'abc123' }],
  validationSummary: {
    status: 'passed',
    antiHallucinationPassed: true,
    sourceRefsValid: true,
    warnings: [],
  },
  warningSummary: null,
  aiMetadata: null,
  costSummary: null,
  deterministicSummary: '基于 TRIZ 矛盾分析，识别出 1 个参数冲突',
  aiExplanationDraft: null,
  fallbackSummary: null,
  availableSections: [
    'source_summary',
    'parameter_tensions',
    'principle_mapping',
    'evidence_chain',
    'feedback',
    'handoff',
  ],
  humanReviewRequirement: null,
  handoffState: null,
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrizRationalePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPermissions.value = { 'rationale:view': true }
    detailMock.mockResolvedValue(mockRationale)
  })

  it('renders loading state initially', () => {
    detailMock.mockReturnValue(new Promise(() => {})) // never resolves
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    expect(screen.getByRole('status')).toBeDefined()
  })

  it('renders rationale details when loaded', async () => {
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('矛盾依据')).toBeDefined()
    })
    expect(screen.getByText('TRIZ 推荐理由')).toBeDefined()
    expect(screen.getByText('规则依据')).toBeDefined()
    expect(screen.getByText('工期')).toBeDefined()
    expect(screen.getByText('成本')).toBeDefined()
    expect(screen.getByText('分割原理')).toBeDefined()
  })

  it('shows permission-safe unavailable state when user lacks view permission', async () => {
    mockPermissions.value = { 'rationale:view': false }
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('暂无访问权限')).toBeDefined()
    })
  })

  it('shows error state when API call fails', async () => {
    detailMock.mockRejectedValue(new Error('来源不可用'))
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('加载推荐理由失败')).toBeDefined()
    })
  })

  it('shows feedback controls for authorized users', async () => {
    mockPermissions.value = { 'rationale:view': true, 'rationale:feedback': true }
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('提供反馈')).toBeDefined()
    })
  })

  it('hides feedback controls for users without feedback permission', async () => {
    mockPermissions.value = { 'rationale:view': true, 'rationale:feedback': false }
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.queryByText('提供反馈')).toBeNull()
    })
  })

  it('shows handoff button for authorized users', async () => {
    mockPermissions.value = { 'rationale:view': true, 'rationale:handoff': true }
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('继续审查（转草稿）')).toBeDefined()
    })
  })

  it('shows evidence chain when available', async () => {
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('证据链 (1)')).toBeDefined()
    })
  })

  it('displays principle mapping table content', async () => {
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('发明原理映射')).toBeDefined()
      expect(screen.getByText('分割原理')).toBeDefined()
    })
  })

  it('shows warning alert when warningSummary is present', async () => {
    const warningRationale = { ...mockRationale, warningSummary: 'STALE_SOURCE_HASH: 来源已过期' }
    detailMock.mockResolvedValue(warningRationale)
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('STALE_SOURCE_HASH: 来源已过期')).toBeDefined()
    })
  })

  it('displays AI explanation when available', async () => {
    const aiRationale = {
      ...mockRationale,
      aiExplanationDraft: 'AI 生成的分析说明文本',
      aiMetadata: {
        isAiGenerated: true,
        validationStatus: 'passed',
        provider: 'test',
        model: 'test',
        inputHash: 'abc',
        outputRef: 'xyz',
      },
    }
    detailMock.mockResolvedValue(aiRationale)
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('AI 生成的分析说明文本')).toBeDefined()
      expect(screen.getByText('AI 已验证')).toBeDefined()
    })
  })

  it('displays fallback when AI validation fails', async () => {
    const fallbackRationale = {
      ...mockRationale,
      fallbackSummary: '规则摘要：工期压缩会导致成本上升',
      aiMetadata: {
        isAiGenerated: false,
        validationStatus: 'failed',
        provider: null,
        model: null,
        inputHash: null,
        outputRef: null,
      },
    }
    detailMock.mockResolvedValue(fallbackRationale)
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByText('规则摘要：工期压缩会导致成本上升')).toBeDefined()
    })
  })

  it('does not refetch on window focus (no hidden calls)', async () => {
    render(
      React.createElement(TrizRationalePanel, {
        projectId: 1,
        targetType: 'contradiction',
        targetId: 'c1',
      }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => {
      expect(trizRationaleApi.detail).toHaveBeenCalledTimes(1)
    })
  })
})
