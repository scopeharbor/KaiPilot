'use client'

import * as React from 'react'
import { EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OkrDashboardSummary, OkrDashboardWarning } from '@aiproj/types'
import {
  OKR_DASHBOARD_METRIC_LABELS,
  formatOkrDashboardWarning,
  formatOkrMetricValue,
  formatOkrRelativeTime,
  isOkrMetricRedacted,
  okrAttentionReasonLabel,
  okrDashboardWarningChipClass,
  selectOkrDashboardKpis,
} from '@/lib/next/org-okr/org-okr-adapter'

/**
 * OKR 仪表盘分区摘要卡片矩阵（v3-ui-next-org-portfolio-domains W2 · tasks 2.6，
 * spec「OKR 达成仪表盘：sections 分区摘要」）。
 *
 * - 纯展示层：消费 `useOkrDashboardSummary` 返回的 OkrDashboardSummary（GET
 *   /okrs/dashboard，周期联动查询参数由工作台收敛），零网络、零写；
 * - KPI 卡（固定白名单顺序 + 全量指标标签）、进度/状态分布、关注项（原因中文
 *   徽标）、对齐健康度/证据新鲜度/进度回流/数据源新鲜度/警告 rail；
 * - RL-05 指标级脱敏：受限 KPI（value null / forbidden / unavailable）与受限面板
 *   一律 `EyeOff` + 中性「不可见」文案，界面不出现任何猜测数值；
 * - 双通道：分布条带颜色 + 数值文本并存（颜色仅供扫描，语义以文字为准）。
 */

const CHIP_CLASS =
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap'

export interface OkrDashboardSectionsProps {
  summary: OkrDashboardSummary
}

