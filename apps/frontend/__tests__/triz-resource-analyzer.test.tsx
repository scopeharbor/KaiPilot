import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import TrizResourceAnalyzer from '@/components/views/triz/triz-resource-analyzer'
import {
  makeResourceAnalysisRunFixture,
  makeResourceOpportunityFixture,
  makeResourceSnapshotFixture,
  type ResourceAnalysisRun,
  type ResourceOpportunityCandidate,
  type ResourceSnapshot,
} from '@aiproj/types'

// ===========================================================================
// TRIZ 资源分析器审查面组件测试（v3-triz-resource-analyzer §7.8–§7.9）
//
// 覆盖：加载态、空态、权限拒绝、资源全景与筛选、机会候选、来源/警告、
// stale 状态、AI fallback 说明、审查动作与 preview 入口、文案安全。
// ===========================================================================

const mockNav = vi.hoisted(() => ({
  replace: vi.fn(),
  search: '',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockNav.replace }),
  useSearchParams: () => new URLSearchParams(mockNav.search),
}))

const mockHooks = vi.hoisted(() => ({
  runsData: undefined as { data: ResourceAnalysisRun[]; meta: unknown } | undefined,
  runsLoading: false,
  snapshotsData: undefined as { data: ResourceSnapshot[]; meta: unknown } | undefined,
  snapshotsLoading: false,
  snapshotsParams: undefined as unknown,
  oppsData: undefined as { data: ResourceOpportunityCandidate[]; meta: unknown } | undefined,
  oppsLoading: false,
  createMutate: vi.fn(),
  createPending: false,
  createError: false,
  reviewMutate: vi.fn(),
  explainMutate: vi.fn(),
  workbenchMutate: vi.fn(),
  decisionMutate: vi.fn(),
  draftMutate: vi.fn(),
  resourceMutate: vi.fn(),
}))

vi.mock('@/hooks/use-resource-analyzer', () => ({
  useResourceAnalyses: () => ({
    data: mockHooks.runsData,
    isLoading: mockHooks.runsLoading,
  }),
  useResourceSnapshots: (_projectId: number, _runId: number, params?: unknown) => {
    mockHooks.snapshotsParams = params
    return { data: mockHooks.snapshotsData, isLoading: mockHooks.snapshotsLoading }
  },
  useResourceOpportunities: () => ({
    data: mockHooks.oppsData,
    isLoading: mockHooks.oppsLoading,
  }),
  useCreateResourceAnalysis: () => ({
    mutate: mockHooks.createMutate,
    isPending: mockHooks.createPending,
    isError: mockHooks.createError,
    error: mockHooks.createError ? new Error('分析服务不可用') : null,
  }),
  useReviewResourceOpportunity: () => ({ mutate: mockHooks.reviewMutate, isPending: false }),
  useExplainResourceOpportunity: () => ({ mutate: mockHooks.explainMutate, isPending: false }),
  useWorkbenchPreview: () => ({ mutate: mockHooks.workbenchMutate, isPending: false }),
  useDecisionPreview: () => ({ mutate: mockHooks.decisionMutate, isPending: false }),
  useDraftPreview: () => ({ mutate: mockHooks.draftMutate, isPending: false }),
  useResourcePreview: () => ({ mutate: mockHooks.resourceMutate, isPending: false }),
}))

const meta = { total: 1, page: 1, perPage: 20, totalPages: 1 }

function seedLoadedState(
  opportunities: ResourceOpportunityCandidate[] = [{ ...makeResourceOpportunityFixture(), id: 11 }],
) {
  mockHooks.runsData = { data: [makeResourceAnalysisRunFixture()], meta }
  mockHooks.snapshotsData = {
    data: [
      makeResourceSnapshotFixture(),
      makeResourceSnapshotFixture({
        resourceKey: 'res-test002',
        label: '测试服务器',
        resourceKind: 'technical',
        origin: 'project_registry',
        utilizationState: 'idle',
        availability: 'high',
        capacity: '2 台',
      }),
    ],
    meta,
  }
  mockHooks.oppsData = { data: opportunities, meta }
}

