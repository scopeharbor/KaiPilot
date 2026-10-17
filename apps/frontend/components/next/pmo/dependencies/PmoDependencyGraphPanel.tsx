'use client'

import * as React from 'react'
import { useMemo, useState } from 'react'
import { AlertTriangle, Network, RefreshCw, X } from 'lucide-react'
import { usePortfolioProjects } from '@/hooks/use-portfolio-dashboard'
import { useMpdGraph } from '@/hooks/use-multi-project-dependencies'
import { cn } from '@/lib/utils'
import type {
  MultiProjectGraphEdge,
  MultiProjectGraphNode,
  MultiProjectGraphQuery,
  MultiProjectGraphResponse,
} from '@aiproj/types'
import {
  categoryLabel,
  dependencyTypeLabel,
  endpointTypeLabel,
  MPD_RISK_COLOR_VAR,
  normalizeMpdGraphPayload,
  riskMeta,
} from './mpd-adapter'
import { MpdRiskBadge, MpdStatusBadge } from './MpdBadges'

/**
 * 组合依赖图谱面板（v3-ui-next-pmo-domain W7 · tasks 7.4）。
 *
 * - 数据：`useMpdGraph` 既有管线；project 范围取组织可见项目（usePortfolioProjects，
 *   后端 graph 查询 projectIds 必填 minLength 1——以可见项目集为有界范围）；
 * - 渲染：自研确定性 SVG 分层布局（Kahn 排序 + label 序稳定），零第三方图库；
 *   节点按聚合风险着色描边 + 端点类型标签，边按风险级色带（critical/high/medium/low）
 *   与新鲜度（stale 虚线）双通道呈现；不 import 旧轨 MultiProjectDependencyGraph（RL-15）；
 * - 交互：点击节点联动只读详情抽屉（数据全部来自已取响应，零额外请求）；
 * - 写入口：图谱面板无任何写操作（RL-01）；管理动作在底册视图承载；
 * - 规模：以 500 依赖冒烟断言渲染完成（确定性布局，无动画）。
 */

export interface MpdGraphSharedFilters {
  category: string
  type: string
  status: string
  riskLevel: string
  freshness: string
}

export interface PmoDependencyGraphPanelProps {
  organizationId: number
  /** 与底册工具栏共享的筛选（同 URL 参数语义）。 */
  filters: MpdGraphSharedFilters
}

const MAX_DEPTH = 3
const NODE_LIMIT = 200
const EDGE_LIMIT = 500

const NODE_WIDTH = 168
const NODE_HEIGHT = 40
const COLUMN_GAP = 64
const ROW_GAP = 14

interface LayoutNode {
  node: MultiProjectGraphNode
  x: number
  y: number
  rank: number
}

interface LayoutEdge extends MultiProjectGraphEdge {
  path: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}

interface GraphLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
}

