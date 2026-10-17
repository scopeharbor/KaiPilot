/**
 * v3-ui-next-pmo-domain W7 · tasks 7.6 —— 组合依赖图谱面板
 * （渲染/风险色带/节点联动/规模冒烟）。
 *
 * 覆盖（spec「跨项目依赖管理」图谱条款 / tasks 7.4）：
 * - 图谱数据装配：SVG 节点/边渲染、风险级色带与过期虚线双通道、图例；
 * - 确定性分层布局纯函数（rank 分配稳定、环节点兜底）；
 * - 节点点击联动只读详情抽屉（数据来自已取响应，零额外请求）；
 * - 普通成员读态：面板无任何写按钮（RL-06）；
 * - 项目范围获取失败 → 错误卡 + 重试、图谱查询禁用（enabled=false）；
 * - 500 端点/500 边规模冒烟：渲染完成无崩溃（风险 5 冒烟口径）；
 * - 空态/截断提示。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  PmoDependencyGraphPanel,
  layoutDependencyGraph,
} from '@/components/next/pmo/dependencies/PmoDependencyGraphPanel'
import { MPD_RISK_COLOR_VAR } from '@/components/next/pmo/dependencies/mpd-adapter'
import type {
  MultiProjectGraphEdge,
  MultiProjectGraphNode,
  MultiProjectGraphResponse,
} from '@aiproj/types'

const hookMocks = vi.hoisted(() => ({
  useMpdGraph: vi.fn(),
}))
vi.mock('@/hooks/use-multi-project-dependencies', () => ({
  useMpdGraph: hookMocks.useMpdGraph,
}))

const portfolioMocks = vi.hoisted(() => ({ usePortfolioProjects: vi.fn() }))
vi.mock('@/hooks/use-portfolio-dashboard', () => ({
  usePortfolioProjects: portfolioMocks.usePortfolioProjects,
}))

/* ── 夹具 ───────────────────────────────────────────────────────────────────── */
function okQuery(data: unknown, extra: Record<string, unknown> = {}) {
  return { data, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...extra }
}

function makeNode(
  id: number,
  opts: {
    label?: string
    projectId?: number
    endpointType?: MultiProjectGraphNode['endpoint']['endpointType']
    redacted?: boolean
    risk?: { critical?: number; high?: number; medium?: number; low?: number }
  } = {},
): MultiProjectGraphNode {
  const projectId = opts.projectId ?? 1
  return {
    nodeId: `n${id}`,
    endpoint: {
      endpointType: opts.endpointType ?? 'task',
      projectId,
      projectName: `项目 ${projectId}`,
      taskId: opts.endpointType === 'task' ? 100 + id : null,
      taskName: opts.endpointType === 'task' ? `任务 ${id}` : null,
      milestoneId: null,
      milestoneName: null,
      externalLabel: null,
      redacted: opts.redacted ?? false,
      redactionReason: opts.redacted ? 'ENDPOINT_REDACTED' : null,
    },
    label: opts.label ?? `节点 ${id}`,
    redacted: opts.redacted ?? false,
    redactionReason: opts.redacted ? 'ENDPOINT_REDACTED' : null,
    dependencyCount: 1,
    riskSummary: {
      critical: opts.risk?.critical ?? 0,
      high: opts.risk?.high ?? 0,
      medium: opts.risk?.medium ?? 1,
      low: opts.risk?.low ?? 0,
    },
    drillDownRef: null,
  }
}

function makeEdge(
  id: number,
  sourceNodeId: string,
  targetNodeId: string,
  opts: {
    riskLevel?: MultiProjectGraphEdge['riskLevel']
    freshness?: MultiProjectGraphEdge['freshness']
    status?: MultiProjectGraphEdge['status']
  } = {},
): MultiProjectGraphEdge {
  return {
    edgeId: id,
    sourceNodeId,
    targetNodeId,
    category: 'deliverable',
    type: 'fs',
    status: opts.status ?? 'active',
    riskLevel: opts.riskLevel ?? 'medium',
    bufferDays: 0,
    lagDays: 0,
    freshness: opts.freshness ?? 'fresh',
    drillDownRef: null,
    warningCodes: [],
  } as unknown as MultiProjectGraphEdge
}

