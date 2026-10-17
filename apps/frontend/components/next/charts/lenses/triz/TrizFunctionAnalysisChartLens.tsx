'use client'

import * as React from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
} from '@xyflow/react'
import { AlertTriangle, Bookmark, Check, Plus, Trash2, X } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import {
  trizGalleryApi,
  type TrizFunctionAnalysisPrefillDraft,
  type TrizFunctionEdgeType,
} from '@/lib/api/triz-gallery'

export interface TrizFunctionAnalysisChartLensProps {
  projectId: number
}

// 四类功能边视觉编码
export function getEdgeConfig(type: string | undefined): {
  label: string
  stroke: string
  strokeDasharray?: string
  strokeWidth: number
} {
  if (type === 'harmful') {
    return { label: '有害功能', stroke: '#ef4444', strokeDasharray: '5,5', strokeWidth: 2.5 }
  }
  if (type === 'insufficient') {
    return { label: '不足功能', stroke: '#f59e0b', strokeDasharray: '3,3', strokeWidth: 2 }
  }
  if (type === 'excessive') {
    return { label: '过度功能', stroke: '#8b5cf6', strokeWidth: 3 }
  }
  return { label: '有用功能', stroke: '#10b981', strokeWidth: 2 }
}

interface ComponentNodeData {
  id: string
  kind: 'system' | 'task' | 'risk' | 'resource' | 'milestone'
  label: string
  source: string
  contextRef: string | null
  [key: string]: unknown
}

interface ProblemCandidate {
  id: string
  kind: string
  message: string
  status: 'pending' | 'confirmed' | 'dismissed'
  contextRefs: string[]
}

// 确定性默认拓扑（初始兜底）
const DEFAULT_INITIAL_NODES: Node<ComponentNodeData>[] = [
  {
    id: 'node-sys',
    position: { x: 260, y: 140 },
    data: {
      id: 'node-sys',
      kind: 'system',
      label: '项目交付主干系统',
      source: 'template',
      contextRef: null,
    },
    style: {
      background: 'var(--nx-workspace-surface)',
      border: '2px solid var(--nx-accent)',
      borderRadius: '8px',
      padding: '10px 14px',
      width: 170,
      color: 'var(--nx-text-primary)',
    },
  },
  {
    id: 'node-task',
    position: { x: 60, y: 60 },
    data: {
      id: 'node-task',
      kind: 'task',
      label: '核心需求开发任务',
      source: 'template',
      contextRef: 'task:101',
    },
    style: {
      background: 'var(--nx-workspace-surface)',
      border: '1px solid var(--nx-border-hairline)',
      borderRadius: '8px',
      padding: '8px 12px',
      width: 150,
      color: 'var(--nx-text-primary)',
    },
  },
  {
    id: 'node-risk',
    position: { x: 480, y: 60 },
    data: {
      id: 'node-risk',
      kind: 'risk',
      label: '关键路径人员超载风险',
      source: 'template',
      contextRef: 'risk:201',
    },
    style: {
      background: 'var(--nx-workspace-surface)',
      border: '1px solid #ef4444',
      borderRadius: '8px',
      padding: '8px 12px',
      width: 160,
      color: 'var(--nx-text-primary)',
    },
  },
  {
    id: 'node-res',
    position: { x: 100, y: 240 },
    data: {
      id: 'node-res',
      kind: 'resource',
      label: '测试自动化算力资源',
      source: 'template',
      contextRef: 'resource:301',
    },
    style: {
      background: 'var(--nx-workspace-surface)',
      border: '1px solid var(--nx-border-hairline)',
      borderRadius: '8px',
      padding: '8px 12px',
      width: 160,
      color: 'var(--nx-text-primary)',
    },
  },
  {
    id: 'node-ms',
    position: { x: 460, y: 240 },
    data: {
      id: 'node-ms',
      kind: 'milestone',
      label: '版本冻结交付里程碑',
      source: 'template',
      contextRef: 'milestone:401',
    },
    style: {
      background: 'var(--nx-workspace-surface)',
      border: '1px solid var(--nx-border-hairline)',
      borderRadius: '8px',
      padding: '8px 12px',
      width: 160,
      color: 'var(--nx-text-primary)',
    },
  },
]

