// 多项目依赖图谱共享合同测试（v3-multi-project-dependency-graph §2.5-2.6）。
// 零运行时依赖——只测试纯函数。

import { describe, it, expect } from 'vitest'
import {
  normalizeGraphViewFilters,
  DEFAULT_GRAPH_VIEW_FILTERS,
  serializeGraphViewFiltersToParams,
  deserializeGraphViewFiltersFromParams,
  hashGraphViewFilters,
  deriveNodeVisualState,
  deriveEdgeVisualState,
  deriveGraphWarningSummary,
  deriveGraphTruncationState,
  deriveGraphFreshnessSummary,
  deriveBoundedGraphSummary,
  buildGraphFeatureDisabledResponse,
  isGraphFeatureDisabled,
  isValidGraphLayoutMode,
  isValidGraphViewMode,
  type GraphViewFilters,
} from './multi-project-dependency-graph.js'
import { normalizeGraphQuery, stableHash } from './multi-project-dependency-model.js'
import {
  visibleGraphFixture,
  redactedGraphFixture,
  staleGraphFixture,
  truncatedGraphFixture,
  emptyGraphFixture,
  largeGraphResponseFixture,
  defaultGraphViewFiltersFixture,
  strictGraphViewFiltersFixture,
} from './multi-project-dependency-graph-fixtures.js'

// =========================================================================
// §2.5 运行时中立性
// =========================================================================

describe('共享图谱合同运行时中立性', () => {
  it('normalizeGraphViewFilters 不抛出运行时异常', () => {
    expect(() => normalizeGraphViewFilters({})).not.toThrow()
  })

  it('DEFAULT_GRAPH_VIEW_FILTERS 是有效对象', () => {
    expect(DEFAULT_GRAPH_VIEW_FILTERS.layoutMode).toBe('layered')
    expect(DEFAULT_GRAPH_VIEW_FILTERS.depth).toBe(3)
  })

  it('hashGraphViewFilters 不抛出运行时异常', () => {
    const filters = defaultGraphViewFiltersFixture()
    expect(() => hashGraphViewFilters(filters)).not.toThrow()
  })

  it('derive* 纯函数不抛出异常', () => {
    const response = visibleGraphFixture()
    expect(() => deriveGraphWarningSummary(response)).not.toThrow()
    expect(() => deriveGraphTruncationState(response)).not.toThrow()
    expect(() => deriveGraphFreshnessSummary(response)).not.toThrow()
    expect(() => deriveBoundedGraphSummary(response)).not.toThrow()
  })
})

// =========================================================================
// §2.6 确定性哈希与查询规范化
// =========================================================================

describe('图谱查询规范化与确定性哈希', () => {
  it('规范化后字段完整', () => {
    const result = normalizeGraphViewFilters({})
    expect(result.projectScope).toEqual([])
    expect(result.depth).toBe(DEFAULT_GRAPH_VIEW_FILTERS.depth)
    expect(result.nodeLimit).toBe(DEFAULT_GRAPH_VIEW_FILTERS.nodeLimit)
    expect(result.edgeLimit).toBe(DEFAULT_GRAPH_VIEW_FILTERS.edgeLimit)
    expect(result.layoutMode).toBe(DEFAULT_GRAPH_VIEW_FILTERS.layoutMode)
  })

  it('字段顺序不同产生相同哈希', () => {
    const a: Partial<GraphViewFilters> = {
      projectScope: [1, 2],
      depth: 3,
      layoutMode: 'layered',
      nodeLimit: 100,
      edgeLimit: 200,
    }
    const b: Partial<GraphViewFilters> = {
      edgeLimit: 200,
      layoutMode: 'layered',
      nodeLimit: 100,
      projectScope: [1, 2],
      depth: 3,
    }
    const ha = hashGraphViewFilters(normalizeGraphViewFilters(a))
    const hb = hashGraphViewFilters(normalizeGraphViewFilters(b))
    expect(ha).toBe(hb)
  })

  it('不同筛选器产生不同哈希', () => {
    const ha = hashGraphViewFilters(defaultGraphViewFiltersFixture())
    const hb = hashGraphViewFilters(strictGraphViewFiltersFixture())
    expect(ha).not.toBe(hb)
  })

  it('边界值被限制', () => {
    const result = normalizeGraphViewFilters({
      depth: 9999,
      nodeLimit: 99999,
      edgeLimit: 99999,
    })
    expect(result.depth).toBeLessThanOrEqual(20)
    expect(result.nodeLimit).toBeLessThanOrEqual(2000)
    expect(result.edgeLimit).toBeLessThanOrEqual(5000)
  })

  it('与后端 normalizeGraphQuery 兼容', () => {
    const filters = strictGraphViewFiltersFixture()
    const apiQuery = {
      projectIds: filters.projectScope,
      endpointType: undefined,
      category: filters.category,
      status: filters.status,
      riskLevel: filters.risk,
      maxDepth: filters.depth,
      nodeLimit: filters.nodeLimit,
      edgeLimit: filters.edgeLimit,
      freshnessThreshold: filters.freshnessThreshold,
    }
    const normalized = normalizeGraphQuery(apiQuery, {
      maxDepth: 20,
      nodeLimit: 2000,
      edgeLimit: 5000,
    })
    expect(normalized.projectIds).toEqual(filters.projectScope)
    expect(normalized.maxDepth).toBe(filters.depth)
    expect(normalized.nodeLimit).toBe(filters.nodeLimit)
    expect(normalized.edgeLimit).toBe(filters.edgeLimit)
  })
})