function makeResponse(
  nodes: MultiProjectGraphNode[],
  edges: MultiProjectGraphEdge[],
  opts: Partial<MultiProjectGraphResponse> = {},
): MultiProjectGraphResponse {
  return {
    nodes,
    edges,
    visibleNodeCount: nodes.filter((node) => !node.redacted).length,
    redactedNodeCount: nodes.filter((node) => node.redacted).length,
    visibleEdgeCount: edges.length,
    truncated: false,
    truncationReason: null,
    warningCodes: [],
    freshnessMeta: { checkedAt: '2026-09-10T00:00:00.000Z', staleCount: 0, freshCount: 0 },
    ...opts,
  }
}

const projectList = (count = 3) => ({
  data: Array.from({ length: count }, (_, index) => ({
    projectId: index + 1,
    projectName: `项目 ${index + 1}`,
    projectStatus: 'active',
    healthStatus: 'healthy',
    progressPercent: 10,
    overdueTaskCount: 0,
    soonDueTaskCount: 0,
    memberCount: 2,
    warnings: [],
  })),
  meta: { total: count, page: 1, perPage: 100, totalPages: 1 },
})

function renderPanel(props: Partial<Parameters<typeof PmoDependencyGraphPanel>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PmoDependencyGraphPanel
        organizationId={1}
        filters={{ category: '', type: '', status: '', riskLevel: '', freshness: '' }}
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  portfolioMocks.usePortfolioProjects.mockReturnValue(okQuery(projectList()))
  hookMocks.useMpdGraph.mockReturnValue(okQuery({ data: makeResponse([], []) }))
})

