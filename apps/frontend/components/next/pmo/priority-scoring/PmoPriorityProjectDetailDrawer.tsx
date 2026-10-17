'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, Clock, ExternalLink, RefreshCw, X } from 'lucide-react'
import { usePriorityScoringDetail } from '@/hooks/use-priority-scoring'
import { PRIORITY_LEVEL_LABELS, SCORE_DIMENSION_LABELS } from '@aiproj/types'
import type { PriorityScoreItem } from '@aiproj/types'
import { priorityLevelVisual } from './pmo-priority-level-meta'

/**
 * 项目评分明细抽屉（v3-ui-next-pmo-domain W4 · tasks 4.3）。
 *
 * - 行点击唤起 → 消费 `usePriorityScoringDetail`（GET /pmo/priority-scoring/projects/:id）
 *   呈现分数构成（维度贡献：权重/归一化值/加权贡献）与权重明细；只读；
 * - 状态通道：forbidden 维度中性「不可见」且零数值；stale 维度黄色警示但仍展示
 *   （双通道）；freshness 列表与 warnings 逐条呈现；
 * - 底部「进入项目空间」链接直达 `/next/projects/:id`（跨景深下推）；
 * - 关闭零副作用：不触发任何写请求（RL-01）。
 */
export interface PmoPriorityProjectDetailDrawerProps {
  item: PriorityScoreItem | null
  open: boolean
  onClose: () => void
}

const UNAVAILABLE_LABEL: Record<string, string> = {
  forbidden: '不可见',
  unavailable: '数据不可用',
  unsupported: '维度不支持',
}

