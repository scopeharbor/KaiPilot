import type {
  FunctionAnalysisCollectorOutput,
  FunctionComponentNode,
  FunctionRelationEdge,
  FunctionIssueCandidate,
  FunctionAnalysisLayoutMetadata,
  FunctionIssueType,
  FunctionIssueSeverity,
  FunctionEdgeType,
  ComponentNodeType,
  ComponentScope,
  FunctionAnalysisSourceRef,
} from '@aiproj/types'
import {
  FUNCTION_ANALYSIS_RULESET_VERSION,
  FUNCTION_ANALYSIS_LAYOUT_VERSION,
  computeFunctionNodeKey,
  computeFunctionEdgeKey,
  computeFunctionIssueKey,
  computeFunctionIssueImpactScore,
  compareFunctionIssueCandidate,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'

/**
 * TRIZ 功能分析图规则引擎（v3-triz-function-analysis-diagram §4.2–§4.4）。
 *
 * 确定性优先：从 Collector 输出生成 nodes、edges、issues 和 layout。
 * 所有计算纯函数，无副作用，不调用外部服务。
 * 规则集版本：{@link FUNCTION_ANALYSIS_RULESET_VERSION}
 */
@inject()
export default class FunctionAnalysisRuleEngine {
  /**
   * 生成功能分析图（节点、边、问题候选和布局）。
   */
  generate(input: FunctionAnalysisCollectorOutput): {
    nodes: FunctionComponentNode[]
    edges: FunctionRelationEdge[]
    issues: FunctionIssueCandidate[]
    layout: FunctionAnalysisLayoutMetadata
  } {
    const nodes = this.buildNodes(input)
    const edges = this.buildEdges(input, nodes)
    const issues = this.detectIssues(input, nodes, edges)
    const layout = this.computeLayout(nodes, edges)

    // 稳定排序
    issues.sort(compareFunctionIssueCandidate)

    return { nodes, edges, issues, layout }
  }

  // ─── Private: Node building ───

  /**
   * 从任务组件和手工补充组件构建节点。
   */
  private buildNodes(input: FunctionAnalysisCollectorOutput): FunctionComponentNode[] {
    const nodeMap = new Map<string, FunctionComponentNode>()

    // 任务组件 → system_component 节点
    for (let i = 0; i < input.taskComponents.length; i++) {
      const tc = input.taskComponents[i]
      const nodeKey = computeFunctionNodeKey('system_component', tc.title, i)
      nodeMap.set(
        nodeKey,
        this.makeNode(nodeKey, tc.title, 'system_component', 'internal', [
          { sourceType: 'task', sourceId: tc.taskId, lowSensitiveTitle: tc.title, hash: tc.hash },
        ]),
      )
    }

    // 手工补充组件 → user_supplied 节点
    for (let i = 0; i < input.manualComponents.length; i++) {
      const mc = input.manualComponents[i]
      const nodeKey = computeFunctionNodeKey(
        'user_supplied',
        mc.name,
        input.taskComponents.length + i,
      )
      nodeMap.set(nodeKey, this.makeNode(nodeKey, mc.name, 'user_supplied', 'external', []))
    }

    return Array.from(nodeMap.values())
  }

  // ─── Private: Edge ───

  /**
   * 从依赖关系构建 useful 边，从手工补充组件构建对应边。
   */
  private buildEdges(
    input: FunctionAnalysisCollectorOutput,
    nodes: FunctionComponentNode[],
  ): FunctionRelationEdge[] {
    const nodeByTaskId = new Map<number, string>()
    for (const n of nodes) {
      for (const ref of n.sourceRefs) {
        if (ref.sourceType === 'task') {
          nodeByTaskId.set(ref.sourceId, n.nodeKey)
        }
      }
    }

    const nodeByName = new Map<string, string>()
    for (const n of nodes) {
      nodeByName.set(n.label, n.nodeKey)
    }

    const edgeSet = new Set<string>()
    const edges: FunctionRelationEdge[] = []

    // 任务依赖 → useful 边
    for (const dep of input.dependencySummary) {
      const fromKey = nodeByTaskId.get(dep.fromTaskId)
      const toKey = nodeByTaskId.get(dep.toTaskId)
      if (fromKey && toKey) {
        const edgeKey = computeFunctionEdgeKey(fromKey, toKey, 'useful')
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          edges.push(this.makeEdge(edgeKey, fromKey, toKey, 'useful', '依赖关系', 0.8, 0.9))
        }
      }
    }

    // 手工补充组件 → relatesTo 映射的边
    for (const mc of input.manualComponents) {
      if (mc.relatesTo) {
        const fromKey = nodeByName.get(mc.name)
        if (fromKey) {
          for (const targetName of mc.relatesTo) {
            const toKey = nodeByName.get(targetName)
            if (toKey) {
              const funcType: FunctionEdgeType = mc.functionType ?? 'useful'
              const edgeKey = computeFunctionEdgeKey(fromKey, toKey, funcType)
              if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey)
                edges.push(
                  this.makeEdge(
                    edgeKey,
                    fromKey,
                    toKey,
                    funcType,
                    mc.description ?? mc.name,
                    mc.strength ?? 0.7,
                    0.8,
                  ),
                )
              }
            }
          }
        }
      }
    }

    return edges
  }

  // ─── Private: Issue Detection ───

  /**
   * 检测问题候选：harmful_function、insufficient_function、
   * isolated_component、single_point_dependency、duplicate_function、
   * trim_candidate、excessive_function。
   */
  private detectIssues(
    input: FunctionAnalysisCollectorOutput,
    nodes: FunctionComponentNode[],
    edges: FunctionRelationEdge[],
  ): FunctionIssueCandidate[] {
    const issues: FunctionIssueCandidate[] = []

    // 计算节点入度/出度
    const inDegree = new Map<string, number>()
    const outDegree = new Map<string, number>()
    for (const e of edges) {
      inDegree.set(e.toNodeKey, (inDegree.get(e.toNodeKey) ?? 0) + 1)
      outDegree.set(e.fromNodeKey, (outDegree.get(e.fromNodeKey) ?? 0) + 1)
    }

    const nodeMap = new Map<string, FunctionComponentNode>()
    for (const n of nodes) {
      nodeMap.set(n.nodeKey, n)
    }

    // 高风险 → harmful_function
    for (const risk of input.riskSummary) {
      if (risk.probability >= 0.7 && risk.impact >= 0.7) {
        // 找到可能关联的节点
        for (const n of nodes) {
          issues.push(
            this.makeIssue(
              'harmful_function',
              'high',
              0.85,
              [n.nodeKey],
              [],
              `高风险 "${risk.title}"（概率 ${risk.probability}，影响 ${risk.impact}）可能引入有害功能`,
              [
                {
                  action: 'trim_or_replace',
                  rationale: '考虑消除或替换高风险关联组件',
                  confidence: 0.8,
                },
              ],
            ),
          )
        }
      }
    }

    // 资源超载 → insufficient_function
    for (const res of input.resourceSummary) {
      // 资源摘要已暗示负载情况
      const associatedNodes = nodes.filter((n) =>
        n.sourceRefs.some((r) => r.sourceType === 'resource' && r.sourceId === res.resourceId),
      )
      if (associatedNodes.length > 0) {
        issues.push(
          this.makeIssue(
            'insufficient_function',
            'medium',
            0.7,
            associatedNodes.map((n) => n.nodeKey),
            [],
            `资源 "${res.name}" 可能不足，导致相关组件功能不足`,
            [{ action: 'add_resource', rationale: '增加或优化资源配置', confidence: 0.7 }],
          ),
        )
      }
    }

    // 无关联节点 → isolated_component
    for (const n of nodes) {
      const degIn = inDegree.get(n.nodeKey) ?? 0
      const degOut = outDegree.get(n.nodeKey) ?? 0
      if (degIn === 0 && degOut === 0 && n.componentType === 'system_component') {
        issues.push(
          this.makeIssue(
            'isolated_component',
            'low',
            0.6,
            [n.nodeKey],
            [],
            `组件 "${n.label}" 在图中无关联，可能是孤立组件`,
            [{ action: 'investigate', rationale: '确认是否需要此组件', confidence: 0.6 }],
          ),
        )
      }
    }

    // 单点依赖 → single_point_dependency
    const allRefs = new Set<string>()
    for (const e of edges) {
      allRefs.add(e.toNodeKey)
    }
    for (const n of nodes) {
      const degOut = outDegree.get(n.nodeKey) ?? 0
      const isSoleTarget = [...allRefs].length > 1 && allRefs.size === 1 && allRefs.has(n.nodeKey)
      if (isSoleTarget && degOut > 2) {
        issues.push(
          this.makeIssue(
            'single_point_dependency',
            'high',
            0.8,
            [n.nodeKey],
            [],
            `组件 "${n.label}" 是所有边的唯一目标，存在单点故障风险`,
            [{ action: 'add_redundancy', rationale: '考虑增加冗余或分担负载', confidence: 0.8 }],
          ),
        )
      }
    }

    // 入度出度均为 0 → trim_candidate
    for (const n of nodes) {
      const degIn = inDegree.get(n.nodeKey) ?? 0
      const degOut = outDegree.get(n.nodeKey) ?? 0
      if (degIn === 0 && degOut === 0) {
        issues.push(
          this.makeIssue(
            'trim_candidate',
            'low',
            0.5,
            [n.nodeKey],
            [],
            `组件 "${n.label}" 无任何连接，可能是裁剪候选`,
            [{ action: 'trim', rationale: '评估是否可以裁剪此组件', confidence: 0.5 }],
          ),
        )
      }
    }

    // 出度 > 5 → excessive_function
    for (const n of nodes) {
      const degOut = outDegree.get(n.nodeKey) ?? 0
      if (degOut > 5) {
        issues.push(
          this.makeIssue(
            'excessive_function',
            'medium',
            0.65,
            [n.nodeKey],
            [],
            `组件 "${n.label}" 出度 ${degOut}，可能承担过多功能`,
            [{ action: 'decompose', rationale: '考虑拆分为多个子组件', confidence: 0.65 }],
          ),
        )
      }
    }

    // 同名节点 → duplicate_function
    const labelCount = new Map<string, string[]>()
    for (const n of nodes) {
      const key = n.label.toLowerCase()
      if (!labelCount.has(key)) labelCount.set(key, [])
      labelCount.get(key)!.push(n.nodeKey)
    }
    for (const [, dups] of labelCount) {
      if (dups.length > 1) {
        issues.push(
          this.makeIssue(
            'duplicate_function',
            'medium',
            0.6,
            dups,
            [],
            `发现 ${dups.length} 个同名组件，可能存在功能重复`,
            [{ action: 'merge', rationale: '考虑合并重复组件', confidence: 0.6 }],
          ),
        )
      }
    }

    return issues
  }

  // ─── Private: Layout ───

  /**
   * 计算确定性布局（简单分层算法）。
   */
  private computeLayout(
    nodes: FunctionComponentNode[],
    _edges: FunctionRelationEdge[],
  ): FunctionAnalysisLayoutMetadata {
    const layerMap = new Map<string, number>()
    const visited = new Set<string>()
    const queue: string[] = []

    // BFS 分层
    for (const n of nodes) {
      if (!visited.has(n.nodeKey)) {
        queue.push(n.nodeKey)
        visited.add(n.nodeKey)
        layerMap.set(n.nodeKey, 0)
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!
      const currentLayer = layerMap.get(current) ?? 0
      for (const e of _edges) {
        if (e.fromNodeKey === current && !visited.has(e.toNodeKey)) {
          visited.add(e.toNodeKey)
          layerMap.set(e.toNodeKey, currentLayer + 1)
          queue.push(e.toNodeKey)
        }
      }
    }

    const layers: Map<number, string[]> = new Map()
    for (const [key, layer] of layerMap) {
      if (!layers.has(layer)) layers.set(layer, [])
      layers.get(layer)!.push(key)
    }

    const nodePositions: Record<string, { x: number; y: number }> = {}
    const spacingX = 180
    const spacingY = 100

    let maxX = 0
    let maxY = 0
    for (const [layer, nodeKeys] of layers) {
      for (const [i, nodeKey] of nodeKeys.entries()) {
        const x = (layer + 1) * spacingX
        const y = (i + 1) * spacingY
        nodePositions[nodeKey] = { x, y }
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }

    return {
      layoutVersion: FUNCTION_ANALYSIS_LAYOUT_VERSION,
      algorithm: 'layered',
      bounds: { minX: 0, minY: 0, maxX, maxY },
      nodePositions,
    }
  }

  // ─── Helpers ───

  private makeNode(
    nodeKey: string,
    label: string,
    componentType: ComponentNodeType,
    scope: ComponentScope,
    sourceRefs: FunctionAnalysisSourceRef[],
  ): FunctionComponentNode {
    return {
      nodeKey,
      label,
      componentType,
      scope,
      status: 'active',
      sourceRefs,
      sourceHashes: {},
      metrics: { inDegree: 0, outDegree: 0, totalWeight: 0 },
      position: null,
      warningCodes: [],
    }
  }

  private makeEdge(
    edgeKey: string,
    fromNodeKey: string,
    toNodeKey: string,
    functionType: FunctionEdgeType,
    label: string,
    strength: number,
    confidence: number,
  ): FunctionRelationEdge {
    return {
      edgeKey,
      fromNodeKey,
      toNodeKey,
      functionType,
      label,
      strength,
      confidence,
      evidenceRefs: [],
      sourceHashes: {},
      warningCodes: [],
    }
  }

  private makeIssue(
    issueType: FunctionIssueType,
    severity: FunctionIssueSeverity,
    confidence: number,
    nodeRefs: string[],
    edgeRefs: string[],
    rationaleSummary: string,
    suggestedActions: Array<{ action: string; rationale: string; confidence: number }>,
  ): FunctionIssueCandidate {
    const impactScore = computeFunctionIssueImpactScore(
      severity,
      confidence,
      nodeRefs.length,
      edgeRefs.length,
    )
    const issueKey = computeFunctionIssueKey(issueType, nodeRefs, edgeRefs)
    return {
      issueKey,
      issueType,
      severity,
      confidence,
      impactScore,
      status: 'unreviewed',
      nodeRefs,
      edgeRefs,
      rationaleSummary,
      suggestedActions,
      sourceHashes: {},
      aiExplanationRef: null,
      reviewedBy: null,
      reviewedAt: null,
      warningCodes: [],
      outputHash: '',
      createdAt: new Date().toISOString(),
      updatedAt: null,
    }
  }
}
