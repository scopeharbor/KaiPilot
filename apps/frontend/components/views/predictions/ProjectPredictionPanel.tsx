'use client'

import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Alert } from '@/components/ui/Alert'
import { Skeleton } from '@/components/ui/Skeleton'
import { Separator } from '@/components/ui/Separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import PermissionGuard from '@/components/PermissionGuard'
import { usePredictionPermissions } from '@/hooks/use-prediction-permissions'
import {
  useLatestPrediction,
  usePredictionList,
  useCreatePrediction,
  useConfirmPrediction,
  useDismissPrediction,
  useGenerateAiExplanation,
  useApproveAiExplanation,
  useRejectAiExplanation,
  predictionKeys,
} from '@/hooks/use-predictions'
import { useQueryClient } from '@tanstack/react-query'
import {
  PREDICTION_WINDOWS,
  PREDICTION_SIGNAL_TYPE_LABELS,
  PREDICTION_SEVERITY_ORDER,
  predictionSeverityScore,
  type PredictionSnapshot,
  type PredictionSnapshotListItem,
  type PredictionSignal,
  type PredictionAiExplanation,
  type PredictionDataWarning,
  type PredictionWindow,
  type PredictionSeverity,
} from '@/lib/api/predictions'
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  RefreshCw,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const WINDOW_LABELS: Record<PredictionWindow, string> = {
  7: '7 天',
  14: '14 天',
  30: '30 天',
  60: '60 天',
  90: '90 天',
}

const SEVERITY_LABELS: Record<PredictionSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '信息',
}

const SEVERITY_VARIANTS: Record<PredictionSeverity, 'danger' | 'warning' | 'neutral' | 'info'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'neutral',
  info: 'info',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  dismissed: '已忽略',
  stale: '已过期',
}

const CONFIRM_BAND_LABELS: Record<string, string> = {
  high: '高置信度',
  medium: '中等置信度',
  low: '低置信度',
}

