'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BellOff,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import {
  usePmoRecommendationDetail,
  useUpdatePmoRecommendationStatus,
} from '@/hooks/use-pmo-ai-priority-recommendations'
import { cn } from '@/lib/utils'
import type { PmoConversionTarget, PmoRecommendationRecord, PmoReviewAction } from '@aiproj/types'
import {
  PMO_AI_STATUS_LABELS,
  PMO_CONVERSION_TARGETS,
  PMO_RECOMMENDATION_TRANSITIONS,
  RECOMMENDATION_SEVERITY_LABELS,
  RECOMMENDATION_STATUS_LABELS,
} from '@aiproj/types'
import {
  AI_STATUS_CHIP,
  REC_SEVERITY_CHIP,
  REC_STATUS_CHIP,
  formatNxDateTime,
  sourceLabelOf,
  useCanReviewPmoRecommendations,
} from './PmoAiRecommendationList'
import { PmoAiRationaleModal } from './PmoAiRationaleModal'

/**
 * PMO AI 优先级推荐详情与人工审阅面板（v3-ui-next-pmo-domain W5 · tasks 5.3，
 * spec「PMO AI 优先级推荐建议-审阅-采纳闭环」）。
 *
 * - 详情查询 `usePmoRecommendationDetail(id)`（GET …/:id，信封 {record,
 *   sourceWarnings, conversionIntents}），完整回显来源维度（sourceSignals）、
 *   证据引用（evidenceRefs）与警告；面板自带骨架/错误重试三态；
 * - 人工审阅动作：accept / dismiss / snooze 单项确认、convert 需选目标引用
 *   （PMO_CONVERSION_TARGETS 闭集）并填写说明后提交，全部经
 *   `useUpdatePmoRecommendationStatus` → POST …/:id/status 人工触发（RL-01：
 *   零自动采纳）；动作可用性按 PMO_RECOMMENDATION_TRANSITIONS 状态机收敛；
 *   成功即失效 ['pmo','ai-priority-recommendations'] 缓存（hook 内联）；
 *   失败回显服务端错误、保留输入不静默（design D4）；
 * - 动作入口按 design D5 降级链显隐（useCanReviewPmoRecommendations），
 *   无管理权限的用户物理看不到任何写按钮（RL-06）；
 * - AI 理由经 PmoAiRationaleModal 显式触发（独立浮层文件）。
 */

const PRIORITY_LEVEL_LABELS: Record<string, string> = {
  critical: '关键',
  high: '高',
  medium: '中',
  low: '低',
  unavailable: '不可用',
}

export const CONVERSION_TARGET_LABELS: Record<PmoConversionTarget, string> = {
  risk: '风险登记',
  change_request: '变更请求',
  resource_preview: '资源预览',
  draft_layer: '草稿层',
  project_priority_review: '项目优先级复核',
}

type ReviewKind = Extract<PmoReviewAction, 'accept' | 'dismiss' | 'snooze' | 'convert'>

const REVIEW_ACTION_META: Array<{
  kind: ReviewKind
  label: string
  target: PmoRecommendationRecord['status']
  icon: typeof BadgeCheck
}> = [
  { kind: 'accept', label: '接受', target: 'accepted', icon: BadgeCheck },
  { kind: 'dismiss', label: '忽略', target: 'dismissed', icon: BellOff },
  { kind: 'snooze', label: '稍后处理', target: 'snoozed', icon: Clock },
  { kind: 'convert', label: '转化为动作', target: 'converted', icon: ArrowRight },
]

export interface PmoAiRecommendationDetailPanelProps {
  id: number
  onClose: () => void
}

