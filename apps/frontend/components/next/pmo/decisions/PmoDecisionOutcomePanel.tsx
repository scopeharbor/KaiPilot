'use client'

import * as React from 'react'
import { Loader2, Send, ShieldCheck, X } from 'lucide-react'
import {
  useCheckReadinessOnce,
  useCreateDecisionHandoff,
  useDecisionHandoffs,
  useDecisionOptions,
  useDecisionOutcomes,
  useSubmitDecisionOutcome,
} from '@/hooks/use-decision-workbench'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  PMO_DECISION_HANDOFF_TARGET_VALUES,
  PMO_DECISION_RATIONALE_MAX_LENGTH,
  pmoDecisionOutcomeTargetStatus,
  type PmoDecisionCaseStatus,
  type PmoDecisionHandoffTarget,
  type PmoDecisionOutcomeAction,
  type PmoDecisionOutcomeDTO,
} from '@aiproj/types'
import { resolveDecisionActionError } from './PmoDecisionCreateDialog'

/**
 * PMO 决策结论与受控交接面板（v3-ui-next-pmo-domain W6 · tasks 6.5，
 * spec「决策工作台详情与人工结论闭环」）。
 *
 * - 人工结论 = 唯一终态入口（无 apply/confirm 自动直写通道，RL-01）：
 *   结论动作按钮仅 `pmo_decision:decide` 且议题处于 under-review 可见；
 *   点击动作 → readiness 检查（POST readiness，绑定证据指纹）→ 未通过列出阻塞缺口、
 *   不打开对话框；通过后二次确认对话框内附审计元数据（执行人/类型/目标状态/指纹）
 *   与理由（≤2000 字），确认才 POST .../outcomes；
 * - supersede 必须填写取代目标议题 ID（后端 SUPERSEDE_TARGET_REQUIRED 同语义）；
 *   approve 必须选择 active 方案（后端 SELECTED_OPTION_REQUIRED 同语义）；
 * - 受控交接：`pmo_decision:handoff` 且议题 decided（存在 approve 结论）时可见；
 *   目标取自闭集目录（后端 HANDOFF_REGISTRY 同款 eligibility：需要选中方案的
 *   目标在缺选中方案时禁用；plugin_action_proposal 属插件执行边界，本批不开放）；
 *   发起前二次确认（展示目标 + 幂等键语义），POST .../handoffs；
 * - 终态（decided/deferred/superseded）：操作区隐藏，仅归档呈现结论历史与交接回执
 *   （audit 元数据：digest / actor / 时间 / 状态）。
 */
export interface PmoDecisionOutcomePanelProps {
  decisionId: number
  caseStatus: PmoDecisionCaseStatus
  caseRevision: number
  canDecide: boolean
  canHandoff: boolean
}

export const PMO_DECISION_OUTCOME_ACTION_META: Record<
  PmoDecisionOutcomeAction,
  { label: string; requiresSelectedOption: boolean }
> = {
  approve: { label: '批准', requiresSelectedOption: true },
  reject: { label: '否决', requiresSelectedOption: false },
  defer: { label: '延后', requiresSelectedOption: false },
  'request-more-evidence': { label: '要求补充证据', requiresSelectedOption: false },
  supersede: { label: '由新议题取代', requiresSelectedOption: false },
}

const PMO_DECISION_ACTION_ORDER: readonly PmoDecisionOutcomeAction[] = [
  'approve',
  'reject',
  'defer',
  'supersede',
  'request-more-evidence',
]

export const PMO_DECISION_TERMINAL_LABEL: Record<string, string> = {
  decided: '已决定（归档）',
  deferred: '已延后（归档）',
  superseded: '已被取代（归档）',
}

