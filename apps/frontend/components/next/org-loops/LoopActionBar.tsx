'use client'

import * as React from 'react'
import {
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import {
  useCancelRcclLoop,
  useCloseRcclLoop,
  useHandoffRcclSelection,
  useReviewRcclLoop,
  useSelectRcclScenario,
} from '@/hooks/use-resource-capacity-loops'
import type { RcclLoopDetail } from '@/lib/api/resource-capacity-loops'
import { isLoopTerminalState } from '@/lib/next/org-loops/org-loops-adapter'
import { cn } from '@/lib/utils'

/**
 * 容量闭环生命周期动作条（v3-ui-next-org-portfolio-domains W6 · tasks 6.5，
 * spec「资源容量闭环咨询工作台（列表与详情）」）。
 *
 * - 动作按后端状态机出边呈现（@aiproj/types RESOURCE_CAPACITY_LOOP_ALLOWED_TRANSITIONS）：
 *   draft→simulated（模拟在情景面板）、simulated→select、selected→handoff、
 *   observing→review、reviewed→close、任意非终态→cancel；终态零动作；
 * - 全部写动作仅 resource_capacity_loop:manage 可见（RL-06 物理隐藏，不渲染
 *   disabled 暗示）；动作点击先弹确认窗（含各动作必填/可选参数），确认后才发出
 *   请求（RL-01/RL-06 二次确认 + isPending 防抖）；
 * - 咨询姿态红线文案常驻：选择仅表达方向，不构成对任何正式资源记录的写入授权；
 *   正式写入须在下游完成预览并二次确认后发生（本页面所有建议均未被应用）。
 */
export interface LoopActionBarProps {
  loopId: number
  detail: RcclLoopDetail
  /** resource_capacity_loop:manage 判定。 */
  canManage: boolean
}

const HANDOFF_TARGETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'cross-project-allocation-draft', label: '跨项目调配草案' },
  { value: 'project-resource-suggestion-preview', label: '项目资源建议预览' },
  { value: 'safe-navigation', label: '安全导航（不落下游草稿）' },
]

const REVIEW_OUTCOMES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'goal_met', label: '目标达成' },
  { value: 'partially_met', label: '部分达成' },
  { value: 'not_met', label: '未达成' },
  { value: 'invalidated', label: '判定无效' },
]

type PendingActionKind = 'select' | 'handoff' | 'review' | 'close' | 'cancel'

function errorTextOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
    const detail = (error as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail) return detail
  }
  return fallback
}

/** 生成幂等键（≥8 字符，后端 validator 下限）。 */
function newIdempotencyKey(loopId: number): string {
  return `rccl-${loopId}-${Date.now().toString(36)}`
}

