// 多项目依赖图谱 UI 共享合同（v3-multi-project-dependency-graph §2）。
// 零运行时依赖——只依赖 TypeScript 类型系统与 ES 标准库。
// 供前后端共享使用，不导入 AdonisJS、React、数据库、AI、网络、缓存、图表、容器或外部提供商。

import type {
  MultiProjectGraphQuery,
  MultiProjectGraphNode,
  MultiProjectGraphEdge,
  MultiProjectGraphResponse,
  MultiProjectEndpointType,
  MultiProjectDependencyCategory,
  MultiProjectDependencyType,
  MultiProjectDependencyStatus,
  MultiProjectDependencyRiskLevel,
  MultiProjectWarningCode,
} from './multi-project-dependency-model.js'
import { stableHash } from './multi-project-dependency-model.js'

// ---------------------------------------------------------------------------
// §G1. 图谱视图筛选器（UI 侧序列化/反序列化，与后端 API 查询解耦）
// ---------------------------------------------------------------------------

/** 图谱布局模式 */
export type GraphLayoutMode = 'force-directed' | 'layered' | 'radial'

/** 图谱节点可视状态 */
export interface GraphNodeVisualState {
  nodeId: string
  riskEncoded: MultiProjectDependencyRiskLevel | 'none'
  statusEncoded: MultiProjectDependencyStatus | 'unknown'
  freshnessEncoded: 'fresh' | 'stale' | 'unknown'
  isSelected: boolean
  isFocused: boolean
  isRedacted: boolean
  redactionReason: string | null
  dependencyCount: number
  label: string
  endpointType: MultiProjectEndpointType
}

/** 图谱边可视状态 */
export interface GraphEdgeVisualState {
  edgeId: number
  sourceNodeId: string
  targetNodeId: string
  riskEncoded: MultiProjectDependencyRiskLevel
  statusEncoded: MultiProjectDependencyStatus
  freshnessEncoded: 'fresh' | 'stale' | 'unknown'
  category: MultiProjectDependencyCategory
  type: MultiProjectDependencyType
  isSelected: boolean
  isFocused: boolean
  warningCodes: MultiProjectWarningCode[]
}

/** 图谱视图筛选器（URL 可恢复） */
export interface GraphViewFilters {
  projectScope: number[]
  category?: MultiProjectDependencyCategory
  dependencyType?: MultiProjectDependencyType
  status?: MultiProjectDependencyStatus[]
  risk?: MultiProjectDependencyRiskLevel
  dateFrom?: string
  dateTo?: string
  depth: number
  nodeLimit: number
  edgeLimit: number
  freshnessThreshold?: 'fresh' | 'stale' | 'all'
  layoutMode: GraphLayoutMode
}

/** 默认图谱视图筛选器 */
export const DEFAULT_GRAPH_VIEW_FILTERS: GraphViewFilters = {
  projectScope: [],
  depth: 3,
  nodeLimit: 200,
  edgeLimit: 500,
  freshnessThreshold: 'all',
  layoutMode: 'layered',
}

// ---------------------------------------------------------------------------
// §G2. 图谱 UI 状态枚举
// ---------------------------------------------------------------------------

/** 图谱视图模式 */
export type GraphViewMode = 'list' | 'graph'

/** 图谱加载状态 */
export type GraphLoadingState =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error'
  | 'empty'
  | 'stale'
  | 'truncated'
  | 'no-permission'
  | 'feature-disabled'

/** 图谱截断状态 */
export interface GraphTruncationState {
  truncated: boolean
  reason: string | null
  visibleNodeCount: number
  redactedNodeCount: number
  visibleEdgeCount: number
  totalEstimatedNodeCount?: number
  totalEstimatedEdgeCount?: number
}

/** 图谱新鲜度摘要 */
export interface GraphFreshnessSummary {
  checkedAt: string
  staleCount: number
  freshCount: number
  staleNodeIds: string[]
  staleEdgeIds: number[]
}

/** 图谱警告摘要 */
export interface GraphWarningSummary {
  codes: MultiProjectWarningCode[]
  blockerCount: number
  warningCount: number
  infoCount: number
  truncated: boolean
  truncatedReason: string | null
}

// ---------------------------------------------------------------------------
// §G3. 图谱选中状态（节点或边）
// ---------------------------------------------------------------------------

