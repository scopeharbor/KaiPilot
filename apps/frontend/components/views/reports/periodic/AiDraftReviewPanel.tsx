'use client'

import { useState, type ChangeEvent } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Sparkles,
  ArrowLeft,
  FileEdit,
  RefreshCw,
  Download,
  Plus,
  Trash2,
} from 'lucide-react'
import { AiCard } from '@/components/ui/AiCard'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Separator } from '@/components/ui/Separator'
import { Textarea } from '@/components/ui/Textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import type {
  AiPeriodicDraft,
  ReportAiReviewStatus,
  PeriodComparison,
  V2ReportExportFormat,
} from '@aiproj/types'

/**
 * AiDraftReviewPanel —— AI 周期报表草稿审核面板。
 *
 * 展示全部 8 个草稿章节为可编辑字段，高亮列表、建议行动列表支持增删。
 * 含确认弹窗、退回原因对话框、Toast 通知回调。
 */

// ---------------------------------------------------------------------------
// 代费摘要类型
// ---------------------------------------------------------------------------

export interface CostSummaryBadge {
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  estimatedCost: number
  latencyMs: number
  budgetVerdict: 'passed' | 'hard_blocked' | 'soft_warning'
}

// ---------------------------------------------------------------------------
// 权限映射
// ---------------------------------------------------------------------------

export interface ReviewPermissions {
  canConfirm: boolean
  canReturn: boolean
  canEdit: boolean
  canRegenerate: boolean
  canExport: boolean
}

// ---------------------------------------------------------------------------
// 警告类型
// ---------------------------------------------------------------------------