/** 确定性分层布局（Kahn + 同级 label 升序；回边节点放入末层，位置稳定可复现）。 */
export function layoutDependencyGraph(
  graphNodes: MultiProjectGraphNode[],
  graphEdges: MultiProjectGraphEdge[],
): GraphLayout {
  const nodes = graphNodes.map((node) => node.nodeId)
  const nodeSet = new Set(nodes)
  const byId = new Map<string, MultiProjectGraphNode>()
  for (const node of graphNodes) byId.set(node.nodeId, node)

  const out: Array<Array<{ id: string; label: string }>> = []
  const edgePairs = graphEdges
    .filter((edge) => nodeSet.has(edge.sourceNodeId) && nodeSet.has(edge.targetNodeId))
    .map((edge) => [edge.sourceNodeId, edge.targetNodeId] as const)
  const remaining = new Set(nodes)
  // 经典 Kahn：统计残余入度（仅统计两端都还在集合内的边）
  const incoming = new Map<string, number>()
  for (const [, target] of edgePairs) {
    incoming.set(target, (incoming.get(target) ?? 0) + 1)
  }
  const sortedByLabel = (ids: string[]) =>
    [...ids].sort((a, b) => byId.get(a)!.label.localeCompare(byId.get(b)!.label, 'zh-Hans-CN'))

  let iteration = 0
  while (remaining.size > 0 && iteration <= nodes.length) {
    const zeroIncoming = [...remaining].filter((id) => (incoming.get(id) ?? 0) === 0)
    const current = sortedByLabel(zeroIncoming.length > 0 ? zeroIncoming : [...remaining])
    for (const id of current) {
      remaining.delete(id)
      // 出边目标入度 -1
      for (const [source, target] of edgePairs) {
        if (source === id && remaining.has(target)) {
          incoming.set(target, (incoming.get(target) ?? 1) - 1)
        }
      }
    }
    out.push(current.map((id) => ({ id, label: byId.get(id)!.label })))
    iteration++
  }

  const nodeLayout: LayoutNode[] = []
  let maxRankSize = 1
  for (let rank = 0; rank < out.length; rank++) {
    const group = out[rank]!
    maxRankSize = Math.max(maxRankSize, group.length)
    group.forEach((entry, index) => {
      nodeLayout.push({
        node: byId.get(entry.id)!,
        rank,
        x: rank * (NODE_WIDTH + COLUMN_GAP),
        y: index * (NODE_HEIGHT + ROW_GAP),
      })
    })
  }

  const posOf = new Map<string, { x: number; y: number }>()
  for (const item of nodeLayout) posOf.set(item.node.nodeId, { x: item.x, y: item.y })

  const layoutEdges: LayoutEdge[] = []
  for (const edge of graphEdges) {
    const sourcePos = posOf.get(edge.sourceNodeId)
    const targetPos = posOf.get(edge.targetNodeId)
    if (!sourcePos || !targetPos) continue
    const sourceX = sourcePos.x + NODE_WIDTH
    const sourceY = sourcePos.y + NODE_HEIGHT / 2
    const targetX = targetPos.x
    const targetY = targetPos.y + NODE_HEIGHT / 2
    const dx = Math.max(24, Math.abs(targetX - sourceX) / 2)
    const path =
      targetX >= sourceX
        ? `M ${sourceX} ${sourceY} C ${sourceX + dx} ${sourceY}, ${targetX - dx} ${targetY}, ${targetX} ${targetY}`
        : `M ${sourceX} ${sourceY} C ${sourceX + dx} ${sourceY - 36}, ${targetX - dx} ${targetY - 36}, ${targetX} ${targetY}`
    layoutEdges.push({ ...edge, path, sourceX, sourceY, targetX, targetY })
  }

  const rankCount = Math.max(1, out.length)
  return {
    nodes: nodeLayout,
    edges: layoutEdges,
    width: rankCount * NODE_WIDTH + (rankCount - 1) * COLUMN_GAP,
    height: Math.max(1, maxRankSize) * (NODE_HEIGHT + ROW_GAP) - ROW_GAP + 20,
  }
}

function nodeRisk(node: MultiProjectGraphNode): string {
  const summary = node.riskSummary
  if (summary.critical > 0) return 'critical'
  if (summary.high > 0) return 'high'
  if (summary.medium > 0) return 'medium'
  if (summary.low > 0) return 'low'
  return 'none'
}

