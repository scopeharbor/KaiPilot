'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import { getRisk, transitionRiskStatus, updateRisk } from '@/lib/api/risks'
import type { Risk, RiskCategory, RiskStatus } from '@/lib/api/risks'
import { createResponsePlan, deleteResponsePlan, listResponsePlans } from '@/lib/api/risks-v2'
import type { ResponsePlanStatus, ResponseStrategyType } from '@/lib/api/risks-v2'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  RISK_CATEGORY_LABELS,
  RISK_CATEGORY_OPTIONS,
  RISK_SCALE_OPTIONS,
  RISK_STATUS_LABELS,
  nextRiskStatuses,
} from '@/components/next/charts/risk/risk-meta'

/**
 * 编辑风险详情与应对计划抽屉（v3-ui-next-risk-change-domains W1 · tasks 1.7，
 * spec「风险登记底册…受控新建与编辑」）。
 *
 * - 按 riskId 读取既有端点 GET /risks/:id（登记表行内「编辑」与工作台 Top 风险
 *   详情直达共用本抽屉，风险数据始终取服务端最新快照）；
 * - 受控编辑：risk:manage / risk:update 全字段；risk:update_own 仅本人负责行可改
 *   概率 / 影响 / 缓解措施（对齐登记底册行级权限语义）；无权只读展示；
 * - 状态机推进下拉仅呈现 RISK_ALLOWED_TRANSITIONS 白名单目标，POST /risks/:id/status；
 * - 应对计划区：列出 / 新增（strategyType + 行动描述 + 目标日期）/ 两步确认删除；
 * - 写成功统一失效 ['risks'] / ['risks-v2'] / ['risk-matrix'] 缓存；RL-01：
 *   AI 来源风险回显 AIMarker（置信度 / 来源 / 原因），修改一律走人工显式保存。
 */

const STRATEGY_LABELS: Record<ResponseStrategyType, string> = {
  avoid: '规避',
  mitigate: '缓解',
  transfer: '转移',
  accept: '接受',
  contingency: '应急',
  escalate: '升级',
}

const STRATEGY_OPTIONS: ReadonlyArray<{ value: ResponseStrategyType; label: string }> = (
  ['avoid', 'mitigate', 'transfer', 'accept', 'contingency', 'escalate'] as const
).map((value) => ({ value, label: STRATEGY_LABELS[value] }))

const PLAN_STATUS_LABELS: Record<ResponsePlanStatus, string> = {
  planned: '已计划',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
  overdue: '已逾期',
}

const PLAN_STATUS_TONE: Record<ResponsePlanStatus, string> = {
  planned: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]',
  in_progress:
    'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] text-[var(--nx-status-warning)]',
  completed:
    'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.12)] text-[var(--nx-status-success)]',
  cancelled: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
  overdue: 'border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)]',
}

const AI_SOURCE_LABELS: Record<string, string> = {
  inferred: '自动推断',
  explicit: '明确指认',
  default: '默认建议',
}

/** 确定性日期展示（UTC 日历日）。 */
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export interface RiskEditDrawerProps {
  projectId: number
  /** 目标风险 ID；null 或 open=false 时不发起任何读取请求 */
  riskId: number | null
  open: boolean
  onClose: () => void
}

