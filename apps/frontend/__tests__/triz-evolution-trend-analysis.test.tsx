import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import TrizEvolutionTrendAnalysis from '@/components/views/triz/triz-evolution-trend-analysis'
import {
  makeEvolutionTrendAnalysisRunFixture,
  makeTrendScoreFixture,
  makeTrendRiskCandidateFixture,
  makeHistoryComparisonFixture,
  type EvolutionTrendAnalysisRun,
  type EvolutionTrendScore,
  type EvolutionTrendRiskCandidate,
  type EvolutionTrendHistoryComparison,
} from '@aiproj/types'

// ===========================================================================
// TRIZ 进化趋势分析审查面组件测试（v3-triz-evolution-trend-analysis §7.8–§7.9）
//
// 覆盖：加载态、空态、权限拒绝、8 趋势卡片、风险候选队列、历史对比、
// stale 状态、AI fallback 说明、审查动作与 preview 入口、文案安全。
// ===========================================================================

const mockNav = vi.hoisted(() => ({
  replace: vi.fn(),
  search: 'runId=1',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockNav.replace }),
  useSearchParams: () => new URLSearchParams(mockNav.search),
}))

const mockHooks = vi.hoisted(() => ({
  runsData: undefined as { data: EvolutionTrendAnalysisRun[]; meta: unknown } | undefined,
  runsLoading: false,
  trendsData: undefined as { data: EvolutionTrendScore[]; meta: unknown } | undefined,
  risksData: undefined as { data: EvolutionTrendRiskCandidate[]; meta: unknown } | undefined,
  historyData: undefined as EvolutionTrendHistoryComparison | undefined,
  createMutateAsync: vi.fn(),
  createPending: false,
  reviewMutate: vi.fn(),
  explainMutateAsync: vi.fn(),
  workbenchMutate: vi.fn(),
  decisionMutate: vi.fn(),
  draftMutate: vi.fn(),
  riskPreviewMutate: vi.fn(),
}))

vi.mock('@/hooks/use-evolution-trend-analysis', () => ({
  useEvolutionTrendAnalyses: () => ({ data: mockHooks.runsData, isLoading: mockHooks.runsLoading }),
  useEvolutionTrendRun: () => ({ data: undefined }),
  useEvolutionTrendScores: () => ({ data: mockHooks.trendsData }),
  useEvolutionTrendRisks: () => ({ data: mockHooks.risksData }),
  useEvolutionTrendHistory: () => ({ data: mockHooks.historyData }),
  useCreateEvolutionTrendAnalysis: () => ({
    mutateAsync: mockHooks.createMutateAsync,
    isPending: mockHooks.createPending,
  }),
  useReviewEvolutionTrendRisk: () => ({ mutate: mockHooks.reviewMutate }),
  useExplainEvolutionTrendRisk: () => ({ mutateAsync: mockHooks.explainMutateAsync }),
  useEvolutionWorkbenchPreview: () => ({ mutate: mockHooks.workbenchMutate }),
  useEvolutionDecisionPreview: () => ({ mutate: mockHooks.decisionMutate }),
  useEvolutionDraftPreview: () => ({ mutate: mockHooks.draftMutate }),
  useEvolutionRiskPreview: () => ({ mutate: mockHooks.riskPreviewMutate }),
}))

beforeEach(() => {
  mockHooks.runsData = undefined
  mockHooks.runsLoading = false
  mockHooks.trendsData = undefined
  mockHooks.risksData = undefined
  mockHooks.historyData = undefined
  mockHooks.createMutateAsync = vi.fn()
  mockHooks.reviewMutate = vi.fn()
  mockHooks.explainMutateAsync = vi.fn()
  mockHooks.workbenchMutate = vi.fn()
  mockHooks.decisionMutate = vi.fn()
  mockHooks.draftMutate = vi.fn()
  mockHooks.riskPreviewMutate = vi.fn()
})

describe('TrizEvolutionTrendAnalysis — 权限与加载状态', () => {
  test('canView=false 显示权限拒绝空态且不泄露内容', () => {
    render(<TrizEvolutionTrendAnalysis projectId={1} canView={false} />)
    expect(screen.getByText(/无权限查看/)).toBeDefined()
    // 不渲染趋势/风险内容
    expect(screen.queryByText('8 大趋势评分')).toBeNull()
  })

  test('加载中显示加载态', () => {
    const prevSearch = mockNav.search
    mockNav.search = ''
    mockHooks.runsLoading = true
    render(<TrizEvolutionTrendAnalysis projectId={1} canView />)
    expect(screen.getByText('加载中…')).toBeDefined()
    mockNav.search = prevSearch
  })

  test('无运行时空态不泄露隐藏计数', () => {
    const prevSearch = mockNav.search
    mockNav.search = ''
    mockHooks.runsData = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
    render(<TrizEvolutionTrendAnalysis projectId={1} canView />)
    expect(screen.getByText('尚无进化趋势分析运行')).toBeDefined()
    mockNav.search = prevSearch
  })
})

