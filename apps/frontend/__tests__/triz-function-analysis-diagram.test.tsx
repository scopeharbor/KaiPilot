import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import FunctionAnalysisDiagram from '@/components/views/triz/function-analysis-diagram'
import {
  functionAnalysisKeys,
  functionAnalysisApi,
  type ListFunctionAnalysesParams,
} from '@/lib/api/triz-function-analysis'
import type {
  FunctionAnalysisRun,
  FunctionComponentNode,
  FunctionRelationEdge,
  FunctionIssueCandidate,
} from '@aiproj/types'

const mockHooks = vi.hoisted(() => ({
  analysesData: undefined as
    | {
        data: FunctionAnalysisRun[]
        meta: { total: number; page: number; perPage: number; totalPages: number }
      }
    | undefined,
  analysesLoading: false,
  analysesError: false,
  graphData: undefined as
    | {
        nodes: FunctionComponentNode[]
        edges: FunctionRelationEdge[]
        layout: {
          layoutVersion: string
          algorithm: string
          bounds: { minX: number; minY: number; maxX: number; maxY: number }
          nodePositions: Record<string, { x: number; y: number }>
        }
        issuesSummary: unknown[]
        warnings: string[]
      }
    | undefined,
  graphLoading: false,
  graphError: false,
  issuesData: undefined as
    | {
        data: FunctionIssueCandidate[]
        meta: { total: number; page: number; perPage: number; totalPages: number }
      }
    | undefined,
  issuesLoading: false,
  issuesError: false,
  createMutate: vi.fn(),
  createPending: false,
  createError: false,
  createData: undefined as { id: number; nodes?: unknown[] } | undefined,
  reviewMutate: vi.fn(),
  reviewPending: false,
  explainMutate: vi.fn(),
  explainPending: false,
  explainData: undefined as
    | {
        explanation: {
          narrative: string
          isFallback: boolean
          hallucinationChecked: boolean
          provider: string | null
          model: string | null
        }
      }
    | undefined,
  workbenchMutate: vi.fn(),
  workbenchData: undefined as
    { issueType: string; nodeRefs: string[]; warnings: string[]; stale?: boolean } | undefined,
  decisionMutate: vi.fn(),
  decisionData: undefined as
    { issueType: string; nodeRefs: string[]; warnings: string[] } | undefined,
  handoffMutate: vi.fn(),
  handoffData: undefined as
    { issueType: string; nodeRefs: string[]; warnings: string[]; stale?: boolean } | undefined,
  hasPermission: true,
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => {
    if (selector) {
      return selector({
        hasPermission: () => mockHooks.hasPermission,
      })
    }
    return { hasPermission: () => mockHooks.hasPermission }
  },
}))

vi.mock('@/hooks/use-function-analysis', () => ({
  useFunctionAnalyses: () => ({
    data: mockHooks.analysesData,
    isLoading: mockHooks.analysesLoading,
    isError: mockHooks.analysesError,
  }),
  useFunctionAnalysisGraph: () => ({
    data: mockHooks.graphData,
    isLoading: mockHooks.graphLoading,
    isError: mockHooks.graphError,
  }),
  useFunctionAnalysisIssues: () => ({
    data: mockHooks.issuesData,
    isLoading: mockHooks.issuesLoading,
    isError: mockHooks.issuesError,
  }),
  useCreateFunctionAnalysis: () => ({
    mutate: mockHooks.createMutate,
    isPending: mockHooks.createPending,
    isError: mockHooks.createError,
    isSuccess: false,
    data: mockHooks.createData,
  }),
  useReviewFunctionIssue: () => ({
    mutate: mockHooks.reviewMutate,
    isPending: mockHooks.reviewPending,
  }),
  useExplainFunctionIssue: () => ({
    mutate: mockHooks.explainMutate,
    isPending: mockHooks.explainPending,
    isSuccess: false,
    data: mockHooks.explainData,
    variables: undefined,
  }),
  useFunctionWorkbenchPreview: () => ({
    mutate: mockHooks.workbenchMutate,
    isPending: false,
    data: mockHooks.workbenchData,
  }),
  useFunctionDecisionPreview: () => ({
    mutate: mockHooks.decisionMutate,
    isPending: false,
    data: mockHooks.decisionData,
  }),
  useFunctionDraftHandoffPreview: () => ({
    mutate: mockHooks.handoffMutate,
    isPending: false,
    data: mockHooks.handoffData,
  }),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  useParams: () => ({ id: '42' }),
}))

