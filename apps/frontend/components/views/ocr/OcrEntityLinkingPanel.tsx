'use client'

import React, { useState, useCallback } from 'react'
import {
  useOcrEntityLinkRuns,
  useOcrEntityLinkRun,
  useOcrEntityLinkCandidates,
  useCreateOcrEntityLinkRun,
  useOcrEntityLinkPreview,
  useConfirmOcrEntityLink,
  useSupersedeOcrEntityLink,
  useRejectOcrEntityLink,
  useOcrEntityLinkExplanation,
} from '@/hooks/use-ocr-entity-linking'
import type {
  OcrEntityLinkRunSummary,
  OcrEntityLinkRunDetail,
  OcrEntityLinkCandidate,
  OcrEntityLinkPreview,
  OcrEntityLinkConfirmedLink,
} from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Progress } from '@/components/ui/Progress'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Link,
  ExternalLink,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'

// ─── 常量 ────────────────────────────────────────────────────────────────

/** 运行状态中文标签 */
const RUN_STATUS_LABEL: Record<string, string> = {
  running: '运行中',
  completed: '已完成',
  stale: '已过期',
  failed: '失败',
}

/** 运行状态徽章颜色 */
const RUN_STATUS_COLOR: Record<string, 'info' | 'success' | 'warning' | 'danger'> = {
  running: 'info',
  completed: 'success',
  stale: 'warning',
  failed: 'danger',
}

/** 候选状态中文标签 */
const CANDIDATE_STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  matched: '已匹配',
  unmatched: '未匹配',
  duplicate: '重复',
  blocked: '已阻断',
}

/** 候选状态徽章颜色 */
const CANDIDATE_STATUS_COLOR: Record<
  string,
  'neutral' | 'success' | 'warning' | 'danger' | 'info'
> = {
  pending: 'info',
  matched: 'success',
  unmatched: 'neutral',
  duplicate: 'warning',
  blocked: 'danger',
}

/** Mention 类型中文标签 */
const MENTION_TYPE_LABEL: Record<string, string> = {
  task_ref: '任务',
  wbs_ref: 'WBS',
  milestone_ref: '里程碑',
  risk_ref: '风险',
  person_name: '人员',
  organization_name: '组织',
  project_name: '项目',
  date_expression: '日期',
  amount_expression: '金额',
  file_ref: '文件',
  attachment_ref: '附件',
  custom_label: '自定义',
}

/** 目标类型中文标签 */
const TARGET_KIND_LABEL: Record<string, string> = {
  project: '项目',
  task: '任务',
  wbs_node: 'WBS 节点',
  milestone: '里程碑',
  risk: '风险',
  file: '文件',
  attachment: '附件',
  project_member: '成员',
}

/** 匹配原因中文标签 */
const MATCH_REASON_LABEL: Record<string, string> = {
  exact_label: '精确匹配',
  normalized_label: '归一化匹配',
  alias: '别名匹配',
  fuzzy: '模糊匹配',
  custom_rule: '自定义规则',
}

/** 警告代码中文标签 */
const WARNING_CODE_LABEL: Record<string, string> = {
  TRUNCATED_TEXT: '文本截断',
  EXTRACTION_SUPERSEDED: '提取已取代',
  SOURCE_HASH_STALE: '源文件已变更',
  RETENTION_EXPIRED: '已过保留期',
  RETENTION_HOLD: '保留锁定中',
  TARGET_NOT_FOUND: '未找到目标',
  TARGET_INACCESSIBLE: '目标不可访问',
  TARGET_ARCHIVED: '目标已归档',
  TARGET_DELETED: '目标已删除',
  TARGET_RENAMED: '目标已重命名',
  DUPLICATE_CANDIDATE: '重复候选',
  DUPLICATE_CONFIRMED: '已被确认',
  LOW_CONFIDENCE: '置信度较低',
  AMBIGUOUS_MENTION: '提及模糊',
  MULTIPLE_TARGETS: '多个可能目标',
  UNSUPPORTED_TARGET_KIND: '不支持的目标类型',
  BUDGET_LIMIT: '预算不足',
  RATE_LIMIT: '频率限制',
  AI_EXPLANATION_FALLBACK: 'AI 解释降级',
  AI_EXPLANATION_HALLUCINATION: 'AI 解释幻觉',
  EXTRACTION_CURRENTLY_PROCESSING: '提取处理中',
}