const EXPLANATION_STATUS_LABELS: Record<string, string> = {
  pending: '待审',
  approved: '已批准',
  rejected: '已驳回',
  failed: '生成失败',
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function severityCount(signals: PredictionSignal[], severity: PredictionSeverity): number {
  return signals.filter((s) => s.severity === severity).length
}

function topSeverity(signals: PredictionSignal[]): PredictionSeverity | null {
  for (const sev of PREDICTION_SEVERITY_ORDER) {
    if (signals.some((s) => s.severity === sev)) return sev
  }
  return null
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ---------------------------------------------------------------------------
// ProjectPredictionPanelProps
// ---------------------------------------------------------------------------

export interface ProjectPredictionPanelProps {
  projectId: number
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

export function ProjectPredictionPanel({ projectId }: ProjectPredictionPanelProps) {
  const [selectedWindow, setSelectedWindow] = useState<PredictionWindow>(14)

  const {
    data: latestResp,
    isLoading: latestLoading,
    error: latestError,
  } = useLatestPrediction(projectId)
  const { data: listResp } = usePredictionList(projectId, { perPage: 10 })

  const createMutation = useCreatePrediction(projectId)
  const confirmMutation = useConfirmPrediction(projectId)
  const dismissMutation = useDismissPrediction(projectId)
  const generateMutation = useGenerateAiExplanation(projectId)
  const approveMutation = useApproveAiExplanation(projectId)
  const rejectMutation = useRejectAiExplanation(projectId)

  const permissions = usePredictionPermissions()

  const snapshot = latestResp?.data ?? null
  const predictions = listResp?.data ?? []
  const isLoadingSnapshot = latestLoading

  // 创建新预测
  const handleGeneratePrediction = async () => {
    if (!permissions.canGenerate) return
    await createMutation.mutateAsync({ window: selectedWindow })
  }

  // 确认
  const handleConfirm = async () => {
    if (!snapshot || !permissions.canConfirm) return
    await confirmMutation.mutateAsync({ id: snapshot.id })
  }

  // 忽略
  const handleDismiss = async () => {
    if (!snapshot || !permissions.canConfirm) return
    await dismissMutation.mutateAsync({
      id: snapshot.id,
      data: { reason: '人工判定无需关注' },
    })
  }

  // 生成 AI 解释
  const handleGenerateExplanation = async () => {
    if (!snapshot || !permissions.canTriggerAi) return
    await generateMutation.mutateAsync({ id: snapshot.id })
  }

  // 批准 AI 解释
  const handleApproveExplanation = async () => {
    if (!snapshot?.aiExplanation || !permissions.canConfirm) return
    await approveMutation.mutateAsync({ id: snapshot.id })
  }

  // 驳回 AI 解释
  const handleRejectExplanation = async () => {
    if (!snapshot?.aiExplanation || !permissions.canConfirm) return
    await rejectMutation.mutateAsync({
      id: snapshot.id,
      data: { reason: '解释不准确' },
    })
  }

  const isPending =
    createMutation.isPending ||
    confirmMutation.isPending ||
    dismissMutation.isPending ||
    generateMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending

  // -----------------------------------------------------------------------
  // 渲染
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">AI 风险与进度预测</h2>
          {snapshot?.stale && (
            <Badge variant="warning">
              <Clock className="h-3 w-3 mr-1" />
              数据已过期
            </Badge>
          )}
          {snapshot && !snapshot.stale && (
            <Badge variant="neutral">生成于 {formatDate(snapshot.generatedAt)}</Badge>
          )}
        </div>

        <PermissionGuard require="prediction:generate">
          <div className="flex items-center gap-2">
            <label htmlFor="prediction-window" className="sr-only">
              预测窗口
            </label>
            <Select
              value={String(selectedWindow)}
              onValueChange={(v) => setSelectedWindow(Number(v) as PredictionWindow)}
              disabled={isPending}
            >
              <SelectTrigger id="prediction-window" className="w-28">
                <SelectValue placeholder="选择窗口" />
              </SelectTrigger>
              <SelectContent>
                {PREDICTION_WINDOWS.map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    {WINDOW_LABELS[w]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleGeneratePrediction}
              disabled={isPending || !permissions.canGenerate}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  生成中…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-1.5" />
                  AI 预测
                </>
              )}
            </Button>
          </div>
        </PermissionGuard>
      </div>

      {/* 加载态 */}
      {isLoadingSnapshot && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      )}

      {/* 错误态 */}
      {!isLoadingSnapshot && latestError && (
        <Alert variant="danger" title="加载失败">
          无法加载预测数据，请稍后重试。
        </Alert>
      )}

      {/* 空态 */}
      {!isLoadingSnapshot && !latestError && !snapshot && (
        <Card variant="outlined">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 mb-4">暂无预测数据</p>
            <PermissionGuard require="prediction:generate">
              <Button onClick={handleGeneratePrediction} disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    生成中…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    生成首次预测
                  </>
                )}
              </Button>
            </PermissionGuard>
          </CardContent>
        </Card>
      )}

      {/* 数据主体 */}
      {snapshot && !isLoadingSnapshot && (
        <>
          {/* 摘要卡片 */}
          <PredictionSummaryCard
            snapshot={snapshot}
            canConfirm={permissions.canConfirm}
            isPending={isPending}
            onConfirm={handleConfirm}
            onDismiss={handleDismiss}
          />

          {/* 警告提示 */}
          {snapshot.warnings.length > 0 && (
            <div className="space-y-2">
              {snapshot.warnings.map((w, idx) => (
                <WarningAlert key={idx} warning={w} />
              ))}
            </div>
          )}

          {/* 信号列表 */}
          {snapshot.signals.length > 0 && <PredictionSignalList signals={snapshot.signals} />}

          {/* AI 解释 */}
          <PredictionAiExplanationSection
            aiExplanation={snapshot.aiExplanation}
            canTriggerAi={permissions.canTriggerAi}
            canReview={permissions.canConfirm}
            isPending={
              generateMutation.isPending || approveMutation.isPending || rejectMutation.isPending
            }
            onGenerate={handleGenerateExplanation}
            onApprove={handleApproveExplanation}
            onReject={handleRejectExplanation}
          />

          {/* 历史快照 */}
          {predictions.length > 0 && <PredictionHistoryList predictions={predictions} />}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PredictionSummaryCard
// ---------------------------------------------------------------------------

interface PredictionSummaryCardProps {
  snapshot: PredictionSnapshot
  canConfirm: boolean
  isPending: boolean
  onConfirm: () => void
  onDismiss: () => void
}

function PredictionSummaryCard({
  snapshot,
  canConfirm,
  isPending,
  onConfirm,
  onDismiss,
}: PredictionSummaryCardProps) {
  const sev = topSeverity(snapshot.signals)
  const topLabel = sev ? SEVERITY_LABELS[sev] : '无信号'
  const topVariant = sev ? SEVERITY_VARIANTS[sev] : 'neutral'

  const counts = {
    critical: severityCount(snapshot.signals, 'critical'),
    high: severityCount(snapshot.signals, 'high'),
    medium: severityCount(snapshot.signals, 'medium'),
    low: severityCount(snapshot.signals, 'low'),
    info: severityCount(snapshot.signals, 'info'),
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>预测摘要</CardTitle>
            <Badge variant={topVariant as never}>{topLabel}</Badge>
            <Badge variant="neutral">{snapshot.signals.length} 个信号</Badge>
            {snapshot.stale ? (
              <Badge variant="warning">已过期</Badge>
            ) : (
              <Badge variant="success">
                {snapshot.confirmation.status === 'confirmed'
                  ? '已确认'
                  : snapshot.confirmation.status === 'dismissed'
                    ? '已忽略'
                    : '待确认'}
              </Badge>
            )}
          </div>
          <span className="text-xs text-gray-400">
            规则 {snapshot.ruleVersion} · 窗口 {WINDOW_LABELS[snapshot.window]}
          </span>
        </div>
        <CardDescription>
          生成于 {formatDate(snapshot.generatedAt)}
          {snapshot.confirmation.confirmedAt && (
            <>
              {' '}
              · 已由用户 {snapshot.confirmation.confirmedBy} 于{' '}
              {formatDate(snapshot.confirmation.confirmedAt)} 确认
            </>
          )}
          {snapshot.confirmation.dismissedAt && (
            <> · 已忽略: {snapshot.confirmation.dismissReason}</>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* 严重度分布 */}
        <div className="flex gap-4 mb-4">
          <SeverityStat label="严重" count={counts.critical} variant="danger" />
          <SeverityStat label="高" count={counts.high} variant="warning" />
          <SeverityStat label="中" count={counts.medium} variant="neutral" />
          <SeverityStat label="低" count={counts.low} variant="neutral" />
          <SeverityStat label="信息" count={counts.info} variant="info" />
        </div>

        {/* 过期提示 */}
        {snapshot.stale && snapshot.staleReason && (
          <Alert variant="warning" title="数据可能已过期" icon={<Clock className="h-5 w-5" />}>
            {snapshot.staleReason}
          </Alert>
        )}

        {/* 操作按钮（仅待确认且具备权限） */}
        {snapshot.confirmation.status === 'pending' && canConfirm && (
          <div className="flex items-center gap-3 mt-4">
            <Button onClick={onConfirm} disabled={isPending}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              确认预测
            </Button>
            <Button variant="outline" onClick={onDismiss} disabled={isPending}>
              <XCircle className="h-4 w-4 mr-1.5" />
              忽略
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SeverityStat({
  label,
  count,
  variant,
}: {
  label: string
  count: number
  variant: 'danger' | 'warning' | 'neutral' | 'info'
}) {
  const dotColor = {
    danger: 'bg-danger',
    warning: 'bg-warning',
    neutral: 'bg-gray-400',
    info: 'bg-info',
  }[variant]

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-800">{count}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WarningAlert
// ---------------------------------------------------------------------------

function WarningAlert({ warning }: { warning: PredictionDataWarning }) {
  return (
    <Alert
      variant={warning.blocking ? 'danger' : 'warning'}
      title={warning.code}
      icon={<AlertTriangle className="h-5 w-5" />}
    >
      <div className="space-y-1">
        <p>{warning.message}</p>
        {warning.signalType && (
          <p className="text-xs text-gray-500">
            关联信号类型: {PREDICTION_SIGNAL_TYPE_LABELS[warning.signalType]}
          </p>
        )}
      </div>
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// PredictionSignalList
// ---------------------------------------------------------------------------

interface PredictionSignalListProps {
  signals: PredictionSignal[]
}

function PredictionSignalList({ signals }: PredictionSignalListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 按严重度降序排列
  const sorted = useMemo(
    () =>
      [...signals].sort(
        (a, b) => predictionSeverityScore(b.severity) - predictionSeverityScore(a.severity),
      ),
    [signals],
  )

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle>预测信号 ({signals.length})</CardTitle>
        <CardDescription>按严重度降序排列，点击展开证据引用</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {sorted.map((signal) => {
          const isExpanded = expandedIds.has(signal.id)
          return (
            <div key={signal.id} className="rounded-lg border border-border overflow-hidden">
              {/* 信号头 */}
              <button
                type="button"
                onClick={() => toggleExpand(signal.id)}
                className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Badge variant={SEVERITY_VARIANTS[signal.severity]}>
                    {SEVERITY_LABELS[signal.severity]}
                  </Badge>
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {PREDICTION_SIGNAL_TYPE_LABELS[signal.signalType]}
                  </span>
                  <span className="text-xs text-gray-400">
                    {CONFIRM_BAND_LABELS[signal.confidenceBand]}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400">评分 {signal.score.toFixed(1)}</span>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  )}
                </div>
              </button>

              {/* 展开内容 */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-3">
                  <Separator />
                  <p className="text-sm text-gray-600">{signal.description}</p>

                  {/* 置信区间 */}
                  {(signal.confidenceLower !== undefined ||
                    signal.confidenceUpper !== undefined) && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>置信区间:</span>
                      <span>
                        [{signal.confidenceLower?.toFixed(2) ?? '—'},{' '}
                        {signal.confidenceUpper?.toFixed(2) ?? '—'}]
                      </span>
                    </div>
                  )}

                  {/* 规则来源 */}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>规则: {signal.ruleId}</span>
                    <span>v{signal.ruleVersion}</span>
                    {signal.expiresAt && (
                      <>
                        <span>·</span>
                        <span>过期: {formatDate(signal.expiresAt)}</span>
                      </>
                    )}
                  </div>

                  {/* 证据引用 */}
                  {signal.evidenceRefs.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-gray-500">证据引用</span>
                      {signal.evidenceRefs.map((ref, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 rounded p-2"
                        >
                          {ref.visibility === 'forbidden' ? (
                            <EyeOff className="h-3 w-3 text-gray-400" />
                          ) : (
                            <Eye className="h-3 w-3 text-gray-400" />
                          )}
                          <span className="font-medium">{ref.entityType}</span>
                          <span>#{ref.entityId}</span>
                          {ref.visibility === 'full' && <span>— {ref.displaySummary}</span>}
                          {ref.visibility === 'summary_only' && (
                            <span className="text-gray-400 italic">摘要可见</span>
                          )}
                          {ref.visibility === 'forbidden' && (
                            <span className="text-gray-400 italic">无访问权限</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// PredictionAiExplanationSection
// ---------------------------------------------------------------------------

interface PredictionAiExplanationSectionProps {
  aiExplanation: PredictionAiExplanation | null
  canTriggerAi: boolean
  canReview: boolean
  isPending: boolean
  onGenerate: () => void
  onApprove: () => void
  onReject: () => void
}

function PredictionAiExplanationSection({
  aiExplanation,
  canTriggerAi,
  canReview,
  isPending,
  onGenerate,
  onApprove,
  onReject,
}: PredictionAiExplanationSectionProps) {
  const hasExplanation = aiExplanation && aiExplanation.status !== 'failed'

  const showGenerate = !aiExplanation || aiExplanation.status === 'failed'

  return (
    <Card variant="outlined">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>AI 解释</CardTitle>
            {aiExplanation && (
              <>
                <Badge variant="neutral">{EXPLANATION_STATUS_LABELS[aiExplanation.status]}</Badge>
                {aiExplanation.status === 'approved' && (
                  <span className="text-xs text-gray-400">
                    由用户 {aiExplanation.approvedBy} 批准于 {formatDate(aiExplanation.approvedAt)}
                  </span>
                )}
                {aiExplanation.status === 'rejected' && (
                  <span className="text-xs text-gray-400">
                    驳回原因: {aiExplanation.rejectReason}
                  </span>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* 生成按钮 */}
            {showGenerate && canTriggerAi && (
              <PermissionGuard require="prediction:trigger_ai">
                <Button variant="outline" size="sm" onClick={onGenerate} disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      生成中…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-1" />
                      生成解释
                    </>
                  )}
                </Button>
              </PermissionGuard>
            )}

            {/* 重新生成 */}
            {aiExplanation && aiExplanation.status === 'rejected' && canTriggerAi && (
              <PermissionGuard require="prediction:trigger_ai">
                <Button variant="outline" size="sm" onClick={onGenerate} disabled={isPending}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  重新生成
                </Button>
              </PermissionGuard>
            )}
          </div>
        </div>
        <CardDescription>AI 对当前预测信号的综合分析与建议</CardDescription>
      </CardHeader>

      <CardContent>
        {/* 无解释 */}
        {!aiExplanation && (
          <div className="text-center py-6 text-gray-400 text-sm">
            {canTriggerAi ? '点击"生成解释"查看 AI 分析' : '暂无 AI 解释'}
          </div>
        )}

        {/* 生成失败 */}
        {aiExplanation?.status === 'failed' && (
          <Alert variant="danger" title="解释生成失败">
            <p>{aiExplanation.failureMessage ?? '未知错误'}</p>
            {aiExplanation.failureCode && (
              <p className="text-xs text-gray-500 mt-1">错误代码: {aiExplanation.failureCode}</p>
            )}
            {canTriggerAi && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={onGenerate}
                disabled={isPending}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                重试
              </Button>
            )}
          </Alert>
        )}

        {/* 有解释内容 */}
        {hasExplanation && aiExplanation && (
          <div className="space-y-4">
            {/* 叙事 */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">综合评估</h4>
              <p className="text-sm text-gray-600 leading-relaxed">{aiExplanation.narrative}</p>
            </div>

            {/* 关注点 */}
            {aiExplanation.focusPoints.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">关注重点</h4>
                <ul className="list-disc list-inside space-y-0.5">
                  {aiExplanation.focusPoints.map((point, idx) => (
                    <li key={idx} className="text-sm text-gray-600">
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 建议行动 */}
            {aiExplanation.suggestedActions.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">建议行动</h4>
                <ul className="list-disc list-inside space-y-0.5">
                  {aiExplanation.suggestedActions.map((action, idx) => (
                    <li key={idx} className="text-sm text-gray-600">
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 假设 */}
            {aiExplanation.assumptions.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-1">假设条件</h4>
                <ul className="list-disc list-inside space-y-0.5">
                  {aiExplanation.assumptions.map((assumption, idx) => (
                    <li key={idx} className="text-sm text-gray-500">
                      {assumption}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 置信度 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">置信度</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden max-w-40">
                <div
                  className="h-full rounded-full bg-ai transition-all"
                  style={{
                    width: `${Math.min(Math.round(aiExplanation.confidence * 100), 100)}%`,
                  }}
                />
              </div>
              <span className="text-xs text-gray-500 w-8 text-right">
                {Math.round(aiExplanation.confidence * 100)}%
              </span>
            </div>

            {/* 模型信息 */}
            {aiExplanation.provider && aiExplanation.model && (
              <div className="text-xs text-gray-400">
                由 {aiExplanation.provider}/{aiExplanation.model} 生成
                {aiExplanation.generatedAt && <> · {formatDate(aiExplanation.generatedAt)}</>}
              </div>
            )}

            {/* 审阅按钮（仅待审） */}
            {aiExplanation.status === 'pending' && canReview && (
              <div className="flex items-center gap-3 pt-2">
                <Button size="sm" onClick={onApprove} disabled={isPending}>
                  <ThumbsUp className="h-4 w-4 mr-1" />
                  批准
                </Button>
                <Button variant="outline" size="sm" onClick={onReject} disabled={isPending}>
                  <ThumbsDown className="h-4 w-4 mr-1" />
                  驳回
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// PredictionHistoryList
// ---------------------------------------------------------------------------

interface PredictionHistoryListProps {
  predictions: PredictionSnapshotListItem[]
}

function PredictionHistoryList({ predictions }: PredictionHistoryListProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const queryClient = useQueryClient()

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: predictionKeys.lists() })
  }

  const displayList = isExpanded ? predictions : predictions.slice(0, 5)

  if (predictions.length === 0) return null

  return (
    <Card variant="outlined">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>历史预测 ({predictions.length})</CardTitle>
            <button
              type="button"
              onClick={handleRefresh}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              title="刷新"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {predictions.length > 5 && (
            <Button variant="ghost" size="sm" onClick={() => setIsExpanded((prev) => !prev)}>
              {isExpanded ? '收起' : `查看全部 ${predictions.length} 条`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {displayList.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 p-2 rounded hover:bg-gray-50 transition-colors text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="neutral">ID {item.id}</Badge>
                <Badge variant="neutral">{WINDOW_LABELS[item.window]}</Badge>
                <Badge
                  variant={
                    item.stale
                      ? 'warning'
                      : item.status === 'confirmed'
                        ? 'success'
                        : item.status === 'dismissed'
                          ? 'neutral'
                          : 'info'
                  }
                >
                  {STATUS_LABELS[item.status] ?? item.status}
                  {item.stale && '·已过期'}
                </Badge>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-xs text-gray-400">
                <span>{item.signalCount} 个信号</span>
                {item.criticalCount > 0 && (
                  <span className="text-danger font-medium">{item.criticalCount} 严重</span>
                )}
                {item.highCount > 0 && (
                  <span className="text-warning font-medium">{item.highCount} 高</span>
                )}
                <span>{formatDate(item.generatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