/** 选中首个运行（机会与资源区在选中运行后才渲染）。 */
function selectFirstRun() {
  fireEvent.click(screen.getByText(/^#1 ·/))
}

beforeEach(() => {
  mockHooks.runsData = undefined
  mockHooks.runsLoading = false
  mockHooks.snapshotsData = undefined
  mockHooks.snapshotsLoading = false
  mockHooks.snapshotsParams = undefined
  mockHooks.oppsData = undefined
  mockHooks.oppsLoading = false
  mockHooks.createPending = false
  mockHooks.createError = false
  mockHooks.createMutate = vi.fn()
  mockHooks.reviewMutate = vi.fn()
  mockHooks.explainMutate = vi.fn()
  mockHooks.workbenchMutate = vi.fn()
  mockHooks.decisionMutate = vi.fn()
  mockHooks.draftMutate = vi.fn()
  mockHooks.resourceMutate = vi.fn()
  mockNav.replace = vi.fn()
  mockNav.search = ''
})

describe('TrizResourceAnalyzer — 权限与基础状态', () => {
  test('无 view 权限时展示权限安全空态，不泄露运行/资源信息', () => {
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView={false} canManage />)

    expect(screen.getByText('您没有 TRIZ 资源分析权限。')).toBeInTheDocument()
    expect(screen.queryByText('TRIZ 资源分析器')).not.toBeInTheDocument()
    expect(screen.queryByText(/资源机会候选/)).not.toBeInTheDocument()
    expect(screen.queryByText(/测试服务器/)).not.toBeInTheDocument()
  })

  test('加载中展示骨架而非空态', () => {
    mockHooks.runsLoading = true
    const { container } = render(<TrizResourceAnalyzer projectId={42} canView />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText(/暂无资源分析运行/)).not.toBeInTheDocument()
  })

  test('无运行时展示引导空态', () => {
    mockHooks.runsData = { data: [], meta: { ...meta, total: 0 } }
    render(<TrizResourceAnalyzer projectId={42} canView />)
    expect(screen.getByText(/暂无资源分析运行/)).toBeInTheDocument()
  })

  test('无 manage 权限时不展示新建按钮与审查动作', () => {
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage={false} />)

    expect(screen.queryByText('新建资源分析')).not.toBeInTheDocument()
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))
    expect(screen.queryByText('记录审查')).not.toBeInTheDocument()
    expect(screen.queryByText('加入方案篮子')).not.toBeInTheDocument()
  })

  test('创建失败时展示错误提示', () => {
    mockHooks.runsData = { data: [], meta: { ...meta, total: 0 } }
    mockHooks.createError = true
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    expect(screen.getByText(/分析失败/)).toBeInTheDocument()
  })
})

describe('TrizResourceAnalyzer — 资源全景与筛选', () => {
  test('展示资源快照及其类型、来源与利用状态', () => {
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()

    expect(screen.getByText('资源全景')).toBeInTheDocument()
    expect(screen.getByText('测试服务器')).toBeInTheDocument()
    expect(screen.getByText('闲置')).toBeInTheDocument()
    expect(screen.getAllByText('项目登记册').length).toBeGreaterThan(0)
  })

  test('切换类型/来源筛选会带入查询参数', () => {
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()

    fireEvent.change(screen.getByLabelText('按资源类型筛选'), { target: { value: 'human' } })
    expect(mockHooks.snapshotsParams).toMatchObject({ resourceKind: 'human' })

    fireEvent.change(screen.getByLabelText('按资源来源筛选'), {
      target: { value: 'user_supplied' },
    })
    expect(mockHooks.snapshotsParams).toMatchObject({ origin: 'user_supplied' })
  })

  test('筛选无结果时展示空态而非隐藏计数', () => {
    seedLoadedState()
    mockHooks.snapshotsData = { data: [], meta: { ...meta, total: 0 } }
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()
    expect(screen.getByText(/当前筛选条件下没有可见资源快照/)).toBeInTheDocument()
  })
})