/** 生命周期状态标签 */
const LIFECYCLE_STATUS_LABEL: Record<string, string> = {
  active: '生效中',
  superseded: '已取代',
  rejected: '已拒绝',
}

// ─── 子组件 ──────────────────────────────────────────────────────────────

/** 置信度进度条 */
function ConfidenceBar({ value }: { value: number }) {
  const percent = Math.round(value * 100)
  const tone = percent >= 80 ? 'success' : percent >= 50 ? 'warning' : 'danger'
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <Progress value={percent} tone={tone} className="flex-1" />
      <span className="text-xs text-muted-foreground w-9 text-right">{percent}%</span>
    </div>
  )
}

/** 警告代码小标签 */
function WarningCodeBadge({ codes }: { codes: string[] }) {
  if (codes.length === 0) return null
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {codes.map((code) => (
        <Badge key={code} variant="warning" className="text-[10px]">
          {WARNING_CODE_LABEL[code] ?? code}
        </Badge>
      ))}
    </div>
  )
}

/** 候选行渲染 */
function CandidateRow({
  candidate,
  onPreview,
  onConfirm,
  onExplain,
  canConfirm,
  isStale,
  previewPending,
  confirmPending,
  explainPending,
  confirmedLinks,
}: {
  candidate: OcrEntityLinkCandidate
  onPreview: (id: number) => void
  onConfirm: (candidate: OcrEntityLinkCandidate) => void
  onExplain: (candidate: OcrEntityLinkCandidate) => void
  canConfirm: boolean
  isStale: boolean
  previewPending: boolean
  confirmPending: boolean
  explainPending: boolean
  confirmedLinks: Map<number, OcrEntityLinkConfirmedLink>
}) {
  const isAlreadyConfirmed = confirmedLinks.has(candidate.candidateId!)
  const isBlocked = candidate.status === 'blocked' || candidate.status === 'duplicate'
  const canAct = canConfirm && !isStale && !isAlreadyConfirmed && !isBlocked

  return (
    <TableRow
      className={
        isAlreadyConfirmed
          ? 'bg-success-bg/30'
          : candidate.status === 'unmatched'
            ? 'bg-muted/20'
            : ''
      }
    >
      <TableCell>
        <Badge variant="outline" className="text-[11px]">
          {MENTION_TYPE_LABEL[candidate.mentionType] ?? candidate.mentionType}
        </Badge>
      </TableCell>
      <TableCell className="font-medium max-w-48 truncate" title={candidate.normalizedLabel}>
        {candidate.normalizedLabel}
      </TableCell>
      <TableCell>
        <ConfidenceBar value={candidate.confidence} />
      </TableCell>
      <TableCell>
        {candidate.status === 'matched' &&
        candidate.targetSuggestion &&
        !candidate.targetSuggestion.redacted ? (
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {TARGET_KIND_LABEL[candidate.targetSuggestion.targetKind] ??
                candidate.targetSuggestion.targetKind}
            </Badge>
            <span className="text-sm truncate max-w-36" title={candidate.targetSuggestion.title}>
              {candidate.targetSuggestion.title}
            </span>
            <Badge variant="success" className="text-[10px]">
              {MATCH_REASON_LABEL[candidate.targetSuggestion.matchReason] ??
                candidate.targetSuggestion.matchReason}
            </Badge>
          </div>
        ) : candidate.status === 'matched' && candidate.targetSuggestion?.redacted ? (
          <Badge variant="warning">已脱敏</Badge>
        ) : (
          <Badge variant="neutral">未匹配</Badge>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={CANDIDATE_STATUS_COLOR[candidate.status] ?? 'neutral'}>
          {CANDIDATE_STATUS_LABEL[candidate.status] ?? candidate.status}
        </Badge>
      </TableCell>
      <TableCell>
        {candidate.warnings.length > 0 && <WarningCodeBadge codes={candidate.warnings} />}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {candidate.status === 'matched' && (
            <>
              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onPreview(candidate.candidateId!)}
                      disabled={previewPending || isBlocked}
                      className="text-xs h-7 px-2"
                    >
                      预览
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>查看链接详情后再确认</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onConfirm(candidate)}
                disabled={!canAct || confirmPending}
                className="text-xs h-7 px-2"
              >
                {isAlreadyConfirmed ? '已确认' : '确认'}
              </Button>
            </>
          )}
          <TooltipProvider>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onExplain(candidate)}
                  disabled={explainPending}
                  className="text-xs h-7 px-2"
                >
                  AI 解释
                </Button>
              </TooltipTrigger>
              <TooltipContent>查看 AI 对该匹配的解释</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ─── Props ───────────────────────────────────────────────────────────────

interface OcrEntityLinkingPanelProps {
  projectId: number
  /** 外部传入只读模式（权限不足时强制 true） */
  readOnly?: boolean
}

// ─── 主组件 ──────────────────────────────────────────────────────────────

export default function OcrEntityLinkingPanel({
  projectId,
  readOnly = false,
}: OcrEntityLinkingPanelProps) {
  // ── 权限 ────────────────────────────────────────────────────────────
  const { can: hasPerm } = usePermissions()
  const canManage = !readOnly && hasPerm('ocr.entity_links.manage')
  const canConfirm = !readOnly && hasPerm('ocr.entity_links.confirm')

  // ── 本地状态 ────────────────────────────────────────────────────────
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 预览/确认对话框
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false)
  const [previewData, setPreviewData] = useState<OcrEntityLinkPreview | null>(null)

  // 确认对话框
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [confirmCandidate, setConfirmCandidate] = useState<OcrEntityLinkCandidate | null>(null)

  // 取代/拒绝对话框
  const [supersedeDialogOpen, setSupersedeDialogOpen] = useState(false)
  const [supersedeTarget, setSupersedeTarget] = useState<OcrEntityLinkConfirmedLink | null>(null)
  const [supersedeReason, setSupersedeReason] = useState('')

  // AI 解释结果
  const [explanationText, setExplanationText] = useState<string | null>(null)
  const [explanationDialogOpen, setExplanationDialogOpen] = useState(false)

  // ── 查询 ────────────────────────────────────────────────────────────
  const runsQuery = useOcrEntityLinkRuns(projectId)
  const runDetailQuery = useOcrEntityLinkRun(projectId, selectedRunId!)
  const candidatesQuery = useOcrEntityLinkCandidates(projectId, selectedRunId!, currentPage)

  // ── 变更 ────────────────────────────────────────────────────────────
  const createRunMutation = useCreateOcrEntityLinkRun(projectId)
  const previewMutation = useOcrEntityLinkPreview(projectId)
  const confirmMutation = useConfirmOcrEntityLink(projectId)
  const supersedeMutation = useSupersedeOcrEntityLink(projectId, selectedRunId!)
  const rejectMutation = useRejectOcrEntityLink(projectId, selectedRunId!)
  const explainMutation = useOcrEntityLinkExplanation(projectId)

  // ── 派生数据 ────────────────────────────────────────────────────────
  const runs: OcrEntityLinkRunSummary[] = runsQuery.data?.data ?? []
  const runDetail: OcrEntityLinkRunDetail | undefined = runDetailQuery.data?.data
  const candidates: OcrEntityLinkCandidate[] = candidatesQuery.data?.data ?? []
  const candidateMeta = candidatesQuery.data?.meta
  const totalPages = candidateMeta?.totalPages ?? 1

  // 从 runDetail 提取警告信息
  const runWarnings = runDetail?.warnings ?? []

  // 已确认链接（通过 candidates 过滤 matched 且已确认的）
  // 在组件内维护一个本地确认记录
  const [confirmedLinks, setConfirmedLinks] = useState<Map<number, OcrEntityLinkConfirmedLink>>(
    new Map(),
  )

  // 过期判断
  const isStale = selectedRunId
    ? runs.find((r) => r.runId === selectedRunId)?.status === 'stale'
    : false

  // ── 事件处理 ────────────────────────────────────────────────────────

  const handleCreateRun = useCallback(async () => {
    setErrorMsg(null)
    try {
      const result = await createRunMutation.mutateAsync({
        organizationId: 0, // 后端从 token 推断
        projectId,
        acceptedExtractionIds: [], // 后端默认取该项目所有已确认提取
      })
      setSelectedRunId(result.data.runId)
    } catch {
      setErrorMsg('创建实体链接运行失败，请检查权限或稍后重试')
    }
  }, [projectId, createRunMutation])

  const handleRunSelect = useCallback((runId: number) => {
    setSelectedRunId(runId)
    setCurrentPage(1)
    setErrorMsg(null)
  }, [])

  const handlePreview = useCallback(
    async (candidateId: number) => {
      if (!selectedRunId) return
      setErrorMsg(null)
      try {
        const result = await previewMutation.mutateAsync({ runId: selectedRunId, candidateId })
        setPreviewData(result.data)
        setPreviewDialogOpen(true)
      } catch {
        setErrorMsg('预览失败，请检查权限或稍后重试')
      }
    },
    [selectedRunId, previewMutation],
  )

  const handleConfirm = useCallback((candidate: OcrEntityLinkCandidate) => {
    setConfirmCandidate(candidate)
    setConfirmDialogOpen(true)
  }, [])

  const handleConfirmSubmit = useCallback(async () => {
    if (!selectedRunId || !confirmCandidate || !previewData) return
    setErrorMsg(null)
    try {
      const result = await confirmMutation.mutateAsync({
        runId: selectedRunId,
        candidateId: confirmCandidate.candidateId!,
        previewHash: previewData.previewHash,
      })
      setConfirmedLinks((prev) => {
        const next = new Map(prev)
        next.set(confirmCandidate.candidateId!, result.data)
        return next
      })
      setConfirmDialogOpen(false)
      setConfirmCandidate(null)
      setPreviewData(null)
    } catch {
      setErrorMsg('确认失败，预览可能已过期，请重新预览')
    }
  }, [selectedRunId, confirmCandidate, previewData, confirmMutation])

  const handleSupersede = useCallback((link: OcrEntityLinkConfirmedLink) => {
    setSupersedeTarget(link)
    setSupersedeReason('')
    setSupersedeDialogOpen(true)
  }, [])

  const handleSupersedeSubmit = useCallback(async () => {
    if (!supersedeTarget || !supersedeReason.trim()) return
    setErrorMsg(null)
    try {
      await supersedeMutation.mutateAsync({
        linkId: supersedeTarget.linkId,
        input: { linkId: supersedeTarget.linkId, reason: supersedeReason },
      })
      setSupersedeDialogOpen(false)
      setSupersedeTarget(null)
      setSupersedeReason('')
    } catch {
      setErrorMsg('取代失败，请稍后重试')
    }
  }, [supersedeTarget, supersedeReason, supersedeMutation])

  const handleReject = useCallback(
    async (link: OcrEntityLinkConfirmedLink) => {
      setErrorMsg(null)
      try {
        await rejectMutation.mutateAsync({
          linkId: link.linkId,
          input: { linkId: link.linkId, reason: '人工审查拒绝' },
        })
        setConfirmedLinks((prev) => {
          const next = new Map(prev)
          next.delete(link.linkId)
          return next
        })
      } catch {
        setErrorMsg('拒绝失败，请稍后重试')
      }
    },
    [rejectMutation],
  )

  const handleExplain = useCallback(
    async (candidate: OcrEntityLinkCandidate) => {
      if (!selectedRunId) return
      setErrorMsg(null)
      try {
        const result = await explainMutation.mutateAsync({
          runId: selectedRunId,
          candidateId: candidate.candidateId!,
        })
        setExplanationText(
          result.data.isFallback
            ? `${result.data.text}\n\n（${result.data.degradedReason ?? 'AI 解释不可用，已降级为确定性说明'}）`
            : result.data.text,
        )
        setExplanationDialogOpen(true)
      } catch {
        setErrorMsg('获取 AI 解释失败')
      }
    },
    [selectedRunId, explainMutation],
  )

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page)
  }, [])

  // ── 渲染 ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* 全局错误 */}
      {errorMsg && (
        <Alert variant="danger">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      {/* 6.1 运行管理区 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800">实体链接运行</h3>
          {canManage && (
            <Button onClick={handleCreateRun} disabled={createRunMutation.isPending} size="sm">
              {createRunMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin mr-1" />
                  创建中…
                </>
              ) : (
                '创建实体链接运行'
              )}
            </Button>
          )}
        </div>

        {/* 运行列表 */}
        {runsQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={Link}
            title="暂无实体链接运行"
            description="点击「创建实体链接运行」来分析 OCR 提取文本中的实体提及，并建立与项目任务的 advisory 链接"
          />
        ) : (
          <div className="space-y-2 max-h-80 overflow-auto">
            {runs.map((run) => (
              <div
                key={run.runId}
                role="button"
                tabIndex={0}
                className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedRunId === run.runId
                    ? 'border-primary bg-primary/5'
                    : run.status === 'stale'
                      ? 'border-warning/30 bg-warning-bg/20'
                      : 'border-border hover:border-primary/50'
                }`}
                onClick={() => handleRunSelect(run.runId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleRunSelect(run.runId)
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant={RUN_STATUS_COLOR[run.status] ?? 'neutral'}>
                    {RUN_STATUS_LABEL[run.status] ?? run.status}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      运行 #{run.runId}
                      <span className="text-xs text-muted-foreground ml-2">v{run.ruleVersion}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      候选 {run.candidateCount} · 已确认 {run.confirmedCount}
                      {run.staleSummary?.isStale && (
                        <span className="text-warning ml-1">· 已过期</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {run.staleSummary?.isStale && (
                    <TooltipProvider>
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <AlertTriangle className="h-4 w-4 text-warning" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {WARNING_CODE_LABEL[
                            run.staleSummary.staleReason ?? 'SOURCE_HASH_STALE'
                          ] ?? '源已变更'}
                          ： 自 {new Date(run.staleSummary.staleSince).toLocaleString('zh-CN')} 起
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 过期警告 */}
      {isStale && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            来源文件或提取结果已变更，当前实体链接数据可能已过时。建议重新创建运行以获得最新结果。
          </AlertDescription>
        </Alert>
      )}

      {/* 运行警告 */}
      {runWarnings.length > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              {runWarnings.map((w, i) => (
                <p key={i} className="text-sm">
                  {WARNING_CODE_LABEL[w.code] ?? w.code}：{w.message}
                </p>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* 6.2 候选审查区 */}
      {selectedRunId && (
        <>
          {runDetailQuery.isLoading ? (
            <Card className="p-4">
              <Skeleton className="h-8 w-48 mb-4" />
              <Skeleton className="h-10 w-full mb-2" />
              <Skeleton className="h-10 w-full mb-2" />
              <Skeleton className="h-10 w-full" />
            </Card>
          ) : candidates.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-muted-foreground text-center py-8">
                该运行暂无可审查的候选实体链接
              </p>
            </Card>
          ) : (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-gray-800">
                  候选列表（{candidateMeta?.total ?? candidates.length}）
                </h3>
                {/* 分页 */}
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">类型</TableHead>
                      <TableHead>识别文本</TableHead>
                      <TableHead className="w-36">置信度</TableHead>
                      <TableHead>目标建议</TableHead>
                      <TableHead className="w-20">状态</TableHead>
                      <TableHead className="w-32">警告</TableHead>
                      <TableHead className="w-44">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidatesQuery.isLoading
                      ? Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell colSpan={7}>
                              <Skeleton className="h-8 w-full" />
                            </TableCell>
                          </TableRow>
                        ))
                      : candidates.map((c) => (
                          <CandidateRow
                            key={c.candidateKey ?? `${c.extractionId}-${c.spanOffset.start}`}
                            candidate={c}
                            onPreview={handlePreview}
                            onConfirm={handleConfirm}
                            onExplain={handleExplain}
                            canConfirm={canConfirm}
                            isStale={isStale}
                            previewPending={previewMutation.isPending}
                            confirmPending={confirmMutation.isPending}
                            explainPending={explainMutation.isPending}
                            confirmedLinks={confirmedLinks}
                          />
                        ))}
                  </TableBody>
                </Table>
              </div>

              {/* 已确认链接区 */}
              {confirmedLinks.size > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    已确认链接（{confirmedLinks.size}）
                  </h4>
                  <div className="space-y-2">
                    {Array.from(confirmedLinks.values()).map((link) => (
                      <div
                        key={link.linkId}
                        className="flex items-center justify-between p-3 border rounded-lg bg-success-bg/20"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{link.normalizedLabel}</p>
                            <p className="text-xs text-muted-foreground">
                              {TARGET_KIND_LABEL[link.targetKind] ?? link.targetKind} #{' '}
                              {link.targetId}
                              {' · '}
                              {MATCH_REASON_LABEL[link.matchReason] ?? link.matchReason}
                              {' · '}
                              置信度 {Math.round(link.confidence * 100)}%{' · '}
                              <Badge variant="outline" className="text-[10px] ml-1">
                                {LIFECYCLE_STATUS_LABEL[link.lifecycleStatus] ??
                                  link.lifecycleStatus}
                              </Badge>
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSupersede(link)}
                            disabled={link.lifecycleStatus !== 'active'}
                            className="text-xs h-7 px-2"
                          >
                            取代
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleReject(link)}
                            disabled={link.lifecycleStatus !== 'active'}
                            className="text-xs h-7 px-2"
                          >
                            拒绝
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {/* 未选择运行的提示 */}
      {!selectedRunId && runs.length > 0 && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground text-center py-8">
            请从上方运行列表中选择一个运行来审查实体链接候选
          </p>
        </Card>
      )}

      {/* 6.3 预览对话框 */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>实体链接预览</DialogTitle>
            <DialogDescription>
              确认前请检查链接详情。确认后此链接将以 advisory 方式记录，不会自动修改任何项目实体。
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4">
              {/* 来源 Span */}
              <div className="border rounded-lg p-3">
                <h5 className="text-sm font-semibold mb-2">来源文本</h5>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">提取：</span>#
                    {previewData.sourceSpan.extractionId}
                  </p>
                  <p>
                    <span className="text-muted-foreground">页面：</span>
                    {previewData.sourceSpan.pageRefs.map((p) => p + 1).join('、')}
                  </p>
                  <p>
                    <span className="text-muted-foreground">位置：</span>第{' '}
                    {previewData.sourceSpan.spanOffset.start}–
                    {previewData.sourceSpan.spanOffset.end} 字符
                  </p>
                </div>
              </div>

              {/* 目标实体 */}
              <div className="border rounded-lg p-3">
                <h5 className="text-sm font-semibold mb-2">目标实体</h5>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {TARGET_KIND_LABEL[previewData.target.targetKind] ??
                        previewData.target.targetKind}
                    </Badge>
                    <span className="font-medium">{previewData.target.title}</span>
                  </div>
                  <p>
                    <span className="text-muted-foreground">匹配方式：</span>
                    {MATCH_REASON_LABEL[previewData.target.matchReason] ??
                      previewData.target.matchReason}
                  </p>
                  <p>
                    <span className="text-muted-foreground">置信度：</span>
                    {Math.round(previewData.target.confidence * 100)}%
                  </p>
                  {previewData.target.navigationRef && (
                    <a
                      href={previewData.target.navigationRef}
                      className="inline-flex items-center gap-1 text-primary-600 text-sm hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      查看目标实体 <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* 警告 */}
              {previewData.warnings.length > 0 && (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      <p className="font-medium text-sm">警告：</p>
                      {previewData.warnings.map((code, i) => (
                        <p key={i} className="text-xs">
                          {WARNING_CODE_LABEL[code] ?? code}
                        </p>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* 红线摘要 */}
              <div className="border rounded-lg p-3 bg-muted/30">
                <h5 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <Info className="h-4 w-4 text-info" />
                  红线声明——以下系统不会被修改：
                </h5>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> 任务字段
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> WBS 字段
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> 风险字段
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> 里程碑字段
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> 文件字节
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> 文档正文
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> 搜索索引
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> 知识库
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> Compiler 产物
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> AI 草稿
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" /> 外部系统
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDialogOpen(false)}>
              关闭
            </Button>
            {previewData && canConfirm && !isStale && (
              <Button
                onClick={() => {
                  setPreviewDialogOpen(false)
                  if (confirmCandidate) {
                    handleConfirmSubmit()
                  }
                }}
              >
                确认链接
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6.4 确认对话框 */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认实体链接</DialogTitle>
            <DialogDescription>
              此操作将建立 advisory 链接。确认后不会自动修改项目、任务、WBS、风险或里程碑。
            </DialogDescription>
          </DialogHeader>

          {confirmCandidate && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {MENTION_TYPE_LABEL[confirmCandidate.mentionType] ?? confirmCandidate.mentionType}
                </Badge>
                <span className="font-medium">{confirmCandidate.normalizedLabel}</span>
              </div>
              {confirmCandidate.targetSuggestion && (
                <div className="flex items-center gap-2">
                  <Badge variant="success">
                    {TARGET_KIND_LABEL[confirmCandidate.targetSuggestion.targetKind] ??
                      confirmCandidate.targetSuggestion.targetKind}
                  </Badge>
                  <span>{confirmCandidate.targetSuggestion.title}</span>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                置信度：{Math.round(confirmCandidate.confidence * 100)}%
              </p>
              {confirmCandidate.warnings.length > 0 && (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    该候选包含 {confirmCandidate.warnings.length} 条警告，建议先预览再确认。
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleConfirmSubmit}
              disabled={confirmMutation.isPending || !previewData}
            >
              {confirmMutation.isPending ? '确认中…' : '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6.5 取代对话框 */}
      <Dialog open={supersedeDialogOpen} onOpenChange={setSupersedeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>取代实体链接</DialogTitle>
            <DialogDescription>此操作将使当前链接失效。请提供取代原因。</DialogDescription>
          </DialogHeader>

          {supersedeTarget && (
            <div className="space-y-3">
              <p className="text-sm">
                链接 #{supersedeTarget.linkId}：
                <span className="font-medium ml-1">{supersedeTarget.normalizedLabel}</span>
                {' → '}
                <Badge variant="outline" className="text-[10px]">
                  {TARGET_KIND_LABEL[supersedeTarget.targetKind] ?? supersedeTarget.targetKind}
                </Badge>
              </p>
              <textarea
                className="w-full border rounded-lg p-2 text-sm resize-none h-20"
                placeholder="请输入取代原因…"
                value={supersedeReason}
                onChange={(e) => setSupersedeReason(e.target.value)}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSupersedeDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={handleSupersedeSubmit}
              disabled={supersedeMutation.isPending || !supersedeReason.trim()}
            >
              {supersedeMutation.isPending ? '取代中…' : '确认取代'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6.6 AI 解释对话框 */}
      <Dialog open={explanationDialogOpen} onOpenChange={setExplanationDialogOpen}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>AI 解释</DialogTitle>
            <DialogDescription>以下为 AI 对该匹配的解释，仅供参考。</DialogDescription>
          </DialogHeader>

          {explanationText ? (
            <div className="text-sm whitespace-pre-wrap leading-relaxed text-gray-700">
              {explanationText}
            </div>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setExplanationDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6.7 权限降级提示 */}
      {readOnly && (
        <Alert>
          <AlertDescription>
            您当前为只读访问。如需创建运行或确认实体链接，请联系项目管理员。
          </AlertDescription>
        </Alert>
      )}

      {!canManage && !readOnly && (
        <Alert>
          <AlertDescription>
            您不具备实体链接管理权限，仅可查看已确认的链接。如需管理权限，请联系项目管理员。
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