describe('PmoDependencyGraphPanel 渲染与双通道', () => {
  test('装配图谱数据：节点/边/图例渲染与风险色带映射', () => {
    const nodes = [
      makeNode(1, { endpointType: 'project', risk: { high: 1 } }),
      makeNode(2, { endpointType: 'task' }),
      makeNode(3, { endpointType: 'milestone', redacted: true }),
    ]
    const edges = [
      makeEdge(10, 'n1', 'n2', { riskLevel: 'critical' }),
      makeEdge(11, 'n2', 'n3', { riskLevel: 'low', freshness: 'stale' }),
    ]
    hookMocks.useMpdGraph.mockReturnValue(okQuery({ data: makeResponse(nodes, edges) }))
    renderPanel()

    expect(document.querySelectorAll('[data-mpd-graph-node]')).toHaveLength(3)
    expect(document.querySelectorAll('[data-mpd-graph-edge]')).toHaveLength(2)
    // 风险色带：critical → 语义危险色 var 引用
    const criticalEdge = byData('[data-mpd-graph-edge="10"]')
    expect(criticalEdge.getAttribute('data-mpd-graph-edge-risk')).toBe('critical')
    expect(criticalEdge.getAttribute('stroke')).toBe(MPD_RISK_COLOR_VAR.critical)
    const lowEdge = byData('[data-mpd-graph-edge="11"]')
    expect(lowEdge.getAttribute('stroke')).toBe(MPD_RISK_COLOR_VAR.low)
    // 过期边：虚线（双通道）+ data 标记
    expect(lowEdge.getAttribute('data-mpd-graph-edge-stale')).not.toBeNull()
    expect(lowEdge.getAttribute('stroke-dasharray')).toBe('4 3')
    // 摘要计数（红绿灯中脱敏节点不计 visible）
    expect(screen.getByText('2 端点')).toBeTruthy()
    expect(screen.getByText('1 脱敏')).toBeTruthy()
    expect(screen.getByText('2 依赖边')).toBeTruthy()
    // 风险图例
    expect(document.querySelector('[data-mpd-graph-legend-risk="critical"]')).not.toBeNull()
    expect(document.querySelector('[data-mpd-graph-legend-risk="medium"]')).not.toBeNull()
  })

  test('脱敏节点虚线样式 + 截断提示（truncated）', () => {
    const nodes = [makeNode(1, { redacted: true, risk: { medium: 1 } }), makeNode(2)]
    const edges = [makeEdge(10, 'n1', 'n2')]
    hookMocks.useMpdGraph.mockReturnValue(
      okQuery({
        data: makeResponse(nodes, edges, { truncated: true, truncationReason: 'NODE_LIMIT' }),
      }),
    )
    renderPanel()

    expect(screen.getByText(/按规模上限截断/)).toBeTruthy()
    const redactedNode = byData('[data-mpd-graph-node="n1"]')
    expect(redactedNode.querySelector('rect')?.getAttribute('stroke-dasharray')).toBe('5 3')
    expect(redactedNode.textContent).toContain('脱敏')
  })

  test('确定性分层布局：链式 rank 递增、同图两次布局一致、环兜底不抛错', () => {
    const chain = [
      makeNode(1, { label: 'A' }),
      makeNode(2, { label: 'B' }),
      makeNode(3, { label: 'C' }),
    ]
    const edges = [makeEdge(1, 'n1', 'n2'), makeEdge(2, 'n2', 'n3')]
    const first = layoutDependencyGraph(chain, edges)
    const second = layoutDependencyGraph(chain, edges)
    expect(first.nodes.map((item) => item.rank)).toEqual([0, 1, 2])
    expect(first.nodes[0]!.x).toBe(0)
    expect(first.nodes[1]!.x).toBeGreaterThan(first.nodes[0]!.x)
    expect(first.nodes[2]!.x).toBeGreaterThan(first.nodes[1]!.x)
    expect(first.edges).toHaveLength(2)
    expect(second.nodes.map((item) => item.node.nodeId)).toEqual(
      first.nodes.map((item) => item.node.nodeId),
    )
    // 环：A→B→C→A 仍可布局（回边兜底），不抛错
    const cycleEdges = [...edges, makeEdge(3, 'n3', 'n1')]
    const cycleLayout = layoutDependencyGraph(chain, cycleEdges)
    expect(cycleLayout.nodes).toHaveLength(3)
    expect(cycleLayout.edges).toHaveLength(3)
  })

  test('500 端点/500 边规模冒烟：渲染完成无崩溃（任务 7.4 冒烟口径）', () => {
    const count = 500
    const nodes: MultiProjectGraphNode[] = Array.from({ length: count }, (_, index) =>
      makeNode(index, {
        projectId: (index % 5) + 1,
        risk: index % 3 === 0 ? { critical: 1 } : { high: 1 },
      }),
    )
    const edges: MultiProjectGraphEdge[] = Array.from({ length: count }, (_, index) =>
      makeEdge(index, `n${index}`, `n${(index + 1) % count}`, {
        riskLevel: index % 4 === 0 ? 'critical' : index % 4 === 1 ? 'high' : 'low',
        freshness: index % 7 === 0 ? 'stale' : 'fresh',
      }),
    )
    hookMocks.useMpdGraph.mockReturnValue(
      okQuery({ data: makeResponse(nodes, edges, { visibleEdgeCount: 500 }) }),
    )
    expect(() => renderPanel()).not.toThrow()
    expect(document.querySelectorAll('[data-mpd-graph-node]')).toHaveLength(count)
    expect(document.querySelectorAll('[data-mpd-graph-edge]')).toHaveLength(count)
    expect(document.querySelector('[data-mpd-graph-svg]')).not.toBeNull()
  })

  test('空响应 → 语义空态；范围无项目时给出组织引导文案', () => {
    hookMocks.useMpdGraph.mockReturnValue(okQuery({ data: makeResponse([], []) }))
    renderPanel()
    expect(screen.getByText('暂无依赖图谱数据')).toBeTruthy()
  })
})

