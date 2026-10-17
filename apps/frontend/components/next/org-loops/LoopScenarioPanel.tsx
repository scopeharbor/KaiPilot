'use client'

import * as React from 'react'
import { AlertTriangle, FlaskConical, Loader2, Plus, X } from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { useCreateRcclScenario, useSimulateRcclLoop } from '@/hooks/use-resource-capacity-loops'
import type { RcclLoopDetail } from '@/lib/api/resource-capacity-loops'
import { cn } from '@/lib/utils'

/**
 * What-if 情景面板（v3-ui-next-org-portfolio-domains W6 · tasks 6.4，
 * spec「资源容量闭环咨询工作台（列表与详情）」）。
 *
 * - 情景列表只读呈现（「假设」徽标语义：全部为假设性计算，未修改任何正式资源事实；
 *   已停用情景显式标注）；空态提示「至少需要 2 个情景才能模拟」；
 * - 创建情景：仅 resource_capacity_loop:manage 可见（RL-06 物理隐藏）；名称必填 +
 *   可选 capacity-delta overlay 行（role/bucket/deltaHours，后端 overlay 封闭字段
 *   白名单内）；创建走既有 useCreateRcclScenario（expectedRevision = 当前修订，
 *   冲突由后端 409 显式回显，不静默覆盖）；
 * - 模拟：useSimulateRcclLoop 按当前修订模拟全部情景；仅 draft/simulated 态 +
 *   基线可模拟 + 至少 2 个活动情景时可提交（能力门禁文案区分于权限隐藏）；
 * - mutation 提交防抖：isPending 期间按钮禁用，防止重复提交。
 */
export interface LoopScenarioPanelProps {
  loopId: number
  detail: RcclLoopDetail
  /** resource_capacity_loop:manage 判定：false 时创建/模拟入口物理隐藏（RL-06）。 */
  canManage: boolean
}

interface OverlayDraftRow {
  id: number
  role: string
  bucket: string
  deltaHours: string
}

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

let overlayRowSeq = 1