function truncateLabel(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max)}…` : label
}

export function PmoDependencyGraphPanel({ organizationId, filters }: PmoDependencyGraphPanelProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // 项目范围：组织可见项目（后端 graph projectIds 必填，以可见集为有界范围）
  const projectsQuery = usePortfolioProjects({
    page: 1,
    perPage: 100,
    sort: 'updated_at',
    order: 'desc',
  })
  const projectRows = projectsQuery.data?.data ?? []
  const scopeProjectIds = useMemo(
    () =>
      projectRows
        .map((item) => item.projectId)
        .filter((id): id is number => typeof id === 'number' && id > 0),
    [projectRows],
  )

  const graphQuery: MultiProjectGraphQuery | null = useMemo(() => {
    if (scopeProjectIds.length === 0) return null
    const freshnessThreshold =
      filters.freshness === 'fresh' || filters.freshness === 'stale'
        ? filters.freshness
        : ('all' as const)
    return {
      projectIds: scopeProjectIds,
      category: (filters.category || undefined) as MultiProjectGraphQuery['category'],
      status: (filters.status ? [filters.status] : undefined) as MultiProjectGraphQuery['status'],
      riskLevel: (filters.riskLevel || undefined) as MultiProjectGraphQuery['riskLevel'],
      maxDepth: MAX_DEPTH,
      nodeLimit: NODE_LIMIT,
      edgeLimit: EDGE_LIMIT,
      freshnessThreshold,
    }
  }, [scopeProjectIds, filters.category, filters.status, filters.riskLevel, filters.freshness])

  const scopeFailed = projectsQuery.isError && !projectsQuery.isLoading
  const graphQueryEnabled = !scopeFailed && graphQuery !== null

  const graphQueryResult = useMpdGraph(organizationId, graphQuery, graphQueryEnabled)
  const { inner: graphPayload } = normalizeMpdGraphPayload<MultiProjectGraphResponse>(
    graphQueryResult.data,
  )

  const layout = useMemo(
    () => layoutDependencyGraph(graphPayload?.nodes ?? [], graphPayload?.edges ?? []),
    [graphPayload],
  )

  const isFeatureDisabled =
    (graphQueryResult.error as { code?: string } | null)?.code === 'FEATURE_DISABLED'
  const errorMessage =
    (graphQueryResult.error as { message?: string } | null)?.message ??
    (projectsQuery.error as { message?: string } | null)?.message

  const visibleNodeCount = graphPayload?.visibleNodeCount ?? layout.nodes.length
  const redactedNodeCount = graphPayload?.redactedNodeCount ?? 0
  const visibleEdgeCount = graphPayload?.visibleEdgeCount ?? layout.edges.length
  const truncated = graphPayload?.truncated ?? false

  const selectedNode = useMemo(
    () => layout.nodes.find((item) => item.node.nodeId === selectedNodeId) ?? null,
    [layout, selectedNodeId],
  )
  const incidentEdges = useMemo(() => {
    if (!selectedNode) return []
    return layout.edges.filter(
      (edge) =>
        edge.sourceNodeId === selectedNode.node.nodeId ||
        edge.targetNodeId === selectedNode.node.nodeId,
    )
  }, [layout, selectedNode])

  const isEmpty = graphPayload !== null && graphPayload.nodes.length === 0
  const isLoading = graphQueryResult.isLoading || (projectsQuery.isLoading && !scopeFailed)
  // FEATURE_DISABLED / 范围失败 / 图谱失败统一走错误卡（诚实降级，不落入空态）
  const queryFailed = graphQueryResult.isError || scopeFailed || isFeatureDisabled

  return (
    <section data-mpd-graph className="flex flex-col gap-3">
      {/* 面板头：摘要 + 刷新 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
            <Network className="h-3.5 w-3.5" aria-hidden />
            范围 {scopeProjectIds.length} 项目
          </span>
          <span className="font-mono text-[10px] text-[var(--nx-text-secondary)]">
            {visibleNodeCount} 端点
          </span>
          <span className="font-mono text-[10px] text-[var(--nx-text-secondary)]">
            {visibleEdgeCount} 依赖边
          </span>
          {redactedNodeCount > 0 ? (
            <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
              {redactedNodeCount} 脱敏
            </span>
          ) : null}
          <span className="flex items-center gap-2 pl-1" aria-label="风险色带图例">
            {(['critical', 'high', 'medium', 'low'] as const).map((risk) => (
              <span
                key={risk}
                data-mpd-graph-legend-risk={risk}
                className="flex items-center gap-1 font-mono text-[9px] text-[var(--nx-text-muted)]"
              >
                <span
                  aria-hidden
                  className="h-0.5 w-4 rounded-full"
                  style={{ backgroundColor: MPD_RISK_COLOR_VAR[risk] }}
                />
                {riskMeta(risk).label}
              </span>
            ))}
            <span className="flex items-center gap-1 font-mono text-[9px] text-[var(--nx-text-muted)]">
              <span
                aria-hidden
                className="h-0 w-4 border-t border-dashed border-[var(--nx-text-muted)]"
              />
              过期
            </span>
          </span>
        </div>
        <button
          type="button"
          data-mpd-graph-refresh
          aria-label="刷新图谱"
          disabled={isLoading}
          onClick={() => {
            void projectsQuery.refetch()
            void graphQueryResult.refetch()
          }}
          className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} aria-hidden />
          刷新
        </button>
      </div>

      {truncated ? (
        <p
          data-mpd-graph-truncated
          role="note"
          className="rounded-sm border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-2.5 py-1.5 text-[10px] text-[var(--nx-text-secondary)]"
        >
          图谱按规模上限截断（深度 {MAX_DEPTH} / 节点 {NODE_LIMIT} / 边 {EDGE_LIMIT}
          ），请用筛选收敛范围。
        </p>
      ) : null}

      {/* 三态 */}
      {isLoading ? (
        <div
          data-mpd-graph-skeleton
          role="status"
          aria-busy="true"
          aria-label="依赖图谱加载中"
          className="flex h-[420px] items-center justify-center rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]"
        >
          <div
            className="h-40 w-2/3 animate-pulse rounded-md"
            style={{ backgroundColor: 'var(--nx-bg-1)' }}
          />
        </div>
      ) : queryFailed ? (
        <div
          data-mpd-graph-error
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
        >
          <AlertTriangle
            className={cn(
              'h-6 w-6',
              isFeatureDisabled ? 'text-[var(--nx-text-muted)]' : 'text-[var(--nx-status-warning)]',
            )}
            aria-hidden
          />
          <div>
            <p className="text-xs font-medium text-[var(--nx-text-primary)]">
              {isFeatureDisabled
                ? '跨项目依赖图谱不可用'
                : scopeFailed
                  ? '无法确定图谱项目范围'
                  : '依赖图谱加载失败'}
            </p>
            <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              {isFeatureDisabled
                ? '该功能需后端启用（FEATURE_MPD_CRUD）。'
                : scopeFailed
                  ? '组织项目清单获取失败（组合项目数据不可达），图谱无法圈定查询范围。'
                  : (errorMessage ?? '网络异常或服务暂不可用，请稍后重试。')}
            </p>
          </div>
          <button
            type="button"
            data-mpd-graph-retry
            onClick={() => {
              void projectsQuery.refetch()
              void graphQueryResult.refetch()
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新加载
          </button>
        </div>
      ) : isEmpty || graphPayload === null ? (
        <div
          data-mpd-graph-empty
          className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
        >
          <Network className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--nx-text-primary)]">
            {scopeProjectIds.length === 0 ? '组织暂无可用项目范围' : '暂无依赖图谱数据'}
          </p>
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            {scopeProjectIds.length === 0
              ? '图谱需要至少一个可见项目作为范围。'
              : '当前筛选范围内不存在依赖关系，可清除筛选条件后重试。'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[1fr_280px]">
          {/* ── 确定性 SVG 图谱（只读，节点点击联动详情） ── */}
          <div className="overflow-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
            <svg
              data-mpd-graph-svg
              role="img"
              aria-label="跨项目依赖网络图"
              width="100%"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              style={{ minWidth: layout.width, minHeight: layout.height }}
            >
              {layout.edges.map((edge) => (
                <path
                  key={edge.edgeId}
                  data-mpd-graph-edge={edge.edgeId}
                  data-mpd-graph-edge-risk={edge.riskLevel}
                  data-mpd-graph-edge-stale={edge.freshness === 'stale' || undefined}
                  d={edge.path}
                  fill="none"
                  stroke={MPD_RISK_COLOR_VAR[edge.riskLevel] ?? 'var(--nx-text-muted)'}
                  strokeWidth={1.5}
                  strokeDasharray={edge.freshness === 'stale' ? '4 3' : undefined}
                  opacity={0.85}
                />
              ))}
              {layout.nodes.map(({ node, x, y }) => {
                const risk = nodeRisk(node)
                const selected = node.nodeId === selectedNodeId
                return (
                  <g
                    key={node.nodeId}
                    data-mpd-graph-node={node.nodeId}
                    data-mpd-graph-node-risk={risk}
                    role="button"
                    aria-label={`查看端点 ${node.label}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedNodeId(node.nodeId)}
                    transform={`translate(${x}, ${y})`}
                  >
                    <rect
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={4}
                      fill="var(--nx-workspace-surface)"
                      stroke={
                        selected
                          ? 'var(--nx-accent)'
                          : (MPD_RISK_COLOR_VAR[risk] ?? 'var(--nx-text-muted)')
                      }
                      strokeWidth={selected ? 2 : 1.25}
                      strokeDasharray={node.redacted ? '5 3' : undefined}
                    />
                    <text
                      x={8}
                      y={15}
                      fontSize={10}
                      fill="var(--nx-text-primary)"
                      fontWeight={selected ? 600 : 400}
                    >
                      {truncateLabel(node.redacted ? '已脱敏' : node.label)}
                    </text>
                    <text
                      x={8}
                      y={29}
                      fontSize={8.5}
                      fill="var(--nx-text-muted)"
                      fontFamily="monospace"
                    >
                      {endpointTypeLabel(node.endpoint.endpointType)}
                      {node.dependencyCount >= 0 ? ` · ${node.dependencyCount} 依赖` : ''}
                    </text>
                    {node.redacted ? (
                      <text
                        x={NODE_WIDTH - 8}
                        y={14}
                        fontSize={8}
                        fill="var(--nx-text-muted)"
                        textAnchor="end"
                        fontFamily="monospace"
                      >
                        脱敏
                      </text>
                    ) : null}
                  </g>
                )
              })}
            </svg>
          </div>

          {/* ── 选中端点只读抽屉（数据来自已取响应，零请求） ── */}
          {selectedNode ? (
            <aside
              data-mpd-graph-node-drawer
              data-node-id={selectedNode.node.nodeId}
              className="flex h-fit max-h-[420px] flex-col rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
            >
              <header className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] px-3 py-2">
                <h4 className="min-w-0 truncate text-xs font-semibold text-[var(--nx-text-primary)]">
                  {selectedNode.node.redacted ? '已脱敏端点' : selectedNode.node.label}
                </h4>
                <button
                  type="button"
                  data-mpd-graph-node-drawer-close
                  aria-label="关闭端点详情"
                  onClick={() => setSelectedNodeId(null)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="font-mono text-[9px] uppercase tracking-wide text-[var(--nx-text-muted)]">
                      端点类型
                    </dt>
                    <dd className="mt-0.5 text-[11px] text-[var(--nx-text-primary)]">
                      {endpointTypeLabel(selectedNode.node.endpoint.endpointType)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[9px] uppercase tracking-wide text-[var(--nx-text-muted)]">
                      关联依赖
                    </dt>
                    <dd className="mt-0.5 text-[11px] text-[var(--nx-text-primary)]">
                      {selectedNode.node.dependencyCount}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="font-mono text-[9px] uppercase tracking-wide text-[var(--nx-text-muted)]">
                      聚合风险
                    </dt>
                    <dd className="mt-0.5 flex items-center gap-2">
                      <MpdRiskBadge value={nodeRisk(selectedNode.node)} />
                      {selectedNode.node.redacted ? (
                        <span className="font-mono text-[9px] text-[var(--nx-text-muted)]">
                          服务端脱敏（仅显示你有权查看的数据）
                        </span>
                      ) : null}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4">
                  <h5 className="mb-1.5 font-mono text-[9px] uppercase tracking-wide text-[var(--nx-text-muted)]">
                    关联依赖边（{incidentEdges.length}）
                  </h5>
                  {incidentEdges.length === 0 ? (
                    <p className="rounded-sm border border-dashed border-[var(--nx-border-hairline)] px-2 py-3 text-center text-[10px] text-[var(--nx-text-muted)]">
                      无边
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-1.5">
                      {incidentEdges.map((edge) => {
                        const isOut = edge.sourceNodeId === selectedNode.node.nodeId
                        return (
                          <li
                            key={edge.edgeId}
                            data-mpd-graph-incident-edge={edge.edgeId}
                            className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5"
                          >
                            <p className="truncate text-[10px] text-[var(--nx-text-primary)]">
                              {isOut ? '→ 输出至' : '← 来自'}
                              <span className="ml-1 text-[var(--nx-text-muted)]">
                                {truncateLabel(
                                  isOut
                                    ? edgeTargetLabel(layout, edge)
                                    : edgeSourceLabel(layout, edge),
                                  20,
                                )}
                              </span>
                            </p>
                            <p className="mt-1 flex flex-wrap items-center gap-1.5">
                              <MpdRiskBadge value={edge.riskLevel} />
                              <MpdStatusBadge value={edge.status} />
                              <span className="font-mono text-[9px] text-[var(--nx-text-muted)]">
                                {categoryLabel(edge.category)} · {dependencyTypeLabel(edge.type)}
                              </span>
                            </p>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </div>
                <p className="mt-3 border-t border-[var(--nx-border-hairline)] pt-2 font-mono text-[9px] text-[var(--nx-text-muted)]">
                  node {selectedNode.node.nodeId}
                </p>
              </div>
            </aside>
          ) : null}
        </div>
      )}
      <p className="font-mono text-[9px] text-[var(--nx-text-muted)]">
        图谱为只读呈现（RL-01）；端点数据按项目可见性由服务端脱敏。
      </p>
    </section>
  )
}

function edgeSourceLabel(layout: GraphLayout, edge: MultiProjectGraphEdge): string {
  const source = layout.nodes.find((item) => item.node.nodeId === edge.sourceNodeId)
  return source ? source.node.label : String(edge.sourceNodeId)
}

function edgeTargetLabel(layout: GraphLayout, edge: MultiProjectGraphEdge): string {
  const target = layout.nodes.find((item) => item.node.nodeId === edge.targetNodeId)
  return target ? target.node.label : String(edge.targetNodeId)
}

export default PmoDependencyGraphPanel