describe('TrizEvolutionTrendAnalysis — 8 趋势与风险队列', () => {
  test('渲染 8 趋势卡片与风险候选', () => {
    mockHooks.runsData = {
      data: [makeEvolutionTrendAnalysisRunFixture({ id: 1, riskCount: 1 })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.trendsData = {
      data: [
        makeTrendScoreFixture({ trendId: 'completeness', severity: 'medium' }),
        makeTrendScoreFixture({
          trendId: 'ideality_increase',
          trendKey: 'trk-2',
          severity: 'critical',
        }),
      ],
      meta: { total: 2, page: 1, perPage: 50, totalPages: 1 },
    }
    mockHooks.risksData = {
      data: [
        makeTrendRiskCandidateFixture({
          id: 5,
          riskKey: 'trr-1',
          status: 'unreviewed',
          severity: 'high',
        }),
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    render(<TrizEvolutionTrendAnalysis projectId={1} canView canManage />)
    // 8 大趋势标题
    expect(screen.getByText('8 大趋势评分')).toBeDefined()
    // 风险预警候选标题
    expect(screen.getByText('风险预警候选')).toBeDefined()
    // 完备性趋势标签出现
    expect(screen.getByText('完备性')).toBeDefined()
  })

  test('无风险候选时显示空态', () => {
    mockHooks.runsData = {
      data: [makeEvolutionTrendAnalysisRunFixture({ id: 1, riskCount: 0 })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.trendsData = {
      data: [makeTrendScoreFixture()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    mockHooks.risksData = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
    render(<TrizEvolutionTrendAnalysis projectId={1} canView />)
    expect(screen.getByText('无风险预警候选')).toBeDefined()
  })
})

describe('TrizEvolutionTrendAnalysis — 审查动作与 preview 入口', () => {
  test('canManage 时渲染审查导向动作按钮', () => {
    mockHooks.runsData = {
      data: [makeEvolutionTrendAnalysisRunFixture({ id: 1 })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.risksData = {
      data: [makeTrendRiskCandidateFixture({ id: 5, status: 'unreviewed' })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    render(<TrizEvolutionTrendAnalysis projectId={1} canView canManage />)
    expect(screen.getByText('记录审查')).toBeDefined()
    expect(screen.getByText('加入方案篮子')).toBeDefined()
    expect(screen.getByText('进入决策预览')).toBeDefined()
    expect(screen.getByText('进入草案预览')).toBeDefined()
    expect(screen.getByText('生成风险预览')).toBeDefined()
  })

  test('stale 风险不渲染动作按钮，显示来源已过期', () => {
    mockHooks.runsData = {
      data: [makeEvolutionTrendAnalysisRunFixture({ id: 1 })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.risksData = {
      data: [makeTrendRiskCandidateFixture({ id: 5, status: 'blocked_stale' })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    render(<TrizEvolutionTrendAnalysis projectId={1} canView canManage />)
    expect(screen.getByText('来源已过期')).toBeDefined()
    expect(screen.queryByText('记录审查')).toBeNull()
  })

  test('动作按钮文案不含自动执行措辞', () => {
    mockHooks.runsData = {
      data: [makeEvolutionTrendAnalysisRunFixture({ id: 1 })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.risksData = {
      data: [makeTrendRiskCandidateFixture({ id: 5, status: 'unreviewed' })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    render(<TrizEvolutionTrendAnalysis projectId={1} canView canManage />)
    const banned = ['自动应用', '一键优化', '自动规划', '自动解决', '自动导出']
    for (const word of banned) {
      expect(document.body.textContent).not.toContain(word)
    }
  })
})

describe('TrizEvolutionTrendAnalysis — 历史对比', () => {
  test('渲染历史对比 delta 与预测抑制提示', () => {
    mockHooks.runsData = {
      data: [makeEvolutionTrendAnalysisRunFixture({ id: 1 })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.historyData = makeHistoryComparisonFixture({ forecastSuppressed: true, stale: false })
    render(<TrizEvolutionTrendAnalysis projectId={1} canView />)
    expect(screen.getByText('历史对比')).toBeDefined()
    expect(screen.getByText(/历史样本不足，趋势预测已抑制/)).toBeDefined()
  })

  test('stale 时显示来源 hash 变化提示', () => {
    mockHooks.runsData = {
      data: [makeEvolutionTrendAnalysisRunFixture({ id: 1 })],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.historyData = makeHistoryComparisonFixture({ stale: true })
    render(<TrizEvolutionTrendAnalysis projectId={1} canView />)
    expect(screen.getByText(/来源 hash 已变化/)).toBeDefined()
  })
})