/** 闭集交接目录（与后端 HANDOFF_REGISTRY eligibility 对齐；plugin 目标本批不开放）。 */
export const PMO_DECISION_HANDOFF_UI_TARGETS: ReadonlyArray<{
  target: PmoDecisionHandoffTarget
  label: string
  description: string
  requiresSelectedOption: boolean
}> = PMO_DECISION_HANDOFF_TARGET_VALUES.filter((target) => target !== 'plugin_action_proposal').map(
  (target) => {
    const base = {
      navigation: {
        label: '导航到组合工作台',
        description: '创建导航交接，指引下游打开对应组合工作台',
        requiresSelectedOption: false,
      },
      priority_review_intent: {
        label: '优先级复核意图',
        description: '携带选中方案生成优先级复核意图（AI 优先级推荐）',
        requiresSelectedOption: true,
      },
      allocation_draft: {
        label: '资源分配草稿',
        description: '携带选中方案生成资源分配草稿（组合资源池）',
        requiresSelectedOption: true,
      },
      risk_change_review_draft: {
        label: '风险/变更复核草稿',
        description: '生成风险/变更复核草稿引用',
        requiresSelectedOption: false,
      },
    } as const
    const meta = base[target as keyof typeof base]
    return {
      target,
      label: meta.label,
      description: meta.description,
      requiresSelectedOption: meta.requiresSelectedOption,
    }
  },
)

const HANDOFF_STATUS_META: Record<
  'pending' | 'failed' | 'replayed',
  { label: string; color: string }
> = {
  pending: { label: '待下游处理', color: 'var(--nx-chart-4)' },
  failed: { label: '失败', color: 'var(--nx-status-danger)' },
  replayed: { label: '幂等重放', color: 'var(--nx-text-secondary)' },
}