describe('TrizResourceAnalyzer — 机会候选与审查动作', () => {
  test('展示候选标题、严重度、类型、置信度与来源引用', () => {
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()

    expect(screen.getByText('测试服务器存在大量闲置算力')).toBeInTheDocument()
    expect(screen.getByText('高')).toBeInTheDocument()
    expect(screen.getByText('闲置能力')).toBeInTheDocument()
    expect(screen.getByText(/置信度: 85%/)).toBeInTheDocument()
    expect(screen.getByText('项目资源分配记录')).toBeInTheDocument()
  })

  test('警告代码以中文低敏文案展示', () => {
    seedLoadedState([
      {
        ...makeResourceOpportunityFixture({ warningCodes: ['PERMISSION_RESTRICTED'] }),
        id: 11,
      },
    ])
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()
    expect(screen.getByText(/部分来源因权限被隐藏/)).toBeInTheDocument()
  })

  test('记录审查按候选 id 调用 review', () => {
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))
    fireEvent.click(screen.getByText('记录审查'))

    expect(mockHooks.reviewMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 42,
        runId: 1,
        opportunityId: 11,
        body: { action: 'mark_reviewed' },
      }),
    )
  })

  test('preview 入口按候选 id 调用对应 mutation', () => {
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))

    fireEvent.click(screen.getByText('加入方案篮子'))
    expect(mockHooks.workbenchMutate).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: 11 }),
      expect.anything(),
    )

    fireEvent.click(screen.getByText('进入草案预览'))
    expect(mockHooks.draftMutate).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: 11 }),
      expect.anything(),
    )

    fireEvent.click(screen.getByText('生成决策记录预览'))
    expect(mockHooks.decisionMutate).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: 11 }),
      expect.anything(),
    )
  })

  test('复制引用摘要只写剪贴板且文案标注不自动执行', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))
    fireEvent.click(screen.getByText('复制引用摘要'))

    await screen.findByText(/引用摘要已复制到剪贴板/)
    const copied = String(writeText.mock.calls[0]![0])
    expect(copied).toContain('rop-')
    expect(copied).toContain('仅供审查参考，不自动执行')
    // 复制不触发任何写回 mutation
    expect(mockHooks.reviewMutate).not.toHaveBeenCalled()
    expect(mockHooks.workbenchMutate).not.toHaveBeenCalled()
  })

  test('过载缓解候选额外提供资源预览入口', () => {
    seedLoadedState([
      {
        ...makeResourceOpportunityFixture({
          opportunityType: 'overload_relief',
          severity: 'critical',
          title: '资源超载需要缓解',
        }),
        id: 12,
      },
    ])
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()
    fireEvent.click(screen.getByText('资源超载需要缓解'))

    fireEvent.click(screen.getByText('生成资源预览'))
    expect(mockHooks.resourceMutate).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: 12 }),
      expect.anything(),
    )
  })

  test('来源已过期的候选标记 stale 并隐藏写动作', () => {
    seedLoadedState([{ ...makeResourceOpportunityFixture({ status: 'blocked_stale' }), id: 13 }])
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()

    expect(screen.getByText('来源已过期')).toBeInTheDocument()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))
    expect(screen.queryByText('记录审查')).not.toBeInTheDocument()
    expect(screen.queryByText('加入方案篮子')).not.toBeInTheDocument()
  })

  test('无机会候选时展示空态', () => {
    seedLoadedState([])
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()
    expect(screen.getByText(/该运行未检测到资源机会候选/)).toBeInTheDocument()
  })
})

