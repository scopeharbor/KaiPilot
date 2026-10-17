import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import TechnicalContradictionAnalyzer from '@/components/views/triz/technical-contradiction-analyzer'
import {
  technicalContradictionKeys,
  technicalContradictionApi,
  type ListTechnicalAnalysesParams,
} from '@/lib/api/triz-technical-contradiction'
import type { TechnicalAnalysisRun, TechnicalContradictionCandidate } from '@aiproj/types'

const mockHooks = vi.hoisted(() => ({
  analysesData: undefined as
    | {
        data: TechnicalAnalysisRun[]
        meta: { total: number; page: number; perPage: number; totalPages: number }
      }
    | undefined,
  analysesLoading: false,
  analysesError: false,
  candidatesData: undefined as
    | {
        data: TechnicalContradictionCandidate[]
        meta: { total: number; page: number; perPage: number; totalPages: number }
      }
    | undefined,
  candidatesLoading: false,
  candidatesError: false,
  createMutate: vi.fn(),
  createPending: false,
  createError: false,
  createData: undefined as { id: number; candidates?: unknown[] } | undefined,
  reviewMutate: vi.fn(),
  explainMutate: vi.fn(),
  confirmationMutate: vi.fn(),
  confirmationData: undefined as
    | { projectedType: string; improvingParameterKey: string; worseningParameterKey: string }
    | undefined,
  handoffMutate: vi.fn(),
  handoffData: undefined as { targetType: string; stale: boolean } | undefined,
}))

vi.mock('@/hooks/use-technical-contradiction', () => ({
  useTechnicalAnalyses: () => ({
    data: mockHooks.analysesData,
    isLoading: mockHooks.analysesLoading,
    isError: mockHooks.analysesError,
  }),
  useTechnicalCandidates: () => ({
    data: mockHooks.candidatesData,
    isLoading: mockHooks.candidatesLoading,
    isError: mockHooks.candidatesError,
  }),
  useCreateTechnicalAnalysis: () => ({
    mutate: mockHooks.createMutate,
    isPending: mockHooks.createPending,
    isError: mockHooks.createError,
    data: mockHooks.createData,
  }),
  useReviewTechnicalCandidate: () => ({
    mutate: mockHooks.reviewMutate,
    isPending: false,
  }),
  useExplainTechnicalCandidate: () => ({
    mutate: mockHooks.explainMutate,
    isPending: false,
  }),
  useTechnicalConfirmationPreview: () => ({
    mutate: mockHooks.confirmationMutate,
    isPending: false,
    data: mockHooks.confirmationData,
    variables: undefined,
  }),
  useTechnicalHandoffPreview: () => ({
    mutate: mockHooks.handoffMutate,
    isPending: false,
    data: mockHooks.handoffData,
    variables: undefined,
  }),
}))

