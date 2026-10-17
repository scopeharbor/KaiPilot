import { render, screen } from '@testing-library/react'
import ChangeImpactPanel from '@/components/views/change-requests/ChangeImpactPanel'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hookState = vi.hoisted(() => ({
  listData: {
    data: [] as unknown[],
    meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
  },
  analysisData: undefined as unknown,
  analysisError: null as unknown,
  createMutate: vi.fn(),
  refreshMutate: vi.fn(),
  confirmMutate: vi.fn(),
  confirmStaleMutate: vi.fn(),
  aiMutate: vi.fn(),
}))

vi.mock('@/lib/api/use-change-impact', () => ({
  useListImpactAnalyses: () => ({ data: hookState.listData, isLoading: false }),
  useImpactAnalysis: () => ({
    data: hookState.analysisData,
    isLoading: false,
    error: hookState.analysisError,
  }),
  useCreateImpactAnalysis: () => ({
    mutate: hookState.createMutate,
    isPending: false,
    isError: false,
    isSuccess: false,
  }),
  useRefreshImpactAnalysis: () => ({ mutate: hookState.refreshMutate, isPending: false }),
  useConfirmImpactAnalysis: () => ({ mutate: hookState.confirmMutate, isPending: false }),
  useConfirmStaleImpactAnalysis: () => ({
    mutate: hookState.confirmStaleMutate,
    isPending: false,
  }),
  useGenerateAiExplanation: () => ({ mutate: hookState.aiMutate, isPending: false }),
}))

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    status: 'completed',
    summary: {
      totalAffected: 2,
      severityDistribution: { critical: 0, high: 1, medium: 1, low: 0, none: 0 },
      dimensionSummaries: [
        {
          dimension: 'schedule',
          affectedCount: 1,
          highestSeverity: 'high',
          topEvidence: ['依赖传播'],
        },
      ],
      criticalPathAffected: true,
      hasBlockingWarnings: true,
    },
    items: [
      {
        entityType: 'task',
        entityId: 42,
        dimension: 'schedule',
        severity: 'high',
        score: 4,
        propagationPath: [],
        depth: 1,
        ruleId: 'R001',
        evidence: '通过任务依赖传播',
        requiresReview: true,
        isVisible: true,
      },
    ],
    warnings: [{ code: 'RESOURCE_DATA_MISSING', message: '缺少资源分配数据' }],
    missingInputs: [],
    isStale: false,
    staleReason: null,
    aiExplanation: null,
    createdAt: '2026-07-14T00:00:00.000Z',
    ruleVersion: '2.0.0',
    ...overrides,
  }
}

describe('ChangeImpactPanel', () => {
  afterEach(() => {
    hookState.listData = {
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    }
    hookState.analysisData = undefined
    hookState.analysisError = null
    vi.clearAllMocks()
  })

  it('view 权限用户可生成只读分析，但看不到管理操作', () => {
    render(
      <ChangeImpactPanel
        projectId={1}
        changeRequestId={2}
        hasCreatePermission
        hasManagePermission={false}
      />,
    )

    expect(screen.getByText('尚未生成影响分析')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成影响分析' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 解释' })).not.toBeInTheDocument()
  })

  it('管理用户在 stale 分析上可刷新、确认继续使用并触发 AI 解释', () => {
    hookState.listData = {
      data: [analysis({ status: 'stale', isStale: true, staleReason: '项目事实已变化' })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    hookState.analysisData = {
      data: analysis({ status: 'stale', isStale: true, staleReason: '项目事实已变化' }),
    }

    render(
      <ChangeImpactPanel
        projectId={1}
        changeRequestId={2}
        hasCreatePermission
        hasManagePermission
        currentAnalysisId={7}
      />,
    )

    expect(screen.getByText(/影响分析已过期/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '刷新分析' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '确认继续使用' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认分析' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI 解释' })).toBeInTheDocument()
    expect(screen.getByText('受影响项（1）')).toBeInTheDocument()
  })

  it('只读用户可以查看摘要和路径入口，但隐藏刷新、确认和创建', () => {
    hookState.listData = {
      data: [analysis()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    hookState.analysisData = { data: analysis() }

    render(
      <ChangeImpactPanel
        projectId={1}
        changeRequestId={2}
        hasCreatePermission={false}
        hasManagePermission={false}
        currentAnalysisId={7}
      />,
    )

    expect(screen.getByText(/共/)).toBeInTheDocument()
    expect(screen.getByText('受影响项（1）')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认分析' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI 解释' })).not.toBeInTheDocument()
  })
})
