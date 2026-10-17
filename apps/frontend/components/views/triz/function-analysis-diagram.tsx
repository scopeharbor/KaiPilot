'use client'

// v3-triz-function-analysis-diagram — 功能分析图审查面
// SVG 渲染组件-功能关系图，审查问题候选。
//
// 文案规则（硬性要求）：
// - 禁止「自动应用」「一键删除」「自动修剪」「自动执行」
// - 使用「加入方案篮子」「记录审查」「进入草案预览」「查看依据」「打开审查」

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type {
  FunctionAnalysisRun,
  FunctionComponentNode,
  FunctionRelationEdge,
  FunctionIssueCandidate,
  FunctionAnalysisCost,
  FunctionEdgeType,
  FunctionIssueType,
  FunctionIssueSeverity,
  FunctionIssueCandidateStatus,
  FunctionAnalysisWarningCode,
} from '@aiproj/types'
import {
  useFunctionAnalyses,
  useFunctionAnalysisGraph,
  useFunctionAnalysisIssues,
  useCreateFunctionAnalysis,
  useExplainFunctionIssue,
  useReviewFunctionIssue,
  useFunctionWorkbenchPreview,
  useFunctionDecisionPreview,
  useFunctionDraftHandoffPreview,
} from '@/hooks/use-function-analysis'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Checkbox } from '@/components/ui/Checkbox'
import { Label } from '@/components/ui/Label'
import { Alert } from '@/components/ui/Alert'
import { ScrollArea } from '@/components/ui/ScrollArea'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Eye,
  FileText,
  Filter,
  GitBranch,
  Info,
  Maximize2,
  Plus,
  RefreshCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// 中文映射
// ---------------------------------------------------------------------------
const runStatusLabels: Record<string, string> = {
  queued: '排队中',
  completed: '已完成',
  completed_with_warnings: '已完成（有警告）',
  failed: '失败',
  stale: '已过期',
  archived: '已归档',
}

const runStatusVariant: Record<
  string,
  'neutral' | 'danger' | 'info' | 'outline' | 'success' | 'warning'
> = {
  queued: 'info',
  completed: 'success',
  completed_with_warnings: 'warning',
  failed: 'danger',
  stale: 'warning',
  archived: 'outline',
}

const edgeTypeLabels: Record<FunctionEdgeType, string> = {
  useful: '有用功能',
  harmful: '有害功能',
  insufficient: '不足功能',
  excessive: '过度功能',
}

const edgeTypeColors: Record<FunctionEdgeType, string> = {
  useful: '#16a34a',
  harmful: '#dc2626',
  insufficient: '#ea580c',
  excessive: '#9333ea',
}

const nodeTypeLabels: Record<string, string> = {
  system_component: '系统组件',
  supersystem_component: '超系统组件',
  user_supplied: '用户提供',
  inferred: '推断',
}

const scopeLabels: Record<string, string> = {
  internal: '内部',
  external: '外部',
  environment: '环境',
}

const issueTypeLabels: Record<FunctionIssueType, string> = {
  trim_candidate: '可修剪',
  harmful_function: '有害功能',
  insufficient_function: '不足功能',
  excessive_function: '过度功能',
  duplicate_function: '重复功能',
  isolated_component: '孤立组件',
  single_point_dependency: '单点依赖',
}

const severityLabels: Record<FunctionIssueSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

const severityVariant: Record<FunctionIssueSeverity, 'danger' | 'warning' | 'neutral' | 'outline'> =
  {
    critical: 'danger',
    high: 'danger',
    medium: 'warning',
    low: 'outline',
  }

const candidateStatusLabels: Record<FunctionIssueCandidateStatus, string> = {
  unreviewed: '待审查',
  reviewed: '已审查',
  dismissed: '已忽略',
  needs_more_info: '需更多信息',
  blocked_stale: '已过期',
}

