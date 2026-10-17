'use client'

import React, { useState, useCallback } from 'react'
import {
  useOcrExtractionProfiles,
  useOcrExtractionRuns,
  useOcrExtractionRun,
  useOcrExtractionCandidates,
  useCreateOcrExtractionRun,
  useOcrStructuredExtractionPreview,
  useOcrStructuredExtractionSave,
} from '@/hooks/use-ocr-structured-extraction'
import type {
  OcrExtractionProfileSummary,
  OcrExtractionRunSummary,
  OcrExtractionRunDetail,
  OcrFieldCandidate,
  OcrTableCandidate,
  OcrTypedTableCellValue,
  OcrExtractionWarning,
  OcrStructuredExtractionPreviewResponse,
} from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
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
import { AlertTriangle, CheckCircle2, FileSearch, AlertCircle } from 'lucide-react'

// ─── 常量 ────────────────────────────────────────────────────────────────

/** 运行状态中文标签 */
const RUN_STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  processing: '处理中',
  completed: '已完成',
  completed_with_warnings: '已完成（含警告）',
  failed: '失败',
  canceled: '已取消',
}

/** 运行状态徽章颜色 */
const RUN_STATUS_COLOR: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral',
  processing: 'info',
  completed: 'success',
  completed_with_warnings: 'warning',
  failed: 'danger',
  canceled: 'neutral',
}

/** 置信度等级徽章颜色 */
const CONFIDENCE_COLOR: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
  unknown: 'neutral',
}

/** 置信度等级中文 */
const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
  unknown: '未知',
}

/** 出处中文 */
const PROVENANCE_LABEL: Record<string, string> = {
  deterministic: '规则',
  ai_assisted: 'AI 辅助',
  ai_fallback: 'AI 回退',
}

/** 警告代码中文 */
const WARNING_CODE_LABEL: Record<string, string> = {
  AMBIGUOUS_DATE: '日期歧义',
  AMBIGUOUS_LABEL: '标签歧义',
  LOW_CONFIDENCE_MATCH: '低置信度',
  MISSING_REQUIRED_FIELD: '缺少必填字段',
  MISSING_TABLE_HEADER: '缺少表头',
  TABLE_BOUNDARY_UNCLEAR: '表格边界不清',
  EXTRA_FIELD_IGNORED: '多余字段已忽略',
  VALUE_COERCION_FAILED: '值转换失败',
  AI_CANDIDATE_REJECTED: 'AI 候选被拒',
  AI_FALLBACK_USED: '使用了 AI 回退',
  SOURCE_TRUNCATED: '源文本截断',
  PROFILE_VERSION_MISMATCH: 'Profile 版本不匹配',
}

/** scope 过滤标签 */
const SCOPE_LABEL: Record<string, string> = {
  all: '全部 Profile',
  builtin: '内置',
  project: '项目',
}

// ─── Props ───────────────────────────────────────────────────────────────

interface OcrStructuredExtractionReviewProps {
  projectId: number
  /** 可选——指定 extractionId 来预过滤运行列表 */
  extractionId?: number
  /** 外部传入只读模式（权限不足时强制 true） */
  readOnly?: boolean
}

// ─── 子组件 ──────────────────────────────────────────────────────────────

/** 置信度徽章 */
function ConfidenceBadge({ level }: { level: string }) {
  const variant = CONFIDENCE_COLOR[level] ?? 'neutral'
  const label = CONFIDENCE_LABEL[level] ?? level
  return (
    <Badge variant={variant} className="text-[11px]">
      {label}
    </Badge>
  )
}

