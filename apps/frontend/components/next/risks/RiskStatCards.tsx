'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Layers,
  Plus,
  Sparkles,
} from 'lucide-react'
import { useRiskSummary } from '@/hooks/use-risks-v2'
import { cn } from '@/lib/utils'
import {
  RISK_STATUS_LABELS,
  RISK_TONE_LABELS,
  riskScoreTone,
} from '@/components/next/charts/risk/risk-meta'
import type { RiskLevel } from '@/lib/api/risks-v2'

/**
 * 风险态势总览看板（v3-ui-next-risk-change-domains W1 · tasks 1.3，
 * spec「风险态势总览看板」）。
 *
 * - 联动 useRiskSummary 呈现四张态势指标卡：总风险数 / 高危严重合并数（danger 色标）/
 *   逾期复查数（warning 色标）/ 健康分（按分值动态匹配健康度色标，0-100）；
 * - 随卡呈现 Top 高危风险简表（严重度、敞口分、状态），点击直达单项风险详情
 *   （由父层以风险抽屉承接）；
 * - 零风险空态提供「新建风险 / AI 识别风险」行动引导（入口由父层按权限注入）；
 * - 三态齐全：仪器感骨架 / 语义空态 / 错误卡 + 重试（aria-busy 杜绝空态误报）。
 */

/** 风险等级（v2 riskLevel）→ 双通道色标。 */
const LEVEL_TEXT: Record<RiskLevel, string> = {
  low: 'text-[var(--nx-status-success)]',
  medium: 'text-[var(--nx-status-warning)]',
  high: 'text-[var(--nx-status-danger)]',
  critical: 'text-[var(--nx-status-danger)]',
}

const LEVEL_LABELS: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

export interface RiskStatCardsProps {
  projectId: number
  /** 点击 Top 高危风险行直达单项风险详情（父层承载抽屉）。 */
  onOpenRisk: (riskId: number) => void
  /** 具备写能力时注入：零风险空态「新建风险」入口。 */
  onCreateRisk?: () => void
  /** 具备写能力时注入：零风险空态「AI 识别风险」入口。 */
  onOpenAiSuggestions?: () => void
}