export function PmoAiRecommendationDetailPanel({
  id,
  onClose,
}: PmoAiRecommendationDetailPanelProps) {
  const canReview = useCanReviewPmoRecommendations()
  const detailResult = usePmoRecommendationDetail(id)
  const statusMutation = useUpdatePmoRecommendationStatus(id)

  const [pendingAction, setPendingAction] = React.useState<ReviewKind | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [rationaleOpen, setRationaleOpen] = React.useState(false)

  const record = detailResult.data?.data?.record

  const submitAction = React.useCallback(
    (
      kind: ReviewKind,
      body: {
        snoozeUntil?: string
        reason?: string
        convertTarget?: PmoConversionTarget
        convertParams?: Record<string, unknown>
      },
    ) => {
      setActionError(null)
      const payload = {
        action: kind as PmoReviewAction,
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        ...(body.snoozeUntil !== undefined ? { snoozeUntil: body.snoozeUntil } : {}),
        ...(body.convertTarget !== undefined
          ? { convertTarget: body.convertTarget, convertParams: body.convertParams ?? {} }
          : {}),
      }
      statusMutation.mutate(payload, {
        onSuccess: () => setPendingAction(null),
        onError: (error) => {
          setActionError(error instanceof Error ? error.message : '操作失败，请稍后重试')
        },
      })
    },
    [statusMutation],
  )

  if (detailResult.isPending || (detailResult.isFetching && !record)) {
    return (
      <div
        data-pmo-ai-detail-skeleton
        role="status"
        aria-label="正在加载推荐详情"
        aria-busy="true"
        className="flex min-h-[50vh] flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <div className="h-5 w-3/4 animate-pulse rounded bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-3 w-full animate-pulse rounded bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-24 animate-pulse rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-24 animate-pulse rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
      </div>
    )
  }

  if (detailResult.isError || !record) {
    return (
      <div
        data-pmo-ai-detail-error
        role="alert"
        aria-label="推荐详情加载错误"
        className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-6 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-xs text-[var(--nx-text-secondary)]">
          推荐详情加载失败：该推荐可能已不存在或暂无访问权限。
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-pmo-ai-detail-retry
            onClick={() => void detailResult.refetch()}
            className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            重新加载
          </button>
          <button
            type="button"
            data-pmo-ai-detail-close
            onClick={onClose}
            className="h-7 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            关闭
          </button>
        </div>
      </div>
    )
  }

  const stale = record.stale
  const transitions = PMO_RECOMMENDATION_TRANSITIONS[record.status] ?? []
  const reviewActions = REVIEW_ACTION_META.filter(({ target }) => transitions.includes(target))

  return (
    <aside
      data-pmo-ai-detail
      aria-label="推荐详情与审阅"
      className="flex min-w-0 flex-col gap-3 self-start rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      {/* 面板头 */}
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">推荐详情</h3>
        <button
          type="button"
          data-pmo-ai-detail-close
          aria-label="关闭推荐详情"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      {/* 推荐摘要 */}
      <section className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span
            data-pmo-ai-detail-severity
            className={cn(
              'rounded-sm border px-1.5 py-0.5',
              REC_SEVERITY_CHIP[record.severity] ?? REC_SEVERITY_CHIP.info,
            )}
          >
            {RECOMMENDATION_SEVERITY_LABELS[record.severity] ?? record.severity}
          </span>
          <span
            data-pmo-ai-detail-status
            className={cn(
              'rounded-sm border px-1.5 py-0.5',
              REC_STATUS_CHIP[record.status] ?? REC_STATUS_CHIP.expired,
            )}
          >
            {RECOMMENDATION_STATUS_LABELS[record.status] ?? record.status}
          </span>
          <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[var(--nx-text-secondary)]">
            {sourceLabelOf(record.sourceType)}
          </span>
          {stale ? (
            <span className="rounded-sm border border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.08)] px-1.5 py-0.5 text-[var(--nx-status-warning)]">
              数据过期
            </span>
          ) : null}
        </div>
        <p className="text-[13px] font-semibold leading-snug text-[var(--nx-text-primary)]">
          {record.title}
        </p>
        <p className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
          {record.summary}
        </p>
        {record.suggestedAction ? (
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            建议行动：{record.suggestedAction}
          </p>
        ) : null}
      </section>

      {/* 目标项目（TargetRef 语义：项目实体，跨景深下推） */}
      <section className="flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5 text-[11px]">
        <span className="text-[var(--nx-text-muted)]">目标引用</span>
        <Link
          href={`/next/projects/${record.projectId}`}
          data-pmo-ai-detail-project
          className="flex min-w-0 items-center gap-1 text-[var(--nx-accent)] transition-colors hover:text-[var(--nx-text-primary)]"
        >
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">项目 #{record.projectId}</span>
        </Link>
      </section>

      {/* 优先级上下文 */}
      <section className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3">
        <h4 className="text-[11px] font-medium text-[var(--nx-text-muted)]">优先级上下文</h4>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
          <div>
            <dt className="text-[10px] text-[var(--nx-text-muted)]">评分</dt>
            <dd className="mt-0.5 font-mono text-[var(--nx-text-primary)]">
              {record.priorityContext.priorityScore !== null
                ? record.priorityContext.priorityScore.toFixed(1)
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-[var(--nx-text-muted)]">等级</dt>
            <dd className="mt-0.5 text-[var(--nx-text-primary)]">
              {PRIORITY_LEVEL_LABELS[record.priorityContext.priorityLevel] ??
                record.priorityContext.priorityLevel}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-[var(--nx-text-muted)]">组织内排名</dt>
            <dd className="mt-0.5 font-mono text-[var(--nx-text-primary)]">
              {record.priorityContext.rank ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-[var(--nx-text-muted)]">权重版本</dt>
            <dd className="mt-0.5 font-mono text-[var(--nx-text-primary)]">
              {record.priorityContext.weightVersion ?? '—'}
            </dd>
          </div>
        </dl>
        {record.priorityContext.topDimensionContributors.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-[var(--nx-text-muted)]">关键贡献维度：</span>
            {record.priorityContext.topDimensionContributors.map((dimension) => (
              <span
                key={dimension}
                className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-secondary)]"
              >
                {dimension}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* AI 理由状态 + 显式触发入口 */}
      <section className="flex items-center justify-between gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--nx-accent)]" aria-hidden />
          <span className="text-[var(--nx-text-secondary)]">AI 理由</span>
          <span
            data-pmo-ai-detail-ai-status
            className={cn(
              'rounded-sm border px-1.5 py-0.5 text-[10px]',
              AI_STATUS_CHIP[record.aiStatus] ?? AI_STATUS_CHIP.none,
            )}
          >
            {PMO_AI_STATUS_LABELS[record.aiStatus] ?? record.aiStatus}
          </span>
        </div>
        {canReview ? (
          <button
            type="button"
            data-pmo-ai-rationale-open
            disabled={record.aiStatus === 'generating'}
            onClick={() => setRationaleOpen(true)}
            className="flex h-7 shrink-0 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
          >
            {record.aiStatus === 'generating' ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : null}
            {rationaleButtonLabel(record.aiStatus)}
          </button>
        ) : null}
      </section>

      {/* 来源信号 */}
      {record.sourceSignals.length > 0 ? (
        <section className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3">
          <h4 className="text-[11px] font-medium text-[var(--nx-text-muted)]">
            来源信号（{record.sourceSignals.length}）
          </h4>
          <ul className="mt-2 flex flex-col gap-1.5">
            {record.sourceSignals.map((signal, index) => (
              <li
                key={index}
                data-pmo-ai-detail-signal
                className={cn(
                  'rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1.5',
                  !signal.available && 'opacity-50',
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="font-mono text-[var(--nx-text-secondary)]">
                    {sourceLabelOf(signal.source)}
                  </span>
                  <span
                    className={cn(
                      'rounded-sm border px-1 py-px text-[9px]',
                      REC_SEVERITY_CHIP[signal.severity] ?? REC_SEVERITY_CHIP.info,
                    )}
                  >
                    {RECOMMENDATION_SEVERITY_LABELS[signal.severity] ?? signal.severity}
                  </span>
                  {!signal.available ? (
                    <span className="text-[var(--nx-text-muted)]">不可用</span>
                  ) : null}
                  {signal.stale ? (
                    <span className="text-[var(--nx-status-warning)]">信号过期</span>
                  ) : null}
                  {signal.refreshedAt ? (
                    <span className="ml-auto text-[var(--nx-text-muted)]">
                      {formatNxDateTime(signal.refreshedAt)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                  {signal.summary}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 证据引用 */}
      {record.evidenceRefs.length > 0 ? (
        <section className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3">
          <h4 className="text-[11px] font-medium text-[var(--nx-text-muted)]">
            证据引用（{record.evidenceRefs.length}）
          </h4>
          <ul className="mt-2 flex flex-col gap-1">
            {record.evidenceRefs.map((evidence, index) => (
              <li
                key={index}
                data-pmo-ai-detail-evidence
                className="flex items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1.5 text-[11px]"
              >
                <span className="truncate text-[var(--nx-text-secondary)]">
                  {evidence.visibility === 'forbidden' || !evidence.displaySummary
                    ? '证据已脱敏'
                    : evidence.displaySummary}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--nx-text-muted)]">
                  {evidence.entityType}#{evidence.entityId}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 警告 */}
      {detailResult.data.data.sourceWarnings.length > 0 ? (
        <section
          data-pmo-ai-detail-warnings
          role="note"
          className="rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2"
        >
          <h4 className="flex items-center gap-1 text-[11px] font-medium text-[var(--nx-status-warning)]">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            警告（{detailResult.data.data.sourceWarnings.length}）
          </h4>
          <ul className="mt-1 flex flex-col gap-0.5 text-[10px] text-[var(--nx-text-secondary)]">
            {detailResult.data.data.sourceWarnings.map((warning, index) => (
              <li key={index}>
                {warning.message}
                {warning.source ? `（${sourceLabelOf(warning.source)}）` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 人工审阅动作（RL-01：全部人工触发；manage 门禁） */}
      {canReview && reviewActions.length > 0 ? (
        <section
          data-pmo-ai-detail-actions
          className="flex flex-col gap-2 border-t border-[var(--nx-border-hairline)] pt-3"
        >
          {actionError ? (
            <div
              data-pmo-ai-action-error
              role="alert"
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {actionError}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {reviewActions.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                data-pmo-ai-action={kind}
                onClick={() => {
                  setActionError(null)
                  setPendingAction(kind)
                }}
                className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
              >
                <Icon className="h-3 w-3" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {record.handledAt ? (
        <p className="text-[10px] text-[var(--nx-text-muted)]">
          最近处理：{formatNxDateTime(record.handledAt)}
          {record.handledBy ? ` · 处理人 #${record.handledBy}` : ''}
        </p>
      ) : null}

      {/* 确认弹窗 */}
      {pendingAction !== null ? (
        <ReviewActionDialog
          kind={pendingAction}
          recordStatus={record.status}
          submitting={statusMutation.isPending}
          serverError={actionError}
          onSubmit={(body) => submitAction(pendingAction, body)}
          onCancel={() => {
            if (statusMutation.isPending) return
            setActionError(null)
            setPendingAction(null)
          }}
        />
      ) : null}

      {/* AI 理由浮层（显式触发，RL-01） */}
      <PmoAiRationaleModal
        id={id}
        record={record}
        open={rationaleOpen}
        onClose={() => setRationaleOpen(false)}
      />
    </aside>
  )
}

/** 单动作确认弹窗（accept/dismiss 单项确认；snooze 选择时长；convert 目标+说明）。 */
function ReviewActionDialog({
  kind,
  recordStatus,
  submitting,
  serverError,
  onSubmit,
  onCancel,
}: {
  kind: ReviewKind
  recordStatus: PmoRecommendationRecord['status']
  submitting: boolean
  serverError: string | null
  onSubmit: (body: {
    snoozeUntil?: string
    reason?: string
    convertTarget?: PmoConversionTarget
    convertParams?: Record<string, unknown>
  }) => void
  onCancel: () => void
}) {
  const [snoozeHours, setSnoozeHours] = React.useState('24')
  const [convertTarget, setConvertTarget] =
    React.useState<PmoConversionTarget>('project_priority_review')
  const [convertReason, setConvertReason] = React.useState('')
  const [localError, setLocalError] = React.useState<string | null>(null)

  const dialogRef = React.useRef<HTMLDivElement | null>(null)

  // 弹窗由父级条件渲染（挂载即打开）；在途提交期间与「取消」按钮同判据：Escape 不关闭。
  useDialogA11y({
    ref: dialogRef,
    open: true,
    onClose: onCancel,
    canClose: () => !submitting,
  })

  const title =
    kind === 'accept'
      ? '确认接受该推荐'
      : kind === 'dismiss'
        ? '确认忽略该推荐'
        : kind === 'snooze'
          ? '稍后处理该推荐'
          : '将推荐转化为正式动作'

  const copy =
    kind === 'accept'
      ? '接受仅将推荐状态置为「已采纳」并留痕审计，不会自动执行任何项目变更（RL-01）。'
      : kind === 'dismiss'
        ? '忽略后推荐状态置为「已忽略」；如后续需要可重新激活。'
        : kind === 'snooze'
          ? '稍后处理会按所选时长推迟该推荐，到点后回到待处理队列。'
          : '转化仅创建待处理转换意图（pending intent），不修改任何正式项目事实；提交前请确认目标引用与说明。'

  const confirm = () => {
    if (kind === 'convert') {
      if (convertReason.trim() === '') {
        setLocalError('请填写转化说明（说明转化动机与期望结果）')
        return
      }
      if (convertReason.trim().length > 500) {
        setLocalError('转化说明不超过 500 字')
        return
      }
      onSubmit({
        reason: convertReason.trim(),
        convertTarget,
        convertParams: {},
      })
      return
    }
    if (kind === 'snooze') {
      const hours = Number(snoozeHours)
      const snoozeUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
      onSubmit({ snoozeUntil })
      return
    }
    onSubmit({})
  }

  return (
    <div
      data-pmo-ai-confirm
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] p-4">
        <h4 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h4>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
          {copy}（当前状态：{RECOMMENDATION_STATUS_LABELS[recordStatus] ?? recordStatus}）
        </p>

        {kind === 'snooze' ? (
          <label className="mt-3 flex flex-col">
            <span className="mb-1 text-[10px] text-[var(--nx-text-muted)]">稍后时长</span>
            <select
              data-pmo-ai-snooze-option
              value={snoozeHours}
              onChange={(event) => setSnoozeHours(event.target.value)}
              className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
            >
              <option value="24">24 小时</option>
              <option value="72">3 天</option>
              <option value="168">7 天</option>
            </select>
          </label>
        ) : null}

        {kind === 'convert' ? (
          <div className="mt-3 flex flex-col gap-2.5">
            <label className="flex flex-col">
              <span className="mb-1 text-[10px] text-[var(--nx-text-muted)]">目标引用</span>
              <select
                data-pmo-ai-convert-target
                value={convertTarget}
                onChange={(event) => setConvertTarget(event.target.value as PmoConversionTarget)}
                className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              >
                {PMO_CONVERSION_TARGETS.map((target) => (
                  <option key={target} value={target}>
                    {CONVERSION_TARGET_LABELS[target]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span className="mb-1 text-[10px] text-[var(--nx-text-muted)]">
                说明（必填，≤500 字）
              </span>
              <textarea
                data-pmo-ai-convert-reason
                value={convertReason}
                onChange={(event) => setConvertReason(event.target.value)}
                rows={3}
                className="resize-none rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              />
            </label>
          </div>
        ) : null}

        {localError ? (
          <p
            data-pmo-ai-confirm-local-error
            role="alert"
            className="mt-2 text-[11px] text-[var(--nx-status-danger)]"
          >
            {localError}
          </p>
        ) : null}
        {serverError && !submitting ? (
          <p
            data-pmo-ai-confirm-server-error
            role="alert"
            className="mt-2 text-[11px] text-[var(--nx-status-danger)]"
          >
            {serverError}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            data-pmo-ai-confirm-cancel
            disabled={submitting}
            onClick={onCancel}
            className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-pmo-ai-confirm-ok
            disabled={submitting}
            onClick={confirm}
            className={cn(
              'flex h-8 items-center gap-1 rounded-sm border px-3 text-xs font-medium transition-colors disabled:opacity-50',
              kind === 'dismiss'
                ? 'border-[rgba(245,158,11,0.45)] text-[var(--nx-status-warning)] hover:border-[var(--nx-status-warning)]'
                : 'border-[var(--nx-border-focus)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]',
            )}
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
            {confirmLabelOf(kind)}
          </button>
        </div>
      </div>
    </div>
  )
}

function confirmLabelOf(kind: ReviewKind): string {
  if (kind === 'accept') return '确认接受'
  if (kind === 'dismiss') return '确认忽略'
  if (kind === 'snooze') return '确认稍后处理'
  return '确认转化'
}

function rationaleButtonLabel(aiStatus: PmoRecommendationRecord['aiStatus']): string {
  if (aiStatus === 'none' || aiStatus === 'unavailable') return '生成 AI 理由'
  if (aiStatus === 'available') return '查看 AI 理由'
  if (aiStatus === 'stale') return '查看 AI 理由（已过期）'
  if (aiStatus === 'failed') return '重新生成 AI 理由'
  return '生成 AI 理由'
}

export default PmoAiRecommendationDetailPanel
