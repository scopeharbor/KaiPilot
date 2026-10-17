'use client'

import * as React from 'react'
import { AlertTriangle, FileClock, RefreshCw } from 'lucide-react'
import { useDecisionSnapshots, useRefreshDecisionEvidence } from '@/hooks/use-decision-workbench'
import { resolveDecisionActionError } from './PmoDecisionCreateDialog'
import type { PmoDecisionSnapshotReadiness, PmoDecisionSourceState } from '@aiproj/types'

/**
 * PMO 决策证据快照面板（v3-ui-next-pmo-domain W6 · tasks 6.4，
 * spec「决策工作台详情与人工结论闭环」证据区）。
 *
 * - 快照列表复用 `useDecisionSnapshots`：每条展示 revision / 整体 readiness /
 *   来源状态（available/stale/forbidden/unavailable/truncated 文字标签 + 颜色
 *   双通道，非 color-only）、收集时间与 hash；
 * - 「刷新证据」仅 `pmo_decision:manage` 且非终态可见，两步武装（arm → 再点确认）
 *   防误触；成功后由 mutation 失效 snapshots/comparison 缓存；
 * - 来源不可用/权限受限显式标注，不以零值伪装（后端脱敏语义）；
 * - 骨架 / 空态 / 错误重试三态闭环。
 */

export const PMO_DECISION_SOURCE_STATE_META: Record<
  PmoDecisionSourceState,
  { label: string; color: string; bg: string; border: string }
> = {
  available: {
    label: '可用',
    color: 'var(--nx-status-success)',
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.35)',
  },
  stale: {
    label: '已过期',
    color: 'var(--nx-status-warning)',
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.35)',
  },
  forbidden: {
    label: '权限受限',
    color: 'var(--nx-text-muted)',
    bg: 'rgba(122,139,161,0.12)',
    border: 'rgba(122,139,161,0.35)',
  },
  unavailable: {
    label: '不可用',
    color: 'var(--nx-status-danger)',
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.35)',
  },
  truncated: {
    label: '已截断',
    color: 'var(--nx-chart-4)',
    bg: 'rgba(251,191,36,0.12)',
    border: 'rgba(251,191,36,0.35)',
  },
}

const SNAPSHOT_READINESS_META: Record<
  PmoDecisionSnapshotReadiness,
  { label: string; color: string }
> = {
  ready: { label: '就绪', color: 'var(--nx-status-success)' },
  degraded: { label: '降级', color: 'var(--nx-status-warning)' },
  blocked: { label: '阻塞', color: 'var(--nx-status-danger)' },
}

export interface PmoDecisionEvidencePanelProps {
  decisionId: number
  /** 维护权限：刷新证据 = pmo_decision:manage（由容器注入，不在本组件重复权限判断）。 */
  canManage: boolean
  /** 终态议题证据冻结，不呈现刷新入口。 */
  isTerminal: boolean
}