function run(overrides: Partial<TechnicalAnalysisRun> = {}): TechnicalAnalysisRun {
  return {
    id: 1,
    organizationId: 1,
    projectId: 42,
    actorId: 1,
    status: 'completed_with_warnings',
    inputSignature: 'tta-test',
    outputHash: 'tto-test',
    ruleVersion: '1.0.0',
    idempotencyKey: 'tta-idem-test',
    sourceSummary: { tasks: { count: 25, hash: 'abc' } },
    warningSummary: [],
    candidateCount: 2,
    costSummary: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: null,
    completedAt: '2026-07-31T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

function candidate(
  overrides: Partial<TechnicalContradictionCandidate> = {},
): TechnicalContradictionCandidate {
  return {
    candidateKey: 'ttc-test001',
    ruleId: 'CD-001',
    ruleVersion: '1.0.0',
    status: 'unreviewed',
    improvingParameterKey: 'duration',
    worseningParameterKey: 'cost',
    improvingDirection: '为追赶工期压缩进度',
    worseningDirection: '赶工成本上升',
    title: '压缩工期会抬高成本与质量风险',
    severity: 'high',
    confidence: 0.8,
    impactScore: 0.72,
    evidenceRefs: [{ entityType: 'task', entityId: 1, lowSensitiveTitle: '逾期任务聚合' }],
    affectedScope: ['schedule', 'cost'],
    principleRefs: [
      {
        principleId: 'segmentation',
        name: '分割/分解',
        relevance: 0.9,
        advice: '将大任务拆分为更小阶段',
      },
    ],
    rationaleSummary: '工期压缩与成本控制是对立的。',
    warningCodes: [],
    sourceHashes: { tasks: 'abc' },
    outputHash: 'tto-test-output',
    reviewedBy: null,
    reviewedAt: null,
    aiExplanationRef: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('TRIZ technical contradiction analyzer frontend', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockHooks.analysesData = undefined
    mockHooks.analysesLoading = false
    mockHooks.analysesError = false
    mockHooks.candidatesData = undefined
    mockHooks.candidatesLoading = false
    mockHooks.candidatesError = false
    mockHooks.createError = false
    mockHooks.createData = undefined
    mockHooks.createPending = false
    mockHooks.confirmationData = undefined
    mockHooks.handoffData = undefined
  })

  test('授权用户看到运行列表', () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    const { container } = render(<TechnicalContradictionAnalyzer projectId={42} />)
    expect(screen.getByText('技术矛盾分析')).toBeTruthy()
    expect(screen.getByText('分析 #1')).toBeTruthy()
    expect(container.textContent).toContain('候选数')
  })

  test('加载中显示 Skeleton 且不显示空状态', () => {
    mockHooks.analysesLoading = true
    const { container } = render(<TechnicalContradictionAnalyzer projectId={42} />)
    expect(container.textContent).not.toContain('尚未有技术矛盾分析')
  })

  test('空状态提示', () => {
    mockHooks.analysesData = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
    render(<TechnicalContradictionAnalyzer projectId={42} />)
    expect(screen.getByText(/尚未有技术矛盾分析/)).toBeTruthy()
  })

  test('错误状态提示权限或加载失败', () => {
    mockHooks.analysesError = true
    render(<TechnicalContradictionAnalyzer projectId={42} />)
    expect(screen.getByText(/无法加载分析历史/)).toBeTruthy()
  })

  test('候选卡片显示改善/恶化参数对、严重度、原理建议', () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.candidatesData = {
      data: [candidate()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<TechnicalContradictionAnalyzer projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    expect(screen.getByText('改善：工期')).toBeTruthy()
    expect(screen.getByText('恶化：成本')).toBeTruthy()
    expect(screen.getByText('高')).toBeTruthy()
    expect(screen.getByText('分割/分解')).toBeTruthy()
    expect(screen.getByText('压缩工期会抬高成本与质量风险')).toBeTruthy()
  })

  test('blocked_stale 候选显示过期标识', () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.candidatesData = {
      data: [candidate({ status: 'blocked_stale' })],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<TechnicalContradictionAnalyzer projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    expect(screen.getByText('来源已过期')).toBeTruthy()
  })

  test('warning 候选显示警告徽标与警告标签', () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.candidatesData = {
      data: [candidate({ warningCodes: ['INSUFFICIENT_EVIDENCE', 'REGISTRY_MISS'] })],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<TechnicalContradictionAnalyzer projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    expect(screen.getByText(/2 个警告/)).toBeTruthy()
    expect(screen.getByText(/⚠ 证据不足/)).toBeTruthy()
    expect(screen.getByText(/⚠ 原理未收录/)).toBeTruthy()
  })

  test('无分析权限时隐藏所有敏感内容', () => {
    const { container } = render(
      <TechnicalContradictionAnalyzer projectId={42} canAnalyze={false} />,
    )
    expect(container.textContent).toContain('没有技术矛盾分析权限')
    expect(container.textContent).not.toContain('候选数')
    expect(container.textContent).not.toContain('参数')
  })

  test('无管理权限时不显示审查/预览按钮', () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.candidatesData = {
      data: [candidate()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    const { container } = render(
      <TechnicalContradictionAnalyzer projectId={42} canManage={false} canAiExplain={false} />,
    )
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    expect(container.textContent).not.toContain('标记已审')
    expect(container.textContent).not.toContain('确认预览')
    expect(container.textContent).not.toContain('说明')
  })

  test('详情抽屉显示参数方向、证据、原理建议详情', async () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.candidatesData = {
      data: [candidate()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<TechnicalContradictionAnalyzer projectId={42} />)
    fireEvent.click(screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')!)
    const detailBtn = await screen.findByText('详情')
    fireEvent.click(detailBtn)
    expect(screen.getByText('候选详情')).toBeTruthy()
    expect(screen.getByText('为追赶工期压缩进度')).toBeTruthy()
    expect(screen.getByText(/逾期任务聚合/)).toBeTruthy()
  })

  test('query key 稳定性', () => {
    const params: ListTechnicalAnalysesParams = { page: 1, perPage: 20 }
    const k1 = technicalContradictionKeys.list(42, params)
    const k2 = technicalContradictionKeys.list(42, params)
    expect(k1).toEqual(k2)
    expect(k1[0]).toBe('triz-technical-contradiction')
  })

  test('api client 方法齐全', () => {
    expect(typeof technicalContradictionApi.create).toBe('function')
    expect(typeof technicalContradictionApi.list).toBe('function')
    expect(typeof technicalContradictionApi.get).toBe('function')
    expect(typeof technicalContradictionApi.listCandidates).toBe('function')
    expect(typeof technicalContradictionApi.explain).toBe('function')
    expect(typeof technicalContradictionApi.review).toBe('function')
    expect(typeof technicalContradictionApi.confirmationPreview).toBe('function')
    expect(typeof technicalContradictionApi.handoffPreview).toBe('function')
  })
})