// =========================================================================
// 枚举白名单
// =========================================================================

describe('枚举白名单', () => {
  it('有效布局模式通过验证', () => {
    expect(isValidGraphLayoutMode('layered')).toBe(true)
    expect(isValidGraphLayoutMode('force-directed')).toBe(true)
    expect(isValidGraphLayoutMode('radial')).toBe(true)
  })

  it('无效布局模式被拒绝', () => {
    expect(isValidGraphLayoutMode('circular')).toBe(false)
    expect(isValidGraphLayoutMode('tree')).toBe(false)
    expect(isValidGraphLayoutMode('')).toBe(false)
  })

  it('有效视图模式通过验证', () => {
    expect(isValidGraphViewMode('list')).toBe(true)
    expect(isValidGraphViewMode('graph')).toBe(true)
  })

  it('无效视图模式被拒绝', () => {
    expect(isValidGraphViewMode('table')).toBe(false)
    expect(isValidGraphViewMode('')).toBe(false)
  })
})

// =========================================================================
// 序列化/反序列化循环
// =========================================================================

describe('图谱筛选器序列化', () => {
  it('序列化再反序列化保持等价', () => {
    const original = strictGraphViewFiltersFixture()
    const params = serializeGraphViewFiltersToParams(original)
    const restored = deserializeGraphViewFiltersFromParams(params)

    // 核心字段应保持等价
    expect(restored.projectScope).toEqual(original.projectScope)
    expect(restored.category).toBe(original.category)
    expect(restored.risk).toBe(original.risk)
    expect(restored.depth).toBe(original.depth)
    expect(restored.nodeLimit).toBe(original.nodeLimit)
    expect(restored.edgeLimit).toBe(original.edgeLimit)
    expect(restored.layoutMode).toBe(original.layoutMode)
  })

  it('默认值不在序列化中出现', () => {
    const filters = normalizeGraphViewFilters({ projectScope: [1] })
    const params = serializeGraphViewFiltersToParams(filters)
    // 默认的 layoutMode 不应出现在 params 中
    expect(params['layoutMode']).toBeUndefined()
    // 默认的 depth 不应出现
    expect(params['depth']).toBeUndefined()
  })

  it('非默认值出现在序列化中', () => {
    const filters = strictGraphViewFiltersFixture()
    const params = serializeGraphViewFiltersToParams(filters)
    expect(params['layoutMode']).toBe('force-directed')
    expect(params['depth']).toBe('2')
  })
})

// =========================================================================
// 视觉状态派生
// =========================================================================

describe('视觉状态派生', () => {
  it('deriveNodeVisualState 返回有效状态', () => {
    const response = visibleGraphFixture()
    const state = deriveNodeVisualState(response.nodes[0], null, null)
    expect(state.nodeId).toBe(response.nodes[0].nodeId)
    expect(state.isRedacted).toBe(false)
    expect(state.isSelected).toBe(false)
    expect(state.isFocused).toBe(false)
  })

  it('选中节点 isSelected 为 true', () => {
    const response = visibleGraphFixture()
    const state = deriveNodeVisualState(response.nodes[0], response.nodes[0].nodeId, null)
    expect(state.isSelected).toBe(true)
  })

  it('脱敏节点 isRedacted 为 true', () => {
    const response = redactedGraphFixture()
    const redacted = response.nodes.find((n) => n.redacted)!
    const state = deriveNodeVisualState(redacted, null, null)
    expect(state.isRedacted).toBe(true)
    expect(state.redactionReason).toBe('project_restricted')
  })

  it('deriveEdgeVisualState 返回有效状态', () => {
    const response = visibleGraphFixture()
    const state = deriveEdgeVisualState(response.edges[0], null, null)
    expect(state.edgeId).toBe(response.edges[0].edgeId)
    expect(state.riskEncoded).toBe(response.edges[0].riskLevel)
    expect(state.isSelected).toBe(false)
  })

  it('deriveEdgeVisualState 陈旧边标识新鲜度', () => {
    const response = staleGraphFixture()
    const state = deriveEdgeVisualState(response.edges[0], null, null)
    expect(state.freshnessEncoded).toBe('stale')
    expect(state.warningCodes).toContain('DEPENDENCY_STALE')
  })
})