const DEFAULT_INITIAL_EDGES: Edge[] = [
  {
    id: 'e1',
    source: 'node-task',
    target: 'node-sys',
    label: '交付功能特性 (有用)',
    data: { edgeType: 'useful', source: 'template' },
    style: {
      stroke: getEdgeConfig('useful').stroke,
      strokeWidth: getEdgeConfig('useful').strokeWidth,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: getEdgeConfig('useful').stroke },
  },
  {
    id: 'e2',
    source: 'node-risk',
    target: 'node-sys',
    label: '挤压测试周期 (有害)',
    data: { edgeType: 'harmful', source: 'template' },
    style: {
      stroke: getEdgeConfig('harmful').stroke,
      strokeWidth: getEdgeConfig('harmful').strokeWidth,
      strokeDasharray: getEdgeConfig('harmful').strokeDasharray,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: getEdgeConfig('harmful').stroke },
  },
  {
    id: 'e3',
    source: 'node-res',
    target: 'node-sys',
    label: '覆盖率不足 (不足)',
    data: { edgeType: 'insufficient', source: 'template' },
    style: {
      stroke: getEdgeConfig('insufficient').stroke,
      strokeWidth: getEdgeConfig('insufficient').strokeWidth,
      strokeDasharray: getEdgeConfig('insufficient').strokeDasharray,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: getEdgeConfig('insufficient').stroke },
  },
  {
    id: 'e4',
    source: 'node-sys',
    target: 'node-ms',
    label: '过度对齐开销 (过度)',
    data: { edgeType: 'excessive', source: 'template' },
    style: {
      stroke: getEdgeConfig('excessive').stroke,
      strokeWidth: getEdgeConfig('excessive').strokeWidth,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: getEdgeConfig('excessive').stroke },
  },
]

const DEFAULT_INITIAL_PROBLEMS: ProblemCandidate[] = [
  {
    id: 'prob-1',
    kind: 'harmful_accumulation',
    message: '风险节点「关键路径人员超载」对主干系统产生有害功能边，可能导致测试挤压',
    status: 'pending',
    contextRefs: ['risk:201'],
  },
  {
    id: 'prob-2',
    kind: 'insufficient_coverage',
    message: '测试资源对主干系统支持不足，建议引入自动化回归',
    status: 'pending',
    contextRefs: ['resource:301'],
  },
]