export function PmoDecisionEvidencePanel({
  decisionId,
  canManage,
  isTerminal,
}: PmoDecisionEvidencePanelProps) {
  const snapshotsQuery = useDecisionSnapshots(decisionId)
  const refreshEvidence = useRefreshDecisionEvidence(decisionId)
  const [refreshArmed, setRefreshArmed] = React.useState(false)
  const [refreshError, setRefreshError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (refreshEvidence.isSuccess) setRefreshArmed(false)
  }, [refreshEvidence.isSuccess])

  if (snapshotsQuery.isPending) {
    return (
      <section
        data-pmo-decision-evidence
        aria-busy="true"
        className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <div className="h-5 w-32 animate-pulse rounded bg-[var(--nx-bg-1)]" />
        <div className="h-24 animate-pulse rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]" />
      </section>
    )
  }

  const snapshots = snapshotsQuery.data ?? []
  const canRefresh = canManage && !isTerminal && !refreshEvidence.isPending

  return (
    <section
      data-pmo-decision-evidence
      aria-label="证据快照"
      className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
            <FileClock className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">证据快照</h3>
            <p className="mt-0.5 text-[10px] text-[var(--nx-text-muted)]">
              权威来源摘要只读呈现 · 不可用来源显式标注，不做零值伪装
            </p>
          </div>
        </div>
        {canRefresh ? (
          refreshArmed ? (
            <button
              type="button"
              data-pmo-decision-evidence-refresh-confirm
              onClick={() => {
                setRefreshError(null)
                refreshEvidence.mutate(undefined, {
                  onError: (error) =>
                    setRefreshError(resolveDecisionActionError(error, '证据刷新失败')),
                })
              }}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-warning)]/60 bg-[rgba(245,158,11,0.1)] px-3 text-xs text-[var(--nx-status-warning)]"
            >
              再次点击确认刷新证据
            </button>
          ) : (
            <button
              type="button"
              data-pmo-decision-evidence-refresh
              onClick={() => {
                setRefreshArmed(true)
                setRefreshError(null)
              }}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              刷新证据
            </button>
          )
        ) : null}
      </header>

      {refreshError ? (
        <p
          role="alert"
          data-pmo-decision-evidence-error
          className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
        >
          {refreshError}
        </p>
      ) : null}

      {snapshotsQuery.isError ? (
        <div
          data-pmo-decision-evidence-error
          role="alert"
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
        >
          <AlertTriangle className="h-5 w-5 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">证据快照加载失败。</p>
          <button
            type="button"
            data-pmo-decision-evidence-retry
            onClick={() => void snapshotsQuery.refetch()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新载入
          </button>
        </div>
      ) : snapshots.length === 0 ? (
        <p
          data-pmo-decision-evidence-empty
          className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-8 text-center text-xs text-[var(--nx-text-muted)]"
        >
          尚无证据快照——请由具备 pmo_decision:manage 权限的成员「刷新证据」收集来源摘要。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {snapshots.map((snapshot) => (
            <li
              key={snapshot.id}
              data-pmo-decision-evidence-snapshot
              data-snapshot-revision={snapshot.snapshotRevision}
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="font-mono text-xs text-[var(--nx-text-secondary)]">
                  r{snapshot.snapshotRevision}
                </span>
                <span
                  data-snapshot-readiness={snapshot.readiness}
                  className="inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px]"
                  style={{
                    color: SNAPSHOT_READINESS_META[snapshot.readiness].color,
                    borderColor: 'var(--nx-border-hairline)',
                    backgroundColor: 'var(--nx-bg-1)',
                  }}
                >
                  整体 {SNAPSHOT_READINESS_META[snapshot.readiness].label}
                </span>
                <span className="text-[11px] text-[var(--nx-text-muted)]">
                  {snapshot.collectedAt.slice(0, 16).replace('T', ' ')}
                </span>
                {snapshot.truncated ? (
                  <span className="text-[11px] text-[var(--nx-status-warning)]">
                    结果按预算截断
                  </span>
                ) : null}
                <span className="ml-auto hidden font-mono text-[10px] text-[var(--nx-text-muted)] md:inline">
                  hash {snapshot.snapshotHash}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(snapshot.sourceStates ?? []).map((sourceState) => {
                  const meta = PMO_DECISION_SOURCE_STATE_META[sourceState.state]
                  return (
                    <span
                      key={sourceState.source}
                      data-source-state={sourceState.state}
                      className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px]"
                      style={{
                        color: meta.color,
                        backgroundColor: meta.bg,
                        borderColor: meta.border,
                      }}
                    >
                      <span className="font-mono text-[10px] opacity-90">{sourceState.source}</span>
                      <span>{meta.label}</span>
                      {sourceState.required ? <span className="opacity-70">（必需）</span> : null}
                    </span>
                  )
                })}
                {(snapshot.sourceStates ?? []).length === 0 ? (
                  <span className="text-[11px] text-[var(--nx-text-muted)]">
                    本次快照未包含来源维度
                  </span>
                ) : null}
              </div>
              {snapshot.warningCodes.length > 0 ? (
                <p className="mt-1.5 text-[11px] text-[var(--nx-status-warning)]">
                  提示：{snapshot.warningCodes.join('、')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default PmoDecisionEvidencePanel