// =========================================================================
// 摘要统计
// =========================================================================

describe('图谱摘要统计', () => {
  it('deriveBoundedGraphSummary 可见图谱', () => {
    const response = visibleGraphFixture()
    const summary = deriveBoundedGraphSummary(response)
    expect(summary.totalNodes).toBe(4)
    expect(summary.totalEdges).toBe(3)
    expect(summary.redactedNodes).toBe(0)
    expect(summary.truncated).toBe(false)
  })

  it('deriveBoundedGraphSummary 脱敏图谱', () => {
    const response = redactedGraphFixture()
    const summary = deriveBoundedGraphSummary(response)
    expect(summary.redactedNodes).toBe(1)
    expect(summary.warningCodes).toContain('ENDPOINT_REDACTED')
  })

  it('deriveBoundedGraphSummary 截断图谱', () => {
    const response = truncatedGraphFixture()
    const summary = deriveBoundedGraphSummary(response)
    expect(summary.truncated).toBe(true)
    expect(summary.truncatedReason).toBe('edgeLimit')
  })

  it('deriveGraphWarningSummary 正确处理警告', () => {
    const response = redactedGraphFixture()
    const summary = deriveGraphWarningSummary(response)
    expect(summary.codes.length).toBeGreaterThan(0)
  })

  it('deriveGraphFreshnessSummary 空图谱', () => {
    const response = emptyGraphFixture()
    const summary = deriveGraphFreshnessSummary(response)
    expect(summary.staleCount).toBe(0)
    expect(summary.freshCount).toBe(0)
    expect(summary.staleNodeIds).toEqual([])
    expect(summary.staleEdgeIds).toEqual([])
  })

  it('deriveGraphFreshnessSummary 陈旧图谱', () => {
    const response = staleGraphFixture()
    const summary = deriveGraphFreshnessSummary(response)
    expect(summary.staleCount).toBe(2)
    expect(summary.freshCount).toBe(0)
    expect(summary.staleEdgeIds.length).toBe(2)
    expect(summary.staleNodeIds.length).toBeGreaterThan(0)
  })
})

// =========================================================================
// 功能禁用
// =========================================================================

describe('功能禁用', () => {
  it('isGraphFeatureDisabled 对禁用响应返回 true', () => {
    const resp = { data: null, featureDisabled: buildGraphFeatureDisabledResponse() }
    expect(isGraphFeatureDisabled(resp)).toBe(true)
  })

  it('isGraphFeatureDisabled 对正常响应返回 false', () => {
    const resp = { data: visibleGraphFixture() }
    expect(isGraphFeatureDisabled(resp)).toBe(false)
  })
})

// =========================================================================
// 夹具边界
// =========================================================================

describe('夹具边界', () => {
  it('visibleGraphFixture 有 4 节点 3 边', () => {
    const fixture = visibleGraphFixture()
    expect(fixture.nodes.length).toBe(4)
    expect(fixture.edges.length).toBe(3)
    expect(fixture.truncated).toBe(false)
  })

  it('redactedGraphFixture 有脱敏节点', () => {
    const fixture = redactedGraphFixture()
    expect(fixture.redactedNodeCount).toBeGreaterThan(0)
  })

  it('staleGraphFixture 有陈旧边', () => {
    const fixture = staleGraphFixture()
    expect(fixture.freshnessMeta.staleCount).toBeGreaterThan(0)
  })

  it('truncatedGraphFixture 截断标志为 true', () => {
    const fixture = truncatedGraphFixture()
    expect(fixture.truncated).toBe(true)
  })

  it('emptyGraphFixture 无节点无边', () => {
    const fixture = emptyGraphFixture()
    expect(fixture.nodes.length).toBe(0)
    expect(fixture.edges.length).toBe(0)
  })

  it('largeGraphResponseFixture 支持 1000 节点 2000 边', () => {
    const fixture = largeGraphResponseFixture(1000, 2000)
    expect(fixture.nodes.length).toBe(1000)
    expect(fixture.edges.length).toBe(2000)
    expect(fixture.truncated).toBe(true)
  })

  it('largeGraphResponseFixture 支持自定义参数', () => {
    const fixture = largeGraphResponseFixture(10, 15)
    expect(fixture.nodes.length).toBe(10)
    expect(fixture.edges.length).toBe(15)
  })
})