/** 图谱选中引用（节点或边） */
export type GraphSelectedRef = { type: 'node'; nodeId: string } | { type: 'edge'; edgeId: number }

/** 图谱下钻引用（不透明 token，需二次授权） */
export interface GraphDrillDownRef {
  refType: 'node' | 'edge' | 'dependency'
  targetId: number | string
  opaqueToken: string
  expiresAt: string
}

/** 影响分析交接引用（从图谱节点/边进入） */
export interface GraphImpactHandoffRef {
  sourceType: 'node' | 'edge'
  sourceId: string | number
  sourceLabel: string
  sourceEndpointType: MultiProjectEndpointType
  boundedContext: {
    organizationId: number
    projectIds: number[]
    maxDepth: number
    edgeLimit: number
  }
}

// ---------------------------------------------------------------------------
// §G4. 功能禁用响应
// ---------------------------------------------------------------------------

/** 图谱功能禁用时的统一响应 */
export interface GraphFeatureDisabledResponse {
  available: false
  reason: 'feature_disabled'
  message: string
}

/** 图谱响应信封 */
export interface GraphResponseEnvelope {
  data: MultiProjectGraphResponse | null
  featureDisabled?: GraphFeatureDisabledResponse
  error?: {
    code: string
    message: string
  }
}

// ---------------------------------------------------------------------------
// §G5. 纯函数：图谱视图查询规范化与序列化
// ---------------------------------------------------------------------------

/**
 * 规范化图谱视图筛选器，补全默认值。
 * 零运行时依赖。
 */
export function normalizeGraphViewFilters(raw: Partial<GraphViewFilters>): GraphViewFilters {
  return {
    projectScope: raw.projectScope ?? DEFAULT_GRAPH_VIEW_FILTERS.projectScope,
    category: raw.category,
    dependencyType: raw.dependencyType,
    status: raw.status,
    risk: raw.risk,
    dateFrom: raw.dateFrom,
    dateTo: raw.dateTo,
    depth: Math.min(20, Math.max(1, raw.depth ?? DEFAULT_GRAPH_VIEW_FILTERS.depth)),
    nodeLimit: Math.min(2000, Math.max(1, raw.nodeLimit ?? DEFAULT_GRAPH_VIEW_FILTERS.nodeLimit)),
    edgeLimit: Math.min(5000, Math.max(1, raw.edgeLimit ?? DEFAULT_GRAPH_VIEW_FILTERS.edgeLimit)),
    freshnessThreshold: raw.freshnessThreshold ?? DEFAULT_GRAPH_VIEW_FILTERS.freshnessThreshold,
    layoutMode: raw.layoutMode ?? DEFAULT_GRAPH_VIEW_FILTERS.layoutMode,
  }
}

/**
 * 将图谱视图筛选器序列化为稳定的 URL 查询参数对象。
 * 仅包含非默认值，用于减少 URL 长度。
 */
export function serializeGraphViewFiltersToParams(
  filters: GraphViewFilters,
): Record<string, string> {
  const params: Record<string, string> = {}

  if (
    filters.projectScope.length > 0 &&
    filters.projectScope.length !== DEFAULT_GRAPH_VIEW_FILTERS.projectScope.length
  ) {
    params['projectScope'] = filters.projectScope.join(',')
  }
  if (filters.category) params['category'] = filters.category
  if (filters.dependencyType) params['dependencyType'] = filters.dependencyType
  if (filters.status?.length) params['status'] = filters.status.join(',')
  if (filters.risk) params['risk'] = filters.risk
  if (filters.dateFrom) params['dateFrom'] = filters.dateFrom
  if (filters.dateTo) params['dateTo'] = filters.dateTo
  if (filters.depth !== DEFAULT_GRAPH_VIEW_FILTERS.depth) {
    params['depth'] = String(filters.depth)
  }
  if (filters.nodeLimit !== DEFAULT_GRAPH_VIEW_FILTERS.nodeLimit) {
    params['nodeLimit'] = String(filters.nodeLimit)
  }
  if (filters.edgeLimit !== DEFAULT_GRAPH_VIEW_FILTERS.edgeLimit) {
    params['edgeLimit'] = String(filters.edgeLimit)
  }
  if (
    filters.freshnessThreshold &&
    filters.freshnessThreshold !== DEFAULT_GRAPH_VIEW_FILTERS.freshnessThreshold
  ) {
    params['freshness'] = filters.freshnessThreshold
  }
  if (filters.layoutMode !== DEFAULT_GRAPH_VIEW_FILTERS.layoutMode) {
    params['layoutMode'] = filters.layoutMode
  }

  return params
}