export interface ReviewWarning {
  level: 'info' | 'warning' | 'critical'
  message: string
  code?: string
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AiDraftReviewPanelProps {
  /** AI 草稿内容 */
  draft: AiPeriodicDraft | null
  /** 审核状态 */
  reviewStatus: ReportAiReviewStatus | null
  /** 警告列表 */
  warnings: ReviewWarning[]
  /** 代费摘要 */
  costSummary: CostSummaryBadge | null
  /** 周期对比 */
  periodComparison: PeriodComparison | null
  /** 权限 */
  permissions: ReviewPermissions
  /** 操作回调 */
  onConfirm: () => void
  onReturn: (reason: string) => void
  onEdit: (editedDraft: AiPeriodicDraft) => void
  onRegenerate?: () => void
  onExport?: (format: V2ReportExportFormat) => void
  /** 加载态 */
  isLoading?: boolean
  isSaving?: boolean
  isRegenerating?: boolean
  /** 错误 */
  error?: Error | null
}

// ---------------------------------------------------------------------------
// 章节配置
// ---------------------------------------------------------------------------

interface DraftSectionMeta {
  key: keyof AiPeriodicDraft
  title: string
  type: 'text' | 'list'
  placeholder?: string
}

const DRAFT_SECTIONS: DraftSectionMeta[] = [
  { key: 'executiveSummary', title: '管理摘要', type: 'text', placeholder: '输入管理摘要…' },
  { key: 'progressNarrative', title: '进度叙述', type: 'text', placeholder: '输入进度说明…' },
  { key: 'riskAndIssues', title: '风险与问题', type: 'text', placeholder: '输入风险与问题说明…' },
  { key: 'resourceNotes', title: '资源说明', type: 'text', placeholder: '输入资源分配说明…' },
  { key: 'changeNotes', title: '变更说明', type: 'text', placeholder: '输入变更记录…' },
  {
    key: 'dataWarningsNarrative',
    title: '数据限制说明',
    type: 'text',
    placeholder: '输入数据限制说明…',
  },
]

// ---------------------------------------------------------------------------
// 帮助函数
// ---------------------------------------------------------------------------

function deltaText(value: number, unit: string): { text: string; positive: boolean } {
  if (value > 0) return { text: `+${value} ${unit}`, positive: true }
  if (value < 0) return { text: `${value} ${unit}`, positive: false }
  return { text: `0 ${unit}`, positive: false }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function AiDraftReviewPanel({
  draft,
  reviewStatus,
  warnings,
  costSummary,
  periodComparison,
  permissions,
  onConfirm,
  onReturn,
  onEdit,
  onRegenerate,
  onExport,
  isLoading = false,
  isSaving = false,
  isRegenerating = false,
  error = null,
}: AiDraftReviewPanelProps) {
  // 编辑状态
  const [isEditing, setIsEditing] = useState(false)
  const [editedDraft, setEditedDraft] = useState<AiPeriodicDraft | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [exportOpen, setExportOpen] = useState(false)

  // 初始化编辑副本
  function startEditing() {
    if (!draft) return
    setEditedDraft(JSON.parse(JSON.stringify(draft)) as AiPeriodicDraft)
    setIsEditing(true)
  }

  function cancelEditing() {
    setEditedDraft(null)
    setIsEditing(false)
  }

  function saveEditing() {
    if (!editedDraft) return
    onEdit(editedDraft)
    setIsEditing(false)
  }

  // 处理退回
  function handleReturn() {
    setReturnOpen(false)
    onReturn(returnReason)
    setReturnReason('')
  }

  // 确定当前显示的草稿
  const displayDraft = isEditing ? editedDraft : draft
  const hasEditPermission = permissions.canEdit
  const isConfirmed = reviewStatus === 'confirmed'

  // 加载态
  if (isLoading) {
    return (
      <div className="space-y-4 rounded-lg border border-border bg-white p-5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
    )
  }

  // 错误态
  if (error && !draft) {
    return (
      <div className="rounded-lg border border-border bg-white p-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertOctagon className="h-8 w-8 text-danger" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-gray-800">加载草稿失败</h3>
            <p className="mt-1 text-sm text-gray-500">{error.message}</p>
          </div>
        </div>
      </div>
    )
  }

  // 空态
  if (!draft) {
    return (
      <div className="rounded-lg border border-border bg-white p-5">
        <EmptyState
          icon={FileEdit}
          title="暂无草稿"
          description="选择一个 AI 周期报表模板并生成后，草稿将在此处显示"
        />
      </div>
    )
  }

  // 已确认态：只读展示
  if (isConfirmed) {
    return (
      <AiCard chipLabel="已确认草稿" className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          <span className="font-medium">此草稿已确认并生效</span>
        </div>

        {/* 章节只读展示 */}
        {DRAFT_SECTIONS.map((section) => {
          const content = displayDraft?.[section.key] as string | undefined
          if (!content) return null
          return (
            <div key={section.key}>
              <h4 className="mb-1 text-sm font-semibold text-gray-800">{section.title}</h4>
              <p className="whitespace-pre-wrap text-sm text-gray-700">{content}</p>
            </div>
          )
        })}

        {/* 亮点列表 */}
        {displayDraft && displayDraft.highlights.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-semibold text-gray-800">亮点</h4>
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
              {displayDraft.highlights.map((item: string, i: number) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 建议行动 */}
        {displayDraft && displayDraft.suggestedActions.length > 0 && (
          <div>
            <h4 className="mb-1 text-sm font-semibold text-gray-800">建议行动</h4>
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
              {displayDraft.suggestedActions.map((action: string, i: number) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 代费摘要 */}
        {costSummary && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
            <Badge variant="outline">{costSummary.model}</Badge>
            <span>代费：${costSummary.estimatedCost.toFixed(4)}</span>
            <span>延迟：{costSummary.latencyMs}ms</span>
          </div>
        )}

        {/* 导出按钮 */}
        {permissions.canExport && onExport && (
          <div className="flex justify-end border-t border-border pt-4">
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              <Download className="mr-1 h-4 w-4" />
              导出
            </Button>
          </div>
        )}

        {/* 导出格式选择弹窗 */}
        <ExportFormatDialog open={exportOpen} onOpenChange={setExportOpen} onExport={onExport} />
      </AiCard>
    )
  }

  return (
    <AiCard chipLabel="AI 草稿审核" className="space-y-4">
      {/* 头部：审核状态 */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ai" aria-hidden />
          <h3 className="text-md font-semibold text-gray-900">草稿审核</h3>
          {reviewStatus && (
            <Badge variant={reviewStatusBadgeVariant(reviewStatus)}>
              {reviewStatusLabel(reviewStatus)}
            </Badge>
          )}
        </div>
      </div>

      {/* 审核状态提示 */}
      {reviewStatus === 'rejected' && (
        <div className="flex items-center gap-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>此草稿已被退回，请编辑后重新提交审核</span>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          <AlertOctagon className="h-4 w-4 shrink-0" aria-hidden />
          <span>{error.message}</span>
        </div>
      )}

      {/* 周期对比摘要 */}
      {periodComparison && (
        <div className="rounded-md bg-primary-50 p-3">
          <h4 className="mb-1.5 text-xs font-semibold text-primary-700">周期对比</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <ComparisonItem label="完成项" {...deltaText(periodComparison.completedDelta, '项')} />
            <ComparisonItem label="延期项" {...deltaText(periodComparison.overdueDelta, '项')} />
            <ComparisonItem label="风险项" {...deltaText(periodComparison.riskDelta, '项')} />
            <ComparisonItem label="资源" {...deltaText(periodComparison.resourceDelta, '人')} />
            <ComparisonItem label="变更" {...deltaText(periodComparison.changeDelta, '项')} />
            <ComparisonItem label="活动" {...deltaText(periodComparison.activityDelta, '项')} />
            <div className="col-span-2 flex gap-2">
              <span className="text-gray-500">完成率：</span>
              <span className="font-medium text-gray-800">
                {periodComparison.currentCompletionRate}%
              </span>
              <span className="text-gray-400">
                （上期 {periodComparison.previousCompletionRate}%）
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w: ReviewWarning, i: number) => (
            <div
              key={i}
              className={cn(
                'flex items-start gap-2 rounded-md px-3 py-2 text-sm',
                w.level === 'critical' && 'bg-danger-bg text-danger',
                w.level === 'warning' && 'bg-warning-bg text-warning',
                w.level === 'info' && 'bg-info-bg text-info',
              )}
            >
              {w.level === 'critical' && <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" />}
              {(w.level === 'warning' || w.level === 'info') && (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      <Separator />

      {/* 草稿章节：编辑模式或只读模式 */}
      {isEditing && editedDraft ? (
        <EditingModeContent
          editedDraft={editedDraft}
          setEditedDraft={setEditedDraft}
          onCancel={cancelEditing}
          onSave={saveEditing}
          isSaving={isSaving}
        />
      ) : (
        <>
          {/* 只读模式：文本章节 */}
          {DRAFT_SECTIONS.map((section) => {
            const content = displayDraft?.[section.key] as string | undefined
            if (!content) {
              return (
                <div key={section.key}>
                  <h4 className="mb-1 text-sm font-semibold text-gray-800">{section.title}</h4>
                  <p className="text-sm italic text-gray-400">（空）</p>
                </div>
              )
            }
            return (
              <div key={section.key}>
                <h4 className="mb-1 text-sm font-semibold text-gray-800">{section.title}</h4>
                <p className="whitespace-pre-wrap text-sm text-gray-700">{content}</p>
              </div>
            )
          })}

          {/* 只读模式：亮点列表 */}
          {displayDraft && displayDraft.highlights.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-gray-800">亮点</h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
                {displayDraft.highlights.map((item: string, i: number) => (
                  <li key={i}>{item || '（空）'}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 只读模式：建议行动列表 */}
          {displayDraft && displayDraft.suggestedActions.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold text-gray-800">建议行动</h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
                {displayDraft.suggestedActions.map((action: string, i: number) => (
                  <li key={i}>{action || '（空）'}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 代费摘要 */}
          {costSummary && (
            <div className="flex flex-wrap gap-2 text-xs text-gray-500">
              <Badge variant="outline">{costSummary.model}</Badge>
              <span>代费：${costSummary.estimatedCost.toFixed(4)}</span>
              <span>延迟：{costSummary.latencyMs}ms</span>
              <span>输入：{costSummary.promptTokens} tokens</span>
              <span>输出：{costSummary.completionTokens} tokens</span>
            </div>
          )}

          <Separator />

          {/* 操作按钮 */}
          <ReadModeActions
            permissions={permissions}
            onRegenerate={onRegenerate}
            isRegenerating={isRegenerating}
            onStartEditing={startEditing}
            hasEditPermission={hasEditPermission}
            onOpenReturn={() => setReturnOpen(true)}
            isSaving={isSaving}
            onOpenConfirm={() => setConfirmOpen(true)}
            onOpenExport={() => setExportOpen(true)}
          />
        </>
      )}

      {/* 确认弹窗 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认草稿</DialogTitle>
            <DialogDescription>
              确认后草稿将生效并可用于导出。确认后如需再次修改需要重新生成。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setConfirmOpen(false)
                onConfirm()
              }}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 退回原因弹窗 */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>退回草稿</DialogTitle>
            <DialogDescription>请说明退回原因，以便后续修改。</DialogDescription>
          </DialogHeader>
          <Textarea
            value={returnReason}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReturnReason(e.target.value)}
            placeholder="输入退回原因…"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReturnOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleReturn}
              disabled={!returnReason.trim()}
            >
              退回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导出格式选择弹窗 */}
      <ExportFormatDialog open={exportOpen} onOpenChange={setExportOpen} onExport={onExport} />
    </AiCard>
  )
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function reviewStatusBadgeVariant(
  status: ReportAiReviewStatus,
): 'warning' | 'info' | 'success' | 'danger' | 'neutral' {
  switch (status) {
    case 'pending_review':
      return 'warning'
    case 'editing':
      return 'info'
    case 'confirmed':
      return 'success'
    case 'rejected':
      return 'danger'
    default:
      return 'neutral'
  }
}

function reviewStatusLabel(status: ReportAiReviewStatus): string {
  switch (status) {
    case 'pending_review':
      return '待审核'
    case 'editing':
      return '编辑中'
    case 'confirmed':
      return '已确认'
    case 'rejected':
      return '已退回'
    default:
      return status
  }
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

function ComparisonItem({
  label,
  text,
  positive,
}: {
  label: string
  text: string
  positive: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-gray-500">{label}：</span>
      <span className={cn('font-medium', positive ? 'text-success' : 'text-danger')}>{text}</span>
    </div>
  )
}

function ExportFormatDialog({
  open,
  onOpenChange,
  onExport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExport?: (format: V2ReportExportFormat) => void
}) {
  const FORMATS: { value: V2ReportExportFormat; label: string }[] = [
    { value: 'markdown', label: 'Markdown' },
    { value: 'csv', label: 'CSV' },
    { value: 'pdf', label: 'PDF' },
    { value: 'xlsx', label: 'XLSX' },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>选择导出格式</DialogTitle>
          <DialogDescription>选择所需的导出格式，系统将生成对应文件。</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {FORMATS.map((fmt: { value: V2ReportExportFormat; label: string }) => (
            <button
              key={fmt.value}
              type="button"
              onClick={() => {
                onOpenChange(false)
                onExport?.(fmt.value)
              }}
              className="rounded-[var(--radius-md)] border border-border px-4 py-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50"
            >
              <div className="text-sm font-medium text-gray-800">{fmt.label}</div>
              <div className="mt-0.5 text-[11px] uppercase text-gray-500">{fmt.value}</div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 编辑模式内容块 */
function EditingModeContent({
  editedDraft,
  setEditedDraft,
  onCancel,
  onSave,
  isSaving,
}: {
  editedDraft: AiPeriodicDraft
  setEditedDraft: (draft: AiPeriodicDraft) => void
  onCancel: () => void
  onSave: () => void
  isSaving: boolean
}) {
  return (
    <>
      {/* 编辑模式：文本章节 */}
      {DRAFT_SECTIONS.map((section) => (
        <div key={section.key}>
          <h4 className="mb-1 text-sm font-semibold text-gray-800">{section.title}</h4>
          <Textarea
            value={(editedDraft[section.key] as string) ?? ''}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setEditedDraft({ ...editedDraft, [section.key]: e.target.value })
            }
            placeholder={section.placeholder}
            rows={3}
          />
        </div>
      ))}

      {/* 编辑模式：亮点列表 */}
      <div>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-800">亮点</h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditedDraft({
                ...editedDraft,
                highlights: [...editedDraft.highlights, ''],
              })
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加
          </Button>
        </div>
        <div className="mt-1 space-y-2">
          {editedDraft.highlights.map((item: string, i: number) => (
            <div key={i} className="flex items-start gap-2">
              <Textarea
                value={item}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                  const list = [...editedDraft.highlights]
                  list[i] = e.target.value
                  setEditedDraft({ ...editedDraft, highlights: list })
                }}
                placeholder="输入亮点…"
                rows={1}
                className="min-h-0"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const list = [...editedDraft.highlights]
                  list.splice(i, 1)
                  setEditedDraft({ ...editedDraft, highlights: list })
                }}
                aria-label="删除亮点"
              >
                <Trash2 className="h-4 w-4 text-gray-400 hover:text-danger" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* 编辑模式：建议行动列表 */}
      <div>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-800">建议行动</h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditedDraft({
                ...editedDraft,
                suggestedActions: [...editedDraft.suggestedActions, ''],
              })
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            添加
          </Button>
        </div>
        <div className="mt-1 space-y-2">
          {editedDraft.suggestedActions.map((action: string, i: number) => (
            <div key={i} className="flex items-start gap-2">
              <Textarea
                value={action}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
                  const list = [...editedDraft.suggestedActions]
                  list[i] = e.target.value
                  setEditedDraft({ ...editedDraft, suggestedActions: list })
                }}
                placeholder="输入建议行动…"
                rows={1}
                className="min-h-0"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const list = [...editedDraft.suggestedActions]
                  list.splice(i, 1)
                  setEditedDraft({ ...editedDraft, suggestedActions: list })
                }}
                aria-label="删除建议行动"
              >
                <Trash2 className="h-4 w-4 text-gray-400 hover:text-danger" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* 编辑模式按钮 */}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
          取消
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} loading={isSaving}>
          {isSaving ? '保存中…' : '保存编辑'}
        </Button>
      </div>
    </>
  )
}

/** 只读模式操作按钮组 */
function ReadModeActions({
  permissions,
  onRegenerate,
  isRegenerating,
  onStartEditing,
  hasEditPermission,
  onOpenReturn,
  isSaving,
  onOpenConfirm,
  onOpenExport,
}: {
  permissions: ReviewPermissions
  onRegenerate?: () => void
  isRegenerating: boolean
  onStartEditing: () => void
  hasEditPermission: boolean
  onOpenReturn: () => void
  isSaving: boolean
  onOpenConfirm: () => void
  onOpenExport: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/* 重新生成 */}
      {permissions.canRegenerate && onRegenerate && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRegenerate}
          disabled={isRegenerating}
          loading={isRegenerating}
        >
          <RefreshCw className="mr-1 h-4 w-4" />
          重新生成
        </Button>
      )}

      {/* 编辑 */}
      {hasEditPermission && (
        <Button variant="outline" size="sm" onClick={onStartEditing}>
          <FileEdit className="mr-1 h-4 w-4" />
          编辑
        </Button>
      )}

      {/* 退回 */}
      {permissions.canReturn && (
        <Button variant="outline" size="sm" onClick={onOpenReturn} disabled={isSaving}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          退回
        </Button>
      )}

      {/* 确认 */}
      {permissions.canConfirm && (
        <Button
          variant="primary"
          size="sm"
          onClick={onOpenConfirm}
          disabled={isSaving}
          loading={isSaving}
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          确认
        </Button>
      )}

      {/* 导出 */}
      {permissions.canExport && (
        <Button variant="secondary" size="sm" onClick={onOpenExport}>
          <Download className="mr-1 h-4 w-4" />
          导出
        </Button>
      )}
    </div>
  )
}