export function LoopScenarioPanel({ loopId, detail, canManage }: LoopScenarioPanelProps) {
  const createScenario = useCreateRcclScenario(loopId)
  const simulate = useSimulateRcclLoop(loopId)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [scenarioName, setScenarioName] = React.useState('')
  const [overlayRows, setOverlayRows] = React.useState<OverlayDraftRow[]>([])
  const [actionError, setActionError] = React.useState<string | null>(null)
  const dialogRef = React.useRef<HTMLDivElement | null>(null)

  // 表单在途提交期间与「取消」按钮同判据：Escape 不关闭新建情景弹窗。
  useDialogA11y({
    ref: dialogRef,
    open: createOpen,
    onClose: () => setCreateOpen(false),
    canClose: () => !createScenario.isPending,
  })

  const state = detail.loop.state
  const canMutateScenarios = state === 'draft' || state === 'simulated'
  const inSimulationWindow = canMutateScenarios
  const activeScenarios = detail.scenarios.filter((scenario) => scenario.active)
  const baselineReady = detail.baseline?.readyForSimulation === true
  const canSimulate = inSimulationWindow && baselineReady && activeScenarios.length >= 2

  function openCreateDialog() {
    setScenarioName('')
    setOverlayRows([])
    setActionError(null)
    setCreateOpen(true)
  }

  function addOverlayRow() {
    setOverlayRows((rows) => [
      ...rows,
      { id: overlayRowSeq++, role: '', bucket: '', deltaHours: '' },
    ])
  }

  function patchOverlayRow(id: number, patch: Partial<OverlayDraftRow>) {
    setOverlayRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function removeOverlayRow(id: number) {
    setOverlayRows((rows) => rows.filter((row) => row.id !== id))
  }

  function submitScenario() {
    const name = scenarioName.trim()
    if (!name) {
      setActionError('请填写情景名称')
      return
    }
    const overlays: unknown[] = overlayRows
      .filter((row) => row.role.trim() !== '')
      .map((row) => ({
        kind: 'capacity-delta',
        role: row.role.trim(),
        normalizedSkillKey: null,
        bucket: row.bucket || detail.loop.windowStart,
        deltaHours: Number(row.deltaHours) || 0,
      }))
    createScenario.mutate(
      { name, overlays, expectedRevision: detail.loop.revision },
      {
        onSuccess: () => {
          setCreateOpen(false)
          setScenarioName('')
          setOverlayRows([])
          setActionError(null)
        },
        onError: (error) => setActionError(errorTextOf(error, '情景创建失败，请重试')),
      },
    )
  }

  const simulationByScenario = React.useMemo(() => {
    const map = new Map<number, { id: number; digest: string; staleState: string }>()
    for (const simulation of detail.simulations) {
      const current = map.get(simulation.scenarioId)
      if (!current || (simulation.staleState === 'current' && current.staleState !== 'current')) {
        map.set(simulation.scenarioId, simulation)
      }
    }
    return map
  }, [detail.simulations])

  return (
    <section
      data-rccl-scenario-panel
      aria-labelledby="rccl-scenario-heading"
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="rccl-scenario-heading"
            className="text-sm font-semibold text-[var(--nx-text-primary)]"
          >
            What-if 情景（假设，未应用）
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
            全部为假设性计算，未修改任何正式资源事实
          </p>
        </div>
        {canManage && canMutateScenarios ? (
          <button
            type="button"
            data-rccl-scenario-create-open
            onClick={openCreateDialog}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            新建情景
          </button>
        ) : null}
      </header>

      {/* 情景列表（只读） */}
      <ul data-rccl-scenario-list className="mt-3 flex flex-col gap-1.5">
        {activeScenarios.map((scenario) => (
          <li
            key={scenario.id}
            data-rccl-scenario-row={scenario.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs"
          >
            <span className="rounded-full border border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] px-2 py-0.5 text-[11px] text-[var(--nx-status-warning)]">
              假设
            </span>
            <span className="text-[var(--nx-text-primary)]">{scenario.name}</span>
            <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
              v{scenario.revision}
            </span>
            {simulationByScenario.has(scenario.id) ? (
              <span
                data-rccl-scenario-snapshot
                className="ml-auto font-mono text-[10px] text-[var(--nx-text-muted)]"
              >
                模拟快照 #{simulationByScenario.get(scenario.id)?.id}
              </span>
            ) : null}
          </li>
        ))}
        {detail.scenarios.map((scenario) =>
          scenario.active ? null : (
            <li
              key={scenario.id}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-[var(--nx-text-muted)]"
            >
              <span className="rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-0.5 text-[11px]">
                已停用
              </span>
              <span className="line-through decoration-[var(--nx-text-muted)]/60">
                {scenario.name}
              </span>
            </li>
          ),
        )}
        {detail.scenarios.length === 0 ? (
          <li data-rccl-scenario-empty className="text-xs text-[var(--nx-text-muted)]">
            尚无情景。至少需要 2 个情景才能模拟。
          </li>
        ) : null}
      </ul>

      {/* 模拟区（manage 门禁 + 能力条件；仅 draft/simulated 可重新模拟） */}
      {canManage && inSimulationWindow ? (
        <div className="mt-3 border-t border-[var(--nx-border-hairline)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-rccl-simulate-button
              disabled={!canSimulate || simulate.isPending}
              onClick={() =>
                simulate.mutate(detail.loop.revision, {
                  onError: (error) => setActionError(errorTextOf(error, '模拟失败，请重试')),
                })
              }
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                canSimulate
                  ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]'
                  : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)]',
              )}
            >
              {simulate.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <FlaskConical className="h-3.5 w-3.5" aria-hidden />
              )}
              {simulate.isPending ? '模拟中…' : `模拟全部情景（当前修订 v${detail.loop.revision}）`}
            </button>
            {!canSimulate ? (
              <span data-rccl-simulate-hint className="text-[11px] text-[var(--nx-text-muted)]">
                {!inSimulationWindow
                  ? '当前状态不可重新模拟（仅草稿/已模拟可模拟）'
                  : !baselineReady
                    ? '基线未就绪：缺失或受限来源显式标记，不会被补零'
                    : '至少需要 2 个活动情景才能模拟'}
              </span>
            ) : null}
          </div>
          {simulate.isError ? (
            <p data-rccl-simulate-error className="mt-2 text-[11px] text-[var(--nx-status-danger)]">
              {errorTextOf(simulate.error, '模拟失败，请重试')}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 模拟快照摘要（只读） */}
      {detail.simulations.length > 0 ? (
        <div
          data-rccl-simulation-summary
          className="mt-3 border-t border-[var(--nx-border-hairline)] pt-3"
        >
          <p className="text-[11px] text-[var(--nx-text-secondary)]">
            已生成 {detail.simulations.length} 份模拟快照；全部为假设性计算，未修改任何
            正式资源事实。
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {detail.simulations.map((simulation) => {
              const scenario = detail.scenarios.find(
                (candidate) => candidate.id === simulation.scenarioId,
              )
              return (
                <li
                  key={simulation.id}
                  data-rccl-simulation-row={simulation.id}
                  className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--nx-text-muted)]"
                >
                  <span className="font-mono">#{simulation.id}</span>
                  <span>情景「{scenario?.name ?? `#${simulation.scenarioId}`}」</span>
                  <span className="font-mono text-[10px]">{simulation.digest}</span>
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-0.5 text-[10px]',
                      simulation.staleState === 'current'
                        ? 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)] text-[var(--nx-status-success)]'
                        : 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]',
                    )}
                  >
                    {simulation.staleState === 'current' ? '当前' : '过期'}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {/* 创建情景弹窗（RL-06 显式提交 + 防抖） */}
      {createOpen ? (
        <div data-rccl-scenario-dialog-overlay className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭新建情景弹窗"
            tabIndex={-1}
            onClick={() => setCreateOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-label="新建 What-if 情景"
            data-rccl-scenario-dialog
            className="absolute left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                新建 What-if 情景
              </h3>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setCreateOpen(false)}
                className="text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>
            <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 py-4">
              <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
                <span>情景名称（唯一）</span>
                <input
                  value={scenarioName}
                  onChange={(event) => setScenarioName(event.target.value)}
                  maxLength={120}
                  data-rccl-scenario-name
                  placeholder="例如：前端组 +20% 支援 2 周"
                  className="h-9 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-[13px] text-[var(--nx-text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                />
              </label>

              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--nx-text-secondary)]">
                  capacity-delta 调整项（可选）
                </span>
                <button
                  type="button"
                  data-rccl-overlay-add
                  onClick={addOverlayRow}
                  className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  添加调整项
                </button>
              </div>
              {overlayRows.length === 0 ? (
                <p className="text-[11px] text-[var(--nx-text-muted)]">
                  不添加调整项时将创建与基线一致的对照情景。
                </p>
              ) : (
                <div className="flex flex-col gap-2" data-rccl-overlay-rows>
                  {overlayRows.map((row) => (
                    <div
                      key={row.id}
                      data-rccl-overlay-row={row.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2"
                    >
                      <input
                        value={row.role}
                        onChange={(event) => patchOverlayRow(row.id, { role: event.target.value })}
                        placeholder="角色（如 前端工程师）"
                        aria-label="角色"
                        className="h-8 min-w-36 flex-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                      />
                      <input
                        value={row.bucket}
                        onChange={(event) =>
                          patchOverlayRow(row.id, { bucket: event.target.value })
                        }
                        placeholder="时间桶 yyyy-mm-dd"
                        aria-label="时间桶"
                        className="h-8 w-36 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 font-mono text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                      />
                      <input
                        value={row.deltaHours}
                        onChange={(event) =>
                          patchOverlayRow(row.id, { deltaHours: event.target.value })
                        }
                        placeholder="工时差"
                        aria-label="工时差"
                        type="number"
                        className="h-8 w-24 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 font-mono text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                      />
                      <button
                        type="button"
                        aria-label="移除调整项"
                        onClick={() => removeOverlayRow(row.id)}
                        className="text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-status-danger)]"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {actionError ? (
                <p
                  data-rccl-scenario-action-error
                  role="alert"
                  className="rounded-md border border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.14)] px-3 py-2 text-xs text-[var(--nx-status-danger)]"
                >
                  {actionError}
                </p>
              ) : null}
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                <AlertTriangle
                  className="mt-0.5 h-3 w-3 shrink-0 text-[var(--nx-status-warning)]"
                  aria-hidden
                />
                情景仅为假设性调整，不会写入任何正式资源记录；正式写入须在下游预览并
                二次确认后发生。
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <button
                type="button"
                data-rccl-scenario-dialog-cancel
                onClick={() => setCreateOpen(false)}
                disabled={createScenario.isPending}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-rccl-scenario-dialog-confirm
                disabled={createScenario.isPending || scenarioName.trim() === ''}
                onClick={submitScenario}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
              >
                {createScenario.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                )}
                创建情景
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default LoopScenarioPanel