describe('TrizResourceAnalyzer — AI 说明与文案安全', () => {
  test('有 ai:trigger 时可请求说明，展示 fallback 结果', () => {
    seedLoadedState()
    mockHooks.explainMutate = vi.fn((_vars, opts) => {
      opts?.onSuccess?.({
        opportunityKey: 'rop-test001',
        explanation: {
          narrative:
            '【闲置能力】测试服务器利用率低。\n（本说明为确定性生成，仅供参考，不自动执行。）',
          isFallback: true,
          hallucinationChecked: true,
          degradedReason: '默认不使用真实模型',
          referencedResourceKeys: [],
          confidence: 0.85,
          provider: null,
          model: null,
          cost: null,
        },
      })
    })

    render(<TrizResourceAnalyzer projectId={42} canView canManage canAiExplain />)
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))
    fireEvent.click(screen.getByText(/生成分析说明/))

    expect(mockHooks.explainMutate).toHaveBeenCalled()
    // 标题行与正文都带「仅供参考，不自动执行」，取全部匹配
    expect(screen.getAllByText(/仅供参考，不自动执行/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/测试服务器利用率低/)).toBeInTheDocument()
  })

  test('说明区展示降级原因、反幻觉校验状态与成本摘要', () => {
    seedLoadedState()
    mockHooks.explainMutate = vi.fn((_vars, opts) => {
      opts?.onSuccess?.({
        opportunityKey: 'rop-test001',
        explanation: {
          narrative: '【闲置能力】测试服务器利用率低。',
          isFallback: true,
          hallucinationChecked: true,
          degradedReason: '默认不使用真实模型；待用户明确授权后可通过 AI gateway 调用',
          referencedResourceKeys: [],
          confidence: 0.85,
          provider: null,
          model: null,
          cost: null,
        },
      })
    })

    render(<TrizResourceAnalyzer projectId={42} canView canManage canAiExplain />)
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))
    fireEvent.click(screen.getByText(/生成分析说明/))

    expect(screen.getByText('来源：确定性降级说明')).toBeInTheDocument()
    expect(screen.getByText('反幻觉校验：已通过')).toBeInTheDocument()
    expect(screen.getByText('成本：未计费')).toBeInTheDocument()
    expect(screen.getByText(/降级原因：默认不使用真实模型/)).toBeInTheDocument()
  })

  test('模型生成说明展示 token 成本而非未计费', () => {
    seedLoadedState()
    mockHooks.explainMutate = vi.fn((_vars, opts) => {
      opts?.onSuccess?.({
        opportunityKey: 'rop-test001',
        explanation: {
          narrative: '模型说明正文。',
          isFallback: false,
          hallucinationChecked: true,
          degradedReason: null,
          referencedResourceKeys: [],
          confidence: 0.85,
          provider: 'anthropic',
          model: 'claude-opus-5',
          cost: {
            provider: 'anthropic',
            model: 'claude-opus-5',
            promptTokens: 800,
            completionTokens: 200,
            estimatedCost: 0.01,
            latencyMs: 900,
          },
        },
      })
    })

    render(<TrizResourceAnalyzer projectId={42} canView canManage canAiExplain />)
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))
    fireEvent.click(screen.getByText(/生成分析说明/))

    expect(screen.getByText('来源：模型生成')).toBeInTheDocument()
    expect(screen.getByText('成本：1000 tokens')).toBeInTheDocument()
    expect(screen.queryByText(/降级原因/)).not.toBeInTheDocument()
  })

  test('无 ai:trigger 时不展示 AI 说明入口', () => {
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage canAiExplain={false} />)
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))
    expect(screen.queryByText(/生成分析说明/)).not.toBeInTheDocument()
  })

  test('preview 失败时提示未生成而非声称已写入', () => {
    seedLoadedState()
    mockHooks.workbenchMutate = vi.fn((_vars, opts) => {
      opts?.onError?.(new Error('来源已过期，请重新运行分析'))
    })

    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))
    fireEvent.click(screen.getByText('加入方案篮子'))

    expect(screen.getByText(/预览未生成/)).toBeInTheDocument()
  })

  test('可见文案不含自动执行措辞', () => {
    seedLoadedState([
      { ...makeResourceOpportunityFixture({ opportunityType: 'overload_relief' }), id: 14 },
    ])
    const { container } = render(
      <TrizResourceAnalyzer projectId={42} canView canManage canAiExplain />,
    )
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))

    const text = container.textContent ?? ''
    for (const banned of ['自动应用', '一键优化', '自动分配', '自动导出计划', '一键执行']) {
      expect(text).not.toContain(banned)
    }
  })
})