export function PmoDecisionOutcomePanel({
  decisionId,
  caseStatus,
  caseRevision,
  canDecide,
  canHandoff,
}: PmoDecisionOutcomePanelProps) {
  const user = useAuthStore((state) => state.user)
  const optionsQuery = useDecisionOptions(decisionId)
  const outcomesQuery = useDecisionOutcomes(decisionId)
  const handoffsQuery = useDecisionHandoffs(decisionId)
  const checkReadiness = useCheckReadinessOnce()
  const submitOutcome = useSubmitDecisionOutcome(decisionId)
  const createHandoff = useCreateDecisionHandoff(decisionId)

  const [outcomeError, setOutcomeError] = React.useState<string | null>(null)
  const [readinessPacket, setReadinessPacket] = React.useState<Awaited<
    ReturnType<typeof checkReadiness.mutateAsync>
  > | null>(null)
  const [confirmAction, setConfirmAction] = React.useState<PmoDecisionOutcomeAction | null>(null)
  const [rationaleDraft, setRationaleDraft] = React.useState('')
  const [selectedOptionId, setSelectedOptionId] = React.useState<number | null>(null)
  const [supersedeTargetDraft, setSupersedeTargetDraft] = React.useState('')
  const [outcomeSuccess, setOutcomeSuccess] = React.useState<string | null>(null)

  const [handoffTarget, setHandoffTarget] = React.useState<PmoDecisionHandoffTarget>('navigation')
  const [handoffArmed, setHandoffArmed] = React.useState(false)
  const [handoffMessage, setHandoffMessage] = React.useState<string | null>(null)
  const [handoffError, setHandoffError] = React.useState<string | null>(null)

  const isTerminal =
    caseStatus === 'decided' || caseStatus === 'deferred' || caseStatus === 'superseded'
  const underReview = caseStatus === 'under-review'

  const outcomes = outcomesQuery.data ?? []
  const hasApproveOutcome = outcomes.some((outcome) => outcome.action === 'approve')
  const activeOptions = (optionsQuery.data ?? []).filter((option) => option.active)
  const identity = user ? (user.fullName ?? user.email) : null

  // 选项数据可能晚于动作按钮到达：openOutcome 内读取 ref 最新值，避免点击闭包读空。
  const optionsRef = React.useRef(optionsQuery.data)
  React.useEffect(() => {
    optionsRef.current = optionsQuery.data
  }, [optionsQuery.data])

  React.useEffect(() => {
    if (!submitOutcome.isSuccess && !createHandoff.isSuccess) return
    if (submitOutcome.isSuccess) setHandoffArmed(false)
  }, [submitOutcome.isSuccess, createHandoff.isSuccess])

  // 选项数据晚到：approve 对话框打开后若尚无选中方案，数据就绪时自动预选首个 active。
  React.useEffect(() => {
    if (confirmAction === 'approve' && selectedOptionId === null && activeOptions.length > 0) {
      setSelectedOptionId(activeOptions[0]?.id ?? null)
    }
  }, [confirmAction, activeOptions, selectedOptionId])

  function resetOutcomeDialog(): void {
    setConfirmAction(null)
    setRationaleDraft('')
    setSelectedOptionId(null)
    setSupersedeTargetDraft('')
    setOutcomeError(null)
  }

  async function openOutcome(action: PmoDecisionOutcomeAction): Promise<void> {
    if (!underReview || !canDecide) return
    setOutcomeError(null)
    setOutcomeSuccess(null)
    try {
      const packet = await checkReadiness.mutateAsync({ decisionId })
      setReadinessPacket(packet)
      if (!packet.ready) {
        setOutcomeError('readiness 未通过：存在阻塞缺口，结论暂不可提交。')
        return
      }
      if (action === 'approve') {
        const activeNow = (optionsRef.current ?? []).filter((option) => option.active)
        if (activeNow.length > 0) setSelectedOptionId(activeNow[0]?.id ?? null)
      }
      setConfirmAction(action)
    } catch (error) {
      setOutcomeError(resolveDecisionActionError(error, 'readiness 检查失败'))
    }
  }

  function targetStatusLabel(action: PmoDecisionOutcomeAction): string {
    const target = pmoDecisionOutcomeTargetStatus(action)
    const labels: Record<string, string> = {
      decided: '已决定',
      deferred: '已延后',
      'collecting-evidence': '收集证据',
      superseded: '已被取代',
    }
    return labels[target] ?? target
  }

  const confirmActionMeta = confirmAction ? PMO_DECISION_OUTCOME_ACTION_META[confirmAction] : null
  const supersedeTargetId =
    confirmAction === 'supersede' ? Number(supersedeTargetDraft.trim()) : NaN
  const supersedeTargetValid =
    confirmAction !== 'supersede' || (Number.isInteger(supersedeTargetId) && supersedeTargetId > 0)
  const fingerprint = readinessPacket?.fingerprint?.fingerprint ?? ''
  const canSubmitOutcome =
    confirmAction !== null &&
    fingerprint.length >= 8 &&
    (confirmAction !== 'approve' || selectedOptionId !== null) &&
    supersedeTargetValid &&
    !submitOutcome.isPending

  const canCreateHandoffVisible = canHandoff && caseStatus === 'decided' && hasApproveOutcome
  const approveOutcomeSelectedOptionId = outcomes
    .filter((outcome) => outcome.action === 'approve')
    .at(-1)?.selectedOptionId

  const handoffIdempotencyKey =
    handoffTarget !== null ? `handoff-${decisionId}-${handoffTarget}-${Date.now()}` : ''

  async function submitConfirmedOutcome(): Promise<void> {
    if (confirmAction === null) return
    setOutcomeError(null)
    try {
      const outcome = await submitOutcome.mutateAsync({
        action: confirmAction,
        selectedOptionId: confirmAction === 'approve' ? selectedOptionId : null,
        reviewFingerprint: fingerprint,
        rationale: rationaleDraft.trim() === '' ? undefined : rationaleDraft.trim(),
        acknowledgedWarnings: (readinessPacket?.warnings ?? []).map((warning) => warning.code),
        supersededByCaseId:
          confirmAction === 'supersede' &&
          Number.isInteger(supersedeTargetId) &&
          supersedeTargetId > 0
            ? supersedeTargetId
            : undefined,
      })
      setOutcomeSuccess(
        `结论已记录（outcome #${outcome.id}）——议题转入「${targetStatusLabel(confirmAction)}」。`,
      )
      resetOutcomeDialog()
      setReadinessPacket(null)
    } catch (error) {
      setOutcomeError(resolveDecisionActionError(error, '结论提交失败'))
    }
  }

  async function confirmHandoff(): Promise<void> {
    if (!canCreateHandoffVisible) return
    setHandoffError(null)
    setHandoffMessage(null)
    try {
      const receipt = await createHandoff.mutateAsync({
        target: handoffTarget,
        idempotencyKey: `handoff-${decisionId}-${handoffTarget}-${Date.now()}`,
      })
      setHandoffArmed(false)
      setHandoffMessage(
        `交接回执 #${receipt.id}：${receipt.pendingTargetRef ?? '已创建待下游引用'}`,
      )
    } catch (error) {
      setHandoffError(resolveDecisionActionError(error, '交接创建失败'))
      setHandoffArmed(false)
    }
  }

  const panelShell =
    'flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4'

  return (
    <section data-pmo-decision-outcome aria-label="结论与受控交接" className={panelShell}>
      <header className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
          <ShieldCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">结论与受控交接</h3>
          <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">
            决策 ≠ 执行 · 结论只生成受控下游交接，AI / 插件 / 后台任务不可代为决定
          </p>
        </div>
      </header>

      {outcomeError ? (
        <p
          role="alert"
          data-pmo-decision-outcome-error
          className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--nx-status-danger)]"
        >
          {outcomeError}
        </p>
      ) : null}

      {/* readiness 结果回显（就绪 → 指纹；未通过 → 阻塞缺口清单） */}
      {readinessPacket ? (
        readinessPacket.ready ? (
          <p
            data-pmo-decision-readiness-ready
            className="rounded-sm border border-[var(--nx-status-success)]/50 bg-[rgba(16,185,129,0.08)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
          >
            readiness 就绪 · 已绑定证据指纹{' '}
            <span className="font-mono text-[var(--nx-status-success)]">
              {readinessPacket.fingerprint?.fingerprint}
            </span>{' '}
            （有效期至{' '}
            {readinessPacket.fingerprint?.expiresAt
              ? readinessPacket.fingerprint.expiresAt.slice(0, 16).replace('T', ' ')
              : '—'}
            ，TOCTOU 门在提交事务内重核）
          </p>
        ) : (
          <div
            data-pmo-decision-readiness-blocked
            className="rounded-sm border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-2.5 py-2"
          >
            <p className="text-[11px] text-[var(--nx-status-warning)]">
              存在阻塞缺口，结论暂不可提交：
            </p>
            <ul className="mt-1 space-y-0.5">
              {(readinessPacket.blockingFindings ?? []).map((finding) => (
                <li
                  key={finding.code}
                  data-blocking-finding={finding.code}
                  className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
                >
                  <span className="font-mono text-[var(--nx-status-danger)]">
                    {finding.severity}
                  </span>{' '}
                  {finding.message}
                  {finding.lensId ? (
                    <span className="text-[var(--nx-text-muted)]">（{finding.lensId}）</span>
                  ) : null}
                </li>
              ))}
            </ul>
            {(readinessPacket.warnings ?? []).length > 0 ? (
              <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
                另有 {(readinessPacket.warnings ?? []).length} 条非阻塞警告将在提交时确认。
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {/* 结论动作区（仅 decide + under-review） */}
      {canDecide && !isTerminal ? (
        <div data-pmo-decision-outcome-actions className="flex flex-col gap-2">
          {!underReview ? (
            <p className="rounded-sm border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[11px] text-[var(--nx-text-muted)]">
              议题需先流转至 under-review（审查中）方可记录结论。
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {PMO_DECISION_ACTION_ORDER.map((action) => {
              const meta = PMO_DECISION_OUTCOME_ACTION_META[action]
              const primary = action === 'approve'
              return (
                <button
                  key={action}
                  type="button"
                  data-outcome-action={action}
                  disabled={!underReview || checkReadiness.isPending}
                  onClick={() => void openOutcome(action)}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors disabled:opacity-40',
                    primary
                      ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)] hover:border-[var(--nx-accent)]'
                      : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]',
                  )}
                >
                  {checkReadiness.isPending && action === 'approve' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {meta.label}
                </button>
              )
            })}
            <span className="text-[10px] text-[var(--nx-text-muted)]">
              提交前自动执行 readiness 检查并绑定证据指纹
            </span>
          </div>
        </div>
      ) : null}

      {/* 终态只读归档标记 */}
      {isTerminal && caseStatus !== 'decided' ? (
        <p
          data-pmo-decision-terminal-archive
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[11px] text-[var(--nx-text-muted)]"
        >
          议题处于终态「{PMO_DECISION_TERMINAL_LABEL[caseStatus] ?? caseStatus}
          」——只读归档，结论操作区已隐藏。
        </p>
      ) : null}
      {isTerminal && caseStatus === 'decided' ? (
        <p
          data-pmo-decision-terminal-archive
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[11px] text-[var(--nx-text-muted)]"
        >
          议题已决定（decided）——结论操作区归档只读；如具备 pmo_decision:handoff
          权限仍可发起受控交接。
        </p>
      ) : null}

      {outcomeSuccess ? (
        <p
          data-pmo-decision-outcome-success
          className="rounded-sm border border-[var(--nx-status-success)]/50 bg-[rgba(16,185,129,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-success)]"
        >
          {outcomeSuccess}
        </p>
      ) : null}

      {/* 结论历史（audit 只读） */}
      {outcomesQuery.isPending ? (
        <div
          aria-busy="true"
          className="h-14 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]"
        />
      ) : (
        <div data-pmo-decision-outcome-history className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-medium text-[var(--nx-text-secondary)]">结论历史</h4>
          {outcomes.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-3 text-[11px] text-[var(--nx-text-muted)]">
              暂无结论记录。
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {[...outcomes]
                .sort((a, b) => b.id - a.id)
                .map((outcome) => (
                  <OutcomeHistoryRow key={outcome.id} outcome={outcome} />
                ))}
            </ul>
          )}
        </div>
      )}

      {/* 受控交接区（handoff 权限 + decided + approve 结论） */}
      {canCreateHandoffVisible ? (
        <div
          data-pmo-decision-handoff
          className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
        >
          <h4 className="text-[11px] font-medium text-[var(--nx-text-secondary)]">
            发起受控交接
            <span className="ml-1 font-normal text-[var(--nx-text-muted)]">
              （绑定最近 approve 结论 · 只产生待下游处理的引用，绝不自动执行）
            </span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {PMO_DECISION_HANDOFF_UI_TARGETS.map((entry) => {
              const optionMissing = entry.requiresSelectedOption && !approveOutcomeSelectedOptionId
              const active = handoffTarget === entry.target
              return (
                <label
                  key={entry.target}
                  data-handoff-target-option={entry.target}
                  data-handoff-target-disabled={optionMissing || undefined}
                  className={cn(
                    'flex cursor-pointer items-start gap-1.5 rounded-sm border px-2 py-1.5 text-[11px]',
                    active
                      ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]'
                      : 'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]',
                    optionMissing && 'cursor-not-allowed opacity-45',
                  )}
                  title={
                    optionMissing
                      ? '该目标要求 approve 时选中方案，当前结论未携带'
                      : entry.description
                  }
                >
                  <input
                    type="radio"
                    name="handoff-target"
                    disabled={optionMissing}
                    checked={active}
                    onChange={() => {
                      setHandoffTarget(entry.target)
                      setHandoffArmed(false)
                      setHandoffError(null)
                    }}
                    className="mt-0.5 accent-[var(--nx-accent)]"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-[var(--nx-text-primary)]">{entry.label}</span>
                    <span className="text-[10px] text-[var(--nx-text-muted)]">
                      {entry.description}
                      {optionMissing ? '（需选中方案）' : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          {handoffError ? (
            <p
              role="alert"
              data-pmo-decision-handoff-error
              className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.1)] px-2 py-1 text-[11px] text-[var(--nx-status-danger)]"
            >
              {handoffError}
            </p>
          ) : null}
          {handoffMessage ? (
            <p
              data-pmo-decision-handoff-message
              className="rounded-sm border border-[var(--nx-status-success)]/50 bg-[rgba(16,185,129,0.08)] px-2 py-1 text-[11px] text-[var(--nx-status-success)]"
            >
              {handoffMessage}
            </p>
          ) : null}

          {!handoffArmed ? (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                data-pmo-decision-handoff-open
                disabled={createHandoff.isPending}
                onClick={() => {
                  setHandoffArmed(true)
                  setHandoffError(null)
                }}
                className="flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] disabled:opacity-50"
              >
                <Send className="h-3 w-3" aria-hidden />
                发起交接
              </button>
            </div>
          ) : (
            <div
              data-pmo-decision-handoff-confirm
              className="flex flex-col gap-2 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 py-2"
            >
              <p className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                确认以你的身份（{identity ?? `用户 #${user?.id ?? '?'}`} · #{user?.id ?? '?'}）向 「
                {
                  PMO_DECISION_HANDOFF_UI_TARGETS.find((entry) => entry.target === handoffTarget)
                    ?.label
                }
                」发起交接？幂等键{' '}
                <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {handoffIdempotencyKey.slice(0, 40)}…
                </span>{' '}
                将生成 pending 下游引用，需下游自身的预览与人工确认才生效。
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  data-pmo-decision-handoff-cancel
                  disabled={createHandoff.isPending}
                  onClick={() => setHandoffArmed(false)}
                  className="h-7 rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-pmo-decision-handoff-submit
                  disabled={createHandoff.isPending}
                  onClick={() => void confirmHandoff()}
                  className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] disabled:opacity-50"
                >
                  {createHandoff.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : null}
                  确认发起
                </button>
              </div>
            </div>
          )}

          {/* 交接回执历史 */}
          {handoffsQuery.isPending ? (
            <div aria-busy="true" className="h-10 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
          ) : (handoffsQuery.data ?? []).length > 0 ? (
            <ul className="flex flex-col gap-1">
              {[...(handoffsQuery.data ?? [])]
                .sort((a, b) => b.id - a.id)
                .map((receipt) => (
                  <li
                    key={receipt.id}
                    data-pmo-decision-handoff-receipt
                    data-handoff-status={receipt.status}
                    className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2.5 py-1.5 text-[11px]"
                  >
                    <span
                      className="inline-flex h-5 items-center rounded-sm border px-1.5 text-[10px]"
                      style={{
                        color: HANDOFF_STATUS_META[receipt.status].color,
                        borderColor: 'var(--nx-border-hairline)',
                        backgroundColor: 'var(--nx-bg-0)',
                      }}
                    >
                      {HANDOFF_STATUS_META[receipt.status].label}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                      #{receipt.id}
                    </span>
                    <span className="text-[var(--nx-text-secondary)]">
                      {PMO_DECISION_HANDOFF_UI_TARGETS.find(
                        (entry) => entry.target === receipt.target,
                      )?.label ?? receipt.target}
                    </span>
                    {receipt.pendingTargetRef ? (
                      <a
                        data-pmo-decision-handoff-ref
                        href={receipt.pendingTargetRef}
                        className="underline decoration-dotted underline-offset-2 text-[var(--nx-accent)] hover:brightness-110"
                      >
                        {receipt.pendingTargetRef}
                      </a>
                    ) : null}
                    <span className="ml-auto text-[10px] text-[var(--nx-text-muted)]">
                      {receipt.createdAt.slice(0, 16).replace('T', ' ')} · by #{receipt.actorId}
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* 结论二次确认对话框 */}
      {confirmAction !== null && confirmActionMeta ? (
        <div data-pmo-decision-outcome-dialog className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            data-pmo-decision-outcome-scrim
            aria-label="关闭确认结论"
            tabIndex={-1}
            onClick={() => resetOutcomeDialog()}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={`确认${confirmActionMeta.label}结论`}
            data-pmo-decision-outcome-panel
            className="absolute left-1/2 top-1/2 flex max-h-[82vh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] shadow-[0_0_64px_rgba(0,0,0,0.6)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
                  <ShieldCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                    确认{confirmActionMeta.label}？
                  </h3>
                  <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                    人工结论唯一入口 · 议题将转入「{targetStatusLabel(confirmAction)}」
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-pmo-decision-outcome-close
                aria-label="关闭确认结论"
                onClick={() => resetOutcomeDialog()}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <dl
                data-outcome-audit-meta
                className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5 text-[11px]"
              >
                <div>
                  <dt className="text-[var(--nx-text-muted)]">执行人</dt>
                  <dd className="text-[var(--nx-text-primary)]">
                    {identity ?? `用户 #${user?.id ?? '?'}`}（#{user?.id ?? '?'}）
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--nx-text-muted)]">议题</dt>
                  <dd className="text-[var(--nx-text-primary)]">
                    #{decisionId} · r{caseRevision}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--nx-text-muted)]">决策类型</dt>
                  <dd className="text-[var(--nx-text-primary)]">{confirmActionMeta.label}</dd>
                </div>
                <div>
                  <dt className="text-[var(--nx-text-muted)]">目标状态</dt>
                  <dd className="text-[var(--nx-text-primary)]">
                    {targetStatusLabel(confirmAction)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[var(--nx-text-muted)]">证据指纹（TOCTOU 门）</dt>
                  <dd className="break-all font-mono text-[10px] text-[var(--nx-text-primary)]">
                    {fingerprint}
                  </dd>
                </div>
              </dl>

              {readinessPacket && (readinessPacket.warnings ?? []).length > 0 ? (
                <p className="text-[11px] text-[var(--nx-text-muted)]">
                  提交时将确认 {readinessPacket.warnings.length} 条非阻塞警告。
                </p>
              ) : null}

              {confirmAction === 'approve' ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    选中方案（必选）
                  </p>
                  {activeOptions.map((option) => (
                    <label
                      key={option.id}
                      data-outcome-option={option.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-2 text-xs',
                        selectedOptionId === option.id
                          ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]'
                          : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]',
                      )}
                    >
                      <input
                        type="radio"
                        name="outcome-option"
                        checked={selectedOptionId === option.id}
                        onChange={() => setSelectedOptionId(option.id)}
                        className="accent-[var(--nx-accent)]"
                      />
                      <span className="min-w-0 flex-1 text-[var(--nx-text-primary)]">
                        {option.label}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                        #{option.id}
                      </span>
                    </label>
                  ))}
                  {activeOptions.length === 0 ? (
                    <p
                      data-outcome-options-pending
                      className="rounded-sm border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2 text-[11px] text-[var(--nx-text-muted)]"
                    >
                      方案选项加载中或暂不可用——请等待数据就绪后选择方案再提交。
                    </p>
                  ) : null}
                </div>
              ) : null}

              {confirmAction === 'supersede' ? (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]">
                    取代本议题的新议题 ID（必填）
                  </span>
                  <input
                    data-outcome-supersede-target
                    className="h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                    placeholder="例如：102"
                    value={supersedeTargetDraft}
                    onChange={(event) => setSupersedeTargetDraft(event.target.value)}
                  />
                </label>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]">
                  理由（可选 · ≤{PMO_DECISION_RATIONALE_MAX_LENGTH} 字 · 审计只保留指纹与摘要）
                </span>
                <textarea
                  data-outcome-rationale
                  className="h-24 w-full resize-y rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs leading-relaxed text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                  maxLength={PMO_DECISION_RATIONALE_MAX_LENGTH}
                  value={rationaleDraft}
                  onChange={(event) => setRationaleDraft(event.target.value)}
                />
                <span className="mt-0.5 block text-right text-[10px] text-[var(--nx-text-muted)]">
                  {rationaleDraft.length}/{PMO_DECISION_RATIONALE_MAX_LENGTH}
                </span>
              </label>

              <p className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                决策 ≠ 执行：结论不会直接修改项目 / 任务 / 资源等业务数据，仅生成受控交接引用。
              </p>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3.5">
              <button
                type="button"
                data-pmo-decision-outcome-cancel
                disabled={submitOutcome.isPending}
                onClick={() => resetOutcomeDialog()}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                data-pmo-decision-outcome-submit
                disabled={!canSubmitOutcome}
                onClick={() => void submitConfirmedOutcome()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] disabled:opacity-40"
              >
                {submitOutcome.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                确认提交结论
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function OutcomeHistoryRow({ outcome }: { outcome: PmoDecisionOutcomeDTO }) {
  return (
    <li
      data-outcome-row
      data-outcome-action={outcome.action}
      className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[11px]"
    >
      <span className="text-[var(--nx-text-secondary)]">
        {PMO_DECISION_OUTCOME_ACTION_META[outcome.action]?.label ?? outcome.action}
      </span>
      {outcome.selectedOptionId ? (
        <span className="text-[var(--nx-text-muted)]">方案 #{outcome.selectedOptionId}</span>
      ) : null}
      <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
        digest {outcome.outcomeDigest}
      </span>
      <span className="ml-auto text-[10px] text-[var(--nx-text-muted)]">
        {outcome.createdAt.slice(0, 16).replace('T', ' ')} · by #{outcome.actorId}
      </span>
    </li>
  )
}

export default PmoDecisionOutcomePanel
