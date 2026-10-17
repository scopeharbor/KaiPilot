'use client'

import * as React from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import type {
  ChangeImpactAnalysis,
  ChangeImpactDimension,
  ChangeRequestImpactSummary,
} from '@/lib/api/change-requests'
import { cn } from '@/lib/utils'

export interface SixDimensionImpactData {
  scope?: string | number | null
  schedule?: string | number | null
  resources?: string | number | null
  cost?: string | number | null
  risks?: string | number | null
  assumptions?: string | number | null
}

export interface PmoChangeImpactPenetrationPanelProps {
  impactSummary?: ChangeRequestImpactSummary | null
  impactAnalysis?: ChangeImpactAnalysis | null
  isStale?: boolean
  staleReason?: string | null
  className?: string
}

interface DimensionConfig {
  key: keyof SixDimensionImpactData
  label: string
  testId: string
  defaultPercent: number
  colorClass: string
}

const DIMENSIONS: DimensionConfig[] = [
  {
    key: 'scope',
    label: '范围 (Scope)',
    testId: 'impact-bar-scope',
    defaultPercent: 65,
    colorClass: 'bg-[var(--nx-status-danger)]',
  },
  {
    key: 'schedule',
    label: '进度 (Schedule)',
    testId: 'impact-bar-schedule',
    defaultPercent: 80,
    colorClass: 'bg-[var(--nx-status-warning)]',
  },
  {
    key: 'resources',
    label: '资源 (Resources)',
    testId: 'impact-bar-resources',
    defaultPercent: 45,
    colorClass: 'bg-[var(--nx-accent)]',
  },
  {
    key: 'cost',
    label: '成本 (Cost)',
    testId: 'impact-bar-cost',
    defaultPercent: 30,
    colorClass: 'bg-[var(--nx-border-focus)]',
  },
  {
    key: 'risks',
    label: '风险 (Risks)',
    testId: 'impact-bar-risks',
    defaultPercent: 75,
    colorClass: 'bg-[var(--nx-status-warning)]',
  },
  {
    key: 'assumptions',
    label: '假设 (Assumptions)',
    testId: 'impact-bar-assumptions',
    defaultPercent: 40,
    colorClass: 'bg-[var(--nx-text-muted)]',
  },
]

/**
 * PMO 变更六维影响穿透与分析快照面板（W4 · tasks 4.1, 4.2 / design Decision 3）。
 *
 * 核心特性：
 * 1. 结构化展示范围、进度、资源、成本、风险、假设六维定性/定量影响评估；
 * 2. 具备六维影响快照柱状指标展示（impact-bar-* 指示条）；
 * 3. 分析快照过期（isStale）时呈现醒目的琥珀色警告标记与复核引导（RL-01）；
 * 4. 暗黑仪器风格高密度纯平降级（RL-15）。
 */
export function PmoChangeImpactPenetrationPanel({
  impactSummary,
  impactAnalysis,
  isStale: propIsStale,
  staleReason: propStaleReason,
  className,
}: PmoChangeImpactPenetrationPanelProps) {
  const isStale = propIsStale ?? impactAnalysis?.isStale ?? false
  const staleReason =
    propStaleReason ??
    impactAnalysis?.staleReason ??
    '项目基线或排程发生变动，当前六维快照已过期，审批时请核对最新排期。'

  // 从 impactAnalysis.summary.dimensionSummaries 或 impactSummary 解析维度数值
  const getDimensionDisplay = (dimKey: keyof SixDimensionImpactData) => {
    // 映射 key 到 ChangeImpactDimension
    const dimMap: Record<string, ChangeImpactDimension> = {
      scope: 'scope',
      schedule: 'schedule',
      resources: 'resource',
      cost: 'scope', // cost 映射 fallback
      risks: 'risk',
      assumptions: 'assumption',
    }
    const mappedDim = dimMap[dimKey]
    const summaryItem = impactAnalysis?.summary?.dimensionSummaries?.find(
      (d) => d.dimension === mappedDim,
    )

    const textFromSummary = impactSummary
      ? (impactSummary as Record<string, string | undefined>)[dimKey]
      : undefined
    const affectedCount = summaryItem?.affectedCount

    return {
      text:
        textFromSummary ||
        (affectedCount !== undefined ? `影响 ${affectedCount} 项实体` : '无显著波动'),
      affectedCount: affectedCount ?? (textFromSummary ? 1 : 0),
      highestSeverity: summaryItem?.highestSeverity ?? (textFromSummary ? 'medium' : 'none'),
    }
  }

  return (
    <section
      data-testid="pmo-change-impact-penetration-panel"
      className={cn(
        'flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3 text-xs',
        className,
      )}
    >
      {/* 头部标题与统计 */}
      <div className="flex items-center justify-between border-b border-[var(--nx-border-hairline)] pb-2">
        <div className="flex items-center gap-1.5 font-medium text-[var(--nx-text-primary)]">
          <Layers className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden="true" />
          <span>六维影响分析快照</span>
        </div>
        {impactAnalysis?.summary ? (
          <span className="font-mono text-[11px] text-[var(--nx-text-muted)]">
            受影响实体：
            <strong className="text-[var(--nx-text-primary)]">
              {impactAnalysis.summary.totalAffected}
            </strong>{' '}
            项
          </span>
        ) : (
          <span className="text-[10px] text-[var(--nx-text-muted)]">穿透评估快照</span>
        )}
      </div>

      {/* 过期琥珀色警示（isStale） */}
      {isStale && (
        <div
          role="alert"
          data-testid="impact-stale-warning"
          data-pmo-impact-stale="true"
          className="flex items-start gap-2 rounded-md border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-[11px] text-[var(--nx-status-warning)]"
        >
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden="true"
          />
          <div className="flex-1 leading-snug">
            <span className="font-semibold">分析快照已过期：</span>
            <span>{staleReason}</span>
          </div>
        </div>
      )}

      {/* 六维柱状指标与文字快照 */}
      <div data-testid="impact-bar-indicator" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {DIMENSIONS.map((dim) => {
          const { text, affectedCount } = getDimensionDisplay(dim.key)
          // 柱状指示条宽度百分比（基于受影响量或预设）
          const barPercent =
            affectedCount > 0 ? Math.min(100, Math.max(20, affectedCount * 25)) : dim.defaultPercent

          return (
            <div
              key={dim.key}
              data-testid={dim.testId}
              className="flex flex-col gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-[var(--nx-text-secondary)]">{dim.label}</span>
                <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {barPercent}% 冲击度
                </span>
              </div>

              {/* 柱状指标指示条 */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--nx-bg-1)]">
                <div
                  className={cn('h-full transition-all duration-300', dim.colorClass)}
                  style={{ width: `${barPercent}%` }}
                />
              </div>

              {/* 定性描述 */}
              <p className="line-clamp-2 text-[11px] text-[var(--nx-text-muted)]">{text}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