describe('PmoDependencyGraphPanel 交互与只读语义', () => {
  test('节点点击联动只读详情抽屉（零额外请求），关闭后清空', () => {
    const nodes = [
      makeNode(1, { label: '网关项目', endpointType: 'project', risk: { high: 2 } }),
      makeNode(2, { label: '计费任务', endpointType: 'task' }),
    ]
    const edges = [makeEdge(10, 'n1', 'n2', { riskLevel: 'high' })]
    hookMocks.useMpdGraph.mockReturnValue(okQuery({ data: makeResponse(nodes, edges) }))
    renderPanel()

    fireEvent.click(byData('[data-mpd-graph-node="n1"]'))
    expect(document.querySelector('[data-mpd-graph-node-drawer]')).not.toBeNull()
    expect(screen.getByText('端点类型')).toBeTruthy()
    // 关联依赖边列表展示目标端点
    expect(document.querySelector('[data-mpd-graph-incident-edge="10"]')).not.toBeNull()
    expect(screen.getByText('关联依赖边（1）')).toBeTruthy()
    // 关联依赖边列表
    expect(document.querySelector('[data-mpd-graph-incident-edge="10"]')).not.toBeNull()
    expect(screen.getByText(/关联依赖边（1）/)).toBeTruthy()

    fireEvent.click(byData('[data-mpd-graph-node-drawer-close]'))
    expect(document.querySelector('[data-mpd-graph-node-drawer]')).toBeNull()
    // 交互全程零写：图谱面板本身无写请求
    const requests = screen.queryAllByRole('button')
    expect(requests.some((button) => /新建|编辑|删除|归档/.test(button.textContent ?? ''))).toBe(
      false,
    )
  })

  test('普通成员读态：无任何写按钮（RL-06 写入口物理隐藏）', () => {
    const nodes = [makeNode(1), makeNode(2)]
    const edges = [makeEdge(10, 'n1', 'n2')]
    hookMocks.useMpdGraph.mockReturnValue(okQuery({ data: makeResponse(nodes, edges) }))
    renderPanel()
    const buttons = Array.from(document.querySelectorAll('button')).map((button) => ({
      text: button.textContent ?? '',
      label: button.getAttribute('aria-label') ?? '',
    }))
    expect(
      buttons.every((button) => !/(新建|编辑|归档|恢复|删除)/.test(button.text + button.label)),
    ).toBe(true)
  })
})

describe('PmoDependencyGraphPanel 错误与禁用态', () => {
  test('项目范围获取失败 → 错误卡，图谱查询禁用（null query + enabled=false）', () => {
    const refetch = vi.fn()
    portfolioMocks.usePortfolioProjects.mockReturnValue(
      okQuery(undefined, { isError: true, error: { message: 'boom' }, refetch }),
    )
    renderPanel()

    expect(screen.getByText('无法确定图谱项目范围')).toBeTruthy()
    const lastCall = hookMocks.useMpdGraph.mock.calls.at(-1)
    expect(lastCall?.[1]).toBeNull()
    expect(lastCall?.[2]).toBe(false)

    fireEvent.click(byData('[data-mpd-graph-retry]'))
    expect(refetch).toHaveBeenCalled()
  })

  test('FEATURE_DISABLED → 诚实降级（不伪造图谱数据）', () => {
    portfolioMocks.usePortfolioProjects.mockReturnValue(okQuery(projectList()))
    hookMocks.useMpdGraph.mockReturnValue(
      okQuery(undefined, { isError: true, error: { code: 'FEATURE_DISABLED', message: 'x' } }),
    )
    renderPanel()
    expect(screen.getByText('跨项目依赖图谱不可用')).toBeTruthy()
    expect(screen.getByText(/FEATURE_MPD_CRUD/)).toBeTruthy()
  })

  test('图谱接口失败 → 错误卡 + 重新加载重新触发查询', () => {
    const graphRefetch = vi.fn()
    hookMocks.useMpdGraph.mockReturnValue(
      okQuery(undefined, { isError: true, error: { message: '500' }, refetch: graphRefetch }),
    )
    renderPanel()
    expect(screen.getByText('依赖图谱加载失败')).toBeTruthy()
    fireEvent.click(byData('[data-mpd-graph-retry]'))
    expect(graphRefetch).toHaveBeenCalled()
  })

  test('筛选联动：状态/风险筛选映射进 graph query（新鲜度转 freshnessThreshold）', () => {
    const nodes = [makeNode(1), makeNode(2)]
    const edges = [makeEdge(10, 'n1', 'n2')]
    hookMocks.useMpdGraph.mockReturnValue(okQuery({ data: makeResponse(nodes, edges) }))
    renderPanel({
      filters: {
        category: 'technical',
        type: '',
        status: 'at_risk',
        riskLevel: 'high',
        freshness: 'stale',
      },
    })
    const lastCall = hookMocks.useMpdGraph.mock.calls.at(-1)
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        category: 'technical',
        status: ['at_risk'],
        riskLevel: 'high',
        freshnessThreshold: 'stale',
        projectIds: [1, 2, 3],
      }),
    )
    expect(lastCall?.[2]).toBe(true)
  })
})

function byData(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`未找到元素：${selector}`)
  return element
}