export function RiskEditDrawer({ projectId, riskId, open, onClose }: RiskEditDrawerProps) {
  const queryClient = useQueryClient()
  const { canAny } = usePermissions()
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)

  const canEditFull = canAny(['risk:manage', 'risk:update'])
  const canEditOwn = canAny(['risk:update_own'])
  const canDeletePlan = canAny(['risk:manage', 'risk:update', 'risk:delete'])

  // ---------------- 数据读取 ----------------
  const detailQuery = useQuery({
    queryKey: ['risks', 'domain-detail', projectId, riskId],
    queryFn: () => getRisk(projectId, riskId as number),
    enabled: open && riskId !== null && riskId > 0,
  })
  const risk = detailQuery.data?.data

  const plansQuery = useQuery({
    queryKey: ['risks-v2', 'response-plans', projectId, riskId],
    queryFn: () => listResponsePlans(projectId, riskId as number),
    enabled: open && riskId !== null && riskId > 0,
  })
  const plans = plansQuery.data?.data ?? []

  // ---------------- 编辑表单态 ----------------
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [category, setCategory] = React.useState<RiskCategory>('technical')
  const [probability, setProbability] = React.useState(3)
  const [impact, setImpact] = React.useState(3)
  const [mitigation, setMitigation] = React.useState('')
  const [contingency, setContingency] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)
  const [localError, setLocalError] = React.useState<string | null>(null)

  const [planStrategy, setPlanStrategy] = React.useState<ResponseStrategyType>('mitigate')
  const [planAction, setPlanAction] = React.useState('')
  const [planTargetDate, setPlanTargetDate] = React.useState('')
  const [confirmDeletePlanId, setConfirmDeletePlanId] = React.useState<number | null>(null)

  // Esc 关闭
  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // 目标风险变化 → 重置表单（确定性填充，避免编辑残留）
  React.useEffect(() => {
    if (!open || !risk) return
    setTitle(risk.title ?? '')
    setDescription(risk.description ?? '')
    setCategory(risk.category ?? 'technical')
    setProbability(risk.probability ?? 3)
    setImpact(risk.impact ?? 3)
    setMitigation(risk.mitigationStrategy ?? '')
    setContingency(risk.contingencyPlan ?? '')
    setFormError(null)
    setLocalError(null)
    setPlanStrategy('mitigate')
    setPlanAction('')
    setPlanTargetDate('')
    setConfirmDeletePlanId(null)
  }, [open, risk?.id])

  // ---------------- 写操作（hooks 必须稳定置于早退之前） ----------------
  const invalidateAll = React.useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['risks'] }),
      queryClient.invalidateQueries({ queryKey: ['risks-v2'] }),
      queryClient.invalidateQueries({ queryKey: ['risk-matrix'] }),
    ])
  }, [queryClient])

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<Risk>) => updateRisk(projectId, riskId as number, patch),
    onSuccess: () => {
      setFormError(null)
      setLocalError(null)
      invalidateAll()
      onClose()
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : '保存风险失败，请重试')
    },
  })

  const transitionMutation = useMutation({
    mutationFn: (next: RiskStatus) => transitionRiskStatus(projectId, riskId as number, next),
    onSuccess: () => invalidateAll(),
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : '状态推进失败，请重试')
    },
  })

  const createPlanMutation = useMutation({
    mutationFn: () =>
      createResponsePlan(projectId, riskId as number, {
        strategyType: planStrategy,
        actionDescription: planAction.trim(),
        targetDate: planTargetDate ? `${planTargetDate}T00:00:00.000Z` : null,
      }),
    onSuccess: () => {
      setLocalError(null)
      setPlanAction('')
      setPlanTargetDate('')
      setConfirmDeletePlanId(null)
      void queryClient.invalidateQueries({ queryKey: ['risks-v2'] })
    },
    onError: (error) => {
      setLocalError(error instanceof Error ? error.message : '新增应对计划失败，请重试')
    },
  })

  const deletePlanMutation = useMutation({
    mutationFn: (planId: number) => deleteResponsePlan(projectId, riskId as number, planId),
    onSuccess: () => {
      setConfirmDeletePlanId(null)
      setLocalError(null)
      void queryClient.invalidateQueries({ queryKey: ['risks-v2'] })
    },
    onError: (error) => {
      setLocalError(error instanceof Error ? error.message : '删除应对计划失败，请重试')
    },
  })

  if (!open) return null

  const riskEditable =
    risk !== undefined && (canEditFull || (canEditOwn && risk.ownerId === currentUserId))
  const limitedEditable =
    risk !== undefined && !canEditFull && canEditOwn && risk.ownerId === currentUserId
  const canTransition = canEditFull
  const status = (risk?.status ?? 'identified') as RiskStatus
  const allowedTransitions = nextRiskStatuses(status)

  const handleSave = () => {
    if (!risk) return
    const trimmedTitle = title.trim()
    if (trimmedTitle === '') {
      setLocalError('风险标题不能为空')
      return
    }
    setLocalError(null)
    setFormError(null)
    const patch: Partial<Risk> = {
      title: trimmedTitle,
      category,
      probability,
      impact,
    }
    if (!limitedEditable) {
      const trimmedDescription = description.trim()
      if (trimmedDescription !== '') patch.description = trimmedDescription
      patch.contingencyPlan = contingency.trim() === '' ? null : contingency.trim()
    }
    patch.mitigationStrategy = mitigation.trim() === '' ? null : mitigation.trim()
    saveMutation.mutate(patch)
  }

  const fieldClass =
    'h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50'
  const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'
  const readonlyNote = 'text-[10px] text-[var(--nx-text-muted)]'

  return (
    <div data-risk-edit-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-risk-edit-scrim
        aria-label="关闭编辑风险"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="编辑风险"
        data-risk-edit-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Check className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
                {risk ? `编辑风险 · ${risk.title}` : '编辑风险'}
              </h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                {risk
                  ? `${risk.riskCode ?? `#${risk.id}`} · ${RISK_CATEGORY_LABELS[risk.category as RiskCategory] ?? risk.category} · ${RISK_STATUS_LABELS[status] ?? status}`
                  : `GET /risks/${riskId ?? ''}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-risk-edit-close
            aria-label="关闭编辑风险"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 加载骨架：详情 + 计划占位 */}
          {detailQuery.isLoading || (riskId !== null && !risk) ? (
            <div
              data-risk-edit-skeleton
              role="status"
              aria-label="正在加载风险详情"
              aria-busy="true"
              className="space-y-2.5"
            >
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
              ))}
            </div>
          ) : null}

          {detailQuery.isError ? (
            <div
              role="alert"
              aria-label="风险详情加载失败"
              data-risk-edit-error
              className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
            >
              <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">
                风险详情加载失败，请稍后重试
              </p>
              <button
                type="button"
                data-risk-edit-retry
                onClick={() => void detailQuery.refetch()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重新载入
              </button>
            </div>
          ) : null}

          {formError ? (
            <p
              role="alert"
              aria-label="保存风险失败"
              data-risk-edit-save-error
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {formError}
            </p>
          ) : null}

          {risk ? (
            <>
              {/* AI 来源标记（RL-01：建议来源透明回显） */}
              {risk.aiMetadata?.aiMarker ? (
                <div
                  data-risk-edit-ai-marker
                  className="rounded-sm border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
                >
                  <p className="font-medium text-[var(--nx-status-warning)]">
                    ✦ AI 推断风险（
                    {AI_SOURCE_LABELS[risk.aiMetadata.aiMarker.source] ??
                      risk.aiMetadata.aiMarker.source}
                    ）
                  </p>
                  <p className="mt-1">
                    置信度 {Math.round(risk.aiMetadata.aiMarker.confidence * 100)}% ·{' '}
                    {risk.aiMetadata.aiMarker.reason}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">
                    已由人工确认采纳写入正式风险，任何修改均需显式保存
                  </p>
                </div>
              ) : null}

              {!riskEditable ? (
                <p className={readonlyNote}>
                  当前账号为只读视图（需要 risk:update 或负责本风险并具备 risk:update_own
                  方可编辑）。
                </p>
              ) : null}

              <div className={cn('space-y-4', !riskEditable && 'pointer-events-none opacity-60')}>
                <div>
                  <label htmlFor="risk-edit-title" className={labelClass}>
                    风险标题 <span className="text-[var(--nx-status-danger)]">*</span>
                  </label>
                  <input
                    id="risk-edit-title"
                    data-risk-edit-title
                    type="text"
                    value={title}
                    maxLength={255}
                    disabled={limitedEditable || !riskEditable}
                    onChange={(event) => setTitle(event.target.value)}
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label htmlFor="risk-edit-description" className={labelClass}>
                    风险描述
                  </label>
                  <textarea
                    id="risk-edit-description"
                    data-risk-edit-description
                    rows={3}
                    value={description}
                    maxLength={5000}
                    disabled={limitedEditable || !riskEditable}
                    onChange={(event) => setDescription(event.target.value)}
                    className={`${fieldClass} h-auto resize-y py-1.5 leading-relaxed`}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="risk-edit-category" className={labelClass}>
                      风险分类
                    </label>
                    <select
                      id="risk-edit-category"
                      data-risk-edit-category
                      value={category}
                      disabled={limitedEditable || !riskEditable}
                      onChange={(event) => setCategory(event.target.value as RiskCategory)}
                      className={fieldClass}
                    >
                      {RISK_CATEGORY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="risk-edit-probability" className={labelClass}>
                      发生概率
                    </label>
                    <select
                      id="risk-edit-probability"
                      data-risk-edit-probability
                      value={probability}
                      disabled={!riskEditable}
                      onChange={(event) => setProbability(Number(event.target.value))}
                      className={fieldClass}
                    >
                      {RISK_SCALE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="risk-edit-impact" className={labelClass}>
                      影响度
                    </label>
                    <select
                      id="risk-edit-impact"
                      data-risk-edit-impact
                      value={impact}
                      disabled={!riskEditable}
                      onChange={(event) => setImpact(Number(event.target.value))}
                      className={fieldClass}
                    >
                      {RISK_SCALE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="risk-edit-mitigation" className={labelClass}>
                    缓解措施
                  </label>
                  <textarea
                    id="risk-edit-mitigation"
                    data-risk-edit-mitigation
                    rows={2}
                    value={mitigation}
                    maxLength={5000}
                    disabled={!riskEditable}
                    onChange={(event) => setMitigation(event.target.value)}
                    placeholder="填写预置缓解与应对措施（可留空）"
                    className={`${fieldClass} h-auto resize-y py-1.5 leading-relaxed`}
                  />
                </div>

                {!limitedEditable ? (
                  <div>
                    <label htmlFor="risk-edit-contingency" className={labelClass}>
                      应急计划
                    </label>
                    <textarea
                      id="risk-edit-contingency"
                      data-risk-edit-contingency
                      rows={2}
                      value={contingency}
                      maxLength={5000}
                      disabled={!riskEditable}
                      onChange={(event) => setContingency(event.target.value)}
                      placeholder="填写风险触发后的应急计划（可留空）"
                      className={`${fieldClass} h-auto resize-y py-1.5 leading-relaxed`}
                    />
                  </div>
                ) : null}

                {limitedEditable ? (
                  <p className={readonlyNote}>
                    你仅可编辑本人负责风险的敞口等级与缓解措施，其他字段为只读。
                  </p>
                ) : null}

                {/* 状态机推进（白名单受控） */}
                <div>
                  <label className={labelClass}>状态推进</label>
                  {canTransition && allowedTransitions.length > 0 ? (
                    <select
                      data-risk-edit-status
                      aria-label={`${title || risk.title} 状态推进`}
                      value={status}
                      disabled={transitionMutation.isPending}
                      onChange={(event) => {
                        const next = event.target.value as RiskStatus
                        if (next !== status) transitionMutation.mutate(next)
                      }}
                      className={fieldClass}
                    >
                      <option value={status} disabled>
                        {RISK_STATUS_LABELS[status] ?? status}
                      </option>
                      {allowedTransitions.map((next) => (
                        <option key={next} value={next}>
                          → {RISK_STATUS_LABELS[next] ?? next}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      data-risk-edit-status-readonly
                      className="inline-block rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                    >
                      {RISK_STATUS_LABELS[status] ?? status}
                    </span>
                  )}
                </div>
              </div>

              {/* 应对计划 */}
              <div className="border-t border-[var(--nx-border-hairline)] pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold text-[var(--nx-text-primary)]">应对计划</h4>
                  <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                    {plans.length} 项
                  </span>
                </div>

                {plansQuery.isLoading && plans.length === 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {[0, 1].map((i) => (
                      <div key={i} className="h-14 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
                    ))}
                  </div>
                ) : plans.length === 0 ? (
                  <p
                    data-risk-plans-empty
                    className="mt-2 rounded-sm border border-dashed border-[var(--nx-border-hairline)] px-3 py-4 text-center text-[11px] text-[var(--nx-text-muted)]"
                  >
                    暂无应对计划，可在下方为风险补充应对措施
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {plans.map((plan) => (
                      <li
                        key={plan.id}
                        data-risk-plan={plan.id}
                        className="flex items-start justify-between gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--nx-text-secondary)]">
                              {STRATEGY_LABELS[plan.strategyType] ?? plan.strategyType}
                            </span>
                            <span
                              data-risk-plan-status
                              className={cn(
                                'rounded-sm border px-1.5 py-0.5 text-[10px]',
                                PLAN_STATUS_TONE[plan.status] ??
                                  'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]',
                              )}
                            >
                              {PLAN_STATUS_LABELS[plan.status] ?? plan.status}
                            </span>
                            {plan.targetDate ? (
                              <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                                目标 {formatDate(plan.targetDate)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                            {plan.actionDescription}
                          </p>
                        </div>
                        {canDeletePlan ? (
                          confirmDeletePlanId === plan.id ? (
                            <div
                              data-risk-plan-delete-confirm
                              className="flex shrink-0 items-center gap-1"
                            >
                              <button
                                type="button"
                                aria-label={`确认删除应对计划：${plan.actionDescription.slice(0, 24)}`}
                                disabled={deletePlanMutation.isPending}
                                onClick={() => deletePlanMutation.mutate(plan.id)}
                                className="flex h-6 items-center gap-1 rounded-sm border border-[var(--nx-status-danger)] px-1.5 text-[10px] text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)] hover:text-white disabled:opacity-50"
                              >
                                确认
                              </button>
                              <button
                                type="button"
                                aria-label="取消删除应对计划"
                                disabled={deletePlanMutation.isPending}
                                onClick={() => setConfirmDeletePlanId(null)}
                                className="h-6 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              data-risk-plan-delete
                              aria-label={`删除应对计划：${plan.actionDescription.slice(0, 24)}`}
                              disabled={deletePlanMutation.isPending}
                              onClick={() => setConfirmDeletePlanId(plan.id)}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-transparent text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)] disabled:opacity-50"
                            >
                              <X className="h-3 w-3" aria-hidden />
                            </button>
                          )
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                {/* 新增应对计划（写能力门禁） */}
                {canDeletePlan ? (
                  <div
                    data-risk-plan-create-form
                    className="mt-3 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] p-3"
                  >
                    <p className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                      新增应对计划
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="risk-plan-strategy" className={labelClass}>
                          应对策略
                        </label>
                        <select
                          id="risk-plan-strategy"
                          data-risk-plan-strategy-select
                          value={planStrategy}
                          onChange={(event) =>
                            setPlanStrategy(event.target.value as ResponseStrategyType)
                          }
                          className={fieldClass}
                        >
                          {STRATEGY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="risk-plan-target-date" className={labelClass}>
                          目标日期（可选）
                        </label>
                        <input
                          id="risk-plan-target-date"
                          data-risk-plan-target-date
                          type="date"
                          value={planTargetDate}
                          onChange={(event) => setPlanTargetDate(event.target.value)}
                          className={fieldClass}
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label htmlFor="risk-plan-action" className={labelClass}>
                        行动描述 <span className="text-[var(--nx-status-danger)]">*</span>
                      </label>
                      <textarea
                        id="risk-plan-action"
                        data-risk-plan-action
                        rows={2}
                        value={planAction}
                        maxLength={5000}
                        onChange={(event) => setPlanAction(event.target.value)}
                        placeholder="描述应对行动内容与执行步骤…"
                        className={`${fieldClass} h-auto resize-y py-1.5 leading-relaxed`}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        data-risk-plan-create-submit
                        disabled={planAction.trim() === '' || createPlanMutation.isPending}
                        onClick={() => {
                          setLocalError(null)
                          createPlanMutation.mutate()
                        }}
                        className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
                      >
                        {createPlanMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <Plus className="h-3 w-3" aria-hidden />
                        )}
                        添加计划
                      </button>
                    </div>
                  </div>
                ) : null}

                {localError ? (
                  <p
                    role="alert"
                    aria-label="应对计划操作失败"
                    data-risk-plan-error
                    className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
                  >
                    {localError}
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {risk ? (
          <footer className="flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
            <span data-risk-edit-meta className="font-mono text-[10px] text-[var(--nx-text-muted)]">
              责任人 {risk.ownerId === null ? '未指派' : `#${risk.ownerId}`} · 目标解决{' '}
              {formatDate(risk.targetResolutionDate)}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-risk-edit-cancel
                onClick={onClose}
                disabled={saveMutation.isPending}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-risk-edit-save
                disabled={!riskEditable || saveMutation.isPending}
                onClick={handleSave}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden />
                )}
                保存修改
              </button>
            </div>
          </footer>
        ) : null}
      </aside>
    </div>
  )
}

export default RiskEditDrawer