/**
 * 从 URL 查询参数反序列化图谱视图筛选器。
 * 缺失值回退到默认值。
 */
export function deserializeGraphViewFiltersFromParams(
  params: Record<string, string | string[] | undefined>,
): GraphViewFilters {
  const get = (key: string): string | undefined => {
    const v = params[key]
    return Array.isArray(v) ? v[0] : v
  }

  return normalizeGraphViewFilters({
    projectScope: get('projectScope')
      ?.split(',')
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0),
    category: get('category') as MultiProjectDependencyCategory | undefined,
    dependencyType: get('dependencyType') as MultiProjectDependencyType | undefined,
    status: get('status')?.split(',').filter(Boolean) as MultiProjectDependencyStatus[] | undefined,
    risk: get('risk') as MultiProjectDependencyRiskLevel | undefined,
    dateFrom: get('dateFrom'),
    dateTo: get('dateTo'),
    depth: get('depth') ? Number(get('depth')) : undefined,
    nodeLimit: get('nodeLimit') ? Number(get('nodeLimit')) : undefined,
    edgeLimit: get('edgeLimit') ? Number(get('edgeLimit')) : undefined,
    freshnessThreshold: get('freshness') as 'fresh' | 'stale' | 'all' | undefined,
    layoutMode: get('layoutMode') as GraphLayoutMode | undefined,
  })
}

/**
 * 生成图谱视图筛选器的稳定查询哈希。
 * 与后端 normalizeGraphQuery + stableHash 兼容。
 */
