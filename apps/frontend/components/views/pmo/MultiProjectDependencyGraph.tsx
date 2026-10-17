'use client'

// 多项目依赖图谱 SVG 渲染器（v3-multi-project-dependency-graph §5.4）。
// 确定性 SVG 布局，支持 pan/zoom/fit-to-view/keyboard/selection/所有状态。

import { useMemo, useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react'
import type {
  MultiProjectGraphResponse,
  MultiProjectGraphNode,
  MultiProjectGraphEdge,
  GraphImpactHandoffRef,
  MultiProjectEndpointType,
} from '@aiproj/types'
import {
  deriveNodeVisualState,
  deriveEdgeVisualState,
  deriveGraphWarningSummary,
  deriveGraphTruncationState,
  deriveBoundedGraphSummary,
  buildGraphExportSummary,
  type GraphLayoutMode,
  type GraphSelectedRef,
  type GraphExportSummary,
} from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { AlertCircle, ZoomIn, ZoomOut, Maximize2, Activity, Download } from 'lucide-react'

// ---------------------------------------------------------------------------
// 布局配置
// ---------------------------------------------------------------------------

interface LayoutConfig {
  nodeWidth: number
  nodeHeight: number
  horizontalGap: number
  verticalGap: number
  layers: number
}

const LAYOUT: Record<GraphLayoutMode, LayoutConfig> = {
  layered: { nodeWidth: 160, nodeHeight: 64, horizontalGap: 200, verticalGap: 100, layers: 4 },
  'force-directed': {
    nodeWidth: 160,
    nodeHeight: 64,
    horizontalGap: 180,
    verticalGap: 120,
    layers: 3,
  },
  radial: { nodeWidth: 160, nodeHeight: 64, horizontalGap: 160, verticalGap: 100, layers: 2 },
}

// ---------------------------------------------------------------------------
// 颜色编码
// ---------------------------------------------------------------------------

const RISK_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
  none: '#9ca3af',
}

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  at_risk: '#f97316',
  blocked: '#ef4444',
  resolved: '#3b82f6',
  archived: '#9ca3af',
  draft: '#9ca3af',
}

const FRESHNESS_COLORS: Record<string, string> = {
  fresh: '#22c55e',
  stale: '#f97316',
  unknown: '#9ca3af',
}

// ---------------------------------------------------------------------------
// 简单分层布局算法
// ---------------------------------------------------------------------------

interface LayoutNode {
  nodeId: string
  x: number
  y: number
  layer: number
  node: MultiProjectGraphNode
}

interface LayoutEdge {
  edgeId: number
  sourceNodeId: string
  targetNodeId: string
  edge: MultiProjectGraphEdge
}