export function PmoPriorityProjectDetailDrawer({
  item,
  open,
  onClose,
}: PmoPriorityProjectDetailDrawerProps) {
  const detailQuery = usePriorityScoringDetail(item?.projectId ?? null)

  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || !item) return null

  const detail = detailQuery.data ?? null
  const loading =
    detailQuery.isPending || detailQuery.isLoading || (detailQuery.isFetching && detail === null)
  const priorityLevel = detail?.priorityLevel ?? item.priorityLevel
  const visual = priorityLevelVisual(priorityLevel)
  const dimensions = detail
    ? [...detail.dimensions].sort((a, b) => b.weightedContribution - a.weightedContribution)
    : []

  return (
    <div data-pps-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-pps-drawer-scrim
        aria-label="关闭评分明细"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${item.projectName} 评分明细`}
        data-pps-drawer-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="min-w-0">
            <h3
              data-pps-drawer-title
              className="truncate text-sm font-semibold text-[var(--nx-text-primary)]"
            >
              {item.projectName}
            </h3>
            <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--nx-text-muted)]">
              {item.scoreVersion} · 计算于{' '}
              {detail
                ? new Date(detail.calculatedAt).toLocaleString()
                : new Date(item.calculatedAt).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            data-pps-drawer-close
            aria-label="关闭评分明细"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {loading ? (
          <div
            data-pps-drawer-skeleton
            role="status"
            aria-busy="true"
            className="space-y-3 px-5 py-4"
          >
            <div className="h-12 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="h-8 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
            ))}
          </div>
        ) : detailQuery.isError || detail === null ? (
          <div
            data-pps-drawer-error
            role="alert"
            className="flex flex-col items-center gap-3 px-6 py-10 text-center"
          >
            <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
            <p className="text-xs text-[var(--nx-text-secondary)]">
              评分明细加载失败：{detailQuery.error?.message ?? '未知错误'}
            </p>
            <button
              type="button"
              data-pps-drawer-retry
              onClick={() => void detailQuery.refetch()}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新加载
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* 分数头 */}
            <div className="flex flex-wrap items-center gap-3">
              <span
                data-pps-drawer-score
                className="font-mono text-2xl font-semibold leading-none text-[var(--nx-text-primary)]"
              >
                {detail.priorityScore >= 0 ? detail.priorityScore.toFixed(1) : '—'}
              </span>
              <span
                data-pps-drawer-badge={priorityLevel}
                className="inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-xs font-medium"
                style={{
                  color: visual.token,
                  backgroundColor: visual.bg,
                  borderColor: visual.border,
                }}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: visual.dot }}
                />
                {PRIORITY_LEVEL_LABELS[priorityLevel]}
              </span>
              <span className="font-mono text-[11px] text-[var(--nx-text-muted)]">
                {detail.rank > 0 ? `组合排名 #${detail.rank}` : '未参与排名'}
              </span>
            </div>

            {/* 分数构成 */}
            <section>
              <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                分数构成与权重明细
              </h4>
              {dimensions.length === 0 ? (
                <p className="rounded-sm bg-[var(--nx-bg-0)] px-3 py-4 text-center text-[11px] text-[var(--nx-text-muted)]">
                  该评分未产生维度贡献（无可用输入源）。
                </p>
              ) : (
                <div className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)]">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-left text-[10px] text-[var(--nx-text-muted)]">
                        <th className="px-2.5 py-1.5 font-normal">维度</th>
                        <th className="px-2.5 py-1.5 text-right font-normal">权重</th>
                        <th className="px-2.5 py-1.5 text-right font-normal">归一化</th>
                        <th className="px-2.5 py-1.5 text-right font-normal">加权贡献</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dimensions.map((dimension) => {
                        const label =
                          SCORE_DIMENSION_LABELS[dimension.dimension] ?? dimension.dimension
                        const masked =
                          dimension.availability === 'forbidden' ||
                          dimension.availability === 'unavailable' ||
                          dimension.availability === 'unsupported'
                        return (
                          <tr
                            key={dimension.dimension}
                            data-pps-drawer-dim={dimension.dimension}
                            data-dim-availability={dimension.availability}
                            className="border-b border-[var(--nx-border-hairline)] last:border-0"
                          >
                            <td className="px-2.5 py-1.5">
                              <span className="flex items-center gap-1.5 text-[var(--nx-text-primary)]">
                                {label}
                                {dimension.availability === 'forbidden' ? (
                                  <span
                                    data-pps-drawer-dim-forbidden
                                    className="rounded-sm border border-[var(--nx-border-hairline)] px-1 py-0.5 text-[9px] text-[var(--nx-text-muted)]"
                                  >
                                    不可见
                                  </span>
                                ) : dimension.availability === 'stale' ? (
                                  <span className="inline-flex items-center gap-0.5 rounded-sm border border-[rgba(245,158,11,0.35)] px-1 py-0.5 text-[9px] text-[var(--nx-status-warning)]">
                                    <Clock className="h-2.5 w-2.5" aria-hidden />
                                    可能过期
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            {masked ? (
                              <td
                                colSpan={3}
                                className="px-2.5 py-1.5 text-right text-[10px] text-[var(--nx-text-muted)]"
                              >
                                {UNAVAILABLE_LABEL[dimension.availability] ?? '不可用'}
                              </td>
                            ) : (
                              <>
                                <td className="px-2.5 py-1.5 text-right font-mono text-[var(--nx-text-muted)]">
                                  {Math.round(dimension.weight * 100)}%
                                </td>
                                <td className="px-2.5 py-1.5 text-right font-mono text-[var(--nx-text-secondary)]">
                                  {dimension.normalizedValue}
                                </td>
                                <td className="px-2.5 py-1.5 text-right font-mono font-medium text-[var(--nx-text-primary)]">
                                  {dimension.weightedContribution.toFixed(1)}
                                </td>
                              </>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 源新鲜度 */}
            {detail.sourceFreshness.length > 0 ? (
              <section>
                <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                  输入源新鲜度
                </h4>
                <div data-pps-drawer-freshness className="space-y-1">
                  {detail.sourceFreshness.map((source) => (
                    <div
                      key={source.source}
                      data-pps-drawer-fresh={source.source}
                      className="flex items-center justify-between gap-2 rounded-sm bg-[var(--nx-bg-0)] px-2.5 py-1.5"
                    >
                      <span className="truncate font-mono text-[10px] text-[var(--nx-text-secondary)]">
                        {source.source}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                          {source.refreshedAt
                            ? new Date(source.refreshedAt).toLocaleString()
                            : '从未刷新'}
                        </span>
                        {source.stale ? (
                          <span
                            data-pps-drawer-fresh-stale
                            className="rounded-sm border border-[rgba(245,158,11,0.35)] px-1 py-0.5 text-[9px] text-[var(--nx-status-warning)]"
                          >
                            过期
                          </span>
                        ) : (
                          <span
                            data-pps-drawer-fresh-ok
                            className="rounded-sm border border-[var(--nx-border-hairline)] px-1 py-0.5 text-[9px] text-[var(--nx-status-success)]"
                          >
                            新鲜
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* warnings */}
            {detail.warnings.length > 0 ? (
              <section>
                <h4 className="mb-2 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                  数据提示
                </h4>
                <ul data-pps-drawer-warnings className="space-y-1">
                  {detail.warnings.map((warning, index) => (
                    <li
                      key={`${warning.code}-${index}`}
                      data-pps-drawer-warning={warning.code}
                      className="flex items-start gap-1.5 rounded-sm bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-warning)]"
                    >
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}

        <footer className="border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <Link
            href={`/next/projects/${item.projectId}`}
            data-pps-drawer-link
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            进入项目空间
          </Link>
        </footer>
      </aside>
    </div>
  )
}

export default PmoPriorityProjectDetailDrawer