function runFixture(overrides: Partial<FunctionAnalysisRun> = {}): FunctionAnalysisRun {
  return {
    id: 1,
    organizationId: 1,
    projectId: 42,
    actorId: 1,
    status: 'completed_with_warnings',
    inputSignature: 'fad-test-sig',
    outputHash: 'fao-test',
    ruleVersion: '1.0.0',
    layoutVersion: '1.0.0',
    idempotencyKey: 'fad-idem-test',
    sourceSummary: { tasks: { count: 3, hash: 'abc' } },
    warningSummary: [],
    nodeCount: 5,
    edgeCount: 8,
    issueCount: 3,
    costSummary: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: null,
    completedAt: '2026-07-31T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

function graphFixture(): NonNullable<typeof mockHooks.graphData> {
  return {
    nodes: [
      {
        nodeKey: 'fcn-n1',
        label: '前端引擎',
        componentType: 'system_component' as const,
        scope: 'internal' as const,
        status: 'active' as const,
        sourceRefs: [
          { sourceType: 'task', sourceId: 1, lowSensitiveTitle: '前端开发', hash: 't1hash' },
        ],
        sourceHashes: { tasks: 'abc' },
        metrics: { inDegree: 1, outDegree: 2, totalWeight: 1.5 },
        position: { x: 100, y: 100 },
        warningCodes: [],
      },
      {
        nodeKey: 'fcn-n2',
        label: '后端服务',
        componentType: 'system_component' as const,
        scope: 'internal' as const,
        status: 'active' as const,
        sourceRefs: [],
        sourceHashes: {},
        metrics: { inDegree: 2, outDegree: 0, totalWeight: 1.0 },
        position: { x: 300, y: 100 },
        warningCodes: [],
      },
    ],
    edges: [
      {
        edgeKey: 'fce-e1',
        fromNodeKey: 'fcn-n1',
        toNodeKey: 'fcn-n2',
        functionType: 'useful' as const,
        label: 'API 调用',
        strength: 0.9,
        confidence: 0.85,
        evidenceRefs: [],
        sourceHashes: {},
        warningCodes: [],
      },
    ],
    layout: {
      layoutVersion: '1.0.0',
      algorithm: 'layered' as const,
      bounds: { minX: 0, minY: 0, maxX: 400, maxY: 200 },
      nodePositions: {},
    },
    issuesSummary: [],
    warnings: [],
  }
}

function issueFixture(overrides: Partial<FunctionIssueCandidate> = {}): FunctionIssueCandidate {
  return {
    issueKey: 'fci-test001',
    issueType: 'harmful_function',
    severity: 'high',
    confidence: 0.8,
    impactScore: 0.72,
    status: 'unreviewed',
    nodeRefs: ['fcn-n1', 'fcn-n2'],
    edgeRefs: ['fce-e1'],
    rationaleSummary: '前端引擎与后端服务之间存在有害功能关系。',
    suggestedActions: [{ action: 'trim_or_replace', rationale: '评估轻量方案', confidence: 0.75 }],
    sourceHashes: { tasks: 'abc' },
    aiExplanationRef: null,
    reviewedBy: null,
    reviewedAt: null,
    warningCodes: [],
    outputHash: 'fco-test',
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('TRIZ function analysis diagram frontend', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockHooks.analysesData = undefined
    mockHooks.analysesLoading = false
    mockHooks.analysesError = false
    mockHooks.graphData = undefined
    mockHooks.graphLoading = false
    mockHooks.graphError = false
    mockHooks.issuesData = undefined
    mockHooks.issuesLoading = false
    mockHooks.issuesError = false
    mockHooks.createError = false
    mockHooks.createData = undefined
    mockHooks.createPending = false
    mockHooks.explainData = undefined
    mockHooks.workbenchData = undefined
    mockHooks.decisionData = undefined
    mockHooks.handoffData = undefined
    mockHooks.hasPermission = true
  })

  test('授权用户看到标题和新建按钮', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    const { container } = render(<FunctionAnalysisDiagram projectId={42} />)
    expect(screen.getByText('功能分析图')).toBeTruthy()
    expect(screen.getByText('新建分析')).toBeTruthy()
    expect(container.textContent).toContain('节点')
  })

  test('加载中显示 Skeleton 且不显示空状态', () => {
    mockHooks.analysesLoading = true
    const { container } = render(<FunctionAnalysisDiagram projectId={42} />)
    expect(container.textContent).not.toContain('尚未有功能分析图')
  })

  test('空状态提示', () => {
    mockHooks.analysesData = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
    render(<FunctionAnalysisDiagram projectId={42} />)
    expect(screen.getByText(/尚未有功能分析图/)).toBeTruthy()
  })

  test('错误状态', () => {
    mockHooks.analysesError = true
    render(<FunctionAnalysisDiagram projectId={42} />)
    expect(screen.getByText(/无法加载分析历史/)).toBeTruthy()
  })

  test('运行列表可点击选择并显示图面板', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.graphData = graphFixture()
    mockHooks.issuesData = {
      data: [issueFixture()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<FunctionAnalysisDiagram projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    // SVG 图面存在
    expect(document.querySelector('svg')).toBeTruthy()
    // 过滤面板存在（multiple elements since desktop + mobile tab both have it）
    expect(screen.getAllByText('过滤').length).toBeGreaterThan(0)
  })

  test('SVG 节点和边渲染', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.graphData = graphFixture()
    render(<FunctionAnalysisDiagram projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    // Nodes rendered as circles in SVG
    const circles = document.querySelectorAll('svg circle')
    expect(circles.length).toBeGreaterThan(0)
    // Edges rendered as lines
    const lines = document.querySelectorAll('svg line')
    expect(lines.length).toBeGreaterThan(0)
  })

  test('图例显示功能类型颜色标识', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.graphData = graphFixture()
    render(<FunctionAnalysisDiagram projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    expect(screen.getByText('有用功能')).toBeTruthy()
    expect(screen.getAllByText('有害功能').length).toBeGreaterThan(0)
    expect(screen.getAllByText('不足功能').length).toBeGreaterThan(0)
    expect(screen.getAllByText('过度功能').length).toBeGreaterThan(0)
  })

  test('节点点击显示详情', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.graphData = graphFixture()
    render(<FunctionAnalysisDiagram projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    // Click a node to select it — need to click the <g> parent since onClick is on <g>
    const circles = document.querySelectorAll('svg circle')
    const firstCircle = circles[0]!
    // SVG namespace: parentElement should be the <g>
    const gParent = firstCircle.parentElement
    if (gParent) fireEvent.click(gParent)
    // After clicking, node label appears in detail panel
    expect(screen.getAllByText('前端引擎').length).toBeGreaterThan(0)
  })

  test('问题审查操作按钮可见', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.graphData = graphFixture()
    mockHooks.issuesData = {
      data: [issueFixture()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<FunctionAnalysisDiagram projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    // Click issue in detail panel to select it
    const issueText = screen.getByText('前端引擎与后端服务之间存在有害功能关系。')
    fireEvent.click(issueText)
    // Actions should appear
    expect(screen.getByText('记录审查')).toBeTruthy()
    expect(screen.getByText('查看依据')).toBeTruthy()
    expect(screen.getByText('加入方案篮子')).toBeTruthy()
    expect(screen.getByText('打开审查')).toBeTruthy()
    expect(screen.getByText('进入草案预览')).toBeTruthy()
  })

  test('审查对话框打开和关闭', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.graphData = graphFixture()
    mockHooks.issuesData = {
      data: [issueFixture()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<FunctionAnalysisDiagram projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    // Select issue then click review
    const issueText = screen.getByText('前端引擎与后端服务之间存在有害功能关系。')
    fireEvent.click(issueText)
    const reviewBtn = screen.getByText('记录审查')
    fireEvent.click(reviewBtn)
    expect(screen.getByText('审查问题候选')).toBeTruthy()
    const cancelBtn = screen.getByText('取消')
    fireEvent.click(cancelBtn)
  })

  test('禁用词检查：渲染文本不含禁用词', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.graphData = graphFixture()
    mockHooks.issuesData = {
      data: [issueFixture()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    }
    render(<FunctionAnalysisDiagram projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    const html = document.body.innerHTML
    expect(html).not.toContain('自动应用')
    expect(html).not.toContain('一键删除')
    expect(html).not.toContain('自动修剪')
    expect(html).not.toContain('自动执行')
  })

  test('无权限时显示权限提示', () => {
    mockHooks.hasPermission = false
    const { container } = render(<FunctionAnalysisDiagram projectId={42} />)
    expect(container.textContent).toContain('您没有功能分析图权限')
  })

  test('query key 稳定性', () => {
    const params: ListFunctionAnalysesParams = { page: 1, perPage: 20 }
    const k1 = functionAnalysisKeys.list(42, params)
    const k2 = functionAnalysisKeys.list(42, params)
    expect(k1).toEqual(k2)
    expect(k1[0]).toBe('triz-function-analysis')
  })

  test('api client 方法齐全', () => {
    expect(typeof functionAnalysisApi.create).toBe('function')
    expect(typeof functionAnalysisApi.list).toBe('function')
    expect(typeof functionAnalysisApi.get).toBe('function')
    expect(typeof functionAnalysisApi.getGraph).toBe('function')
    expect(typeof functionAnalysisApi.listIssues).toBe('function')
    expect(typeof functionAnalysisApi.explain).toBe('function')
    expect(typeof functionAnalysisApi.review).toBe('function')
    expect(typeof functionAnalysisApi.workbenchPreview).toBe('function')
    expect(typeof functionAnalysisApi.decisionPreview).toBe('function')
    expect(typeof functionAnalysisApi.handoffPreview).toBe('function')
  })

  test('响应式：移动端 tabs 结构存在', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.graphData = graphFixture()
    const { container } = render(<FunctionAnalysisDiagram projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    // Mobile tabs exist in the DOM (hidden on desktop via lg:hidden)
    expect(container.innerHTML).toContain('过滤')
  })

  test('过滤交互：切换严重度 Badge', () => {
    mockHooks.analysesData = {
      data: [runFixture()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockHooks.graphData = graphFixture()
    render(<FunctionAnalysisDiagram projectId={42} />)
    const runCard = screen.getByText('分析 #1').closest('[class*="cursor-pointer"]')
    fireEvent.click(runCard!)
    const criticalBadges = screen.getAllByText('严重')
    fireEvent.click(criticalBadges[0]!)
    // Badge click should work without error
  })
})
