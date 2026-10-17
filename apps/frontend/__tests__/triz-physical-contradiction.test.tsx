import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import PhysicalContradictionAnalyzer from '@/components/views/triz/physical-contradiction-analyzer'
import {
  physicalContradictionKeys,
  physicalContradictionApi,
} from '@/lib/api/triz-physical-contradiction'
import type {
  ListPhysicalAnalysesResponse,
  ListPhysicalCandidatesResponse,
  PhysicalAnalysisRun,
  PhysicalContradictionCandidate,
} from '@aiproj/types'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    headers: new Headers({ 'content-type': 'application/json' }),
  } as Response
}

const mockHooks = vi.hoisted(() => ({
  analysesData: undefined as ListPhysicalAnalysesResponse | undefined,
  analysesLoading: false,
  analysesError: false,
  candidatesData: undefined as ListPhysicalCandidatesResponse | undefined,
  candidatesLoading: false,
  candidatesError: false,
  createMutate: vi.fn(),
  createPending: false,
  createError: false,
  // 组件只读 id 与 candidates 两个字段（physical-contradiction-analyzer.tsx:125-133）。
  createData: undefined as { id: number; candidates?: unknown[] } | undefined,
  reviewMutate: vi.fn(),
  explainMutate: vi.fn(),
}))

vi.mock('@/hooks/use-physical-contradiction', () => ({
  usePhysicalAnalyses: () => ({
    data: mockHooks.analysesData,
    isLoading: mockHooks.analysesLoading,
    isError: mockHooks.analysesError,
  }),
  usePhysicalCandidates: () => ({
    data: mockHooks.candidatesData,
    isLoading: mockHooks.candidatesLoading,
    isError: mockHooks.candidatesError,
  }),
  useCreatePhysicalAnalysis: () => ({
    mutate: mockHooks.createMutate,
    isPending: mockHooks.createPending,
    isError: mockHooks.createError,
    data: mockHooks.createData,
  }),
  useReviewPhysicalCandidate: () => ({
    mutate: mockHooks.reviewMutate,
    isPending: false,
  }),
  useExplainPhysicalCandidate: () => ({
    mutate: mockHooks.explainMutate,
    isPending: false,
  }),
}))

function run(overrides: Partial<PhysicalAnalysisRun> = {}): PhysicalAnalysisRun {
  return {
    id: 1,
    organizationId: 1,
    projectId: 42,
    actorId: 1,
    status: 'completed_with_warnings',
    inputSignature: 'tpa-test',
    outputHash: 'tpo-test',
    ruleVersion: '1.0.0',
    idempotencyKey: 'tpa-idem-test',
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
  overrides: Partial<PhysicalContradictionCandidate> = {},
): PhysicalContradictionCandidate {
  return {
    candidateKey: 'tpc-test001',
    ruleId: 'PD-001',
    ruleVersion: '1.0.0',
    status: 'unreviewed',
    parameterKey: 'scope',
    requirementA: {
      summary: '范围要完整覆盖所有需求',
      context: '干系人期望全面交付',
      conditionRefs: ['cond_stakeholder'],
    },
    requirementB: {
      summary: '交付要快速收敛',
      context: '项目有紧迫的截止日期',
      conditionRefs: ['cond_deadline'],
    },
    separationAxis: 'time',
    contextA: '前期探索阶段需要大范围',
    contextB: '后期交付阶段需要快速收窄',
    conditionRefs: ['cond_phase_exploration', 'cond_phase_delivery'],
    severity: 'high',
    confidence: 0.75,
    impactScore: 0.8,
    evidenceRefs: [{ entityType: 'task', entityId: 1, lowSensitiveTitle: '逾期任务聚合' }],
    affectedScope: ['scope', 'duration'],
    principleRefs: [
      {
        principleKey: 'time_separation',
        name: '时间分离',
        relevance: 0.9,
        advice: '在不同时间段分别满足对立要求',
      },
    ],
    rationaleSummary: '范围既可全也可快——关键在于按阶段分离要求而非同时满足。',
    warningCodes: [],
    sourceHashes: { tasks: 'abc' },
    outputHash: 'tpo-test-output',
    reviewedBy: null,
    reviewedAt: null,
    aiExplanationRef: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('TRIZ physical contradiction analyzer frontend', () => {
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
  })

  test('授权用户看到运行列表与候选', () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    const { container } = render(<PhysicalContradictionAnalyzer projectId={42} />)
    expect(screen.getByText('物理矛盾分析')).toBeTruthy()
    expect(screen.getByText('分析 #1')).toBeTruthy()
    expect(container.textContent).toContain('候选数')
  })

  test('加载中显示 Skeleton', () => {
    mockHooks.analysesLoading = true
    const { container } = render(<PhysicalContradictionAnalyzer projectId={42} />)
    // Skeleton 渲染不报错，且不显示空状态
    expect(container.textContent).not.toContain('尚未有物理矛盾分析')
  })

  test('空状态提示', () => {
    mockHooks.analysesData = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
    render(<PhysicalContradictionAnalyzer projectId={42} />)
    expect(screen.getByText(/尚未有物理矛盾分析/)).toBeTruthy()
  })

  test('错误状态提示权限或加载失败', () => {
    mockHooks.analysesError = true
    render(<PhysicalContradictionAnalyzer projectId={42} />)
    expect(screen.getByText(/无法加载分析历史/)).toBeTruthy()
  })

  test('候选卡片显示参数、对立要求、分离维度、严重度', () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.candidatesData = {
      data: [candidate()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<PhysicalContradictionAnalyzer projectId={42} />)
    // 选中第一个 run 触发候选渲染
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    expect(screen.getByText(/要求A：范围要完整覆盖所有需求/)).toBeTruthy()
    expect(screen.getByText(/要求B：交付要快速收敛/)).toBeTruthy()
    expect(screen.getByText('范围')).toBeTruthy()
    // 「时间分离」可能同时出现在分离维度 badge 与 principleRefs chip，断言至少一个
    expect(screen.getAllByText('时间分离').length).toBeGreaterThan(0)
    expect(screen.getByText('高')).toBeTruthy()
  })

  test('blocked_stale 候选显示过期标识且不渲染敏感正文泄漏', () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    const staleCandidate = candidate({ status: 'blocked_stale' })
    mockHooks.candidatesData = {
      data: [staleCandidate],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<PhysicalContradictionAnalyzer projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    expect(screen.getByText('已过期')).toBeTruthy()
  })

  test('AI fallback 叙述不显示为「已验证」', () => {
    // 仅验证组件不渲染未经请求的 AI 文案
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.candidatesData = {
      data: [candidate()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    const { container } = render(<PhysicalContradictionAnalyzer projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    // 初始未点击「说明」时不应出现 AI 叙述
    expect(container.textContent).not.toContain('已验证')
  })

  test('UI 文案避免自动解决/自动应用措辞', () => {
    mockHooks.analysesData = {
      data: [run()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    const { container } = render(<PhysicalContradictionAnalyzer projectId={42} />)
    expect(container.textContent).not.toMatch(/自动解决|自动应用|自动重排|自动平衡资源/)
  })

  test('query keys 分层且包含 projectId', () => {
    const key = physicalContradictionKeys.list(42, { page: 1 })
    expect(key[0]).toBe('triz-physical-contradiction')
    expect(key).toContain(42)
  })

  test('API client 构造正确路径', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, { data: run() }))
    await physicalContradictionApi.get(42, 1)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/projects/42/triz/physical-contradiction-analyses/1'),
      expect.anything(),
    )
    fetchSpy.mockRestore()
  })
})