export function hashGraphViewFilters(filters: GraphViewFilters): string {
  const apiQuery: MultiProjectGraphQuery = {
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
  return stableHash(JSON.stringify(apiQuery))
}

// ---------------------------------------------------------------------------
// §G6. 纯函数：视觉状态派生
// ---------------------------------------------------------------------------

/**
 * 从 MultiProjectGraphNode 派生 UI 可视状态。
 * 零运行时依赖。
 */
export function deriveNodeVisualState(
  node: MultiProjectGraphNode,
  selectedNodeId: string | null,
  focusedNodeId: string | null,
): GraphNodeVisualState {
  return {
    nodeId: node.nodeId,
    riskEncoded: deriveNodeRisk(node),
    statusEncoded: deriveNodeStatus(node),
    freshnessEncoded: 'unknown', // 节点级新鲜度由边决定，此处默认 unknown
    isSelected: node.nodeId === selectedNodeId,
    isFocused: node.nodeId === focusedNodeId,
    isRedacted: node.redacted,
    redactionReason: node.redactionReason,
    dependencyCount: node.dependencyCount,
    label: node.label,
    endpointType: node.endpoint.endpointType,
  }
}

function deriveNodeRisk(node: MultiProjectGraphNode): MultiProjectDependencyRiskLevel | 'none' {
  if (node.riskSummary.critical > 0) return 'critical'
  if (node.riskSummary.high > 0) return 'high'
  if (node.riskSummary.medium > 0) return 'medium'
  if (node.riskSummary.low > 0) return 'low'
  return 'none'
}

function deriveNodeStatus(node: MultiProjectGraphNode): MultiProjectDependencyStatus | 'unknown' {
  if (node.redacted) return 'unknown'
  // 节点状态由关联的边推断；简化实现：若有 critical risk 则为 blocked
  if (node.riskSummary.critical > 0) return 'blocked'
  return 'active'
}

/**
 * 从 MultiProjectGraphEdge 派生 UI 可视状态。
 * 零运行时依赖。
 */
export function deriveEdgeVisualState(
  edge: MultiProjectGraphEdge,
  selectedEdgeId: number | null,
  focusedEdgeId: number | null,
): GraphEdgeVisualState {
  return {
    edgeId: edge.edgeId,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    riskEncoded: edge.riskLevel,
    statusEncoded: edge.status,
    freshnessEncoded: edge.freshness,
    category: edge.category,
    type: edge.type,
    isSelected: edge.edgeId === selectedEdgeId,
    isFocused: edge.edgeId === focusedEdgeId,
    warningCodes: edge.warningCodes,
  }
}

// ---------------------------------------------------------------------------
// §G7. 纯函数：图谱摘要统计
// ---------------------------------------------------------------------------

/**
 * 从 MultiProjectGraphResponse 派生图谱警告摘要。
 */
export function deriveGraphWarningSummary(
  response: MultiProjectGraphResponse,
): GraphWarningSummary {
  const codes = response.warningCodes ?? []
  let blockerCount = 0
  let warningCount = 0
  let infoCount = 0

  for (const code of codes) {
    switch (classifyWarningSeverity(code)) {
      case 'blocker':
        blockerCount++
        break
      case 'warning':
        warningCount++
        break
      default:
        infoCount++
        break
    }
  }

  return {
    codes,
    blockerCount,
    warningCount,
    infoCount,
    truncated: response.truncated,
    truncatedReason: response.truncationReason,
  }
}

function classifyWarningSeverity(code: MultiProjectWarningCode): 'blocker' | 'warning' | 'info' {
  switch (code) {
    case 'DEPENDENCY_CYCLE_BLOCKED':
    case 'DEPENDENCY_DUPLICATE_BLOCKED':
    case 'GRAPH_INTEGRITY_BLOCKED':
    case 'PREVIEW_EXPIRED':
    case 'PERMISSION_CHANGED':
      return 'blocker'
    case 'ENDPOINT_REDACTED':
    case 'ENDPOINT_STALE':
    case 'ENDPOINT_DELETED':
    case 'ENDPOINT_HIDDEN':
    case 'PROJECT_RESTRICTED':
    case 'DIMENSION_REDACTED':
    case 'DEPENDENCY_STALE':
    case 'IMPACT_HIDDEN_AFFECTED':
    case 'IMPACT_STALE_SOURCE':
    case 'PREVIEW_STALE':
    case 'AI_MALFORMED_OUTPUT':
    case 'FEATURE_FLAG_DISABLED':
    case 'LOCAL_CONTEXT_UNAVAILABLE':
      return 'warning'
    default:
      return 'info'
  }
}

/**
 * 从 MultiProjectGraphResponse 派生图谱截断状态。
 */
export function deriveGraphTruncationState(
  response: MultiProjectGraphResponse,
): GraphTruncationState {
  return {
    truncated: response.truncated,
    reason: response.truncationReason,
    visibleNodeCount: response.visibleNodeCount,
    redactedNodeCount: response.redactedNodeCount,
    visibleEdgeCount: response.visibleEdgeCount,
  }
}

/**
 * 从 MultiProjectGraphResponse 派生图谱新鲜度摘要。
 */
export function deriveGraphFreshnessSummary(
  response: MultiProjectGraphResponse,
): GraphFreshnessSummary {
  const staleNodeIds: string[] = []
  const staleEdgeIds: number[] = []

  for (const edge of response.edges) {
    if (edge.freshness === 'stale') {
      staleEdgeIds.push(edge.edgeId)
      if (!staleNodeIds.includes(edge.sourceNodeId)) {
        staleNodeIds.push(edge.sourceNodeId)
      }
      if (!staleNodeIds.includes(edge.targetNodeId)) {
        staleNodeIds.push(edge.targetNodeId)
      }
    }
  }

  return {
    checkedAt: response.freshnessMeta?.checkedAt ?? new Date().toISOString(),
    staleCount: response.freshnessMeta?.staleCount ?? 0,
    freshCount: response.freshnessMeta?.freshCount ?? 0,
    staleNodeIds,
    staleEdgeIds,
  }
}

// ---------------------------------------------------------------------------
// §G8. 纯函数：有界图谱摘要统计
// ---------------------------------------------------------------------------

/**
 * 从 MultiProjectGraphResponse 派生有界统计，用于 UI 摘要栏。
 */
export interface BoundedGraphSummary {
  totalNodes: number
  totalEdges: number
  visibleNodes: number
  visibleEdges: number
  redactedNodes: number
  truncated: boolean
  truncatedReason: string | null
  criticalEdges: number
  highRiskEdges: number
  staleEdges: number
  warningCodes: MultiProjectWarningCode[]
}

export function deriveBoundedGraphSummary(
  response: MultiProjectGraphResponse,
): BoundedGraphSummary {
  let criticalEdges = 0
  let highRiskEdges = 0
  let staleEdges = 0

  for (const edge of response.edges) {
    if (edge.riskLevel === 'critical') criticalEdges++
    if (edge.riskLevel === 'high') highRiskEdges++
    if (edge.freshness === 'stale') staleEdges++
  }

  return {
    totalNodes: response.visibleNodeCount + response.redactedNodeCount,
    totalEdges: response.visibleEdgeCount,
    visibleNodes: response.visibleNodeCount,
    visibleEdges: response.visibleEdgeCount,
    redactedNodes: response.redactedNodeCount,
    truncated: response.truncated,
    truncatedReason: response.truncationReason,
    criticalEdges,
    highRiskEdges,
    staleEdges,
    warningCodes: response.warningCodes ?? [],
  }
}

// ---------------------------------------------------------------------------
// §G9. 纯函数：功能禁用检查
// ---------------------------------------------------------------------------

/**
 * 构建图谱功能禁用响应。
 */
export function buildGraphFeatureDisabledResponse(message?: string): GraphFeatureDisabledResponse {
  return {
    available: false,
    reason: 'feature_disabled',
    message: message ?? '多项目依赖图谱功能当前已禁用。',
  }
}

/**
 * 检查图谱响应是否为功能禁用状态。
 */
export function isGraphFeatureDisabled(
  response: GraphResponseEnvelope,
): response is GraphResponseEnvelope & { featureDisabled: GraphFeatureDisabledResponse } {
  return response.featureDisabled?.available === false
}

// ---------------------------------------------------------------------------
// §G10. 枚举白名单（编译时+运行时双重校验用）
// ---------------------------------------------------------------------------

/** 有效的图谱布局模式 */
export const GRAPH_LAYOUT_MODES: readonly GraphLayoutMode[] = [
  'force-directed',
  'layered',
  'radial',
] as const

/** 有效的图谱视图模式 */
export const GRAPH_VIEW_MODES: readonly GraphViewMode[] = ['list', 'graph'] as const

/**
 * 验证布局模式是否在枚举白名单内。
 */
export function isValidGraphLayoutMode(value: string): value is GraphLayoutMode {
  return (GRAPH_LAYOUT_MODES as readonly string[]).includes(value)
}

/**
 * 验证视图模式是否在枚举白名单内。
 */
export function isValidGraphViewMode(value: string): value is GraphViewMode {
  return (GRAPH_VIEW_MODES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// §G11. 低敏图谱导出摘要（§8.3：复用既有 reporting/export 边界，无新文件存储模型）
// ---------------------------------------------------------------------------

/** 低敏图谱导出摘要：仅含计数与警告码，不含隐藏标签、证据或敏感凭据 */
export interface GraphExportSummary {
  organizationId: number | string | undefined
  generatedAt: string
  visibleNodeCount: number
  visibleEdgeCount: number
  redactedNodeCount: number
  truncated: boolean
  truncationReason: string | null
  warningCodes: MultiProjectWarningCode[]
  riskBreakdown: { critical: number; high: number; medium: number; low: number }
  staleEdgeCount: number
}

/**
 * 从图谱响应派生低敏导出摘要（§8.3）。
 * 零运行时依赖——仅遍历可见边，不触及隐藏标签或证据。
 */
export function buildGraphExportSummary(
  response: MultiProjectGraphResponse | null,
  organizationId?: number | string,
): GraphExportSummary | null {
  if (!response) return null
  const riskBreakdown = { critical: 0, high: 0, medium: 0, low: 0 }
  let staleEdgeCount = 0
  for (const edge of response.edges) {
    if (edge.riskLevel === 'critical') riskBreakdown.critical++
    else if (edge.riskLevel === 'high') riskBreakdown.high++
    else if (edge.riskLevel === 'medium') riskBreakdown.medium++
    else if (edge.riskLevel === 'low') riskBreakdown.low++
    if (edge.freshness === 'stale') staleEdgeCount++
  }
  return {
    organizationId,
    // generatedAt 由调用方注入时间戳（保持零运行时依赖，不依赖 Date.now）
    generatedAt: '',
    visibleNodeCount: response.visibleNodeCount,
    visibleEdgeCount: response.visibleEdgeCount,
    redactedNodeCount: response.redactedNodeCount,
    truncated: response.truncated,
    truncationReason: response.truncationReason,
    warningCodes: response.warningCodes ?? [],
    riskBreakdown,
    staleEdgeCount,
  }
}