const warningLabels: Record<FunctionAnalysisWarningCode, string> = {
  INSUFFICIENT_COMPONENT_SOURCE: '组件来源不足',
  SOURCE_UNAVAILABLE: '来源模块不可用',
  SOURCE_STALE: '来源数据已过期',
  PERMISSION_RESTRICTED: '部分来源因权限被隐藏',
  INSUFFICIENT_EVIDENCE: '证据不足',
  AI_EXPLANATION_FALLBACK: 'AI 解释已降级',
  AI_EXPLANATION_BLOCKED: 'AI 解释被阻断',
  HANDOFF_BLOCKED_STALE: '交接因来源过期被阻止',
  LARGE_GRAPH_TRUNCATED: '大图已截断',
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------
export interface FunctionAnalysisDiagramProps {
  projectId: number
}

export default function FunctionAnalysisDiagram({ projectId }: FunctionAnalysisDiagramProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canView = hasPermission('function_analysis:view')

  const runIdParam = searchParams.get('runId')
  const initialRunId = runIdParam ? Number(runIdParam) : null

  const [selectedRunId, setSelectedRunId] = useState<number | null>(initialRunId)
  const [selectedNode, setSelectedNode] = useState<FunctionComponentNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<FunctionRelationEdge | null>(null)
  const [selectedIssue, setSelectedIssue] = useState<FunctionIssueCandidate | null>(null)
  const [filterType, setFilterType] = useState<string[]>([])
  const [filterSeverity, setFilterSeverity] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterStale, setFilterStale] = useState<boolean | undefined>(undefined)
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [reviewAction, setReviewAction] = useState<'reviewed' | 'dismissed' | 'needs_more_info'>(
    'reviewed',
  )
  const [reviewReason, setReviewReason] = useState('')
  const [actionDialogOpen, setActionDialogOpen] = useState(false)
  const [actionDialogType, setActionDialogType] = useState<'workbench' | 'decision' | 'draft'>(
    'workbench',
  )
  const [actionConfirmChecked, setActionConfirmChecked] = useState(false)
  const [svgPan, setSvgPan] = useState({ x: 0, y: 0 })
  const [svgZoom, setSvgZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  const [detailTab, setDetailTab] = useState('node')

  const {
    data: analysesData,
    isLoading: loadingRuns,
    isError: runsError,
  } = useFunctionAnalyses(projectId)

  const {
    data: graphData,
    isLoading: loadingGraph,
    isError: graphError,
  } = useFunctionAnalysisGraph(projectId, selectedRunId ?? 0)

  const issuesParams = useMemo(
    () => ({
      issueType: filterType.length > 0 ? filterType.join(',') : undefined,
      severity: filterSeverity.length > 0 ? filterSeverity.join(',') : undefined,
      status: filterStatus.length > 0 ? filterStatus.join(',') : undefined,
      stale: filterStale,
    }),
    [filterType, filterSeverity, filterStatus, filterStale],
  )

  const { data: issuesData, isLoading: loadingIssues } = useFunctionAnalysisIssues(
    projectId,
    selectedRunId ?? 0,
    issuesParams,
  )

  const createMutation = useCreateFunctionAnalysis(projectId)
  const explainMutation = useExplainFunctionIssue(projectId, selectedRunId ?? 0)
  const reviewMutation = useReviewFunctionIssue(projectId, selectedRunId ?? 0)
  const workbenchPreviewMutation = useFunctionWorkbenchPreview(projectId, selectedRunId ?? 0)
  const decisionPreviewMutation = useFunctionDecisionPreview(projectId, selectedRunId ?? 0)
  const handoffPreviewMutation = useFunctionDraftHandoffPreview(projectId, selectedRunId ?? 0)

  // URL query filter sync
  useEffect(() => {
    if (selectedRunId !== null && selectedRunId !== initialRunId) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('runId', String(selectedRunId))
      router.replace(`?${params.toString()}`, { scroll: false })
    }
  }, [selectedRunId, initialRunId, router, searchParams])

  // SVG pan/zoom handlers
  const handleSvgMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 0) {
        setIsPanning(true)
        setPanStart({ x: e.clientX - svgPan.x, y: e.clientY - svgPan.y })
      }
    },
    [svgPan],
  )

  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return
      setSvgPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    },
    [isPanning, panStart],
  )

  const handleSvgMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const handleZoomIn = () => setSvgZoom((z) => Math.min(z * 1.2, 3))
  const handleZoomOut = () => setSvgZoom((z) => Math.max(z / 1.2, 0.3))
  const handleResetView = () => {
    setSvgPan({ x: 0, y: 0 })
    setSvgZoom(1)
  }

  const handleReviewOpen = (issue: FunctionIssueCandidate) => {
    setSelectedIssue(issue)
    setReviewAction('reviewed')
    setReviewReason('')
    setReviewDialogOpen(true)
  }

  const handleReviewSubmit = () => {
    if (!selectedIssue) return
    reviewMutation.mutate(
      {
        issueKey: selectedIssue.issueKey,
        body: { action: reviewAction, reason: reviewReason || undefined },
      },
      {
        onSuccess: () => setReviewDialogOpen(false),
      },
    )
  }

  const handleActionOpen = (
    issue: FunctionIssueCandidate,
    type: 'workbench' | 'decision' | 'draft',
  ) => {
    setSelectedIssue(issue)
    setActionDialogType(type)
    setActionConfirmChecked(false)
    setActionDialogOpen(true)
  }

  const handleActionSubmit = () => {
    if (!selectedIssue) return
    if (!actionConfirmChecked) return

    if (actionDialogType === 'draft') {
      handoffPreviewMutation.mutate({
        issueKey: selectedIssue.issueKey,
        targetType: 'draft_layer',
      })
    } else if (actionDialogType === 'workbench') {
      workbenchPreviewMutation.mutate(selectedIssue.issueKey)
    } else {
      decisionPreviewMutation.mutate(selectedIssue.issueKey)
    }
    setActionDialogOpen(false)
  }

  const handleExplain = (issue: FunctionIssueCandidate) => {
    explainMutation.mutate(issue.issueKey)
  }

  if (!canView) {
    return (
      <div className="rounded-md bg-muted p-6 text-center text-sm text-muted-foreground">
        您没有功能分析图权限。
      </div>
    )
  }

  const runs = analysesData?.data ?? []
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">功能分析图</h2>
          <p className="text-sm text-muted-foreground">
            分析项目组件间的功能关系，识别有害功能、不足功能与可修剪组件，提供问题候选供审查
          </p>
        </div>
        <Button onClick={() => createMutation.mutate({})} disabled={createMutation.isPending}>
          <Plus className="mr-1 h-4 w-4" />
          {createMutation.isPending ? '分析中...' : '新建分析'}
        </Button>
      </div>

      {createMutation.isError && (
        <Alert variant="danger">创建分析失败，请检查权限或稍后重试。</Alert>
      )}

      {createMutation.isSuccess && createMutation.data && (
        <Alert>
          分析运行已创建：产生 {(createMutation.data as { nodes?: unknown[] }).nodes?.length ?? 0}{' '}
          个组件节点。
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              const created = createMutation.data as { id: number }
              setSelectedRunId(created.id ?? null)
            }}
          >
            查看结果
          </Button>
        </Alert>
      )}

      {/* Run list + graph area */}
      {loadingRuns ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : runsError ? (
        <Alert variant="danger">无法加载分析历史。请确认拥有功能分析权限。</Alert>
      ) : runs.length === 0 ? (
        <div className="rounded-md bg-muted p-8 text-center text-sm text-muted-foreground">
          尚未有功能分析图。点击「新建分析」开始。
        </div>
      ) : (
        <RunListPanel runs={runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
      )}

      {selectedRun && (
        <>
          {/* Three-column layout: desktop */}
          <div className="hidden gap-4 lg:grid lg:grid-cols-[220px_1fr_280px]">
            <FilterPanel
              filterType={filterType}
              filterSeverity={filterSeverity}
              filterStatus={filterStatus}
              filterStale={filterStale}
              onFilterTypeChange={setFilterType}
              onFilterSeverityChange={setFilterSeverity}
              onFilterStatusChange={setFilterStatus}
              onFilterStaleChange={setFilterStale}
            />
            <SvgGraphCanvas
              graphData={graphData}
              loadingGraph={loadingGraph}
              graphError={graphError}
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              svgPan={svgPan}
              svgZoom={svgZoom}
              svgRef={svgRef}
              onNodeSelect={(node) => {
                setSelectedNode(node)
                setSelectedEdge(null)
                setSelectedIssue(null)
                setDetailTab('node')
              }}
              onEdgeSelect={(edge) => {
                setSelectedEdge(edge)
                setSelectedNode(null)
                setSelectedIssue(null)
                setDetailTab('edge')
              }}
              onMouseDown={handleSvgMouseDown}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onReset={handleResetView}
            />
            <DetailPanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              selectedIssue={selectedIssue}
              detailTab={detailTab}
              onDetailTabChange={setDetailTab}
              issues={issuesData?.data ?? []}
              loadingIssues={loadingIssues}
              onIssueSelect={(issue) => {
                setSelectedIssue(issue)
                setSelectedNode(null)
                setSelectedEdge(null)
                setDetailTab('issue')
              }}
              onReviewOpen={handleReviewOpen}
              onActionOpen={handleActionOpen}
              onExplain={handleExplain}
              explainMutation={explainMutation}
              workbenchPreviewData={workbenchPreviewMutation.data}
              decisionPreviewData={decisionPreviewMutation.data}
              handoffPreviewData={handoffPreviewMutation.data}
            />
          </div>

          {/* Mobile: tabs mode */}
          <div className="lg:hidden">
            <Tabs defaultValue="filter">
              <TabsList className="w-full">
                <TabsTrigger value="filter">
                  <Filter className="mr-1 h-3 w-3" />
                  过滤
                </TabsTrigger>
                <TabsTrigger value="graph">
                  <GitBranch className="mr-1 h-3 w-3" />图
                </TabsTrigger>
                <TabsTrigger value="detail">
                  <Info className="mr-1 h-3 w-3" />
                  详情
                </TabsTrigger>
              </TabsList>
              <TabsContent value="filter">
                <FilterPanel
                  filterType={filterType}
                  filterSeverity={filterSeverity}
                  filterStatus={filterStatus}
                  filterStale={filterStale}
                  onFilterTypeChange={setFilterType}
                  onFilterSeverityChange={setFilterSeverity}
                  onFilterStatusChange={setFilterStatus}
                  onFilterStaleChange={setFilterStale}
                />
              </TabsContent>
              <TabsContent value="graph">
                <SvgGraphCanvas
                  graphData={graphData}
                  loadingGraph={loadingGraph}
                  graphError={graphError}
                  selectedNode={selectedNode}
                  selectedEdge={selectedEdge}
                  svgPan={svgPan}
                  svgZoom={svgZoom}
                  svgRef={svgRef}
                  onNodeSelect={(node) => {
                    setSelectedNode(node)
                    setSelectedEdge(null)
                    setSelectedIssue(null)
                  }}
                  onEdgeSelect={(edge) => {
                    setSelectedEdge(edge)
                    setSelectedNode(null)
                    setSelectedIssue(null)
                  }}
                  onMouseDown={handleSvgMouseDown}
                  onMouseMove={handleSvgMouseMove}
                  onMouseUp={handleSvgMouseUp}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  onReset={handleResetView}
                />
              </TabsContent>
              <TabsContent value="detail">
                <DetailPanel
                  selectedNode={selectedNode}
                  selectedEdge={selectedEdge}
                  selectedIssue={selectedIssue}
                  detailTab={detailTab}
                  onDetailTabChange={setDetailTab}
                  issues={issuesData?.data ?? []}
                  loadingIssues={loadingIssues}
                  onIssueSelect={(issue) => {
                    setSelectedIssue(issue)
                    setSelectedNode(null)
                    setSelectedEdge(null)
                  }}
                  onReviewOpen={handleReviewOpen}
                  onActionOpen={handleActionOpen}
                  onExplain={handleExplain}
                  explainMutation={explainMutation}
                  workbenchPreviewData={workbenchPreviewMutation.data}
                  decisionPreviewData={decisionPreviewMutation.data}
                  handoffPreviewData={handoffPreviewMutation.data}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Dialogs */}
          <ReviewDialog
            open={reviewDialogOpen}
            onOpenChange={setReviewDialogOpen}
            reviewAction={reviewAction}
            onReviewActionChange={setReviewAction}
            reviewReason={reviewReason}
            onReviewReasonChange={setReviewReason}
            onSubmit={handleReviewSubmit}
            isPending={reviewMutation.isPending}
          />

          <ActionDialog
            open={actionDialogOpen}
            onOpenChange={setActionDialogOpen}
            actionType={actionDialogType}
            confirmChecked={actionConfirmChecked}
            onConfirmCheckedChange={setActionConfirmChecked}
            onSubmit={handleActionSubmit}
            isPending={
              workbenchPreviewMutation.isPending ||
              decisionPreviewMutation.isPending ||
              handoffPreviewMutation.isPending
            }
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RunListPanel
// ---------------------------------------------------------------------------
function RunListPanel({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: FunctionAnalysisRun[]
  selectedRunId: number | null
  onSelect: (id: number) => void
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">分析运行（{runs.length}）</h3>
      <ScrollArea className="max-h-48">
        <div className="space-y-2">
          {runs.map((run) => (
            <Card
              key={run.id}
              className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                selectedRunId === run.id ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => onSelect(run.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">分析 #{run.id}</CardTitle>
                  <Badge variant={runStatusVariant[run.status] ?? 'neutral'}>
                    {runStatusLabels[run.status] ?? run.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <span>节点：{run.nodeCount}</span>
                  <span>边：{run.edgeCount}</span>
                  <span>问题：{run.issueCount}</span>
                  <span>
                    创建：
                    {new Date(run.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  <span>版本：{run.ruleVersion}</span>
                  {run.costSummary && (
                    <span>
                      成本：
                      {run.costSummary.estimatedCost != null
                        ? `$${run.costSummary.estimatedCost.toFixed(4)}`
                        : '—'}
                    </span>
                  )}
                </div>
                {run.warningSummary?.length > 0 && (
                  <div className="mt-2 text-xs text-amber-600">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    {run.warningSummary.length} 个警告
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilterPanel
// ---------------------------------------------------------------------------
function FilterPanel({
  filterType,
  filterSeverity,
  filterStatus,
  filterStale,
  onFilterTypeChange,
  onFilterSeverityChange,
  onFilterStatusChange,
  onFilterStaleChange,
}: {
  filterType: string[]
  filterSeverity: string[]
  filterStatus: string[]
  filterStale: boolean | undefined
  onFilterTypeChange: (v: string[]) => void
  onFilterSeverityChange: (v: string[]) => void
  onFilterStatusChange: (v: string[]) => void
  onFilterStaleChange: (v: boolean | undefined) => void
}) {
  const toggleFilter = (current: string[], value: string, setter: (v: string[]) => void) => {
    if (current.includes(value)) {
      setter(current.filter((x) => x !== value))
    } else {
      setter([...current, value])
    }
  }

  const clearAll = () => {
    onFilterTypeChange([])
    onFilterSeverityChange([])
    onFilterStatusChange([])
    onFilterStaleChange(undefined)
  }

  const hasFilters =
    filterType.length > 0 ||
    filterSeverity.length > 0 ||
    filterStatus.length > 0 ||
    filterStale !== undefined

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">过滤</CardTitle>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="mr-1 h-3 w-3" />
              清除
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Issue Type */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">问题类型</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                'trim_candidate',
                'harmful_function',
                'insufficient_function',
                'excessive_function',
                'duplicate_function',
                'isolated_component',
                'single_point_dependency',
              ] as FunctionIssueType[]
            ).map((t) => (
              <Badge
                key={t}
                variant={filterType.includes(t) ? 'neutral' : 'outline'}
                className="cursor-pointer"
                onClick={() => toggleFilter(filterType, t, onFilterTypeChange)}
              >
                {issueTypeLabels[t]}
              </Badge>
            ))}
          </div>
        </div>

        {/* Severity */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">严重度</p>
          <div className="flex flex-wrap gap-1">
            {(['critical', 'high', 'medium', 'low'] as FunctionIssueSeverity[]).map((s) => (
              <Badge
                key={s}
                variant={filterSeverity.includes(s) ? 'neutral' : 'outline'}
                className="cursor-pointer"
                onClick={() => toggleFilter(filterSeverity, s, onFilterSeverityChange)}
              >
                {severityLabels[s]}
              </Badge>
            ))}
          </div>
        </div>

        {/* Status */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">审查状态</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                'unreviewed',
                'reviewed',
                'dismissed',
                'needs_more_info',
                'blocked_stale',
              ] as FunctionIssueCandidateStatus[]
            ).map((s) => (
              <Badge
                key={s}
                variant={filterStatus.includes(s) ? 'neutral' : 'outline'}
                className="cursor-pointer"
                onClick={() => toggleFilter(filterStatus, s, onFilterStatusChange)}
              >
                {candidateStatusLabels[s]}
              </Badge>
            ))}
          </div>
        </div>

        {/* Stale */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="filter-stale"
            checked={filterStale === true}
            onCheckedChange={(checked) =>
              onFilterStaleChange(
                checked === 'indeterminate' ? undefined : checked === true ? true : undefined,
              )
            }
          />
          <Label htmlFor="filter-stale" className="text-xs">
            仅显示已过期
          </Label>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// SvgGraphCanvas
// ---------------------------------------------------------------------------
function SvgGraphCanvas({
  graphData,
  loadingGraph,
  graphError,
  selectedNode,
  selectedEdge,
  svgPan,
  svgZoom,
  svgRef,
  onNodeSelect,
  onEdgeSelect,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  graphData:
    | {
        nodes: FunctionComponentNode[]
        edges: FunctionRelationEdge[]
        layout: { bounds: { minX: number; minY: number; maxX: number; maxY: number } }
      }
    | undefined
  loadingGraph: boolean
  graphError: boolean
  selectedNode: FunctionComponentNode | null
  selectedEdge: FunctionRelationEdge | null
  svgPan: { x: number; y: number }
  svgZoom: number
  svgRef: React.RefObject<SVGSVGElement | null>
  onNodeSelect: (node: FunctionComponentNode) => void
  onEdgeSelect: (edge: FunctionRelationEdge) => void
  onMouseDown: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseUp: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}) {
  const NODE_RADIUS = 28

  const nodes = graphData?.nodes ?? []
  const edges = graphData?.edges ?? []

  if (loadingGraph) {
    return (
      <Card className="flex items-center justify-center" style={{ minHeight: 400 }}>
        <Skeleton className="h-64 w-full" />
      </Card>
    )
  }

  if (graphError) {
    return (
      <Card className="flex items-center justify-center" style={{ minHeight: 400 }}>
        <Alert variant="danger" className="m-4">
          无法加载功能分析图。请确认数据可用。
        </Alert>
      </Card>
    )
  }

  if (nodes.length === 0) {
    return (
      <Card className="flex items-center justify-center" style={{ minHeight: 400 }}>
        <div className="text-sm text-muted-foreground">
          此运行暂无图数据。可能仍在分析中或已过期。
        </div>
      </Card>
    )
  }

  // Compute SVG viewport from layout bounds
  const bounds = graphData?.layout?.bounds
  const padding = 60
  const viewBox = bounds
    ? `${bounds.minX - padding} ${bounds.minY - padding} ${
        bounds.maxX - bounds.minX + padding * 2
      } ${bounds.maxY - bounds.minY + padding * 2}`
    : '0 0 800 600'

  const nodeMap = useMemo(() => {
    const map = new Map<string, FunctionComponentNode>()
    for (const n of nodes) map.set(n.nodeKey, n)
    return map
  }, [nodes])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const list = nodes
        const current = selectedNode
        if (!current && list.length > 0) {
          onNodeSelect(list[0]!)
          return
        }
        const idx = list.findIndex((n) => n.nodeKey === current?.nodeKey)
        const next =
          e.key === 'ArrowUp' ? (idx - 1 + list.length) % list.length : (idx + 1) % list.length
        onNodeSelect(list[next]!)
      }
    },
    [nodes, selectedNode, onNodeSelect],
  )

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            功能关系图（{nodes.length} 节点，{edges.length} 边）
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onZoomOut} title="缩小">
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onZoomIn} title="放大">
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onReset} title="重置视图">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(['useful', 'harmful', 'insufficient', 'excessive'] as FunctionEdgeType[]).map((ft) => (
            <span key={ft} className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: edgeTypeColors[ft] }}
              />
              {edgeTypeLabels[ft]}
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <svg
          // props 声明为 RefObject<SVGSVGElement | null>，而 @types/react 18 的
          // LegacyRef 在 T 上是协变的，需显式收窄。
          ref={svgRef as React.RefObject<SVGSVGElement>}
          viewBox={viewBox}
          className="h-[500px] w-full cursor-grab active:cursor-grabbing"
          tabIndex={0}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onKeyDown={handleKeyDown}
        >
          <g transform={`translate(${svgPan.x},${svgPan.y}) scale(${svgZoom})`}>
            {/* Edges */}
            {edges.map((edge) => {
              const from = nodeMap.get(edge.fromNodeKey)
              const to = nodeMap.get(edge.toNodeKey)
              if (!from?.position || !to?.position) return null
              const isSelected = selectedEdge?.edgeKey === edge.edgeKey
              return (
                <g key={edge.edgeKey}>
                  <line
                    x1={from.position.x}
                    y1={from.position.y}
                    x2={to.position.x}
                    y2={to.position.y}
                    stroke={edgeTypeColors[edge.functionType]}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    strokeOpacity={0.7}
                    markerEnd={`url(#arrow-${edge.functionType})`}
                    className="cursor-pointer transition-all hover:stroke-[2.5]"
                    onClick={() => onEdgeSelect(edge)}
                  />
                  {/* Invisible wider hit area */}
                  <line
                    x1={from.position.x}
                    y1={from.position.y}
                    x2={to.position.x}
                    y2={to.position.y}
                    stroke="transparent"
                    strokeWidth={8}
                    className="cursor-pointer"
                    onClick={() => onEdgeSelect(edge)}
                  />
                </g>
              )
            })}

            {/* Arrow markers */}
            <defs>
              {(['useful', 'harmful', 'insufficient', 'excessive'] as FunctionEdgeType[]).map(
                (ft) => (
                  <marker
                    key={ft}
                    id={`arrow-${ft}`}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill={edgeTypeColors[ft]} />
                  </marker>
                ),
              )}
            </defs>

            {/* Nodes */}
            {nodes.map((node) => {
              if (!node.position) return null
              const isSelected = selectedNode?.nodeKey === node.nodeKey
              const hasWarnings = node.warningCodes.length > 0
              return (
                <g
                  key={node.nodeKey}
                  transform={`translate(${node.position.x},${node.position.y})`}
                  className="cursor-pointer"
                  onClick={() => onNodeSelect(node)}
                >
                  <circle
                    r={NODE_RADIUS}
                    fill={
                      node.status === 'deprecated' ? 'var(--color-gray-200)' : 'var(--color-gray-0)'
                    }
                    stroke={isSelected ? 'var(--color-primary-500)' : 'var(--color-gray-400)'}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    className="transition-all hover:stroke-[2.5]"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-current text-[10px] font-medium"
                    style={{
                      maxWidth: NODE_RADIUS * 2 - 4,
                      overflow: 'hidden',
                    }}
                  >
                    {node.label.length > 8 ? node.label.slice(0, 8) + '…' : node.label}
                  </text>
                  {hasWarnings && (
                    <text
                      textAnchor="middle"
                      y={NODE_RADIUS + 12}
                      className="fill-amber-500 text-[8px]"
                    >
                      !
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// DetailPanel
// ---------------------------------------------------------------------------
function DetailPanel({
  selectedNode,
  selectedEdge,
  selectedIssue,
  issues,
  loadingIssues,
  onIssueSelect,
  onReviewOpen,
  onActionOpen,
  onExplain,
  explainMutation,
  workbenchPreviewData,
  decisionPreviewData,
  handoffPreviewData,
}: {
  selectedNode: FunctionComponentNode | null
  selectedEdge: FunctionRelationEdge | null
  selectedIssue: FunctionIssueCandidate | null
  detailTab: string
  onDetailTabChange: (v: string) => void
  issues: FunctionIssueCandidate[]
  loadingIssues: boolean
  onIssueSelect: (issue: FunctionIssueCandidate) => void
  onReviewOpen: (issue: FunctionIssueCandidate) => void
  onActionOpen: (issue: FunctionIssueCandidate, type: 'workbench' | 'decision' | 'draft') => void
  onExplain: (issue: FunctionIssueCandidate) => void
  explainMutation: ReturnType<typeof useExplainFunctionIssue>
  workbenchPreviewData: ReturnType<typeof useFunctionWorkbenchPreview>['data']
  decisionPreviewData: ReturnType<typeof useFunctionDecisionPreview>['data']
  handoffPreviewData: ReturnType<typeof useFunctionDraftHandoffPreview>['data']
}) {
  if (selectedNode) return <NodeDetailPanel node={selectedNode} />
  if (selectedEdge) return <EdgeDetailPanel edge={selectedEdge} />
  if (selectedIssue)
    return (
      <IssueDetailPanel
        issue={selectedIssue}
        onReviewOpen={onReviewOpen}
        onActionOpen={onActionOpen}
        onExplain={onExplain}
        explainMutation={explainMutation}
        workbenchPreviewData={workbenchPreviewData}
        decisionPreviewData={decisionPreviewData}
        handoffPreviewData={handoffPreviewData}
      />
    )

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">问题列表</CardTitle>
      </CardHeader>
      <CardContent>
        {loadingIssues ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : issues.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            点击图中节点/边查看详情，或从问题列表中选择。
          </p>
        ) : (
          <ScrollArea className="max-h-[460px]">
            <div className="space-y-1">
              {issues.map((issue) => (
                <div
                  key={issue.issueKey}
                  className="cursor-pointer rounded-md border p-2 text-xs transition-colors hover:bg-muted/50"
                  onClick={() => onIssueSelect(issue)}
                >
                  <div className="flex items-center gap-1">
                    <Badge variant={severityVariant[issue.severity]} className="text-[10px]">
                      {severityLabels[issue.severity]}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {issueTypeLabels[issue.issueType]}
                    </Badge>
                    <Badge variant="neutral" className="text-[10px]">
                      {candidateStatusLabels[issue.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-muted-foreground">
                    {issue.rationaleSummary}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// NodeDetailPanel
// ---------------------------------------------------------------------------
function NodeDetailPanel({ node }: { node: FunctionComponentNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{node.label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-muted-foreground">类型</p>
            <p className="font-medium">
              {nodeTypeLabels[node.componentType] ?? node.componentType}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">作用域</p>
            <p className="font-medium">{scopeLabels[node.scope] ?? node.scope}</p>
          </div>
          <div>
            <p className="text-muted-foreground">状态</p>
            <p className="font-medium">
              {node.status === 'active' ? '活跃' : node.status === 'deprecated' ? '已弃用' : '外部'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">节点 Key</p>
            <p className="font-mono text-[10px]">{node.nodeKey}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-muted-foreground">入度</p>
            <p className="font-medium">{node.metrics.inDegree}</p>
          </div>
          <div>
            <p className="text-muted-foreground">出度</p>
            <p className="font-medium">{node.metrics.outDegree}</p>
          </div>
          <div>
            <p className="text-muted-foreground">权重</p>
            <p className="font-medium">{node.metrics.totalWeight.toFixed(1)}</p>
          </div>
        </div>
        {node.sourceRefs.length > 0 && (
          <div>
            <p className="text-muted-foreground">来源引用（{node.sourceRefs.length}）</p>
            <ul className="mt-1 space-y-0.5">
              {node.sourceRefs.map((ref, i) => (
                <li key={i} className="text-muted-foreground">
                  {ref.sourceType} #{ref.sourceId}：{ref.lowSensitiveTitle}
                </li>
              ))}
            </ul>
          </div>
        )}
        {node.warningCodes.length > 0 && <WarningsDisplay warnings={node.warningCodes} />}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// EdgeDetailPanel
// ---------------------------------------------------------------------------
function EdgeDetailPanel({ edge }: { edge: FunctionRelationEdge }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{edge.label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-muted-foreground">功能类型</p>
            <p className="font-medium" style={{ color: edgeTypeColors[edge.functionType] }}>
              {edgeTypeLabels[edge.functionType]}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">强度</p>
            <p className="font-medium">{(edge.strength * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">置信度</p>
            <p className="font-medium">{(edge.confidence * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">边 Key</p>
            <p className="font-mono text-[10px]">{edge.edgeKey}</p>
          </div>
        </div>
        <div>
          <p className="text-muted-foreground">从：{edge.fromNodeKey}</p>
          <p className="text-muted-foreground">
            <ArrowRight className="mr-1 inline h-3 w-3" />
            到：{edge.toNodeKey}
          </p>
        </div>
        {edge.evidenceRefs.length > 0 && (
          <div>
            <p className="text-muted-foreground">证据引用（{edge.evidenceRefs.length}）</p>
            <ul className="mt-1 space-y-0.5">
              {edge.evidenceRefs.map((ref, i) => (
                <li key={i} className="text-muted-foreground">
                  {ref.sourceType} #{ref.sourceId}：{ref.lowSensitiveTitle}
                </li>
              ))}
            </ul>
          </div>
        )}
        {edge.warningCodes.length > 0 && <WarningsDisplay warnings={edge.warningCodes} />}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// IssueDetailPanel
// ---------------------------------------------------------------------------
function IssueDetailPanel({
  issue,
  onReviewOpen,
  onActionOpen,
  onExplain,
  explainMutation,
  workbenchPreviewData,
  decisionPreviewData,
  handoffPreviewData,
}: {
  issue: FunctionIssueCandidate
  onReviewOpen: (issue: FunctionIssueCandidate) => void
  onActionOpen: (issue: FunctionIssueCandidate, type: 'workbench' | 'decision' | 'draft') => void
  onExplain: (issue: FunctionIssueCandidate) => void
  explainMutation: ReturnType<typeof useExplainFunctionIssue>
  workbenchPreviewData: ReturnType<typeof useFunctionWorkbenchPreview>['data']
  decisionPreviewData: ReturnType<typeof useFunctionDecisionPreview>['data']
  handoffPreviewData: ReturnType<typeof useFunctionDraftHandoffPreview>['data']
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{issueTypeLabels[issue.issueType]}</CardTitle>
          <Badge variant={severityVariant[issue.severity]}>{severityLabels[issue.severity]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-muted-foreground">置信度</p>
            <p className="font-medium">{(issue.confidence * 100).toFixed(0)}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">影响分</p>
            <p className="font-medium">{issue.impactScore.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">状态</p>
            <p className="font-medium">{candidateStatusLabels[issue.status]}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Key</p>
            <p className="font-mono text-[10px]">{issue.issueKey}</p>
          </div>
        </div>
        <div>
          <p className="text-muted-foreground">理由</p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{issue.rationaleSummary}</p>
        </div>
        {issue.suggestedActions.length > 0 && (
          <div>
            <p className="text-muted-foreground">建议动作</p>
            <ul className="mt-1 space-y-1">
              {issue.suggestedActions.map((a, i) => (
                <li key={i} className="rounded border p-1.5">
                  <p className="font-medium">{a.action}</p>
                  <p className="text-muted-foreground">{a.rationale}</p>
                  <p className="text-muted-foreground">
                    置信度：{(a.confidence * 100).toFixed(0)}%
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="text-muted-foreground">关联节点（{issue.nodeRefs.length}）</p>
          <div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px]">
            {issue.nodeRefs.map((ref) => (
              <span key={ref} className="rounded bg-muted px-1 py-0.5">
                {ref}
              </span>
            ))}
          </div>
        </div>
        {issue.edgeRefs.length > 0 && (
          <div>
            <p className="text-muted-foreground">关联边（{issue.edgeRefs.length}）</p>
            <div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px]">
              {issue.edgeRefs.map((ref) => (
                <span key={ref} className="rounded bg-muted px-1 py-0.5">
                  {ref}
                </span>
              ))}
            </div>
          </div>
        )}
        {issue.warningCodes.length > 0 && <WarningsDisplay warnings={issue.warningCodes} />}

        {/* Explain result */}
        {explainMutation.isSuccess &&
          explainMutation.variables === issue.issueKey &&
          explainMutation.data && (
            <div className="rounded-md bg-muted p-3">
              <p className="font-medium">AI 解释（仅供参考，不自动执行）</p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {(explainMutation.data as { explanation: { narrative: string } }).explanation
                  ?.narrative ?? '无法生成说明'}
              </p>
              {(
                explainMutation.data as {
                  explanation: {
                    isFallback: boolean
                    hallucinationChecked: boolean
                    provider: string | null
                    model: string | null
                  }
                }
              ).explanation?.isFallback && <p className="mt-1 text-amber-600">AI 已降级</p>}
            </div>
          )}

        {/* Preview data */}
        {workbenchPreviewData && (
          <div className="rounded-md bg-primary/5 p-3">
            <p className="font-medium">方案篮子预览（需人工确认）</p>
            <p className="mt-1 text-muted-foreground">
              类型：{workbenchPreviewData.issueType}
              ；节点 {workbenchPreviewData.nodeRefs.length} 个
            </p>
            {workbenchPreviewData.warnings.length > 0 && (
              <p className="text-amber-600">警告：{workbenchPreviewData.warnings.join('、')}</p>
            )}
          </div>
        )}

        {decisionPreviewData && (
          <div className="rounded-md bg-primary/5 p-3">
            <p className="font-medium">决策预览（需人工确认后写入决策日志）</p>
            <p className="mt-1 text-muted-foreground">
              类型：{decisionPreviewData.issueType}
              ；节点 {decisionPreviewData.nodeRefs.length} 个
            </p>
            {decisionPreviewData.warnings.length > 0 && (
              <p className="text-amber-600">警告：{decisionPreviewData.warnings.join('、')}</p>
            )}
          </div>
        )}

        {handoffPreviewData && (
          <div className="rounded-md bg-primary/5 p-3">
            <p className="font-medium">进入草案预览（需人工确认后写入草案层）</p>
            <p className="mt-1 text-muted-foreground">
              类型：{handoffPreviewData.issueType}
              ；节点 {handoffPreviewData.nodeRefs.length} 个
            </p>
            {/* 契约里没有 stale 字段，过期状态由 warnings 里的 stale 类告警表达。 */}
            {handoffPreviewData.warnings.some(
              (w) => w === 'SOURCE_STALE' || w === 'HANDOFF_BLOCKED_STALE',
            ) && <p className="text-amber-600">来源已过期，交接被阻止。</p>}
          </div>
        )}

        {/* Actions */}
        <IssueActions
          issue={issue}
          onReviewOpen={onReviewOpen}
          onActionOpen={onActionOpen}
          onExplain={onExplain}
          explainPending={explainMutation.isPending}
        />
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// IssueActions
// ---------------------------------------------------------------------------
function IssueActions({
  issue,
  onReviewOpen,
  onActionOpen,
  onExplain,
  explainPending,
}: {
  issue: FunctionIssueCandidate
  onReviewOpen: (issue: FunctionIssueCandidate) => void
  onActionOpen: (issue: FunctionIssueCandidate, type: 'workbench' | 'decision' | 'draft') => void
  onExplain: (issue: FunctionIssueCandidate) => void
  explainPending: boolean
}) {
  if (issue.status === 'blocked_stale') {
    return (
      <div className="space-y-1">
        <p className="text-amber-600">来源已过期，无法执行操作。</p>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onExplain(issue)}
          disabled={explainPending}
        >
          <FileText className="mr-1 h-3 w-3" />
          查看依据
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => onReviewOpen(issue)}>
          <Eye className="mr-1 h-3 w-3" />
          记录审查
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => onExplain(issue)}
          disabled={explainPending}
        >
          <Search className="mr-1 h-3 w-3" />
          查看依据
        </Button>
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => onActionOpen(issue, 'workbench')}
        >
          <Activity className="mr-1 h-3 w-3" />
          加入方案篮子
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => onActionOpen(issue, 'decision')}
        >
          <FileText className="mr-1 h-3 w-3" />
          打开审查
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1"
          onClick={() => onActionOpen(issue, 'draft')}
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          进入草案预览
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReviewDialog
// ---------------------------------------------------------------------------
function ReviewDialog({
  open,
  onOpenChange,
  reviewAction,
  onReviewActionChange,
  reviewReason,
  onReviewReasonChange,
  onSubmit,
  isPending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reviewAction: 'reviewed' | 'dismissed' | 'needs_more_info'
  onReviewActionChange: (action: 'reviewed' | 'dismissed' | 'needs_more_info') => void
  reviewReason: string
  onReviewReasonChange: (reason: string) => void
  onSubmit: () => void
  isPending: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>审查问题候选</DialogTitle>
          <DialogDescription>选择审查动作并（可选）填写理由。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            {(
              [
                { value: 'reviewed', label: '已审查' },
                { value: 'dismissed', label: '忽略' },
                { value: 'needs_more_info', label: '需更多信息' },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.value}
                variant={reviewAction === opt.value ? 'primary' : 'outline'}
                size="sm"
                onClick={() => onReviewActionChange(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
          <div>
            <Label htmlFor="review-reason">理由（可选）</Label>
            <textarea
              id="review-reason"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              rows={3}
              value={reviewReason}
              onChange={(e) => onReviewReasonChange(e.target.value)}
              placeholder="审查意见..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? '提交中...' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// ActionDialog
// ---------------------------------------------------------------------------
function ActionDialog({
  open,
  onOpenChange,
  actionType,
  confirmChecked,
  onConfirmCheckedChange,
  onSubmit,
  isPending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionType: 'workbench' | 'decision' | 'draft'
  confirmChecked: boolean
  onConfirmCheckedChange: (checked: boolean) => void
  onSubmit: () => void
  isPending: boolean
}) {
  const labels = {
    workbench: {
      title: '加入方案篮子',
      description:
        '此操作将问题候选信息预览到 TRIZ 创新方案篮子，需在方案篮子中进一步确认后才生效。',
    },
    decision: {
      title: '打开审查',
      description: '此操作将问题候选信息预览到决策日志，需人工确认后才写入正式决策记录。',
    },
    draft: {
      title: '进入草案预览',
      description: '此操作将问题候选信息预览到草案层，需人工确认后才写入草案。',
    },
  }

  const info = labels[actionType]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{info.title}</DialogTitle>
          <DialogDescription>{info.description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Checkbox
            id="action-confirm"
            checked={confirmChecked}
            onCheckedChange={(checked) => onConfirmCheckedChange(checked === true)}
          />
          <Label htmlFor="action-confirm" className="text-sm">
            我已阅读说明，确认预览（不会自动写入正式数据）
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSubmit} disabled={!confirmChecked || isPending}>
            {isPending ? '预览中...' : '确认预览'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// WarningsDisplay
// ---------------------------------------------------------------------------
function WarningsDisplay({ warnings }: { warnings: FunctionAnalysisWarningCode[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950">
      <p className="font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mr-1 inline h-3 w-3" />
        {warnings.length} 个警告
      </p>
      <ul className="mt-1 space-y-0.5 text-amber-600 dark:text-amber-300">
        {warnings.map((w) => (
          <li key={w}>{warningLabels[w] ?? w}</li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CostSummaryDisplay
// ---------------------------------------------------------------------------
export function CostSummaryDisplay({ cost }: { cost: FunctionAnalysisCost | null | undefined }) {
  if (!cost) return null
  return (
    <div className="rounded-md border p-2 text-xs">
      <p className="font-medium text-muted-foreground">AI 成本</p>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
        {cost.provider && (
          <>
            <span className="text-muted-foreground">提供商</span>
            <span>{cost.provider}</span>
          </>
        )}
        {cost.model && (
          <>
            <span className="text-muted-foreground">模型</span>
            <span>{cost.model}</span>
          </>
        )}
        {cost.promptTokens != null && (
          <>
            <span className="text-muted-foreground">Prompt Tokens</span>
            <span>{cost.promptTokens.toLocaleString()}</span>
          </>
        )}
        {cost.completionTokens != null && (
          <>
            <span className="text-muted-foreground">Completion Tokens</span>
            <span>{cost.completionTokens.toLocaleString()}</span>
          </>
        )}
        {cost.estimatedCost != null && (
          <>
            <span className="text-muted-foreground">估算成本</span>
            <span>${cost.estimatedCost.toFixed(6)}</span>
          </>
        )}
        {cost.latencyMs != null && (
          <>
            <span className="text-muted-foreground">延迟</span>
            <span>{cost.latencyMs}ms</span>
          </>
        )}
      </div>
    </div>
  )
}