export function OkrDashboardSections({ summary }: OkrDashboardSectionsProps) {
  const kpis = selectOkrDashboardKpis(summary)
  const attention = summary.attention ?? []
  const alignment = summary.alignmentHealth
  const evidence = summary.evidenceFreshness
  const backflow = summary.backflow
  const staleSources = summary.sourceFreshness.filter((source) => source.isStale)

  return (
    <div data-okr-dash-sections className="flex flex-col gap-4">
      {/* 关键指标 KPI 卡（固定顺序选区） */}
      <section
        data-okr-dash-section="kpi"
        aria-label="关键指标"
        className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">关键指标</h3>
        <div data-okr-dash-kpi-strip className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {kpis.map((metric) => {
            const redacted = isOkrMetricRedacted(metric)
            return (
              <div
                key={metric.key}
                data-okr-dash-kpi={metric.key}
                data-okr-dash-kpi-redacted={redacted || undefined}
                className={cn(
                  'flex flex-col gap-1.5 rounded-sm border px-3 py-2.5',
                  redacted
                    ? 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]'
                    : 'border-[var(--nx-border-focus)]/50 bg-[var(--nx-bg-0)]',
                )}
              >
                {redacted ? (
                  <span className="flex items-center gap-1.5 text-xs text-[var(--nx-text-muted)]">
                    <EyeOff className="h-3.5 w-3.5" aria-hidden />
                    不可见
                  </span>
                ) : (
                  <span
                    data-okr-dash-kpi-value
                    className="font-mono text-lg font-semibold text-[var(--nx-text-primary)]"
                  >
                    {formatOkrMetricValue(metric)}
                  </span>
                )}
                <span
                  data-okr-dash-kpi-label
                  className="text-[11px] text-[var(--nx-text-secondary)]"
                >
                  {OKR_DASHBOARD_METRIC_LABELS[metric.key] ?? metric.key}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* 进度 / 状态分布 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DistributionCard
          title="进度分布"
          testId="okr-dash-progress-distribution"
          slices={summary.progressDistribution}
        />
        <DistributionCard
          title="状态分布"
          testId="okr-dash-status-distribution"
          slices={summary.statusDistribution}
        />
      </div>

      {/* 关注项 */}
      <section
        data-okr-dash-section="attention"
        aria-label="关注项"
        className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">关注项</h3>
        {attention.length === 0 ? (
          <p data-okr-dash-attention-empty className="mt-2 text-[11px] text-[var(--nx-text-muted)]">
            当前周期无关注项。
          </p>
        ) : (
          <ul data-okr-dash-attention-list className="mt-3 space-y-2">
            {attention.map((item) => (
              <li
                key={`${item.kind}-${item.entityId}`}
                data-okr-dash-attention={`${item.kind}-${item.entityId}`}
                className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2"
              >
                <span className="text-[10px] text-[var(--nx-text-muted)]">
                  {item.kind === 'objective' ? 'O' : 'KR'}
                </span>
                <span
                  data-okr-dash-attention-title
                  className="min-w-0 flex-1 truncate text-xs text-[var(--nx-text-primary)]"
                >
                  {item.title}
                </span>
                {item.progress !== null ? (
                  <span className="font-mono text-[10px] text-[var(--nx-text-secondary)]">
                    {Math.round(item.progress)}%
                  </span>
                ) : null}
                <span className="flex flex-wrap gap-1">
                  {(item.reasons ?? []).map((reason) => (
                    <span
                      key={reason}
                      className={cn(
                        CHIP_CLASS,
                        'border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.16)] text-[var(--nx-status-warning)]',
                      )}
                    >
                      {okrAttentionReasonLabel(reason)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 对齐健康度 / 证据新鲜度 / 进度回流 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PanelCard
          title="对齐健康度"
          available={alignment.available}
          forbidden={alignment.forbidden}
        >
          {alignment.available && !alignment.forbidden ? (
            <dl data-okr-dash-alignment className="space-y-1.5 text-xs">
              <Row
                label="健康分"
                value={alignment.healthScore !== null ? alignment.healthScore.toFixed(1) : '—'}
              />
              <Row
                label="孤立目标"
                value={
                  alignment.orphanObjectiveCount !== null
                    ? String(alignment.orphanObjectiveCount)
                    : '—'
                }
              />
              <Row
                label="弱对齐"
                value={
                  alignment.weakAlignmentCount !== null ? String(alignment.weakAlignmentCount) : '—'
                }
              />
            </dl>
          ) : null}
        </PanelCard>
        <PanelCard title="证据新鲜度" available={evidence.available} forbidden={evidence.forbidden}>
          {evidence.available && !evidence.forbidden ? (
            <dl data-okr-dash-evidence className="space-y-1.5 text-xs">
              <Row
                label="证据总数"
                value={evidence.totalEvidence !== null ? String(evidence.totalEvidence) : '—'}
              />
              <Row
                label="过期证据"
                value={evidence.staleEvidence !== null ? String(evidence.staleEvidence) : '—'}
              />
              <Row
                label="受限证据"
                value={
                  evidence.restrictedEvidence !== null ? String(evidence.restrictedEvidence) : '—'
                }
              />
              <Row label="最近证据" value={formatOkrRelativeTime(evidence.freshestAt)} />
            </dl>
          ) : null}
        </PanelCard>
        <PanelCard title="进度回流" available={backflow.available} forbidden={backflow.forbidden}>
          {backflow.available && !backflow.forbidden ? (
            <dl data-okr-dash-backflow className="space-y-1.5 text-xs">
              <Row
                label="回流候选"
                value={backflow.candidateCount !== null ? String(backflow.candidateCount) : '—'}
              />
              <Row
                label="回流冲突"
                value={backflow.conflictCount !== null ? String(backflow.conflictCount) : '—'}
              />
              <Row
                label="过期候选"
                value={backflow.staleCount !== null ? String(backflow.staleCount) : '—'}
              />
            </dl>
          ) : null}
        </PanelCard>
      </div>

      {/* 数据源新鲜度 + 警告 rail */}
      {staleSources.length > 0 ? (
        <section
          data-okr-dash-stale-rail
          aria-label="过期数据源"
          className="rounded-md border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.06)] px-3 py-2"
        >
          <p className="text-[11px] text-[var(--nx-status-warning)]">
            以下数据来源已过期，数值仅供参考：
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {staleSources.map((source) => (
              <li
                key={source.source}
                data-okr-dash-source={source.source}
                className={cn(
                  CHIP_CLASS,
                  'border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.16)] text-[var(--nx-status-warning)]',
                )}
                title={
                  source.lastUpdatedAt
                    ? `最近更新 ${formatOkrRelativeTime(source.lastUpdatedAt)}`
                    : '最近更新时间未知'
                }
              >
                {source.source} · 已过期
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.warnings.length > 0 ? (
        <section
          data-okr-dash-warning-rail
          aria-label="仪表盘警告"
          className="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2"
        >
          {summary.warnings.map((warning, index) => (
            <WarningChip key={`${warning.code}-${index}`} warning={warning} />
          ))}
        </section>
      ) : null}
    </div>
  )
}

// ── 子件 ────────────────────────────────────────────────────────────────────

function DistributionCard({
  title,
  testId,
  slices,
}: {
  title: string
  testId: string
  slices: OkrDashboardSummary['progressDistribution']
}) {
  return (
    <section
      data-okr-dash-section={title}
      aria-label={title}
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
      {slices.length === 0 ? (
        <p className="mt-2 text-[11px] text-[var(--nx-text-muted)]">暂无数据</p>
      ) : (
        <ul data-okr-dash-dist={testId} className="mt-3 space-y-1.5">
          {slices.map((slice) => (
            <li
              key={slice.key}
              data-okr-dash-dist-slice={slice.key}
              className="flex items-center gap-2 text-xs"
            >
              <span className="w-16 shrink-0 text-[var(--nx-text-secondary)]">{slice.label}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-[var(--nx-bg-1)]">
                <span
                  className="block h-full rounded-sm bg-[var(--nx-chart-1)]"
                  style={{ width: `${Math.max(0, Math.min(100, slice.percent))}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-[10px] text-[var(--nx-text-muted)]">
                {slice.count} · {slice.percent}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[var(--nx-text-muted)]">{label}</dt>
      <dd data-okr-dash-panel-row className="font-mono text-[11px] text-[var(--nx-text-primary)]">
        {value}
      </dd>
    </div>
  )
}

function PanelCard({
  title,
  available,
  forbidden,
  children,
}: {
  title: string
  available: boolean
  forbidden: boolean
  children: React.ReactNode
}) {
  const limited = forbidden || !available
  return (
    <section
      data-okr-dash-section={title}
      aria-label={title}
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
    >
      <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
      {limited ? (
        <p
          data-okr-dash-panel-limited
          className="mt-2 flex items-center gap-1.5 text-xs text-[var(--nx-text-muted)]"
        >
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          {forbidden ? '当前角色无查看该分区的权限' : '该分区数据暂不可用'}
        </p>
      ) : (
        <div className="mt-2">{children}</div>
      )}
    </section>
  )
}

function WarningChip({ warning }: { warning: OkrDashboardWarning }) {
  return (
    <span
      data-okr-dash-warning={warning.code}
      title={warning.message}
      className={cn(CHIP_CLASS, okrDashboardWarningChipClass(warning))}
    >
      {formatOkrDashboardWarning(warning)}
    </span>
  )
}

export default OkrDashboardSections