function computeLayout(
  nodes: MultiProjectGraphNode[],
  edges: MultiProjectGraphEdge[],
  mode: GraphLayoutMode,
): { layoutNodes: LayoutNode[]; layoutEdges: LayoutEdge[]; svgWidth: number; svgHeight: number } {
  const config = LAYOUT[mode]
  const { nodeWidth, nodeHeight, horizontalGap, verticalGap, layers: maxLayers } = config

  // 分层算法：入度越高的节点越靠上层
  const inDegree = new Map<string, number>()
  for (const node of nodes) inDegree.set(node.nodeId, 0)
  for (const edge of edges) {
    inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1)
  }

  // 分配层级（入度 → 层号）
  const layerMap = new Map<string, number>()
  const layerCounts = new Map<number, number>()
  for (const node of nodes) {
    const deg = Math.min(inDegree.get(node.nodeId) ?? 0, maxLayers - 1)
    layerMap.set(node.nodeId, deg)
    layerCounts.set(deg, (layerCounts.get(deg) ?? 0) + 1)
  }

  // 计算位置
  const layoutNodes: LayoutNode[] = nodes.map((node) => {
    const layer = layerMap.get(node.nodeId) ?? 0
    const col =
      (layerCounts.get(layer) ?? 1) <= 1
        ? 0
        : nodes.filter((n) => layerMap.get(n.nodeId) === layer).indexOf(node)
    const x = 40 + layer * horizontalGap
    const y = 40 + col * verticalGap
    return { nodeId: node.nodeId, x, y, layer, node }
  })

  const layoutEdges: LayoutEdge[] = edges.map((edge) => ({
    edgeId: edge.edgeId,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    edge,
  }))

  // 计算 SVG 尺寸
  const maxX = Math.max(...layoutNodes.map((n) => n.x)) + nodeWidth + 40
  const maxY = Math.max(...layoutNodes.map((n) => n.y)) + nodeHeight + 40

  return {
    layoutNodes,
    layoutEdges,
    svgWidth: Math.max(800, maxX),
    svgHeight: Math.max(600, maxY),
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MultiProjectDependencyGraphProps {
  response: MultiProjectGraphResponse | null
  layoutMode: GraphLayoutMode
  isLoading?: boolean
  isError?: boolean
  errorMessage?: string
  isEmpty?: boolean
  isFeatureDisabled?: boolean
  isNoPermission?: boolean
  onSelectNode?: (nodeId: string) => void
  onSelectEdge?: (edgeId: number) => void
  onStartImpactHandoff?: (ref: GraphImpactHandoffRef) => void
  selectedRef?: GraphSelectedRef | null
  organizationId?: number | string
  /** 图例密度变体（§8.1）：compact 紧凑、comfortable 舒适，默认 comfortable */
  density?: 'compact' | 'comfortable'
  /** 本地布局偏好变更回调（§8.2）：用于父组件可选地持久化 layoutMode */
  onLayoutModePreferenceChange?: (mode: GraphLayoutMode) => void
  /** 低敏图谱导出摘要回调（§8.3）：传入生成的摘要供父组件复用既有 export 边界 */
  onExportSummary?: (summary: GraphExportSummary) => void
}

// ---------------------------------------------------------------------------
// §8.2 本地布局偏好持久化（仅 UI 偏好，不存业务数据）
// ---------------------------------------------------------------------------

const GRAPH_ZOOM_PREF_KEY = 'aiproj:mpd-graph:zoom'

function loadPreferredZoom(): number {
  if (typeof window === 'undefined') return 1
  const raw = window.localStorage.getItem(GRAPH_ZOOM_PREF_KEY)
  if (!raw) return 1
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0.3 && n <= 3 ? n : 1
}

function savePreferredZoom(zoom: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(GRAPH_ZOOM_PREF_KEY, String(zoom))
  } catch {
    // localStorage 不可用时静默降级（隐私模式等）
  }
}

