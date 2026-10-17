'use client'

import * as React from 'react'
import { Target, CheckCircle2, TrendingUp, AlertOctagon, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CockpitMetric } from '@aiproj/types'

export interface StrategicKpiRibbonProps {
  /** 战略目标总数 */
  totalObjectives?: number
  /** 完成率（0-100） */
  completionRate?: number
  /** 平均进度（0-100） */
  averageProgress?: number
  /** 高风险目标数 */
  highRiskCount?: number
  /** 映射覆盖率（0-100） */
  mappingCoverageRate?: number
  /** 原始 KPI 数组（如果直接传入 summary.kpis） */
  kpis?: CockpitMetric[]
  /** 外部样式 */
  className?: string
}

/** 从 kpis 数组中按 key 提取数值辅助函数 */
function extractKpiValue(kpis: CockpitMetric[] | undefined, key: string): number | undefined {
  if (!kpis) return undefined
  const item = kpis.find((k) => k.key === key)
  if (item && item.value !== null && item.value !== undefined) {
    const n = Number(item.value)
    return isNaN(n) ? undefined : n
  }
  return undefined
}

/**
 * 战略核心 KPI 丝带（v3-ui-next-batch1-strategy-launch-tasks §1.3 / spec「战略周期导言与 KPI 丝带结构」）。
 * 呈现高管战略关注的关键量度：战略目标总数、完成率（%）、平均进度百分比（附进度条）、高风险目标数与映射覆盖率。
 */
export function StrategicKpiRibbon({
  totalObjectives: explicitTotal,
  completionRate: explicitCompletion,
  averageProgress: explicitProgress,
  highRiskCount: explicitHighRisk,
  mappingCoverageRate: explicitCoverage,
  kpis,
  className,
}: StrategicKpiRibbonProps) {
  // 智能合流：优先使用显式数值，其次尝试从 kpis 数组提取
  const total = explicitTotal ?? extractKpiValue(kpis, 'cockpit_total_objectives') ?? 0

  const completion =
    explicitCompletion ??
    extractKpiValue(kpis, 'cockpit_completion_rate') ??
    (total > 0 && extractKpiValue(kpis, 'cockpit_completed_objectives') !== undefined
      ? Math.round(((extractKpiValue(kpis, 'cockpit_completed_objectives') ?? 0) / total) * 100)
      : 0)

  const progress = explicitProgress ?? extractKpiValue(kpis, 'cockpit_strategy_progress_avg') ?? 0

  const highRisk =
    explicitHighRisk ??
    extractKpiValue(kpis, 'cockpit_at_risk_objectives') ??
    extractKpiValue(kpis, 'cockpit_attention_count') ??
    0

  const coverage =
    explicitCoverage ?? extractKpiValue(kpis, 'cockpit_mapping_coverage_percent') ?? 0

  return (
    <section
      aria-label="战略核心指标横幅"
      data-strategic-kpi-ribbon="true"
      className={cn('w-full', className)}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* 卡片 1：战略目标总数 */}
        <div
          data-testid="kpi-total-objectives"
          className={cn(
            'flex flex-col justify-between rounded-lg border p-4 transition-all',
            'border-[rgba(56,52,44,0.12)] bg-[var(--nx-role-surface,#ebe9e1)]',
          )}
        >
          <div className="flex items-center justify-between text-xs text-[var(--nx-role-text,#38342c)]/70">
            <span>战略目标总数</span>
            <Target className="h-3.5 w-3.5 text-[var(--nx-role-accent,#d97706)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-2xl font-bold tracking-tight text-[var(--nx-role-text,#38342c)] sm:text-3xl">
              {total}
            </span>
            <span className="text-xs text-[var(--nx-role-text,#38342c)]/60">项</span>
          </div>
        </div>

        {/* 卡片 2：完成率 */}
        <div
          data-testid="kpi-completion-rate"
          className={cn(
            'flex flex-col justify-between rounded-lg border p-4 transition-all',
            'border-[rgba(56,52,44,0.12)] bg-[var(--nx-role-surface,#ebe9e1)]',
          )}
        >
          <div className="flex items-center justify-between text-xs text-[var(--nx-role-text,#38342c)]/70">
            <span>战略完成率</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-2xl font-bold tracking-tight text-[var(--nx-role-text,#38342c)] sm:text-3xl">
              {completion}%
            </span>
          </div>
        </div>

        {/* 卡片 3：平均进度条 */}
        <div
          data-testid="kpi-average-progress"
          className={cn(
            'col-span-2 sm:col-span-1 flex flex-col justify-between rounded-lg border p-4 transition-all',
            'border-[rgba(56,52,44,0.12)] bg-[var(--nx-role-surface,#ebe9e1)]',
          )}
        >
          <div className="flex items-center justify-between text-xs text-[var(--nx-role-text,#38342c)]/70">
            <span>平均进度</span>
            <TrendingUp className="h-3.5 w-3.5 text-[var(--nx-role-accent,#d97706)]" />
          </div>
          <div className="mt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tracking-tight text-[var(--nx-role-text,#38342c)] sm:text-3xl">
                {progress}%
              </span>
            </div>
            {/* 纸光进度条 */}
            <div
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(56,52,44,0.1)]"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="平均战略进度"
            >
              <div
                data-testid="progress-bar-fill"
                className="h-full rounded-full bg-[var(--nx-role-accent,#d97706)] transition-all duration-300 motion-reduce:transition-none"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>
        </div>

        {/* 卡片 4：高风险目标数 */}
        <div
          data-testid="kpi-high-risk"
          className={cn(
            'flex flex-col justify-between rounded-lg border p-4 transition-all',
            'border-[rgba(56,52,44,0.12)] bg-[var(--nx-role-surface,#ebe9e1)]',
          )}
        >
          <div className="flex items-center justify-between text-xs text-[var(--nx-role-text,#38342c)]/70">
            <span>高风险目标</span>
            <AlertOctagon
              className={cn(
                'h-3.5 w-3.5',
                highRisk > 0 ? 'text-amber-600' : 'text-[var(--nx-role-text,#38342c)]/40',
              )}
            />
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span
              className={cn(
                'text-2xl font-bold tracking-tight sm:text-3xl',
                highRisk > 0 ? 'text-amber-700' : 'text-[var(--nx-role-text,#38342c)]',
              )}
            >
              {highRisk}
            </span>
            <span className="text-xs text-[var(--nx-role-text,#38342c)]/60">项</span>
          </div>
        </div>

        {/* 卡片 5：映射覆盖率 */}
        <div
          data-testid="kpi-mapping-coverage"
          className={cn(
            'flex flex-col justify-between rounded-lg border p-4 transition-all',
            'border-[rgba(56,52,44,0.12)] bg-[var(--nx-role-surface,#ebe9e1)]',
          )}
        >
          <div className="flex items-center justify-between text-xs text-[var(--nx-role-text,#38342c)]/70">
            <span>项目映射覆盖</span>
            <Link2 className="h-3.5 w-3.5 text-[var(--nx-role-accent,#d97706)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-2xl font-bold tracking-tight text-[var(--nx-role-text,#38342c)] sm:text-3xl">
              {coverage}%
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