export function LoopActionBar({ loopId, detail, canManage }: LoopActionBarProps) {
  const state = detail.loop.state

  const selectMutation = useSelectRcclScenario(loopId)
  const handoffMutation = useHandoffRcclSelection(loopId)
  const reviewMutation = useReviewRcclLoop(loopId)
  const closeMutation = useCloseRcclLoop(loopId)
  const cancelMutation = useCancelRcclLoop(loopId)

  const [pending, setPending] = React.useState<PendingActionKind | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  // ── 各动作候选数据（确定性派生）──
  const selectableScenarios = React.useMemo(() => {
    const snapshotByScenario = new Map<number, { id: number; staleState: string }>()
    for (const simulation of detail.simulations) {
      const current = snapshotByScenario.get(simulation.scenarioId)
      if (!current || (simulation.staleState === 'current' && current.staleState !== 'current')) {
        snapshotByScenario.set(simulation.scenarioId, {
          id: simulation.id,
          staleState: simulation.staleState,
        })
      }
    }
    return detail.scenarios
      .filter((scenario) => scenario.active && snapshotByScenario.has(scenario.id))
      .map((scenario) => ({
        scenario,
        snapshot: snapshotByScenario.get(scenario.id)!,
      }))
  }, [detail.scenarios, detail.simulations])

  const latestObservation = detail.observations[0] ?? null
  const activeMutation =
    pending === 'select'
      ? selectMutation
      : pending === 'handoff'
        ? handoffMutation
        : pending === 'review'
          ? reviewMutation
          : pending === 'close'
            ? closeMutation
            : cancelMutation
  const isBusy = activeMutation.isPending

  // ── 弹窗内表单状态 ──
  const [selectedScenarioId, setSelectedScenarioId] = React.useState<number | null>(null)
  const [handoffTarget, setHandoffTarget] = React.useState<string>(HANDOFF_TARGETS[0]!.value)
  const [idempotencyKey, setIdempotencyKey] = React.useState<string>(() =>
    newIdempotencyKey(loopId),
  )
  const [reviewOutcome, setReviewOutcome] = React.useState<string>(REVIEW_OUTCOMES[0]!.value)
  const [reviewRationale, setReviewRationale] = React.useState<string>('')
  const [cancelReason, setCancelReason] = React.useState<string>('')
  const dialogRef = React.useRef<HTMLDivElement | null>(null)

  // 表单在途提交期间与「取消」按钮同判据（closeDialog 亦自带该守卫）：Escape 不关闭。
  useDialogA11y({
    ref: dialogRef,
    open: pending !== null,
    onClose: closeDialog,
    canClose: () => !isBusy,
  })

  if (!canManage || isLoopTerminalState(state)) return null

  function openDialog(kind: PendingActionKind) {
    setActionError(null)
    setPending(kind)
    // 打开弹窗时重置表单并预选第一个候选（选择/复核场景）。
    if (kind === 'select') setSelectedScenarioId(selectableScenarios[0]?.scenario.id ?? null)
    if (kind === 'handoff') {
      setHandoffTarget(HANDOFF_TARGETS[0]!.value)
      setIdempotencyKey(newIdempotencyKey(loopId))
    }
    if (kind === 'review') {
      setReviewOutcome(REVIEW_OUTCOMES[0]!.value)
      setReviewRationale('')
    }
    if (kind === 'cancel') setCancelReason('')
  }

  function closeDialog() {
    if (isBusy) return
    setPending(null)
    setActionError(null)
  }

  function submitAction() {
    if (isBusy) return
    const onError = (error: unknown) => setActionError(errorTextOf(error, '操作失败，请重试'))
    const onSuccess = () => {
      setPending(null)
      setActionError(null)
    }
    if (pending === 'select') {
      const candidate = selectableScenarios.find(
        (entry) => entry.scenario.id === selectedScenarioId,
      )
      if (!candidate) {
        setActionError('请先选择一个已模拟的情景')
        return
      }
      selectMutation.mutate(
        {
          scenarioId: candidate.scenario.id,
          simulationSnapshotId: candidate.snapshot.id,
          acknowledgedWarnings:
            candidate.snapshot.staleState === 'current' ? [] : ['RCCL_SNAPSHOT_STALE'],
        },
        { onSuccess, onError },
      )
      return
    }
    if (pending === 'handoff') {
      handoffMutation.mutate(
        {
          target: handoffTarget,
          idempotencyKey,
          requestedRefs: [],
          authorizedVisibleRefIds: [],
        },
        { onSuccess, onError },
      )
      return
    }
    if (pending === 'review') {
      if (!latestObservation) {
        setActionError('该闭环尚无观察快照，无法提交复核')
        return
      }
      reviewMutation.mutate(
        {
          observationSnapshotId: latestObservation.id,
          outcome: reviewOutcome,
          boundedRationale: reviewRationale.trim(),
        },
        { onSuccess, onError },
      )
      return
    }
    if (pending === 'close') {
      closeMutation.mutate({ expectedRevision: detail.loop.revision }, { onSuccess, onError })
      return
    }
    cancelMutation.mutate(
      { reason: cancelReason.trim() === '' ? undefined : cancelReason.trim() },
      { onSuccess, onError },
    )
  }

  const actions: ReadonlyArray<{
    kind: PendingActionKind
    label: string
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
    visible: boolean
  }> = [
    {
      kind: 'select',
      label: '选择情景方向',
      icon: ShieldCheck,
      visible: state === 'simulated' && selectableScenarios.length > 0,
    },
    { kind: 'handoff', label: '移交下游', icon: Send, visible: state === 'selected' },
    {
      kind: 'review',
      label: '人工复核',
      icon: CheckCircle2,
      visible: state === 'observing' && latestObservation !== null,
    },
    { kind: 'close', label: '关闭闭环', icon: RefreshCw, visible: state === 'reviewed' },
    {
      kind: 'cancel',
      label: '取消闭环',
      icon: Ban,
      visible: state !== 'closed' && state !== 'cancelled',
    },
  ]
  const visibleActions = actions.filter((action) => action.visible)

  return (
    <section
      data-rccl-action-bar
      aria-label="容量闭环生命周期动作"
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--nx-text-primary)]">
            <ArrowRightLeft className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
            人工决策与受控移交
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            选择仅表达方向，不构成对任何正式资源记录的写入授权。正式写入须在下游完成预览并二次确认后发生——本页面建议均为咨询性质且未被应用。
          </p>
        </div>
      </header>

      {visibleActions.length === 0 ? (
        <p data-rccl-action-none className="mt-3 text-xs text-[var(--nx-text-muted)]">
          当前状态无可用生命周期动作。
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {visibleActions.map((action) => {
            const Icon = action.icon
            const destructive = action.kind === 'cancel'
            return (
              <button
                key={action.kind}
                type="button"
                data-rccl-action-open={action.kind}
                onClick={() => openDialog(action.kind)}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors',
                  destructive
                    ? 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)] hover:bg-[var(--nx-status-danger)] hover:text-white'
                    : 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {action.label}
              </button>
            )
          })}
        </div>
      )}

      {/* ── 二次确认弹窗（RL-06：确认后才发请求 + isPending 防抖）── */}
      {pending ? (
        <div data-rccl-action-dialog-overlay className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭确认弹窗"
            tabIndex={-1}
            onClick={closeDialog}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-label={dialogTitle(pending)}
            data-rccl-action-dialog={pending}
            className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                {dialogTitle(pending)}
              </h3>
            </header>
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 py-4">
              {pending === 'select' ? (
                <>
                  <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                    选择将记录当前方向偏好（选择仅表达方向，不构成对任何正式资源记录的写入授权）。选择带
                    72 小时过期与内容指纹，过期须重新选择。
                  </p>
                  <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                    <span>选择情景</span>
                    <select
                      value={selectedScenarioId ?? ''}
                      data-rccl-select-scenario
                      onChange={(event) => setSelectedScenarioId(Number(event.target.value))}
                      className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                    >
                      {selectableScenarios.map(({ scenario, snapshot }) => (
                        <option key={scenario.id} value={scenario.id}>
                          {scenario.name}（模拟快照 #{snapshot.id}
                          {snapshot.staleState === 'current' ? '' : ' · 已过期'})
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}

              {pending === 'handoff' ? (
                <>
                  <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                    受控移交将基于当前选择创建下游待审载体（仅创建草稿/预览，绝不代为
                    confirm/apply）；下游仍须独立预览并再次显式确认。
                  </p>
                  <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                    <span>移交目标</span>
                    <select
                      value={handoffTarget}
                      data-rccl-handoff-target
                      onChange={(event) => setHandoffTarget(event.target.value)}
                      className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                    >
                      {HANDOFF_TARGETS.map((target) => (
                        <option key={target.value} value={target.value}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                    <span>幂等键（自动生成，防重复提交）</span>
                    <input
                      value={idempotencyKey}
                      data-rccl-handoff-idemkey
                      readOnly
                      className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 font-mono text-xs text-[var(--nx-text-muted)]"
                    />
                  </label>
                </>
              ) : null}

              {pending === 'review' ? (
                <>
                  <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                    人工复核基于最新观察快照 #{latestObservation?.id}
                    ；观察到的变化不能仅凭时间先后归因于该选择。
                  </p>
                  <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                    <span>复核结论</span>
                    <select
                      value={reviewOutcome}
                      data-rccl-review-outcome
                      onChange={(event) => setReviewOutcome(event.target.value)}
                      className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                    >
                      {REVIEW_OUTCOMES.map((outcome) => (
                        <option key={outcome.value} value={outcome.value}>
                          {outcome.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                    <span>有界理由（≤500 字，可选）</span>
                    <textarea
                      value={reviewRationale}
                      data-rccl-review-rationale
                      maxLength={500}
                      rows={3}
                      onChange={(event) => setReviewRationale(event.target.value)}
                      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                    />
                  </label>
                </>
              ) : null}

              {pending === 'close' ? (
                <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                  确认关闭该容量闭环（修订 v{detail.loop.revision}）？关闭后状态不可逆，
                  闭环记录将保留为终态档案。
                </p>
              ) : null}

              {pending === 'cancel' ? (
                <>
                  <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                    取消后该闭环进入「已取消」终态，不可恢复。此操作仅废弃本闭环的咨询工作，不触碰任何正式资源记录。
                  </p>
                  <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                    <span>取消原因（≤200 字，可选）</span>
                    <textarea
                      value={cancelReason}
                      data-rccl-cancel-reason
                      maxLength={200}
                      rows={2}
                      onChange={(event) => setCancelReason(event.target.value)}
                      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                    />
                  </label>
                </>
              ) : null}

              {actionError ? (
                <p
                  data-rccl-action-error
                  role="alert"
                  className="rounded-md border border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)] px-3 py-2 text-xs text-[var(--nx-status-danger)]"
                >
                  {actionError}
                </p>
              ) : null}
            </div>
            <footer className="flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <p className="text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
                本页面所有建议均为咨询性质且未被应用。
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  data-rccl-action-dialog-cancel
                  onClick={closeDialog}
                  disabled={isBusy}
                  className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  data-rccl-action-dialog-confirm
                  disabled={isBusy}
                  onClick={submitAction}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-md border px-4 text-xs font-medium transition-colors disabled:opacity-50',
                    pending === 'cancel'
                      ? 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)] hover:bg-[var(--nx-status-danger)] hover:text-white'
                      : 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]',
                  )}
                >
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  确认提交
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function dialogTitle(kind: PendingActionKind): string {
  switch (kind) {
    case 'select':
      return '确认选择情景方向'
    case 'handoff':
      return '确认创建受控移交'
    case 'review':
      return '确认提交人工复核'
    case 'close':
      return '确认关闭闭环'
    case 'cancel':
      return '确认取消闭环'
  }
}

export default LoopActionBar