// ---------------------------------------------------------------------------
// §8.3 低敏图谱导出摘要复用 @aiproj/types 的 buildGraphExportSummary（见 import）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export default function MultiProjectDependencyGraph({
  response,
  layoutMode,
  isLoading,
  isError,
  errorMessage,
  isEmpty,
  isFeatureDisabled,
  isNoPermission,
  onSelectNode,
  onSelectEdge,
  onStartImpactHandoff,
  selectedRef,
  organizationId,
  density = 'comfortable',
  onLayoutModePreferenceChange,
  onExportSummary,
}: MultiProjectDependencyGraphProps) {
  const [zoom, setZoom] = useState<number>(loadPreferredZoom)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  // §8.2 zoom 偏好持久化（仅 UI 偏好）
  useEffect(() => {
    savePreferredZoom(zoom)
  }, [zoom])

  // 响应式：检测窄屏视口（§5.10）
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // ── 选中节点/边对象（用于影响分析交接） ──
  const selectedNode = useMemo(() => {
    if (!response || selectedRef?.type !== 'node') return null
    return response.nodes.find((n) => n.nodeId === selectedRef.nodeId) ?? null
  }, [response, selectedRef])

  const selectedEdge = useMemo(() => {
    if (!response || selectedRef?.type !== 'edge') return null
    return response.edges.find((e) => e.edgeId === selectedRef.edgeId) ?? null
  }, [response, selectedRef])

  // ── 影响分析交接：只传递有界 source ref，不产生写入（§5.8） ──
  const handleStartImpactHandoff = useCallback(() => {
    if (!onStartImpactHandoff || !response) return
    if (selectedNode) {
      const orgId =
        typeof organizationId === 'string' ? Number(organizationId) : (organizationId ?? 0)
      const projectIds: number[] = []
      for (const n of response.nodes) {
        if (n.endpoint.projectId) projectIds.push(n.endpoint.projectId)
      }
      const handoff: GraphImpactHandoffRef = {
        sourceType: 'node',
        sourceId: selectedNode.nodeId,
        sourceLabel: selectedNode.label,
        sourceEndpointType: (selectedNode.endpoint.endpointType ??
          'project') as MultiProjectEndpointType,
        boundedContext: {
          organizationId: orgId,
          projectIds: Array.from(new Set(projectIds)),
          maxDepth: 3,
          edgeLimit: response.visibleEdgeCount,
        },
      }
      onStartImpactHandoff(handoff)
    } else if (selectedEdge) {
      const orgId =
        typeof organizationId === 'string' ? Number(organizationId) : (organizationId ?? 0)
      const handoff: GraphImpactHandoffRef = {
        sourceType: 'edge',
        sourceId: selectedEdge.edgeId,
        sourceLabel: `依赖边 ${selectedEdge.edgeId}`,
        sourceEndpointType: 'project',
        boundedContext: {
          organizationId: orgId,
          projectIds: [],
          maxDepth: 3,
          edgeLimit: response.visibleEdgeCount,
        },
      }
      onStartImpactHandoff(handoff)
    }
  }, [onStartImpactHandoff, response, selectedNode, selectedEdge, organizationId])

  const boundedSummary = useMemo(() => {
    if (!response) return null
    return deriveBoundedGraphSummary(response)
  }, [response])

  const layout = useMemo(() => {
    if (!response?.nodes.length) return null
    return computeLayout(response.nodes, response.edges, layoutMode)
  }, [response, layoutMode])

  const warningSummary = useMemo(() => {
    if (!response) return null
    return deriveGraphWarningSummary(response)
  }, [response])

  const truncationState = useMemo(() => {
    if (!response) return null
    return deriveGraphTruncationState(response)
  }, [response])

  const selectedNodeId = selectedRef?.type === 'node' ? selectedRef.nodeId : null
  const selectedEdgeId = selectedRef?.type === 'edge' ? selectedRef.edgeId : null

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!layout) return
      if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(3, z + 0.1))
      } else if (e.key === '-') {
        setZoom((z) => Math.max(0.3, z - 0.1))
      } else if (e.key === '0') {
        setZoom(1)
        setPan({ x: 0, y: 0 })
      }
    },
    [layout],
  )

  // ── 状态渲染 ──

  if (isFeatureDisabled) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>多项目依赖图谱功能当前已禁用。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (isNoPermission) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <Alert className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>你没有查看多项目依赖图谱的权限。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <Alert variant="danger" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errorMessage ?? '图谱加载失败'}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (isEmpty || !response || response.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <p className="text-muted-foreground">当前筛选条件下暂无依赖图谱数据</p>
      </div>
    )
  }

  if (!layout) return null

  const { layoutNodes, layoutEdges, svgWidth, svgHeight } = layout

  return (
    <div
      className="relative"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="figure"
      aria-label="多项目依赖图谱"
    >
      {/* 摘要栏 */}
      <div className="flex items-center gap-3 mb-3 px-2 flex-wrap">
        <span className="text-sm text-muted-foreground">
          {response.visibleNodeCount} 节点 · {response.visibleEdgeCount} 边
          {response.redactedNodeCount > 0 && (
            <span className="text-amber-600 ml-1">（{response.redactedNodeCount} 已脱敏）</span>
          )}
        </span>
        {truncationState?.truncated && (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            已截断: {truncationState.reason}
          </Badge>
        )}
        {warningSummary && warningSummary.warningCount > 0 && (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            {warningSummary.warningCount} 个警告
          </Badge>
        )}
        {response.freshnessMeta?.staleCount > 0 && (
          <Badge variant="outline" className="text-orange-500 border-orange-300">
            {response.freshnessMeta.staleCount} 条陈旧
          </Badge>
        )}
      </div>

      {/* 工具栏 */}
      <div className="flex gap-1 mb-2 px-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setZoom(1)
            setPan({ x: 0, y: 0 })
            // §8.2 用户重置视图时，将当前 layoutMode 作为本地偏好通知父组件（可选持久化）
            onLayoutModePreferenceChange?.(layoutMode)
          }}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground self-center ml-2">
          {Math.round(zoom * 100)}%
        </span>
        {/* 影响分析交接入口（§5.8）：只读，传递有界 source ref，不产生写入 */}
        {onStartImpactHandoff && selectedRef && (
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={handleStartImpactHandoff}
            aria-label="从选中节点或边进入只读影响分析"
          >
            <Activity className="mr-1 h-4 w-4" />
            影响分析
          </Button>
        )}
        {/* §8.3 低敏图谱导出摘要入口：复用既有 export 边界，不引入新文件存储 */}
        {onExportSummary && response && (
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => {
              const summary = buildGraphExportSummary(response, organizationId)
              if (summary) {
                summary.generatedAt = new Date().toISOString()
                onExportSummary(summary)
              }
            }}
            aria-label="导出低敏图谱摘要（仅含计数与警告，不含隐藏标签或证据）"
          >
            <Download className="mr-1 h-4 w-4" />
            导出摘要
          </Button>
        )}
      </div>

      {/* 窄屏移动端降级视图（§5.10）：摘要 + 分层列表，避免画布不可读 */}
      {isMobile ? (
        <MobileGraphFallback
          response={response}
          summary={boundedSummary}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          selectedRef={selectedRef}
        />
      ) : (
        /* SVG 图谱（桌面端） */
        <div
          className="border rounded-md overflow-hidden bg-white dark:bg-gray-950"
          style={{ height: 500 }}
        >
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`${-pan.x} ${-pan.y} ${svgWidth / zoom} ${svgHeight / zoom}`}
            style={{ cursor: 'grab' }}
            role="figure"
            aria-label={`多项目依赖图谱，${response.visibleNodeCount} 个节点，${response.visibleEdgeCount} 条边`}
          >
            {/* 边 */}
            {layoutEdges.map((le) => {
              const sourceNode = layoutNodes.find((n) => n.nodeId === le.sourceNodeId)
              const targetNode = layoutNodes.find((n) => n.nodeId === le.targetNodeId)
              if (!sourceNode || !targetNode) return null

              const vs = deriveEdgeVisualState(le.edge, selectedEdgeId, null)
              const isSelected = vs.isSelected
              const strokeColor = RISK_COLORS[vs.riskEncoded] ?? '#9ca3af'
              const strokeWidth = isSelected ? 3 : 1.5
              const strokeDash = vs.freshnessEncoded === 'stale' ? '5,5' : undefined

              return (
                <line
                  key={le.edgeId}
                  x1={sourceNode.x + LAYOUT[layoutMode].nodeWidth / 2}
                  y1={sourceNode.y + LAYOUT[layoutMode].nodeHeight / 2}
                  x2={targetNode.x + LAYOUT[layoutMode].nodeWidth / 2}
                  y2={targetNode.y + LAYOUT[layoutMode].nodeHeight / 2}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={strokeDash}
                  opacity={vs.freshnessEncoded === 'stale' ? 0.5 : 0.8}
                  className="cursor-pointer transition-opacity hover:opacity-100"
                  onClick={() => onSelectEdge?.(le.edgeId)}
                  role="button"
                  tabIndex={0}
                  aria-label={`依赖边 ${le.edgeId}: ${vs.riskEncoded} 风险, ${vs.freshnessEncoded}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectEdge?.(le.edgeId)
                    }
                  }}
                />
              )
            })}

            {/* 节点 */}
            {layoutNodes.map((ln) => {
              const vs = deriveNodeVisualState(ln.node, selectedNodeId, focusedNodeId)
              const isSelected = vs.isSelected
              const isFocused = vs.isFocused
              const borderColor = isSelected
                ? '#6366f1'
                : isFocused
                  ? '#a5b4fc'
                  : vs.isRedacted
                    ? '#9ca3af'
                    : (RISK_COLORS[vs.riskEncoded] ?? '#9ca3af')
              const bgColor = vs.isRedacted ? '#f3f4f6' : 'white'
              const borderWidth = isSelected ? 3 : isFocused ? 2 : 1

              return (
                <g
                  key={ln.nodeId}
                  transform={`translate(${ln.x}, ${ln.y})`}
                  className="cursor-pointer"
                  onClick={() => onSelectNode?.(ln.nodeId)}
                  onFocus={() => setFocusedNodeId(ln.nodeId)}
                  onBlur={() => setFocusedNodeId(null)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${vs.isRedacted ? '已脱敏' : vs.label}: ${vs.dependencyCount} 个依赖, ${vs.riskEncoded} 风险`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectNode?.(ln.nodeId)
                    }
                  }}
                >
                  <rect
                    width={LAYOUT[layoutMode].nodeWidth}
                    height={LAYOUT[layoutMode].nodeHeight}
                    rx={8}
                    fill={bgColor}
                    stroke={borderColor}
                    strokeWidth={borderWidth}
                    className="transition-all"
                  />
                  <text
                    x={LAYOUT[layoutMode].nodeWidth / 2}
                    y={22}
                    textAnchor="middle"
                    className="text-xs font-medium fill-gray-800 dark:fill-gray-200"
                    style={{ fontSize: 12 }}
                  >
                    {vs.isRedacted
                      ? '***'
                      : vs.label.length > 20
                        ? vs.label.slice(0, 18) + '…'
                        : vs.label}
                  </text>
                  <text
                    x={LAYOUT[layoutMode].nodeWidth / 2}
                    y={44}
                    textAnchor="middle"
                    className="fill-gray-500"
                    style={{ fontSize: 10 }}
                  >
                    {vs.isRedacted
                      ? (vs.redactionReason ?? '已脱敏')
                      : `${vs.endpointType} · ${vs.dependencyCount}条`}
                  </text>
                  {/* 风险指示器 */}
                  {!vs.isRedacted && vs.riskEncoded !== 'none' && (
                    <circle
                      cx={LAYOUT[layoutMode].nodeWidth - 10}
                      cy={10}
                      r={6}
                      fill={RISK_COLORS[vs.riskEncoded] ?? '#9ca3af'}
                    />
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      )}

      {/* 图例（§8.1 密度变体：尊重 light/dark 与 compact/comfortable 主题 token） */}
      <div
        className={`flex flex-wrap mt-3 px-2 text-muted-foreground ${
          density === 'compact' ? 'gap-2 text-[10px]' : 'gap-4 text-xs'
        }`}
        role="region"
        aria-label="图谱图例"
      >
        <span className="flex items-center gap-1">
          <span
            className={`inline-block rounded-full ${density === 'compact' ? 'w-2 h-2' : 'w-3 h-3'}`}
            style={{ backgroundColor: RISK_COLORS.critical }}
          />{' '}
          严重
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`inline-block rounded-full ${density === 'compact' ? 'w-2 h-2' : 'w-3 h-3'}`}
            style={{ backgroundColor: RISK_COLORS.high }}
          />{' '}
          高
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`inline-block rounded-full ${density === 'compact' ? 'w-2 h-2' : 'w-3 h-3'}`}
            style={{ backgroundColor: RISK_COLORS.medium }}
          />{' '}
          中
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`inline-block rounded-full ${density === 'compact' ? 'w-2 h-2' : 'w-3 h-3'}`}
            style={{ backgroundColor: RISK_COLORS.low }}
          />{' '}
          低
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`inline-block rounded-full ${density === 'compact' ? 'w-2 h-2' : 'w-3 h-3'}`}
            style={{ backgroundColor: STATUS_COLORS.archived }}
          />{' '}
          已脱敏
        </span>
        <span className="flex items-center gap-1 ml-2">
          <span
            className={`inline-block border-t-2 border-dashed ${density === 'compact' ? 'w-3' : 'w-4'}`}
            style={{ borderColor: FRESHNESS_COLORS.stale }}
          />{' '}
          陈旧
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// §5.10 窄屏移动端降级视图：摘要 + 分层列表，保证文字/按钮/图例可读不重叠
// ---------------------------------------------------------------------------

