'use client'

import * as React from 'react'
import { GitBranch, Scale, Users } from 'lucide-react'
import {
  useDecisionComparison,
  useDecisionOptions,
  useDecisionPositions,
  useRecordDecisionPosition,
} from '@/hooks/use-decision-workbench'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { PMO_DECISION_POSITION_NOTE_MAX_LENGTH } from '@aiproj/types'
import type { PmoDecisionComparisonCell } from '@aiproj/types'
import { resolveDecisionActionError } from './PmoDecisionCreateDialog'

/**
 * PMO 决策方案 / 对比 / 立场面板（v3-ui-next-pmo-domain W6 · tasks 6.4，
 * spec「决策工作台详情与人工结论闭环」方案与立场区）。
 *
 * - 方案选项：2–5 约束提示、启停用呈现（停用降透明 + 文字标注），只读；
 * - 确定性对比视图：仅投影权威事实单元格（可对比显示基线/对照/Δ；不可对比显式
 *   标注原因），不生成总分或 winner（后端契约 hasWinnerScore=false 语义）；
 * - 参与者立场：recordPosition 按后端 DecisionWorkbenchPolicy 语义仅需
 *   `pmo_decision:view`（MEMBER/OBSERVER 亦可留痕）——按钮对全部可见用户呈现；
 *   提交前需确认当前身份与立场内容（审计留痕），note ≤500 字可选；
 * - 终态议题隐藏立场写入区（立场冻结由服务端 immutableAfterDecision 裁决）。
 */
export interface PmoDecisionOptionsPanelProps {
  decisionId: number
  caseRevision: number
  isTerminal: boolean
}

type Stance = 'support' | 'oppose' | 'abstain'

const STANCE_META: Record<
  Stance,
  { label: string; short: string; color: string; bg: string; border: string }
> = {
  support: {
    label: '支持',
    short: '支持',
    color: 'var(--nx-status-success)',
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.35)',
  },
  oppose: {
    label: '反对（异议）',
    short: '反对',
    color: 'var(--nx-status-danger)',
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.35)',
  },
  abstain: {
    label: '弃权',
    short: '弃权',
    color: 'var(--nx-text-secondary)',
    bg: 'rgba(148,163,184,0.12)',
    border: 'rgba(148,163,184,0.35)',
  },
}

const NOT_COMPARABLE_LABELS: Record<string, string> = {
  UNIT_MISMATCH: '单位不一致',
  WINDOW_MISMATCH: '时间窗不一致',
  SCOPE_MISMATCH: '范围不一致',
  SOURCE_VERSION_MISMATCH: '来源版本不一致',
  MISSING_VALUE: '缺少值',
}

function formatCellValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function PmoDecisionOptionsPanel({
  decisionId,
  caseRevision,
  isTerminal,
}: PmoDecisionOptionsPanelProps) {
  const user = useAuthStore((state) => state.user)
  const optionsQuery = useDecisionOptions(decisionId)
  const positionsQuery = useDecisionPositions(decisionId)
  const comparisonQuery = useDecisionComparison(decisionId, caseRevision)
  const recordPosition = useRecordDecisionPosition(decisionId)

  const [pendingStance, setPendingStance] = React.useState<Stance | null>(null)
  const [noteDraft, setNoteDraft] = React.useState('')
  const [positionError, setPositionError] = React.useState<string | null>(null)

  const identity = user ? (user.fullName ?? user.email) : null

  const comparison = comparisonQuery.data
  const optionById = new Map((optionsQuery.data ?? []).map((option) => [option.id, option]))

  function openStance(stance: Stance): void {
    setPositionError(null)
    if (pendingStance === stance) {
      setPendingStance(null)
      return
    }
    setPendingStance(stance)
    setNoteDraft('')
  }

  function submitPosition(): void {
    if (pendingStance === null) return
    setPositionError(null)
    recordPosition.mutate(
      { stance: pendingStance, note: noteDraft.trim() === '' ? undefined : noteDraft.trim() },
      {
        onSuccess: () => {
          setPendingStance(null)
          setNoteDraft('')
        },
        onError: (error) => {
          setPositionError(resolveDecisionActionError(error, '立场记录失败'))
        },
      },
    )
  }

  const panelShell =
    'flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4'

  return (
    <section
      data-pmo-decision-options-panel
      aria-label="候选方案与参与者立场"
      className={panelShell}
    >
      <header className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
          <GitBranch className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">候选方案与立场</h3>
          <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">
            方案预算 2–5 个 · 确定性对比无 winner 分数 · 立场仅由参与者本人留痕
          </p>
        </div>
      </header>

      {/* 方案选项 */}
      {optionsQuery.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          {[0, 1].map((row) => (
            <div
              key={row}
              className="h-20 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]"
            />
          ))}
        </div>
      ) : optionsQuery.isError ? (
        <p
          data-pmo-decision-options-error
          role="alert"
          className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-6 text-center text-xs text-[var(--nx-text-muted)]"
        >
          方案选项加载失败。
        </p>
      ) : (optionsQuery.data ?? []).length === 0 ? (
        <p
          data-pmo-decision-options-empty
          className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-6 text-center text-xs text-[var(--nx-text-muted)]"
        >
          尚未登记候选方案（议题需备齐 2–5 个方案方可进入结论）。
        </p>
      ) : (
        <ul data-pmo-decision-options-list className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {(optionsQuery.data ?? []).map((option) => (
            <li
              key={option.id}
              data-pmo-decision-option
              data-option-id={option.id}
              data-option-active={option.active}
              className={cn(
                'flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5',
                !option.active && 'opacity-55',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium leading-snug text-[var(--nx-text-primary)]">
                  {option.label}
                </span>
                {option.active ? (
                  <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                    #{option.id} r{option.revision}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] px-1 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                    已停用
                  </span>
                )}
              </div>
              {option.proposedOutcomeCategory ? (
                <p className="text-[11px] text-[var(--nx-text-muted)]">
                  预期结果类型：{option.proposedOutcomeCategory}
                </p>
              ) : null}
              {option.assumptions.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                  {option.assumptions.slice(0, 3).map((assumption) => (
                    <li key={assumption}>假设：{assumption}</li>
                  ))}
                </ul>
              ) : null}
              {option.constraints.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                  {option.constraints.slice(0, 3).map((constraint) => (
                    <li key={constraint}>约束：{constraint}</li>
                  ))}
                </ul>
              ) : null}
              {option.affectedProjectRefs.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {option.affectedProjectRefs.map((ref) => (
                    <span
                      key={ref}
                      className="rounded-sm border border-[var(--nx-border-hairline)] px-1 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
                    >
                      {ref}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* 确定性对比视图（只读投影） */}
      <div data-pmo-decision-comparison className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
          <Scale className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
          方案确定性对比
          {comparison && comparison.cells.length > 0 ? (
            <span className="font-normal text-[var(--nx-text-muted)]">
              （基线 vs 候选 · lens {comparison.lensVersions.map((lens) => lens.version).join('、')}
              ）
            </span>
          ) : null}
        </h4>
        {comparisonQuery.isPending ? (
          <div className="h-16 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]" />
        ) : comparisonQuery.isError ? (
          <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-4 text-[11px] text-[var(--nx-text-muted)]">
            对比视图暂不可用。
          </p>
        ) : comparison && comparison.cells.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-md border border-[var(--nx-border-hairline)]">
              <table
                className="w-full min-w-[560px] text-left text-xs"
                aria-label="方案确定性对比表"
              >
                <thead>
                  <tr className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                    <th className="px-3 py-2">度量引用</th>
                    <th className="px-3 py-2">
                      基线（
                      {comparison.baselineOptionId
                        ? (optionById.get(comparison.baselineOptionId)?.label ??
                          `#${comparison.baselineOptionId}`)
                        : '—'}
                      ）
                    </th>
                    <th className="px-3 py-2">
                      候选（
                      {comparison.candidateOptionId
                        ? (optionById.get(comparison.candidateOptionId)?.label ??
                          `#${comparison.candidateOptionId}`)
                        : '—'}
                      ）
                    </th>
                    <th className="px-3 py-2">Δ</th>
                    <th className="px-3 py-2">lens</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.cells.map((cell) => (
                    <ComparisonRow key={`${cell.lensId}:${cell.measureRef}`} cell={cell} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
              对比仅投影权威来源事实；不可比单元格显式标注原因，不生成总分或 winner。
            </p>
          </>
        ) : (
          <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-4 text-[11px] text-[var(--nx-text-muted)]">
            尚无对比数据——请先刷新证据快照。
          </p>
        )}
      </div>

      {/* 参与者立场 */}
      <div data-pmo-decision-positions className="flex flex-col gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
          <Users className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
          参与者立场
          {isTerminal ? (
            <span className="font-normal text-[var(--nx-text-muted)]">（终态立场冻结，只读）</span>
          ) : null}
        </h4>

        {!isTerminal ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(STANCE_META) as Stance[]).map((stance) => (
              <button
                key={stance}
                type="button"
                data-position-stance={stance}
                aria-pressed={pendingStance === stance}
                onClick={() => openStance(stance)}
                disabled={recordPosition.isPending}
                className={cn(
                  'h-7 rounded-sm border px-2.5 text-xs transition-colors disabled:opacity-50',
                  pendingStance === stance
                    ? 'font-medium'
                    : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]',
                )}
                style={
                  pendingStance === stance
                    ? {
                        color: STANCE_META[stance].color,
                        backgroundColor: STANCE_META[stance].bg,
                        borderColor: STANCE_META[stance].border,
                      }
                    : undefined
                }
              >
                记录{STANCE_META[stance].label}
              </button>
            ))}
          </div>
        ) : null}

        {pendingStance !== null ? (
          <div
            data-pmo-decision-position-confirm
            className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 py-2.5"
          >
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              以
              {identity ? (
                <span className="font-medium text-[var(--nx-text-primary)]"> {identity} </span>
              ) : (
                <span className="font-medium text-[var(--nx-text-primary)]"> 当前用户 </span>
              )}
              （用户 #{user?.id ?? '?'}）的身份记录立场「
              <span style={{ color: STANCE_META[pendingStance].color }}>
                {STANCE_META[pendingStance].short}
              </span>
              」——该记录将作为审计留痕，确认后不可匿名修改。
            </p>
            <textarea
              data-pmo-decision-position-note
              aria-label="立场说明（可选）"
              className="h-16 w-full resize-y rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1.5 text-xs leading-relaxed text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              maxLength={PMO_DECISION_POSITION_NOTE_MAX_LENGTH}
              placeholder="立场说明（可选，≤500 字；服务端只保留摘要与指纹）"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
            />
            {positionError ? (
              <p
                role="alert"
                data-pmo-decision-position-error
                className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.1)] px-2 py-1 text-[11px] text-[var(--nx-status-danger)]"
              >
                {positionError}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                data-pmo-decision-position-cancel
                onClick={() => setPendingStance(null)}
                disabled={recordPosition.isPending}
                className="h-7 rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-pmo-decision-position-submit
                disabled={recordPosition.isPending}
                onClick={submitPosition}
                className="h-7 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] disabled:opacity-50"
              >
                {recordPosition.isPending ? '记录中…' : '确认记录立场'}
              </button>
            </div>
          </div>
        ) : null}

        {positionsQuery.isPending ? (
          <div className="h-12 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]" />
        ) : positionsQuery.isError ? (
          <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-4 text-[11px] text-[var(--nx-text-muted)]">
            立场记录加载失败。
          </p>
        ) : (positionsQuery.data ?? []).length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-4 text-[11px] text-[var(--nx-text-muted)]">
            暂无参与者立场记录。
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {(positionsQuery.data ?? []).map((position) => (
              <li
                key={position.id}
                data-position-row
                data-stance={position.stance}
                className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs"
              >
                <span
                  className="inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px]"
                  style={{
                    color: STANCE_META[position.stance].color,
                    backgroundColor: STANCE_META[position.stance].bg,
                    borderColor: STANCE_META[position.stance].border,
                  }}
                >
                  {STANCE_META[position.stance].short}
                </span>
                <span className="text-[var(--nx-text-secondary)]">
                  参与者 #{position.participantId}
                </span>
                {position.notePreview ? (
                  <span className="min-w-0 flex-1 truncate text-[var(--nx-text-muted)]">
                    {position.notePreview}
                  </span>
                ) : null}
                {position.immutableAfterDecision ? (
                  <span className="text-[10px] text-[var(--nx-text-muted)]">已冻结</span>
                ) : null}
                <span className="ml-auto text-[10px] text-[var(--nx-text-muted)]">
                  {position.createdAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function ComparisonRow({ cell }: { cell: PmoDecisionComparisonCell }) {
  if (cell.comparable) {
    return (
      <tr className="border-b border-[var(--nx-border-hairline)] last:border-0">
        <td className="px-3 py-1.5 font-mono text-[11px] text-[var(--nx-text-secondary)]">
          {cell.measureRef}
        </td>
        <td className="px-3 py-1.5 text-[var(--nx-text-primary)]">
          {formatCellValue(cell.baselineValue)}
        </td>
        <td className="px-3 py-1.5 text-[var(--nx-text-primary)]">
          {formatCellValue(cell.candidateValue)}
        </td>
        <td className="px-3 py-1.5 font-mono text-[var(--nx-text-primary)]">
          {formatCellValue(cell.delta)}
          {cell.unit ? (
            <span className="ml-1 text-[10px] text-[var(--nx-text-muted)]">{cell.unit}</span>
          ) : null}
        </td>
        <td className="px-3 py-1.5 text-[10px] text-[var(--nx-text-muted)]">{cell.lensId}</td>
      </tr>
    )
  }
  return (
    <tr className="border-b border-[var(--nx-border-hairline)] last:border-0 opacity-70">
      <td className="px-3 py-1.5 font-mono text-[11px] text-[var(--nx-text-secondary)]">
        {cell.measureRef}
      </td>
      <td className="px-3 py-1.5 text-[var(--nx-text-muted)]">—</td>
      <td className="px-3 py-1.5 text-[var(--nx-text-muted)]">—</td>
      <td
        className="px-3 py-1.5 text-[var(--nx-status-warning)]"
        title={cell.notComparableReason ?? undefined}
      >
        {NOT_COMPARABLE_LABELS[cell.notComparableReason ?? ''] ?? '不可比'}
      </td>
      <td className="px-3 py-1.5 text-[10px] text-[var(--nx-text-muted)]">{cell.lensId}</td>
    </tr>
  )
}

export default PmoDecisionOptionsPanel
