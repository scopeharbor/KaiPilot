'use client'

import React, { useState } from 'react'
import {
  AlertCircle,
  HelpCircle,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Shield,
  AlertTriangle,
  MessageSquare,
  Send,
  Loader2,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert } from '@/components/ui/Alert'
import { Textarea } from '@/components/ui/Textarea'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useTrizRationaleDetail,
  useTrizRationaleFeedback,
  useTrizRationaleHandoff,
} from '@/hooks/use-triz-rationale'
import type {
  RationaleSourceRef,
  RationaleEvidenceRef,
  PrincipleMappingEntry,
  RationaleWarning,
  RationaleFeedbackReason,
} from '@aiproj/types'
import {
  RATIONALE_FEEDBACK_REASONS,
  RATIONALE_FEEDBACK_LABELS,
  sortEvidenceRefs,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrizRationalePanelProps {
  projectId: number
  targetType: string
  targetId: string
  className?: string
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RationaleSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="加载推荐理由中">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-10 w-32" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Warning badge
// ---------------------------------------------------------------------------

function WarningBadge({ warning }: { warning: RationaleWarning }) {
  const variantMap: Record<string, 'danger' | 'warning' | 'info'> = {
    STALE_SOURCE_HASH: 'danger',
    SOURCE_UNAVAILABLE: 'warning',
    AI_VALIDATION_FAILED: 'danger',
    AI_FALLBACK: 'warning',
    BUDGET_BLOCKED: 'warning',
    HALLUCINATION_WARNING: 'danger',
  }

  return (
    <Badge
      variant={variantMap[warning.code] ?? 'info'}
      className="gap-1 text-xs"
      title={warning.details ?? warning.message}
    >
      <AlertTriangle className="w-3 h-3" />
      {warning.message}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Section: Source Summary
// ---------------------------------------------------------------------------

function SourceSummarySection({ refs }: { refs: RationaleSourceRef[] }) {
  if (refs.length === 0) return null
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
        <FileText className="w-4 h-4" />
        来源摘要
      </h4>
      <ul className="space-y-1">
        {refs.map((ref, i) => (
          <li key={i} className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {ref.sourceType}
            </Badge>
            <span>{ref.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Principle Mapping Table
// ---------------------------------------------------------------------------

function PrincipleMappingSection({ mappings }: { mappings: PrincipleMappingEntry[] }) {
  if (mappings.length === 0) return null
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
        <Shield className="w-4 h-4" />
        发明原理映射
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1 pr-2 font-medium text-xs text-muted-foreground">
                原理
              </th>
              <th className="text-left py-1 px-2 font-medium text-xs text-muted-foreground">
                相关度
              </th>
              <th className="text-left py-1 px-2 font-medium text-xs text-muted-foreground">
                映射理由
              </th>
              <th className="text-left py-1 pl-2 font-medium text-xs text-muted-foreground">
                适用性
              </th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-1 pr-2 font-medium">{m.principleName}</td>
                <td className="py-1 px-2">
                  <Badge
                    variant={
                      m.relevance === 'high'
                        ? 'success'
                        : m.relevance === 'medium'
                          ? 'warning'
                          : 'info'
                    }
                    className="text-xs"
                  >
                    {m.relevance === 'high' ? '高' : m.relevance === 'medium' ? '中' : '低'}
                  </Badge>
                </td>
                <td className="py-1 px-2 text-muted-foreground">{m.rationale}</td>
                <td className="py-1 pl-2 text-muted-foreground">{m.applicability}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Evidence Chain
// ---------------------------------------------------------------------------

function EvidenceChainSection({ refs }: { refs: RationaleEvidenceRef[] }) {
  const [expanded, setExpanded] = useState(false)
  const sorted = sortEvidenceRefs(refs)

  if (refs.length === 0) return null
  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors"
        aria-expanded={expanded}
        aria-label={expanded ? '收起证据链' : '展开证据链'}
      >
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <FileText className="w-4 h-4" />
        证据链 ({refs.length})
      </button>
      {expanded && (
        <ul className="space-y-1 pl-6">
          {sorted.map((ref, i) => (
            <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {ref.label}
              </Badge>
              <span>{ref.description}</span>
              {ref.navigationUrl && (
                <a
                  href={ref.navigationUrl}
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`查看 ${ref.label} 详情`}
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: AI Explanation
// ---------------------------------------------------------------------------

function AiExplanationSection({
  aiDraft,
  fallback,
  validationStatus,
}: {
  aiDraft: string | null
  fallback: string | null
  validationStatus: string | null
}) {
  if (!aiDraft && !fallback) return null

  const isAiValid = validationStatus === 'passed'
  const isFailed = validationStatus === 'failed'

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
        <Sparkles className="w-4 h-4" />
        解释说明
        {validationStatus && (
          <Badge
            variant={isAiValid ? 'success' : isFailed ? 'danger' : 'warning'}
            className="text-xs ml-2"
          >
            {isAiValid ? 'AI 已验证' : isFailed ? '验证失败' : '规则摘要'}
          </Badge>
        )}
      </h4>
      {aiDraft && isAiValid && (
        <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
          <p className="whitespace-pre-line">{aiDraft}</p>
        </div>
      )}
      {fallback && (!aiDraft || !isAiValid) && (
        <div className="rounded-md bg-gray-50 dark:bg-gray-900 p-3 text-sm text-muted-foreground border border-border">
          <p className="whitespace-pre-line">{fallback}</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Validation State
// ---------------------------------------------------------------------------

function ValidationSection({ warnings }: { warnings: RationaleWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
        <AlertTriangle className="w-4 h-4" />
        Warning
      </h4>
      <div className="flex flex-wrap gap-2">
        {warnings.map((w, i) => (
          <WarningBadge key={i} warning={w} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Feedback Controls
// ---------------------------------------------------------------------------

function FeedbackControls({
  projectId,
  targetType,
  targetId,
}: {
  projectId: number
  targetType: string
  targetId: string
}) {
  const [selectedReason, setSelectedReason] = useState<string>('')
  const [note, setNote] = useState('')
  const [showForm, setShowForm] = useState(false)
  const feedbackMutation = useTrizRationaleFeedback(projectId)
  const { can } = usePermissions()
  const canFeedback = can('rationale:feedback')

  if (!canFeedback) return null

  const handleSubmit = async () => {
    if (!selectedReason) return
    await feedbackMutation.mutateAsync({
      targetType,
      targetId,
      payload: {
        reason: selectedReason as RationaleFeedbackReason,
        note: note.trim() || undefined,
      },
    })
    setSelectedReason('')
    setNote('')
    setShowForm(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowForm(!showForm)}
          aria-expanded={showForm}
          className="text-xs text-muted-foreground"
        >
          <MessageSquare className="w-3 h-3 mr-1" />
          {showForm ? '取消反馈' : '提供反馈'}
        </Button>
      </div>
      {showForm && (
        <div className="space-y-2 p-3 rounded-md bg-gray-50 dark:bg-gray-900 border border-border">
          <Select value={selectedReason} onValueChange={setSelectedReason}>
            <SelectTrigger className="w-full" aria-label="选择反馈原因">
              <SelectValue placeholder="选择反馈原因" />
            </SelectTrigger>
            <SelectContent>
              {RATIONALE_FEEDBACK_REASONS.map((reason) => (
                <SelectItem key={reason} value={reason}>
                  {RATIONALE_FEEDBACK_LABELS[reason]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="补充说明（可选，低敏信息）"
            rows={2}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!selectedReason || feedbackMutation.isPending}
              onClick={handleSubmit}
              loading={feedbackMutation.isPending}
            >
              {feedbackMutation.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Send className="w-3 h-3 mr-1" />
              )}
              提交反馈
            </Button>
          </div>
          {feedbackMutation.isSuccess && (
            <p className="text-xs text-green-600">反馈已提交，感谢您的意见</p>
          )}
          {feedbackMutation.isError && <p className="text-xs text-red-600">反馈提交失败，请重试</p>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Handoff Button
// ---------------------------------------------------------------------------

function HandoffButton({
  projectId,
  targetType,
  targetId,
}: {
  projectId: number
  targetType: string
  targetId: string
}) {
  const handoffMutation = useTrizRationaleHandoff(projectId)
  const { can } = usePermissions()
  const canHandoff = can('rationale:handoff')

  if (!canHandoff) return null

  const handleHandoff = async () => {
    await handoffMutation.mutateAsync({ targetType, targetId })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleHandoff}
      disabled={handoffMutation.isPending}
      loading={handoffMutation.isPending}
      className="text-xs"
    >
      {handoffMutation.isPending ? (
        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
      ) : (
        <ExternalLink className="w-3 h-3 mr-1" />
      )}
      继续审查（转草稿）
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

/**
 * TRIZ 推荐理由面板。
 *
 * 展示来源摘要、参数 tension、发明原理映射、证据链、AI/fallback 解释、
 * 验证状态、成本摘要、反馈控件和 Draft Layer handoff 入口。
 *
 * 红线：
 * - 绝不触发 contradiction refresh/confirm/dismiss/explain
 * - 绝不触发 AIGateway、推荐生成
 * - AI 解释草稿与规则摘要视觉分离
 */
export function TrizRationalePanel({
  projectId,
  targetType,
  targetId,
  className,
}: TrizRationalePanelProps) {
  const { can } = usePermissions()
  const canView = can('rationale:view')

  const {
    data: rationale,
    isLoading,
    isError,
    error,
  } = useTrizRationaleDetail(projectId, canView ? targetType : null, canView ? targetId : null)

  // Permission-safe unavailable state
  if (!canView) {
    return (
      <Card variant="outlined" className={cn('w-full', className)}>
        <CardContent>
          <EmptyState
            icon={AlertCircle}
            title="暂无访问权限"
            description="您没有查看该项目 TRIZ 推荐理由的权限。"
          />
        </CardContent>
      </Card>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <Card variant="outlined" className={cn('w-full', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            TRIZ 推荐理由
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RationaleSkeleton />
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (isError || !rationale) {
    return (
      <Card variant="outlined" className={cn('w-full', className)}>
        <CardContent>
          <Alert variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
            <div className="font-medium">加载推荐理由失败</div>
            <div className="text-sm">{(error as Error)?.message ?? '来源不可用或已过期'}</div>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card variant="outlined" className={cn('w-full', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-500" />
              TRIZ 推荐理由
            </CardTitle>
            <CardDescription>查看该建议的依据与证据链</CardDescription>
          </div>
          <HandoffButton projectId={projectId} targetType={targetType} targetId={targetId} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Rule/AI distinction */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-xs">
            {rationale.sourceType === 'contradiction'
              ? '矛盾依据'
              : rationale.sourceType === 'analysis_artifact'
                ? '分析依据'
                : '推荐依据'}
          </Badge>
          {rationale.aiMetadata?.isAiGenerated ? (
            <Badge variant="warning" className="text-xs">
              AI 辅助说明
            </Badge>
          ) : (
            <Badge variant="info" className="text-xs">
              规则依据
            </Badge>
          )}
        </div>

        {/* Deterministic summary */}
        <div className="text-sm text-gray-700 dark:text-gray-300">
          {rationale.deterministicSummary}
        </div>

        {/* Warnings */}
        {rationale.warningSummary && (
          <Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
            <span className="text-sm">{rationale.warningSummary}</span>
          </Alert>
        )}

        {/* Source Summary */}
        <SourceSummarySection refs={rationale.sourceRefs} />

        {/* Parameter Tensions */}
        {rationale.availableSections.includes('parameter_tensions') &&
          rationale.parameterTensions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">参数矛盾</h4>
              {rationale.parameterTensions.map((t, i) => (
                <div key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                  <Badge variant="info" className="text-xs">
                    {t.improvingParameterName}
                  </Badge>
                  <span className="text-muted-foreground">↔</span>
                  <Badge variant="danger" className="text-xs">
                    {t.worseningParameterName}
                  </Badge>
                  <span className="text-xs text-muted-foreground">严重度: {t.severity}</span>
                </div>
              ))}
            </div>
          )}

        {/* Principle Mapping */}
        {rationale.availableSections.includes('principle_mapping') && (
          <PrincipleMappingSection mappings={rationale.principleMappings} />
        )}

        {/* Evidence Chain */}
        {rationale.availableSections.includes('evidence_chain') && (
          <EvidenceChainSection refs={rationale.evidenceRefs} />
        )}

        {/* AI / Fallback Explanation */}
        <AiExplanationSection
          aiDraft={rationale.aiExplanationDraft}
          fallback={rationale.fallbackSummary}
          validationStatus={rationale.aiMetadata?.validationStatus ?? null}
        />

        {/* Warnings List */}
        {rationale.validationSummary.warnings.length > 0 && (
          <ValidationSection warnings={rationale.validationSummary.warnings} />
        )}

        {/* Human review requirement */}
        {rationale.humanReviewRequirement && (
          <Alert variant="info" icon={<HelpCircle className="h-4 w-4" />}>
            <span className="text-sm">{rationale.humanReviewRequirement}</span>
          </Alert>
        )}

        {/* Feedback */}
        {rationale.availableSections.includes('feedback') && (
          <FeedbackControls projectId={projectId} targetType={targetType} targetId={targetId} />
        )}
      </CardContent>
    </Card>
  )
}

export default TrizRationalePanel