describe('TrizResourceAnalyzer — URL 状态恢复', () => {
  test('URL 带 runId 时直接恢复选中运行', () => {
    mockNav.search = 'runId=1'
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)

    // 未点击运行按钮即已渲染资源全景与机会队列
    expect(screen.getByText('资源全景')).toBeInTheDocument()
    expect(screen.getByText('测试服务器存在大量闲置算力')).toBeInTheDocument()
    // 与 URL 一致时不重复写回
    expect(mockNav.replace).not.toHaveBeenCalled()
  })

  test('切换运行时把 runId 同步回 URL', () => {
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()

    expect(mockNav.replace).toHaveBeenCalledWith('?runId=1', { scroll: false })
  })

  test('runId 非法时退回未选中状态而非崩溃', () => {
    mockNav.search = 'runId=abc'
    seedLoadedState()
    render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    expect(screen.queryByText('资源全景')).not.toBeInTheDocument()
    expect(screen.getByText('TRIZ 资源分析器')).toBeInTheDocument()
  })
})

describe('TrizResourceAnalyzer — 响应式与主题结构约束', () => {
  // jsdom 不做真实布局测量，故这里断言的是「不会在窄屏/深色下崩版」的结构前提：
  // 主栅格单列起步 + lg 断点分栏、所有横向条目可换行、颜色全部走语义 token、
  // 无超出移动端视口的固定像素宽度。
  test('主栅格单列起步并在 lg 断点分栏', () => {
    seedLoadedState()
    const { container } = render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()

    const grid = container.querySelector('[class*="grid-cols-1"]')
    expect(grid).not.toBeNull()
    expect(grid!.className).toContain('lg:grid-cols-')
  })

  test('横向条目均可换行，窄视口不产生水平溢出结构', () => {
    seedLoadedState()
    const { container } = render(<TrizResourceAnalyzer projectId={42} canView canManage />)
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))

    const rows = Array.from(container.querySelectorAll('div[class*="flex"]')).filter(
      (el) => !el.className.includes('flex-col') && el.className.includes('gap-'),
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.className).toContain('flex-wrap')
    }
    // 无写死的宽像素（移动端 375px 视口下会溢出）
    expect(container.innerHTML).not.toMatch(/w-\[\d{3,}px\]/)
    expect(container.innerHTML).not.toMatch(/min-w-\[\d{3,}px\]/)
  })

  test('颜色全部走语义 token，浅色/深色与紧凑模式共用同一套类名', () => {
    seedLoadedState([
      { ...makeResourceOpportunityFixture({ warningCodes: ['SOURCE_STALE'] }), id: 11 },
    ])
    const { container } = render(
      <TrizResourceAnalyzer projectId={42} canView canManage canAiExplain />,
    )
    selectFirstRun()
    fireEvent.click(screen.getByText('测试服务器存在大量闲置算力'))

    const html = container.innerHTML
    // 无硬编码颜色（硬编码会在深色模式下失效）
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(html).not.toMatch(/\b(?:rgb|hsl)a?\(/)
    // 语义 token 实际在用
    for (const token of ['text-muted-foreground', 'border-border', 'bg-muted']) {
      expect(html).toContain(token)
    }
  })
})