export function RiskStatCards({
  projectId,
  onOpenRisk,
  onCreateRisk,
  onOpenAiSuggestions,
}: RiskStatCardsProps) {
  const { data, isLoading, isError, refetch } = useRiskSummary(projectId)
  const summary = data?.data

  const highCritical = (summary?.highRiskCount ?? 0) + (summary?.criticalRiskCount ?? 0)
  const healthScore = summary?.healthScore ?? null
  const healthTone =
    healthScore === null ? 'muted' : healthScore >= 60 ? ('success' as const) : ('warning' as const)

  if (isLoading && !summary) {
    return (
      <section
        data-risk-stat-cards
        data-risk-stat-skeleton
        role="status"
        aria-label="正在加载风险态势"
        aria-busy="true"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
          />
        ))}
      </section>
    )
  }

  if (isError || !summary) {
    return (
      <section
        data-risk-stat-cards
        data-risk-summary-error
        role="alert"
        aria-label="风险态势加载失败"
        className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-8 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
        <p className="text-sm text-[var(--nx-text-secondary)]">风险态势摘要加载失败，请稍后重试</p>
        <button
          type="button"
          data-risk-summary-retry
          onClick={() => void refetch()}
          className="h-8 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          重新载入
        </button>
      </section>
    )
  }

  const statCards: ReadonlyArray<{
    kind: 'total' | 'highcritical' | 'overdue' | 'health'
    label: string
    value: string
    tone: 'neutral' | 'danger' | 'warning' | 'success'
    icon: React.ComponentType<{ className?: string }>
  }> = [
    {
      kind: 'total',
      label: '总风险数',
      value: String(summary.totalRisks),
      tone: 'neutral',
      icon: Layers,
    },
    {
      kind: 'highcritical',
      label: '高危/严重风险',
      value: String(highCritical),
      tone: 'danger',
      icon: AlertTriangle,
    },
    {
      kind: 'overdue',
      label: '逾期复查',
      value: String(summary.overdueReviewCount),
      tone: 'warning',
      icon: Clock,
    },
    {
      kind: 'health',
      label: '健康分',
      value: healthScore === null ? 'N/A' : String(healthScore),
      tone: healthTone === 'muted' ? 'neutral' : healthTone,
      icon: CheckCircle2,
    },
  ]

  const toneText: Record<(typeof statCards)[number]['tone'], string> = {
    neutral: 'text-[var(--nx-text-primary)]',
    danger: 'text-[var(--nx-status-danger)]',
    warning: 'text-[var(--nx-status-warning)]',
    success: 'text-[var(--nx-status-success)]',
  }
  const toneBadgeBg: Record<(typeof statCards)[number]['tone'], string> = {
    neutral:
      'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)]',
    danger:
      'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)]',
    warning:
      'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] text-[var(--nx-status-warning)]',
    success:
      'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.12)] text-[var(--nx-status-success)]',
  }

  return (
    <section data-risk-stat-cards className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.kind}
              data-risk-stat-card
              data-risk-stat-kind={card.kind}
              data-health-tone={card.kind === 'health' ? healthTone : undefined}
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3.5"
            >
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md border',
                  toneBadgeBg[card.tone],
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <p
                data-risk-stat-value
                className={cn(
                  'mt-3 font-mono text-2xl font-semibold leading-none',
                  toneText[card.tone],
                )}
              >
                {card.value}
              </p>
              <p className="mt-1.5 text-[11px] text-[var(--nx-text-muted)]">{card.label}</p>
            </div>
          )
        })}
      </div>

      {/* 零风险空态：引导新建 / AI 识别（RL-01：入口即建议，落库仍需人工） */}
      {summary.totalRisks === 0 ? (
        <div
          data-risk-workbench-empty
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-8 text-center"
        >
          <CheckCircle2 className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <div>
            <p className="text-sm font-medium text-[var(--nx-text-secondary)]">暂无项目风险</p>
            <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
              使用规则评估或 AI 风险建议识别项目风险，或手动登记首条风险
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onCreateRisk ? (
              <button
                type="button"
                data-risk-empty-create
                onClick={onCreateRisk}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                新建风险
              </button>
            ) : null}
            {onOpenAiSuggestions ? (
              <button
                type="button"
                data-risk-empty-ai
                onClick={onOpenAiSuggestions}
                className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                AI 识别风险
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Top 高危风险简表 */}
      {summary.totalRisks > 0 ? (
        summary.topRisks.length > 0 ? (
          <div
            data-risk-top-risks
            className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-4 py-2.5">
              <h3 className="text-xs font-semibold text-[var(--nx-text-primary)]">Top 高危风险</h3>
              <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                按敞口分值排序 · Top {summary.topRisks.length}
              </span>
            </div>
            <ul className="divide-y divide-[var(--nx-border-hairline)]/60">
              {summary.topRisks.map((risk) => {
                const level = risk.riskLevel as RiskLevel
                return (
                  <li key={risk.id}>
                    <button
                      type="button"
                      data-risk-top-risk
                      aria-label={`查看风险 ${risk.title}`}
                      onClick={() => onOpenRisk(risk.id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--nx-bg-1)]/60"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--nx-text-primary)]">
                        {risk.title}
                      </span>
                      {level ? (
                        <span
                          data-risk-top-risk-level
                          className={cn('shrink-0 text-[10px] font-medium', LEVEL_TEXT[level])}
                        >
                          {LEVEL_LABELS[level]}
                        </span>
                      ) : null}
                      <span
                        aria-label={`敞口得分 ${risk.score}`}
                        className={cn(
                          'shrink-0 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px]',
                          riskScoreTone(risk.score) === 'high'
                            ? 'text-[var(--nx-status-danger)]'
                            : riskScoreTone(risk.score) === 'medium'
                              ? 'text-[var(--nx-status-warning)]'
                              : 'text-[var(--nx-status-success)]',
                        )}
                      >
                        {risk.score} 分 · {RISK_TONE_LABELS[riskScoreTone(risk.score)]}
                      </span>
                      <span className="shrink-0 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
                        {RISK_STATUS_LABELS[risk.status as keyof typeof RISK_STATUS_LABELS] ??
                          risk.status}
                      </span>
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
                        aria-hidden
                      />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <div
            data-risk-top-risks-empty
            className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3 text-center text-[11px] text-[var(--nx-text-muted)]"
          >
            当前无高危或严重风险，项目风险状态良好
          </div>
        )
      ) : null}
    </section>
  )
}

export default RiskStatCards