export function TrizFunctionAnalysisChartLens({ projectId }: TrizFunctionAnalysisChartLensProps) {
  const { can } = usePermissions()
  const canManage = can('diagram:manage')

  const [nodes, setNodes] = React.useState<Node<ComponentNodeData>[]>(DEFAULT_INITIAL_NODES)
  const [edges, setEdges] = React.useState<Edge[]>(DEFAULT_INITIAL_EDGES)
  const [problems, setProblems] = React.useState<ProblemCandidate[]>(DEFAULT_INITIAL_PROBLEMS)
  const [loading, setLoading] = React.useState(true)
  const [isDirty, setIsDirty] = React.useState(false)
  const [existingArtifactId, setExistingArtifactId] = React.useState<number | null>(null)
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null)

  // 新增节点对话框表单状态
  const [newNodeLabel, setNewNodeLabel] = React.useState('')
  const [newNodeKind, setNewNodeKind] = React.useState<'task' | 'risk' | 'resource'>('task')

  // 初始化加载
  React.useEffect(() => {
    let active = true
    setLoading(true)

    async function loadData() {
      try {
        const artifactsList = await trizGalleryApi.listArtifacts(projectId, {
          artifactType: 'function_analysis',
        })
        if (!active) return

        if (artifactsList.data && artifactsList.data.length > 0) {
          const current = artifactsList.data[0]!
          setExistingArtifactId(current.id)
          const content = current.content
          if (content?.nodes && content?.edges) {
            // 从保存的结构化数据中恢复节点（位置按默认网格排布，保存时不持久化拖拽坐标）
            type SavedNode = {
              id: string
              kind: ComponentNodeData['kind']
              label: string
              source?: string
              contextRef?: string | null
            }
            type SavedEdge = {
              id: string
              from: string
              to: string
              label?: string
              edgeType?: string
              source?: string
            }

            const restoredNodes: Node<ComponentNodeData>[] = (content.nodes as SavedNode[]).map(
              (n, idx) => ({
                id: n.id,
                position: { x: 80 + (idx % 3) * 190, y: 60 + Math.floor(idx / 3) * 110 },
                data: {
                  id: n.id,
                  kind: n.kind,
                  label: n.label,
                  source: n.source || 'manual',
                  contextRef: n.contextRef || null,
                },
                style: {
                  background: 'var(--nx-workspace-surface)',
                  border:
                    n.kind === 'risk' ? '1px solid #ef4444' : '1px solid var(--nx-border-hairline)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  width: 160,
                  color: 'var(--nx-text-primary)',
                },
              }),
            )

            const restoredEdges: Edge[] = (content.edges as SavedEdge[]).map((e) => {
              const cfg = getEdgeConfig(e.edgeType)
              return {
                id: e.id,
                source: e.from,
                target: e.to,
                label: e.label,
                data: { edgeType: e.edgeType, source: e.source || 'manual' },
                style: {
                  stroke: cfg.stroke,
                  strokeWidth: cfg.strokeWidth,
                  strokeDasharray: cfg.strokeDasharray,
                },
                markerEnd: { type: MarkerType.ArrowClosed, color: cfg.stroke },
              }
            })

            setNodes(restoredNodes)
            setEdges(restoredEdges)
            if (content.problemCandidates) {
              setProblems(content.problemCandidates as ProblemCandidate[])
            }
            setIsDirty(false)
            setLoading(false)
            return
          }
        }

        // 无保存产物，请求预填草案
        const draft = await trizGalleryApi.getPrefillDraft<TrizFunctionAnalysisPrefillDraft>(
          projectId,
          'function_analysis',
        )
        if (!active) return

        if (draft && draft.nodes && draft.edges) {
          const prefillNodes: Node<ComponentNodeData>[] = draft.nodes.map((n, idx) => ({
            id: n.id,
            position: { x: 80 + (idx % 3) * 190, y: 60 + Math.floor(idx / 3) * 110 },
            data: {
              id: n.id,
              kind: n.kind,
              label: n.label,
              source: n.source,
              contextRef: n.contextRef,
            },
            style: {
              background: 'var(--nx-workspace-surface)',
              border:
                n.kind === 'risk' ? '1px solid #ef4444' : '1px solid var(--nx-border-hairline)',
              borderRadius: '8px',
              padding: '8px 12px',
              width: 160,
              color: 'var(--nx-text-primary)',
            },
          }))

          const prefillEdges: Edge[] = draft.edges.map((e) => {
            const cfg = getEdgeConfig(e.edgeType)
            return {
              id: e.id,
              source: e.from,
              target: e.to,
              label: e.label,
              data: { edgeType: e.edgeType, source: e.source },
              style: {
                stroke: cfg.stroke,
                strokeWidth: cfg.strokeWidth,
                strokeDasharray: cfg.strokeDasharray,
              },
              markerEnd: { type: MarkerType.ArrowClosed, color: cfg.stroke },
            }
          })

          setNodes(prefillNodes)
          setEdges(prefillEdges)
          if (draft.problemCandidates) {
            setProblems(
              draft.problemCandidates.map((p) => ({
                id: p.id,
                kind: p.kind,
                message: p.message,
                status: 'pending',
                contextRefs: p.contextRefs,
              })),
            )
          }
        }
      } catch {
        // 异常保持默认初始化图
      } finally {
        if (active) setLoading(false)
      }
    }

    loadData()
    return () => {
      active = false
    }
  }, [projectId])

  const onNodesChange: OnNodesChange<Node<ComponentNodeData>> = React.useCallback((changes) => {
    // 允许在前端视图中拖拽调整位置，但注意：保存时绝不持久化自由布局坐标（特此有断言守门）
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  const onEdgesChange: OnEdgesChange = React.useCallback((changes) => {
    setEdges((eds) => applyEdgeChanges(changes, eds))
    setIsDirty(true)
  }, [])

  // 问题候选逐条确认 / 驳回（只更新本地与分馆产物状态，零业务表写入）
  const handleReviewProblem = (id: string, action: 'confirmed' | 'dismissed') => {
    setProblems((prev) => prev.map((p) => (p.id === id ? { ...p, status: action } : p)))
    setIsDirty(true)
  }

  // 受控编辑：添加组件节点
  const handleAddNode = () => {
    if (!newNodeLabel.trim()) return
    const newId = `node-custom-${Date.now()}`
    const newNode: Node<ComponentNodeData> = {
      id: newId,
      position: { x: 200, y: 200 },
      data: {
        id: newId,
        kind: newNodeKind,
        label: newNodeLabel.trim(),
        source: 'manual',
        contextRef: null,
      },
      style: {
        background: 'var(--nx-workspace-surface)',
        border: '1px dashed var(--nx-accent)',
        borderRadius: '8px',
        padding: '8px 12px',
        width: 160,
        color: 'var(--nx-text-primary)',
      },
    }
    setNodes((prev) => [...prev, newNode])
    setNewNodeLabel('')
    setIsDirty(true)
  }

  // 受控编辑：删除节点
  const handleDeleteNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId))
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setIsDirty(true)
  }

  // 受控编辑：修改边类型
  const handleChangeEdgeType = (edgeId: string, newType: TrizFunctionEdgeType) => {
    const cfg = getEdgeConfig(newType)
    setEdges((prev) =>
      prev.map((e) => {
        if (e.id === edgeId) {
          return {
            ...e,
            data: { ...(e.data || {}), edgeType: newType, source: 'manual' },
            style: {
              stroke: cfg.stroke,
              strokeWidth: cfg.strokeWidth,
              strokeDasharray: cfg.strokeDasharray,
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: cfg.stroke },
          }
        }
        return e
      }),
    )
    setIsDirty(true)
  }

  // 显式保存分馆产物（断言：无自由布局拖拽坐标保存）
  const handleSave = async () => {
    if (!canManage) return
    setSaveStatus('saving')
    setSaveMessage(null)

    try {
      // 结构化数据提取：只保存拓扑语义（节点类型、文案、来源、连线与功能类型），不保存 x / y 自由坐标！
      const payloadContent = {
        nodes: nodes.map((n) => ({
          id: n.data.id,
          kind: n.data.kind,
          label: n.data.label,
          source: n.data.source,
          contextRef: n.data.contextRef,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          from: e.source,
          to: e.target,
          edgeType: (e.data?.edgeType as string) || 'useful',
          label: e.label || '',
          source: (e.data?.source as string) || 'template',
        })),
        problemCandidates: problems,
        savedAt: new Date().toISOString(),
      }

      const payload = {
        artifactType: 'function_analysis' as const,
        content: payloadContent,
      }

      if (existingArtifactId) {
        await trizGalleryApi.updateArtifact(projectId, existingArtifactId, payload)
      } else {
        const created = await trizGalleryApi.createArtifact(projectId, payload)
        setExistingArtifactId(created.id)
      }

      setIsDirty(false)
      setSaveStatus('saved')
      setSaveMessage('功能分析图已显式保存（保留规则引擎与人工来源标注）')
    } catch {
      setSaveStatus('error')
      setSaveMessage('保存失败，请稍后重试')
    }
  }

  return (
    <div
      data-triz-function-analysis-lens
      className="flex h-full flex-col gap-4 overflow-y-auto p-4 lg:p-6 bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)]"
    >
      {/* 顶部工具条 */}
      <header
        data-export-ignore="true"
        className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-[var(--nx-text-primary)]">
            功能拓扑分析图
          </span>
          {isDirty && (
            <span
              data-unsaved-badge
              className="rounded bg-[var(--nx-status-warning)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--nx-status-warning)] animate-pulse"
            >
              未保存修改
            </span>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 text-[var(--nx-text-muted)]">
              <span className="inline-block w-2.5 h-0.5 bg-[#10b981]" /> 有用
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--nx-text-muted)]">
              <span className="inline-block w-2.5 h-0.5 border-b border-dashed border-[#ef4444]" />{' '}
              有害
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--nx-text-muted)]">
              <span className="inline-block w-2.5 h-0.5 border-b border-dotted border-[#f59e0b]" />{' '}
              不足
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--nx-text-muted)]">
              <span className="inline-block w-2.5 h-1 bg-[#8b5cf6]" /> 过度
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {canManage ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saveStatus === 'saving'}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-[var(--nx-accent)] px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Bookmark className="h-3 w-3" />
              <span>{saveStatus === 'saving' ? '正在保存...' : '保存功能分析'}</span>
            </button>
          ) : (
            <span
              data-permission-neutral-hint
              className="text-xs text-[var(--nx-text-muted)] italic"
            >
              当前账号仅具只读权限，保存入口已隐藏
            </span>
          )}

          {saveMessage && (
            <span
              className={`text-xs ${saveStatus === 'saved' ? 'text-[var(--nx-status-success)]' : 'text-[var(--nx-status-danger)]'}`}
            >
              {saveMessage}
            </span>
          )}
        </div>
      </header>

      {/* 受控添加组件小工具条 */}
      <div
        data-export-ignore="true"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-2 text-xs"
      >
        <span className="font-medium text-[var(--nx-text-primary)]">受控编辑：</span>
        <input
          type="text"
          value={newNodeLabel}
          onChange={(e) => setNewNodeLabel(e.target.value)}
          placeholder="输入新组件节点名称..."
          className="h-7 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 text-xs text-[var(--nx-text-primary)] focus:outline-none focus:border-[var(--nx-accent)]"
        />
        <select
          value={newNodeKind}
          onChange={(e) => setNewNodeKind(e.target.value as 'task' | 'risk' | 'resource')}
          className="h-7 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 text-xs text-[var(--nx-text-primary)]"
        >
          <option value="task">任务组件</option>
          <option value="risk">风险因素</option>
          <option value="resource">资源要素</option>
        </select>
        <button
          type="button"
          onClick={handleAddNode}
          className="inline-flex h-7 items-center gap-1 rounded bg-[var(--nx-space-surface)] border border-[var(--nx-border-hairline)] px-2 text-xs font-medium text-[var(--nx-text-primary)] hover:bg-[var(--nx-bg-1)]"
        >
          <Plus className="h-3 w-3" />
          <span>添加节点</span>
        </button>
      </div>

      {/* 问题候选审查区 */}
      {problems.length > 0 && (
        <section
          aria-label="功能问题候选审查"
          data-export-ignore="true"
          className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)] mb-2">
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--nx-status-warning)]" />
            <span>检测到的功能分析问题候选（需人工逐条确认或驳回，不直接写业务表）：</span>
          </div>

          <div className="flex flex-col gap-2">
            {problems.map((prob) => (
              <div
                key={prob.id}
                data-problem-candidate={prob.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-2 text-xs"
              >
                <div className="flex items-center gap-2 flex-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      prob.status === 'confirmed'
                        ? 'bg-[var(--nx-status-success)]/15 text-[var(--nx-status-success)] font-medium'
                        : prob.status === 'dismissed'
                          ? 'bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)] line-through'
                          : 'bg-[var(--nx-status-warning)]/15 text-[var(--nx-status-warning)] font-medium'
                    }`}
                  >
                    {prob.status === 'confirmed'
                      ? '已确认'
                      : prob.status === 'dismissed'
                        ? '已驳回'
                        : '待确认'}
                  </span>
                  <span className="text-[var(--nx-text-secondary)]">{prob.message}</span>
                </div>

                {prob.status === 'pending' && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleReviewProblem(prob.id, 'confirmed')}
                      className="inline-flex h-6 items-center gap-1 rounded bg-[var(--nx-status-success)]/10 px-2 text-[11px] font-medium text-[var(--nx-status-success)] hover:bg-[var(--nx-status-success)]/20"
                    >
                      <Check className="h-3 w-3" />
                      <span>确认</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReviewProblem(prob.id, 'dismissed')}
                      className="inline-flex h-6 items-center gap-1 rounded bg-[var(--nx-status-danger)]/10 px-2 text-[11px] font-medium text-[var(--nx-status-danger)] hover:bg-[var(--nx-status-danger)]/20"
                    >
                      <X className="h-3 w-3" />
                      <span>驳回</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ReactFlow 节点关系图画布容器 */}
      <section
        aria-label="功能拓扑关系图画布"
        className="flex-1 min-h-[480px] rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] relative overflow-hidden"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodesDraggable={true}
          nodesConnectable={false}
          fitView
          attributionPosition="bottom-right"
        >
          <Background color="var(--nx-border-hairline)" gap={16} />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </section>

      {/* 边与节点清单快速修改栏 */}
      <div
        data-export-ignore="true"
        className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
      >
        <div>
          <span className="font-semibold text-[var(--nx-text-primary)] block mb-1.5">
            边属性受控微调（修改类型）：
          </span>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {edges.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-2 p-1.5 rounded bg-[var(--nx-workspace-surface)] border border-[var(--nx-border-hairline)]"
              >
                <span className="truncate flex-1 text-[var(--nx-text-secondary)]">
                  {e.source} ➔ {e.target}: {e.label}
                </span>
                <select
                  value={(e.data?.edgeType as string) || 'useful'}
                  onChange={(ev) =>
                    handleChangeEdgeType(e.id, ev.target.value as TrizFunctionEdgeType)
                  }
                  className="h-6 text-[11px] rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-primary)]"
                >
                  <option value="useful">有用</option>
                  <option value="harmful">有害</option>
                  <option value="insufficient">不足</option>
                  <option value="excessive">过度</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div>
          <span className="font-semibold text-[var(--nx-text-primary)] block mb-1.5">
            节点管理（删除节点）：
          </span>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {nodes.map((n) => (
              <div
                key={n.id}
                className="flex items-center justify-between gap-2 p-1.5 rounded bg-[var(--nx-workspace-surface)] border border-[var(--nx-border-hairline)]"
              >
                <span className="truncate flex-1 text-[var(--nx-text-primary)]">
                  {n.data.label} ({n.data.kind})
                  <span className="ml-1 text-[10px] text-[var(--nx-text-muted)]">
                    [{n.data.source}]
                  </span>
                </span>
                {n.data.kind !== 'system' && (
                  <button
                    type="button"
                    onClick={() => handleDeleteNode(n.id)}
                    className="text-[var(--nx-text-muted)] hover:text-[var(--nx-status-danger)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TrizFunctionAnalysisChartLens