/** 警告图标 + Tooltip */
function WarningIndicator({ warnings }: { warnings: OcrExtractionWarning[] }) {
  if (warnings.length === 0) return null

  const hasError = warnings.some((w) => w.severity === 'error')
  const Icon = hasError ? AlertCircle : AlertTriangle
  const iconColor = hasError ? 'text-danger' : 'text-warning'

  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span className={`inline-flex cursor-help ${iconColor}`}>
            <Icon className="h-4 w-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="text-xs">
              <span className="font-medium">{WARNING_CODE_LABEL[w.code] ?? w.code}</span>
              {w.message ? `：${w.message}` : ''}
            </div>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** 源跨度引用行 */
function SourceSpanRef({
  spanRef,
}: {
  spanRef: { pageIndex: number; charStart: number; charEnd: number } | null
}) {
  if (!spanRef) return null
  return (
    <span className="text-[11px] text-muted-foreground">
      第 {spanRef.pageIndex + 1} 页，{spanRef.charStart}-{spanRef.charEnd}
    </span>
  )
}

/** 表格单元格渲染 */
function TableCellValue({ cell }: { cell: OcrTypedTableCellValue }) {
  const val = cell.value
  if (!val) return <span className="text-muted-foreground">—</span>

  switch (val.kind) {
    case 'date':
      return <span>{val.normalized}</span>
    case 'number':
      return <span>{val.normalized ?? val.raw}</span>
    case 'enum':
      return <span>{val.normalized}</span>
    case 'person_name':
      return (
        <span className={val.matchType === 'none' ? 'text-muted-foreground' : ''}>
          {val.normalized}
        </span>
      )
    case 'project_ref':
      return (
        <span className={val.matchType === 'none' ? 'text-muted-foreground' : 'text-primary-600'}>
          {val.normalized}
        </span>
      )
    case 'text':
    default:
      return <span>{val.normalized}</span>
  }
}

// ─── 主组件 ──────────────────────────────────────────────────────────────

export default function OcrStructuredExtractionReview({
  projectId,
  extractionId,
  readOnly = false,
}: OcrStructuredExtractionReviewProps) {
  // ── 本地状态 ────────────────────────────────────────────────────────
  const [scopeFilter, setScopeFilter] = useState<string>('all')
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<number>>(new Set())
  const [selectedTableIds, setSelectedTableIds] = useState<Set<number>>(new Set())
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmCheckbox, setConfirmCheckbox] = useState(false)
  const [previewResult, setPreviewResult] = useState<OcrStructuredExtractionPreviewResponse | null>(
    null,
  )
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // ── 查询 ────────────────────────────────────────────────────────────
  const profilesQuery = useOcrExtractionProfiles(projectId, {
    scope: scopeFilter !== 'all' ? scopeFilter : undefined,
  })
  const runsQuery = useOcrExtractionRuns(projectId, {
    extractionId,
    profileId: selectedProfileId ?? undefined,
  })
  const runDetailQuery = useOcrExtractionRun(projectId, selectedRunId)
  const candidatesQuery = useOcrExtractionCandidates(projectId, selectedRunId)

  // ── 变更 ────────────────────────────────────────────────────────────
  const createRunMutation = useCreateOcrExtractionRun(projectId)
  const previewMutation = useOcrStructuredExtractionPreview(projectId)
  const saveMutation = useOcrStructuredExtractionSave(projectId)

  // ── 派生数据 ────────────────────────────────────────────────────────
  const profiles: OcrExtractionProfileSummary[] = profilesQuery.data?.data ?? []
  const runs: OcrExtractionRunSummary[] = runsQuery.data?.data ?? []
  const runDetail: OcrExtractionRunDetail | undefined = runDetailQuery.data?.data
  const candidates = candidatesQuery.data?.data
  const fields: OcrFieldCandidate[] = candidates?.fields ?? []
  const tables: OcrTableCandidate[] = candidates?.tables ?? []

  // 权限解析
  const canRun =
    !readOnly && runDetail
      ? runDetail.allowedActions.includes('preview_confirm') ||
        runDetail.allowedActions.includes('confirm')
      : !readOnly
  const canConfirm =
    !readOnly && runDetail ? runDetail.allowedActions.includes('confirm') : !readOnly

  // 是否过期（源已变更）
  const isStale = runDetail?.warningSummary?.topCodes?.includes('SOURCE_TRUNCATED') ?? false

  // ── 事件处理 ────────────────────────────────────────────────────────

  const handleScopeChange = useCallback((value: string) => {
    setScopeFilter(value)
    setSelectedProfileId(null)
    setSelectedRunId(null)
    setSelectedFieldIds(new Set())
    setSelectedTableIds(new Set())
    setPreviewResult(null)
    setErrorMsg(null)
  }, [])

  const handleProfileChange = useCallback((profileId: string) => {
    const id = profileId ? Number(profileId) : null
    setSelectedProfileId(id)
    setSelectedRunId(null)
    setSelectedFieldIds(new Set())
    setSelectedTableIds(new Set())
    setPreviewResult(null)
    setErrorMsg(null)
  }, [])

  const handleRunSelect = useCallback((runId: number) => {
    setSelectedRunId(runId)
    setSelectedFieldIds(new Set())
    setSelectedTableIds(new Set())
    setPreviewResult(null)
    setErrorMsg(null)
    setConfirmCheckbox(false)
  }, [])

  const handleCreateRun = useCallback(async () => {
    if (!selectedProfileId || !extractionId) return
    setErrorMsg(null)
    try {
      await createRunMutation.mutateAsync({
        extractionId,
        profileId: selectedProfileId,
      })
    } catch {
      setErrorMsg('创建提取运行失败，请检查权限或稍后重试')
    }
  }, [selectedProfileId, extractionId, createRunMutation])

  const toggleField = useCallback((candidateId: number) => {
    setSelectedFieldIds((prev) => {
      const next = new Set(prev)
      if (next.has(candidateId)) {
        next.delete(candidateId)
      } else {
        next.add(candidateId)
      }
      return next
    })
    setPreviewResult(null)
    setConfirmCheckbox(false)
  }, [])

  const toggleTable = useCallback((candidateId: number) => {
    setSelectedTableIds((prev) => {
      const next = new Set(prev)
      if (next.has(candidateId)) {
        next.delete(candidateId)
      } else {
        next.add(candidateId)
      }
      return next
    })
    setPreviewResult(null)
    setConfirmCheckbox(false)
  }, [])

  const handlePreview = useCallback(async () => {
    if (!selectedRunId) return
    setErrorMsg(null)
    try {
      const result = await previewMutation.mutateAsync({
        runId: selectedRunId,
        selectedFieldCandidateIds: Array.from(selectedFieldIds),
        selectedTableCandidateIds: Array.from(selectedTableIds),
      })
      setPreviewResult(result.data)
      setShowConfirmDialog(true)
    } catch {
      setErrorMsg('预览失败，请检查权限或稍后重试')
    }
  }, [selectedRunId, selectedFieldIds, selectedTableIds, previewMutation])

  const handleSave = useCallback(async () => {
    if (!selectedRunId || !previewResult || !confirmCheckbox) return
    setErrorMsg(null)
    try {
      await saveMutation.mutateAsync({
        previewHash: previewResult.previewHash,
        runId: selectedRunId,
        selectedFieldCandidateIds: Array.from(selectedFieldIds),
        selectedTableCandidateIds: Array.from(selectedTableIds),
      })
      setShowConfirmDialog(false)
      setPreviewResult(null)
      setConfirmCheckbox(false)
      setSelectedFieldIds(new Set())
      setSelectedTableIds(new Set())
    } catch {
      setErrorMsg('保存失败，预览可能已过期，请重新预览')
    }
  }, [
    selectedRunId,
    previewResult,
    confirmCheckbox,
    selectedFieldIds,
    selectedTableIds,
    saveMutation,
  ])

  // ── 渲染 ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* 全局错误 */}
      {errorMsg && (
        <Alert variant="danger">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      {/* 6.4 Profile 选择 + 运行状态 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Scope 过滤 */}
          <div className="w-36">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Profile 范围</label>
            <Select value={scopeFilter} onValueChange={handleScopeChange}>
              <SelectTrigger>
                <SelectValue placeholder="全部 Profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部 Profile</SelectItem>
                <SelectItem value="builtin">内置</SelectItem>
                <SelectItem value="project">项目</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Profile 选择 */}
          <div className="w-56">
            <label className="text-xs font-medium text-gray-500 mb-1 block">提取 Profile</label>
            <Select
              value={selectedProfileId ? String(selectedProfileId) : ''}
              onValueChange={handleProfileChange}
              disabled={profilesQuery.isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择 Profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.profileId} value={String(p.profileId)}>
                    <span className="flex items-center gap-2">
                      {p.name}
                      <Badge variant="outline" className="text-[10px] px-1">
                        {SCOPE_LABEL[p.scope] ?? p.scope}
                      </Badge>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 创建运行按钮 */}
          {canRun && selectedProfileId && extractionId && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateRun}
              disabled={createRunMutation.isPending}
            >
              {createRunMutation.isPending ? '创建中…' : '创建运行'}
            </Button>
          )}
        </div>

        {/* 运行列表 */}
        <div className="mt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">提取运行</h4>

          {runsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="暂无提取运行"
              description="选择一个 Profile 并点击「创建运行」来启动结构化提取"
            />
          ) : (
            <div className="space-y-2 max-h-64 overflow-auto">
              {runs.map((run) => (
                <div
                  key={run.runId}
                  role="button"
                  tabIndex={0}
                  className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedRunId === run.runId
                      ? 'border-primary bg-primary/5'
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
                        {run.profileName} v{run.profileVersion}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        字段 {run.totalFieldCandidates} · 表格 {run.totalTableCandidates}
                        {run.warningCount > 0 && (
                          <span className="text-warning ml-1">· {run.warningCount} 条警告</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <Badge variant="outline" className="text-[10px]">
                      {PROVENANCE_LABEL[run.provenance] ?? run.provenance}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(run.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 过期警告 */}
      {isStale && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            来源文件可能已变更，当前候选数据可能已过时。建议重新运行提取以获得最新结果。
          </AlertDescription>
        </Alert>
      )}

      {/* 候选详情 */}
      {selectedRunId && (
        <>
          {/* 6.5 字段候选审查 */}
          {candidatesQuery.isLoading ? (
            <Card className="p-4">
              <Skeleton className="h-8 w-48 mb-4" />
              <Skeleton className="h-24 w-full mb-3" />
              <Skeleton className="h-24 w-full" />
            </Card>
          ) : fields.length === 0 && tables.length === 0 ? (
            <Card className="p-4">
              <p className="text-sm text-muted-foreground text-center py-8">
                该运行暂无可审查的候选数据
              </p>
            </Card>
          ) : (
            <>
              {/* 字段候选卡片 */}
              {fields.length > 0 && (
                <Card className="p-4">
                  <h4 className="text-base font-semibold text-gray-800 mb-4">
                    字段候选（{fields.length}）
                  </h4>
                  <div className="space-y-3">
                    {fields.map((field) => (
                      <div
                        key={field.candidateId}
                        className={`flex items-start gap-3 p-3 border rounded-lg transition-colors ${
                          selectedFieldIds.has(field.candidateId)
                            ? 'border-primary bg-primary/5'
                            : 'border-border'
                        }`}
                      >
                        <Checkbox
                          checked={selectedFieldIds.has(field.candidateId)}
                          onCheckedChange={() => toggleField(field.candidateId)}
                          disabled={!canConfirm || isStale}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-700">
                              {field.fieldKey}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {field.fieldType}
                            </Badge>
                            <ConfidenceBadge level={field.confidence} />
                            <WarningIndicator warnings={field.warnings} />
                          </div>
                          <p className="text-sm text-gray-600 break-words">
                            {field.value
                              ? field.value.kind === 'date'
                                ? (field.value as { normalized: string }).normalized
                                : field.value.kind === 'number'
                                  ? String(
                                      (field.value as { normalized: number | null }).normalized ??
                                        field.raw,
                                    )
                                  : (field.value as { normalized: string }).normalized
                              : field.raw}
                          </p>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                            <SourceSpanRef spanRef={field.spanRef} />
                            <Badge variant="outline" className="text-[10px] px-1">
                              {PROVENANCE_LABEL[field.provenance] ?? field.provenance}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* 6.6 表格候选审查 */}
              {tables.length > 0 && (
                <Card className="p-4">
                  <h4 className="text-base font-semibold text-gray-800 mb-4">
                    表格候选（{tables.length}）
                  </h4>
                  <div className="space-y-6">
                    {tables.map((table) => (
                      <div key={table.candidateId} className="space-y-2">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedTableIds.has(table.candidateId)}
                            onCheckedChange={() => toggleTable(table.candidateId)}
                            disabled={!canConfirm || isStale}
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {table.tableKey}
                          </span>
                          <ConfidenceBadge level={table.confidence} />
                          <WarningIndicator warnings={table.warnings} />
                          <Badge variant="outline" className="text-[10px]">
                            {PROVENANCE_LABEL[table.provenance] ?? table.provenance}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {table.rows.length} 行（上限 {table.maxRows}）
                          </span>
                        </div>

                        {selectedTableIds.has(table.candidateId) && table.rows.length > 0 && (
                          <div className="border rounded-lg overflow-x-auto">
                            <div className="min-w-max">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-12 text-center">#</TableHead>
                                    {table.rows[0]?.cells.map((cell, ci) => (
                                      <TableHead key={ci} className="whitespace-nowrap">
                                        <div className="flex items-center gap-1">
                                          {cell.fieldKey}
                                          <Badge variant="outline" className="text-[9px] px-1">
                                            {cell.fieldType}
                                          </Badge>
                                        </div>
                                      </TableHead>
                                    ))}
                                    <TableHead className="w-24">来源</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {table.rows.slice(0, table.maxRows).map((row) => (
                                    <TableRow key={row.rowKey}>
                                      <TableCell className="text-center text-xs text-muted-foreground">
                                        {row.rowIndex + 1}
                                      </TableCell>
                                      {row.cells.map((cell, ci) => (
                                        <TableCell key={ci} className="whitespace-nowrap text-sm">
                                          <TableCellValue cell={cell} />
                                        </TableCell>
                                      ))}
                                      <TableCell className="text-[11px] text-muted-foreground">
                                        {row.spanRefs.length > 0
                                          ? `第 ${row.spanRefs[0]!.pageIndex + 1} 页`
                                          : '—'}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                        )}

                        {table.rows.length > table.maxRows && (
                          <p className="text-xs text-muted-foreground pl-7">
                            显示前 {table.maxRows} 行，共 {table.rows.length} 行
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* 操作按钮 */}
              {canConfirm && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    已选 {selectedFieldIds.size} 个字段、{selectedTableIds.size} 个表格
                  </p>
                  <Button
                    onClick={handlePreview}
                    disabled={
                      previewMutation.isPending ||
                      (selectedFieldIds.size === 0 && selectedTableIds.size === 0) ||
                      isStale
                    }
                  >
                    {previewMutation.isPending ? '预览中…' : '预览确认'}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* 未选择运行的提示 */}
      {!selectedRunId && runs.length > 0 && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground text-center py-8">
            请从上方运行列表中选择一个运行来审查提取结果
          </p>
        </Card>
      )}

      {/* 6.7 确认预览/保存对话框 */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>审查提取结果</DialogTitle>
            <DialogDescription>
              以下是选中的结构化提取结果预览。请确认所有内容后再保存。
            </DialogDescription>
          </DialogHeader>

          {previewResult && (
            <div className="space-y-4">
              {/* 运行信息 */}
              <div className="flex gap-4 text-sm text-muted-foreground">
                <span>
                  Profile：{previewResult.profileId} v{previewResult.profileVersion}
                </span>
                <span>运行：#{previewResult.runId}</span>
              </div>

              {/* 选中字段预览 */}
              {previewResult.selectedFields.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-semibold">
                    选中字段（{previewResult.selectedFields.length}）
                  </h5>
                  <div className="space-y-1.5 max-h-48 overflow-auto">
                    {previewResult.selectedFields.map((field) => (
                      <div
                        key={field.candidateId}
                        className="flex items-center justify-between p-2 border rounded text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium">{field.fieldKey}</span>
                          <span className="text-muted-foreground truncate">
                            {field.value
                              ? field.value.kind === 'date'
                                ? (field.value as { normalized: string }).normalized
                                : (field.value as { normalized: string }).normalized
                              : field.raw}
                          </span>
                        </div>
                        <ConfidenceBadge level={field.confidence} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 选中表格预览 */}
              {previewResult.selectedTables.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-semibold">
                    选中表格（{previewResult.selectedTables.length}）
                  </h5>
                  {previewResult.selectedTables.map((table) => (
                    <div key={table.candidateId} className="border rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">{table.tableKey}</span>
                        <span className="text-xs text-muted-foreground">
                          {table.rows.length} 行
                        </span>
                        <ConfidenceBadge level={table.confidence} />
                      </div>
                      {table.rows.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          首行：{table.rows[0]!.cells.map((c) => c.raw).join(' | ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 过期警告 */}
              {previewResult.staleWarnings.length > 0 && (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-1">
                      <p className="font-medium">过期警告：</p>
                      {previewResult.staleWarnings.map((w, i) => (
                        <p key={i} className="text-xs">
                          {WARNING_CODE_LABEL[w.code] ?? w.code}：{w.message}
                        </p>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* 6.7 红线摘要 */}
              <div className="border rounded-lg p-3 bg-muted/30">
                <h5 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 text-warning" />
                  红线声明——以下系统不会被修改：
                </h5>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    任务
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    WBS
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    风险
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    里程碑
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    资源
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    报表
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    文档正文
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    Compiler 产物
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    AI 草稿
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    搜索索引
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    知识库
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    外部系统
                  </div>
                </div>
              </div>

              {/* 显式确认 */}
              <div className="flex items-start gap-2">
                <Checkbox
                  id="structured-extraction-confirm"
                  checked={confirmCheckbox}
                  onCheckedChange={(v) => setConfirmCheckbox(v === true)}
                  className="mt-0.5"
                />
                <label
                  htmlFor="structured-extraction-confirm"
                  className="text-sm text-gray-700 leading-relaxed"
                >
                  我确认以上提取结果仅作为参考数据保存，不会自动修改项目、任务、WBS、风险或里程碑
                </label>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !confirmCheckbox ||
                saveMutation.isPending ||
                !previewResult ||
                (previewResult.selectedFields.length === 0 &&
                  previewResult.selectedTables.length === 0)
              }
            >
              {saveMutation.isPending ? '保存中…' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6.8 只读提示 */}
      {readOnly && (
        <Alert>
          <AlertDescription>
            您当前为只读访问。如需创建运行或确认提取结果，请联系项目管理员。
          </AlertDescription>
        </Alert>
      )}

      {/* 保存成功提示 */}
      {saveMutation.isSuccess && (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <AlertDescription>结构化提取结果已成功保存！</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