function MobileGraphFallback({
  response,
  summary,
  onSelectNode,
  onSelectEdge,
  selectedRef,
}: {
  response: MultiProjectGraphResponse
  summary: {
    criticalEdges: number
    highRiskEdges: number
    staleEdges: number
    truncated: boolean
    truncatedReason: string | null
  } | null
  onSelectNode?: (nodeId: string) => void
  onSelectEdge?: (edgeId: number) => void
  selectedRef?: GraphSelectedRef | null
}) {
  return (
    <div className="space-y-3" role="region" aria-label="移动端依赖图谱降级视图">
      {/* 摘要栏 */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">{response.visibleNodeCount} 节点</Badge>
        <Badge variant="outline">{response.visibleEdgeCount} 边</Badge>
        {response.redactedNodeCount > 0 && (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            {response.redactedNodeCount} 已脱敏
          </Badge>
        )}
        {summary && summary.criticalEdges > 0 && (
          <Badge variant="outline" className="text-red-600 border-red-300">
            {summary.criticalEdges} 严重
          </Badge>
        )}
        {summary && summary.highRiskEdges > 0 && (
          <Badge variant="outline" className="text-orange-600 border-orange-300">
            {summary.highRiskEdges} 高风险
          </Badge>
        )}
        {summary && summary.staleEdges > 0 && (
          <Badge variant="outline" className="text-orange-500 border-orange-300">
            {summary.staleEdges} 陈旧
          </Badge>
        )}
        {summary?.truncated && (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            已截断: {summary.truncatedReason}
          </Badge>
        )}
      </div>

      {/* 节点列表（可点击下钻） */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">节点</p>
        {response.nodes.slice(0, 50).map((node) => {
          const isSelected = selectedRef?.type === 'node' && selectedRef.nodeId === node.nodeId
          return (
            <button
              key={node.nodeId}
              type="button"
              onClick={() => onSelectNode?.(node.nodeId)}
              className={`w-full text-left p-2 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                isSelected
                  ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950'
                  : 'border-gray-200 dark:border-gray-800'
              }`}
              aria-label={`${node.redacted ? '已脱敏节点' : node.label}，${node.dependencyCount} 个依赖`}
              aria-pressed={isSelected}
            >
              <div className="flex items-center justify-between">
                <span className="truncate max-w-[200px]">{node.redacted ? '***' : node.label}</span>
                {!node.redacted && (
                  <span
                    className="inline-block w-2 h-2 rounded-full ml-2 flex-shrink-0"
                    style={{
                      backgroundColor:
                        node.riskSummary.critical > 0
                          ? '#ef4444'
                          : node.riskSummary.high > 0
                            ? '#f97316'
                            : node.riskSummary.medium > 0
                              ? '#eab308'
                              : node.riskSummary.low > 0
                                ? '#3b82f6'
                                : '#9ca3af',
                    }}
                  />
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {node.redacted
                  ? (node.redactionReason ?? '已脱敏')
                  : `${node.endpoint.endpointType} · ${node.dependencyCount}条依赖`}
              </div>
            </button>
          )
        })}
        {response.nodes.length > 50 && (
          <p className="text-xs text-muted-foreground text-center">
            仅显示前 50 个节点（共 {response.visibleNodeCount}）
          </p>
        )}
      </div>

      {/* 边列表 */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">依赖边</p>
        {response.edges.slice(0, 50).map((edge) => {
          const isSelected = selectedRef?.type === 'edge' && selectedRef.edgeId === edge.edgeId
          const riskColor = RISK_COLORS[edge.riskLevel] ?? '#9ca3af'
          return (
            <button
              key={edge.edgeId}
              type="button"
              onClick={() => onSelectEdge?.(edge.edgeId)}
              className={`w-full text-left p-2 rounded-md border text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                isSelected
                  ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950'
                  : 'border-gray-200 dark:border-gray-800'
              }`}
              aria-label={`依赖边 ${edge.edgeId}，${edge.riskLevel} 风险，${edge.freshness}`}
              aria-pressed={isSelected}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: riskColor }}
                />
                <span className="truncate">边 #{edge.edgeId}</span>
                <span className="text-muted-foreground ml-auto flex-shrink-0">
                  {edge.category} · {edge.type}
                </span>
              </div>
              <div className="text-muted-foreground mt-1">
                {edge.sourceNodeId} → {edge.targetNodeId}
                {edge.freshness === 'stale' && <span className="text-orange-500 ml-1">· 陈旧</span>}
              </div>
            </button>
          )
        })}
        {response.edges.length > 50 && (
          <p className="text-xs text-muted-foreground text-center">
            仅显示前 50 条边（共 {response.visibleEdgeCount}）
          </p>
        )}
      </div>
    </div>
  )
}
