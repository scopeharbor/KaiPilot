// 多项目依赖图谱测试夹具（v3-multi-project-dependency-graph §2.4）。
// 零运行时依赖——只用于测试和开发。
// 覆盖 visible/redacted/stale/truncated/no-permission/empty/large 场景。

import type {
  MultiProjectGraphResponse,
  MultiProjectGraphNode,
  MultiProjectGraphEdge,
} from './multi-project-dependency-model.js'
import type {
  GraphViewFilters,
  GraphResponseEnvelope,
  GraphFeatureDisabledResponse,
} from './multi-project-dependency-graph.js'
import { buildRedactedEndpoint } from './multi-project-dependency-model.js'

// ---------------------------------------------------------------------------
// 节点/边工厂
// ---------------------------------------------------------------------------

let _nodeSeq = 0
let _edgeSeq = 0

function resetSeq() {
  _nodeSeq = 0
  _edgeSeq = 0
}

function makeNode(overrides?: Partial<MultiProjectGraphNode>): MultiProjectGraphNode {
  _nodeSeq++
  const id = `node-${_nodeSeq}`
  return {
    nodeId: id,
    endpoint: {
      endpointType: 'project',
      projectId: _nodeSeq,
      projectName: `项目 ${_nodeSeq}`,
      taskId: null,
      taskName: null,
      milestoneId: null,
      milestoneName: null,
      externalLabel: null,
      redacted: false,
    },
    label: `项目 ${_nodeSeq}`,
    redacted: false,
    redactionReason: null,
    dependencyCount: 1,
    riskSummary: { critical: 0, high: 0, medium: 1, low: 0 },
    drillDownRef: {
      refType: 'dependency',
      targetId: _nodeSeq,
      opaqueToken: `token-node-${_nodeSeq}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
    ...overrides,
  }
}

function makeEdge(
  sourceId: string,
  targetId: string,
  overrides?: Partial<MultiProjectGraphEdge>,
): MultiProjectGraphEdge {
  _edgeSeq++
  return {
    edgeId: _edgeSeq,
    sourceNodeId: sourceId,
    targetNodeId: targetId,
    category: 'deliverable',
    type: 'fs',
    status: 'active',
    riskLevel: 'medium',
    bufferDays: 2,
    lagDays: 0,
    freshness: 'fresh',
    drillDownRef: {
      refType: 'dependency',
      targetId: _edgeSeq,
      opaqueToken: `token-edge-${_edgeSeq}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
    warningCodes: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// §F1. 可见图谱夹具
// ---------------------------------------------------------------------------

export function visibleGraphFixture(): MultiProjectGraphResponse {
  resetSeq()
  const n1 = makeNode()
  const n2 = makeNode()
  const n3 = makeNode()
  const n4 = makeNode()

  const e1 = makeEdge(n1.nodeId, n2.nodeId)
  const e2 = makeEdge(n2.nodeId, n3.nodeId)
  const e3 = makeEdge(n3.nodeId, n4.nodeId)

  return {
    nodes: [n1, n2, n3, n4],
    edges: [e1, e2, e3],
    visibleNodeCount: 4,
    redactedNodeCount: 0,
    visibleEdgeCount: 3,
    truncated: false,
    truncationReason: null,
    warningCodes: [],
    freshnessMeta: {
      checkedAt: new Date().toISOString(),
      staleCount: 0,
      freshCount: 3,
    },
  }
}

// ---------------------------------------------------------------------------
// §F2. 脱敏图谱夹具（含被限制的端点）
// ---------------------------------------------------------------------------

export function redactedGraphFixture(): MultiProjectGraphResponse {
  resetSeq()
  const n1 = makeNode()
  const nRedacted = makeNode({
    endpoint: buildRedactedEndpoint('project_restricted', 'project'),
    label: '***',
    redacted: true,
    redactionReason: 'project_restricted',
    drillDownRef: null,
  })
  const n3 = makeNode()

  const e1 = makeEdge(n1.nodeId, nRedacted.nodeId)
  const e2 = makeEdge(nRedacted.nodeId, n3.nodeId)

  return {
    nodes: [n1, nRedacted, n3],
    edges: [e1, e2],
    visibleNodeCount: 2,
    redactedNodeCount: 1,
    visibleEdgeCount: 2,
    truncated: false,
    truncationReason: null,
    warningCodes: ['ENDPOINT_REDACTED', 'PROJECT_RESTRICTED'],
    freshnessMeta: {
      checkedAt: new Date().toISOString(),
      staleCount: 0,
      freshCount: 2,
    },
  }
}

// ---------------------------------------------------------------------------
// §F3. 陈旧/新鲜度过期图谱夹具
// ---------------------------------------------------------------------------

export function staleGraphFixture(): MultiProjectGraphResponse {
  resetSeq()
  const n1 = makeNode()
  const n2 = makeNode()
  const n3 = makeNode()

  const e1 = makeEdge(n1.nodeId, n2.nodeId, {
    freshness: 'stale',
    warningCodes: ['DEPENDENCY_STALE'],
  })
  const e2 = makeEdge(n2.nodeId, n3.nodeId, {
    freshness: 'stale',
    warningCodes: ['DEPENDENCY_STALE'],
  })

  return {
    nodes: [n1, n2, n3],
    edges: [e1, e2],
    visibleNodeCount: 3,
    redactedNodeCount: 0,
    visibleEdgeCount: 2,
    truncated: false,
    truncationReason: null,
    warningCodes: ['DEPENDENCY_STALE'],
    freshnessMeta: {
      checkedAt: new Date().toISOString(),
      staleCount: 2,
      freshCount: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// §F4. 截断图谱夹具
// ---------------------------------------------------------------------------

export function truncatedGraphFixture(): MultiProjectGraphResponse {
  resetSeq()
  const nodes: MultiProjectGraphNode[] = []
  const edges: MultiProjectGraphEdge[] = []

  for (let i = 0; i < 50; i++) {
    nodes.push(makeNode())
  }
  for (let i = 0; i < 49; i++) {
    edges.push(makeEdge(nodes[i]!.nodeId, nodes[i + 1]!.nodeId))
  }

  return {
    nodes,
    edges,
    visibleNodeCount: 50,
    redactedNodeCount: 0,
    visibleEdgeCount: 49,
    truncated: true,
    truncationReason: 'edgeLimit',
    warningCodes: ['GRAPH_TRUNCATED_EDGES'],
    freshnessMeta: {
      checkedAt: new Date().toISOString(),
      staleCount: 0,
      freshCount: 49,
    },
  }
}

// ---------------------------------------------------------------------------
// §F5. 无权限图谱夹具
// ---------------------------------------------------------------------------

export function noPermissionGraphFixture(): GraphResponseEnvelope {
  return {
    data: null,
    error: {
      code: 'PERMISSION_DENIED',
      message: '你没有查看多项目依赖图谱的权限。',
    },
  }
}

// ---------------------------------------------------------------------------
// §F6. 空图谱夹具
// ---------------------------------------------------------------------------

export function emptyGraphFixture(): MultiProjectGraphResponse {
  resetSeq()
  return {
    nodes: [],
    edges: [],
    visibleNodeCount: 0,
    redactedNodeCount: 0,
    visibleEdgeCount: 0,
    truncated: false,
    truncationReason: null,
    warningCodes: [],
    freshnessMeta: {
      checkedAt: new Date().toISOString(),
      staleCount: 0,
      freshCount: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// §F7. 功能禁用图谱夹具
// ---------------------------------------------------------------------------

export function featureDisabledGraphFixture(): GraphFeatureDisabledResponse {
  return {
    available: false,
    reason: 'feature_disabled',
    message: '多项目依赖图谱功能当前已禁用。',
  }
}

// ---------------------------------------------------------------------------
// §F8. 大型图谱夹具（1000 节点 + 2000 边）—— 性能测试用
// ---------------------------------------------------------------------------

export function largeGraphResponseFixture(
  nodeCount: number = 1000,
  edgeCount: number = 2000,
): MultiProjectGraphResponse {
  resetSeq()
  const nodes: MultiProjectGraphNode[] = []

  for (let i = 0; i < nodeCount; i++) {
    nodes.push(
      makeNode({
        label: `项目 ${i + 1}`,
        endpoint: {
          endpointType: 'project',
          projectId: i + 1,
          projectName: `项目 ${i + 1}`,
          taskId: null,
          taskName: null,
          milestoneId: null,
          milestoneName: null,
          externalLabel: null,
          redacted: false,
        },
      }),
    )
  }

  const edges: MultiProjectGraphEdge[] = []
  for (let i = 0; i < edgeCount && i < nodes.length * 3; i++) {
    const srcIdx = i % nodes.length
    const tgtIdx = (i + 1 + Math.floor(i / nodes.length)) % nodes.length
    if (srcIdx !== tgtIdx) {
      edges.push(
        makeEdge(nodes[srcIdx]!.nodeId, nodes[tgtIdx]!.nodeId, {
          riskLevel: ['medium', 'low', 'high', 'none', 'critical'][
            i % 5
          ] as MultiProjectGraphEdge['riskLevel'],
        }),
      )
    }
  }

  const staleCount = Math.floor(edgeCount * 0.1)

  return {
    nodes,
    edges,
    visibleNodeCount: nodes.length,
    redactedNodeCount: 0,
    visibleEdgeCount: edges.length,
    truncated: true,
    truncationReason: 'edgeLimit',
    warningCodes: ['GRAPH_TRUNCATED_EDGES'],
    freshnessMeta: {
      checkedAt: new Date().toISOString(),
      staleCount,
      freshCount: edges.length - staleCount,
    },
  }
}

// ---------------------------------------------------------------------------
// §F9. 图谱视图筛选器夹具
// ---------------------------------------------------------------------------

export function defaultGraphViewFiltersFixture(): GraphViewFilters {
  return {
    projectScope: [1, 2, 3],
    depth: 3,
    nodeLimit: 200,
    edgeLimit: 500,
    freshnessThreshold: 'all',
    layoutMode: 'layered',
  }
}

export function strictGraphViewFiltersFixture(): GraphViewFilters {
  return {
    projectScope: [1],
    category: 'deliverable',
    status: ['active'],
    risk: 'high',
    depth: 2,
    nodeLimit: 50,
    edgeLimit: 100,
    freshnessThreshold: 'fresh',
    layoutMode: 'force-directed',
  }
}
