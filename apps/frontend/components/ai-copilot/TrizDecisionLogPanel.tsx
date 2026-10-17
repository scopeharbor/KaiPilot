'use client'

import React, { useState } from 'react'
import {
  Award,
  Plus,
  FileEdit,
  Clock,
  User,
  AlertCircle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RefreshCw,
  Sparkles,
  Loader2,
  Braces,
  History,
  Inbox,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/hooks/use-permissions'
import {
  useTrizDecisionSubjectLookup,
  useCreateTrizDecisionLog,
  useTrizDecisionAiDraft,
} from '@/hooks/use-triz-decision-log'
import type {
  TrizDecisionLogEntry,
  TrizDecisionSubjectRef,
  TrizDecisionSourceRef,
} from '@aiproj/types'
import { TRIZ_DECISION_TYPES, requiresSourceRefs } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrizDecisionLogPanelProps {
  /** 项目 ID。 */
  projectId: number
  /** 决策主题 ref（矛盾/artifact/draft 等）。 */
  subjectRef: TrizDecisionSubjectRef
  /** 可选的预填充来源 refs。 */
  sourceRefs?: TrizDecisionSourceRef[]
  /** 可选的决策创建回调（用于父组件追踪变更）。 */
  onDecisionCreated?: () => void
}

interface CreateFormState {
  decisionType: string
  reasonSummary: string
  alternativeSummary: string
  isGeneratingDraft: boolean
}

const INITIAL_FORM_STATE: CreateFormState = {
  decisionType: '',
  reasonSummary: '',
  alternativeSummary: '',
  isGeneratingDraft: false,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const decisionTypeMeta: Record<
  string,
  {
    label: string
    badgeVariant: 'success' | 'danger' | 'warning' | 'info' | 'neutral'
    icon: LucideIcon
  }
> = {
  adopt: { label: '采纳', badgeVariant: 'success', icon: CheckCircle2 },
  reject: { label: '驳回', badgeVariant: 'danger', icon: XCircle },
  partial_accept: { label: '部分采纳', badgeVariant: 'warning', icon: AlertCircle },
  modified_accept: { label: '修改后采纳', badgeVariant: 'info', icon: FileEdit },
  clarification_requested: { label: '请求补充说明', badgeVariant: 'neutral', icon: HelpCircle },
  supersede: { label: '废止', badgeVariant: 'danger', icon: RefreshCw },
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ts
  }
}

// ---------------------------------------------------------------------------
// Skeleton loading
// ---------------------------------------------------------------------------

function DecisionLogSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="加载决策日志中">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Decision type badge
// ---------------------------------------------------------------------------

function DecisionTypeBadge({ decisionType }: { decisionType: string }) {
  const meta = decisionTypeMeta[decisionType] ?? {
    label: decisionType,
    badgeVariant: 'neutral' as const,
    icon: HelpCircle,
  }
  const Icon = meta.icon
  return (
    <Badge variant={meta.badgeVariant} className="gap-1">
      <Icon className="w-3 h-3" />
      {meta.label}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Single decision entry
// ---------------------------------------------------------------------------

interface DecisionEntryProps {
  entry: TrizDecisionLogEntry
  projectId: number
  onSupersede: () => void
}

function DecisionEntry({ entry, projectId: _projectId, onSupersede }: DecisionEntryProps) {
  const { can } = usePermissions()
  const canManage = can('triz_decision:manage')
  const isActive = entry.decisionStatus === 'active'
  const hasSourceRefs = entry.sourceRefs.length > 0

  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-2 transition-colors',
        !isActive && 'opacity-60 bg-gray-50 dark:bg-gray-900',
      )}
      role="listitem"
      aria-label={`决策: ${entry.decisionType}`}
    >
      {/* Header: decision type + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DecisionTypeBadge decisionType={entry.decisionType} />
          {!isActive && (
            <Badge variant="outline" className="text-xs">
              已废止
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Supersede button — only for active, non-terminal decisions */}
          {canManage &&
            isActive &&
            entry.decisionType !== 'reject' &&
            entry.decisionType !== 'adopt' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSupersede}
                className="text-xs text-muted-foreground"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                废止
              </Button>
            )}
        </div>
      </div>

      {/* Reason summary */}
      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
        {entry.reasonSummary}
      </p>

      {/* Alternative summary */}
      {entry.alternativeSummary && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">备选方案：</span>
          {entry.alternativeSummary}
        </p>
      )}

      {/* Source refs */}
      {hasSourceRefs && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">
            <span className="inline-flex items-center gap-1">
              <Braces className="w-3 h-3" />
              来源引用 ({entry.sourceRefs.length})
            </span>
          </summary>
          <ul className="mt-1 space-y-1 pl-4 list-disc">
            {entry.sourceRefs.map((ref, i) => (
              <li key={i}>
                <span className="font-medium">{ref.kind}</span>
                {ref.summary && <span> — {ref.summary}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Timestamp + actor */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTimestamp(entry.createdAt)}
        </span>
        <span className="inline-flex items-center gap-1">
          <User className="w-3 h-3" />#{entry.createdBy}
        </span>
        {entry.supersedesDecisionLogId && (
          <span className="inline-flex items-center gap-1">
            <History className="w-3 h-3" />
            前置决策 #{entry.supersedesDecisionLogId}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create decision form (within Dialog)
// ---------------------------------------------------------------------------

interface CreateDecisionDialogProps {
  projectId: number
  subjectRef: TrizDecisionSubjectRef
  sourceRefs: TrizDecisionSourceRef[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

function CreateDecisionDialog({
  projectId,
  subjectRef,
  sourceRefs,
  open,
  onOpenChange,
  onSuccess,
}: CreateDecisionDialogProps) {
  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM_STATE)
  const createMutation = useCreateTrizDecisionLog(projectId)
  const draftMutation = useTrizDecisionAiDraft(projectId)

  const isFormValid = !!form.decisionType && form.reasonSummary.trim().length > 0

  const handleSubmit = async () => {
    if (!isFormValid) return

    const sourceRefsPayload = requiresSourceRefs(
      form.decisionType as (typeof TRIZ_DECISION_TYPES)[number],
    )
      ? sourceRefs
      : []

    await createMutation.mutateAsync({
      decisionType: form.decisionType as (typeof TRIZ_DECISION_TYPES)[number],
      subjectRefs: [subjectRef],
      sourceRefs: sourceRefsPayload,
      artifactHashes: [],
      reasonSummary: form.reasonSummary.trim(),
      alternativeSummary: form.alternativeSummary.trim() || null,
    })

    setForm(INITIAL_FORM_STATE)
    onOpenChange(false)
    onSuccess()
  }

  const handleGenerateDraft = async () => {
    if (!form.decisionType) return
    setForm((prev) => ({ ...prev, isGeneratingDraft: true }))

    try {
      const result = await draftMutation.mutateAsync({
        subjectRefs: [subjectRef],
        sourceRefs,
        decisionType: form.decisionType as (typeof TRIZ_DECISION_TYPES)[number],
      })
      setForm((prev) => ({
        ...prev,
        reasonSummary: result.draftReason,
        isGeneratingDraft: false,
      }))
    } catch {
      setForm((prev) => ({ ...prev, isGeneratingDraft: false }))
    }
  }

  const decisionTypeOptions = TRIZ_DECISION_TYPES.filter(
    (t) => t !== 'supersede', // supersede only used via the dedicated action
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="w-5 h-5 text-purple-500" />
            创建 TRIZ 决策
          </DialogTitle>
          <DialogDescription>
            记录对当前 TRIZ 矛盾的决策。AI 可辅助生成理由草稿，最终由您确认。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Decision Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">决策类型 *</label>
            <Select
              value={form.decisionType}
              onValueChange={(val) => setForm((prev) => ({ ...prev, decisionType: val }))}
            >
              <SelectTrigger aria-label="选择决策类型">
                <SelectValue placeholder="请选择决策类型" />
              </SelectTrigger>
              <SelectContent>
                {decisionTypeOptions.map((type) => {
                  const meta = decisionTypeMeta[type] ?? {
                    label: type,
                    badgeVariant: 'neutral' as const,
                    icon: HelpCircle,
                  }
                  const Icon = meta.icon
                  return (
                    <SelectItem key={type} value={type}>
                      <span className="flex items-center gap-2">
                        <Icon className="w-4 h-4" />
                        {meta.label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Reason Summary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">理由摘要 *</label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGenerateDraft}
                disabled={!form.decisionType || form.isGeneratingDraft}
                className="text-xs"
                type="button"
              >
                {form.isGeneratingDraft ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3 mr-1" />
                )}
                AI 辅助生成
              </Button>
            </div>
            <Textarea
              value={form.reasonSummary}
              onChange={(e) => setForm((prev) => ({ ...prev, reasonSummary: e.target.value }))}
              placeholder="请输入决策理由摘要（低敏信息）"
              rows={4}
            />
          </div>

          {/* Alternative Summary */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">备选方案摘要（可选）</label>
            <Textarea
              value={form.alternativeSummary}
              onChange={(e) => setForm((prev) => ({ ...prev, alternativeSummary: e.target.value }))}
              placeholder="如有备选方案，请简要描述"
              rows={2}
            />
          </div>

          {createMutation.isError && <Alert variant="danger">创建决策失败，请重试。</Alert>}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <DialogClose asChild>
            <Button variant="secondary">取消</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!isFormValid || createMutation.isPending}
            loading={createMutation.isPending}
          >
            确认创建
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

/**
 * TRIZ 矛盾详情决策日志面板。
 *
 * 展示指定 subject 的已有决策日志、允许创建新决策、废止旧决策。
 * 无 manage 权限时隐藏创建/废止操作按钮。
 */
export function TrizDecisionLogPanel({
  projectId,
  subjectRef,
  sourceRefs = [],
  onDecisionCreated,
}: TrizDecisionLogPanelProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const { can } = usePermissions()
  const canManage = can('triz_decision:manage')

  const {
    data: lookupResult,
    isLoading,
    isError,
    error,
    refetch,
  } = useTrizDecisionSubjectLookup(projectId, subjectRef.kind, subjectRef.id)

  const decisions = lookupResult ?? []

  const handleDecisionCreated = () => {
    refetch()
    onDecisionCreated?.()
  }

  const handleSupersede = () => {
    refetch()
    onDecisionCreated?.()
  }

  return (
    <Card variant="outlined" className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Award className="w-4 h-4 text-purple-500" />
              TRIZ 决策日志
            </CardTitle>
            <CardDescription>记录对本矛盾的决策历史与理由追溯</CardDescription>
          </div>

          {/* Create button — only with manage permission */}
          {canManage && (
            <Button variant="primary" size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              创建决策
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Loading state */}
        {isLoading && <DecisionLogSkeleton />}

        {/* Error state */}
        {isError && !isLoading && (
          <Alert variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
            <div className="font-medium">加载决策日志失败</div>
            <div className="text-sm">{(error as Error)?.message ?? '请稍后重试'}</div>
          </Alert>
        )}

        {/* Empty state */}
        {!isLoading && !isError && decisions.length === 0 && (
          <EmptyState
            icon={Inbox}
            title="暂无决策记录"
            description="对该主题尚未记录任何 TRIZ 决策。"
          />
        )}

        {/* Decision list */}
        {!isLoading && !isError && decisions.length > 0 && (
          <div className="space-y-3" role="list" aria-label="决策日志列表">
            {decisions.map((entry: TrizDecisionLogEntry) => (
              <DecisionEntry
                key={entry.id}
                entry={entry}
                projectId={projectId}
                onSupersede={() => handleSupersede()}
              />
            ))}
          </div>
        )}
      </CardContent>

      {/* Create decision dialog */}
      {canManage && (
        <CreateDecisionDialog
          projectId={projectId}
          subjectRef={subjectRef}
          sourceRefs={sourceRefs}
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onSuccess={handleDecisionCreated}
        />
      )}
    </Card>
  )
}

export default TrizDecisionLogPanel
