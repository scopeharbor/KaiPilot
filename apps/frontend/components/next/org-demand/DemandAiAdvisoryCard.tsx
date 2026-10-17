'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { resourceDemandForecastingKeys } from '@/lib/api/resource-demand-forecasting'
import { useForecastAiAdvisory } from '@/hooks/use-resource-demand-forecasting'
import { cn } from '@/lib/utils'
import {
  confidenceMetaOf,
  demandWarningChipClass,
  demandWarningLabel,
} from '@/lib/next/org-demand/org-demand-adapter'

/**
 * 需求预测 AI 咨询只读卡（v3-ui-next-org-portfolio-domains W5 · tasks 5.8，
 * spec「需求预测：AI 咨询只读卡（RL-01/RL-10/RL-12）」）。
 *
 * - **零自动触发**：初始态零请求；用户显式点击「生成 AI 洞察」才经既有
 *   `useForecastAiAdvisory`（GET /resource-demand-forecasting/ai-advisory）实查；
 * - 生成中防抖：pending 期间生成按钮 disabled（杜绝连击重放），提供「取消」返回
 *   空闲态（cancelQueries 中止在途查询观察）；失败可重试（5xx/网络态重试按钮）；
 * - 结果卡完整回显 AIMarker（来源模型/置信度档位/叙述理由），并保留
 *   `advisoryOnly · writesApplied=false` 诚实标注——AI 只建议、不自动执行、不落库
 *   （RL-01/RL-12）。
 */

export interface DemandAiAdvisoryCardProps {
  organizationId: number
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return fallback
}

export function DemandAiAdvisoryCard({ organizationId }: DemandAiAdvisoryCardProps) {
  const queryClient = useQueryClient()
  const [armed, setArmed] = React.useState(false)

  const advisoryQuery = useForecastAiAdvisory(organizationId, armed)
  const advisory = advisoryQuery.data ?? null

  const idle = !armed
  const pending = armed && advisoryQuery.isFetching && !advisoryQuery.isError && !advisory

  const handleCancel = () => {
    // 取消生成：中止在途查询并回空闲态（advisory 为纯只读端点，零副作用）。
    void queryClient.cancelQueries({
      queryKey: resourceDemandForecastingKeys.aiAdvisory(organizationId),
    })
    setArmed(false)
  }

  return (
    <section
      data-demand-ai-advisory-card
      className="rounded-lg border border-[rgba(0,240,255,0.18)] bg-[var(--nx-bg-0)] p-3.5"
    >
      {/* 卡头 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[rgba(0,240,255,0.3)] bg-[rgba(0,240,255,0.06)]">
            <BrainCircuit className="h-3.5 w-3.5 text-[var(--nx-ai)]" aria-hidden />
          </span>
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--nx-text-primary)]">
              AI 资源需求洞察
            </h3>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
              GET …/resource-demand-forecasting/ai-advisory · 仅咨询，零自动写
            </p>
          </div>
        </div>
        {idle && !advisory ? (
          <button
            type="button"
            data-demand-ai-generate
            onClick={() => setArmed(true)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[rgba(0,240,255,0.35)] bg-[rgba(0,240,255,0.08)] px-3 text-xs font-medium text-[var(--nx-ai)] transition-colors hover:bg-[rgba(0,240,255,0.14)]"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            生成 AI 洞察
          </button>
        ) : null}
        {pending ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-demand-ai-cancel
              onClick={handleCancel}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              <XCircle className="h-3.5 w-3.5" aria-hidden />
              取消
            </button>
          </div>
        ) : null}
        {!idle && advisory ? (
          <span
            data-demand-ai-generated-badge
            className="inline-flex items-center gap-1 rounded-sm border border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.12)] px-2 py-1 text-[10px] font-medium text-[var(--nx-status-success)]"
          >
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            洞察已生成
          </span>
        ) : null}
      </div>

      {/* 内容区 */}
      {idle && !advisory ? (
        <div
          data-demand-ai-idle
          className="mt-3 rounded-sm border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-5 text-center"
        >
          <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            基于当前预测窗口的聚合需求、分配与缺口数据，AI 可生成一段结构化洞察与 建议动作。{' '}
            <span className="text-[var(--nx-text-secondary)]">
              点击上方按钮显式触发，平台绝不自动生成或自动执行（RL-01）。
            </span>
          </p>
        </div>
      ) : null}

      {pending ? (
        <div
          data-demand-ai-pending
          role="status"
          aria-busy="true"
          aria-label="AI 洞察生成中"
          className="mt-3 space-y-2"
        >
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-9 animate-pulse rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            />
          ))}
          <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-[var(--nx-text-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            AI 正在分析预测窗口的供需缺口…
          </p>
        </div>
      ) : null}

      {advisoryQuery.isError && !advisory ? (
        <div
          data-demand-ai-error
          role="alert"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.08)] px-3 py-2"
        >
          <p className="flex items-center gap-1.5 text-[11px] text-[var(--nx-status-danger)]">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            AI 洞察生成失败：
            {advisoryQuery.error instanceof Error
              ? resolveErrorMessage(advisoryQuery.error, '服务暂时不可用')
              : resolveErrorMessage(advisoryQuery.error, 'AI 咨询服务暂不可用')}
          </p>
          <button
            type="button"
            data-demand-ai-retry
            onClick={() => void advisoryQuery.refetch()}
            disabled={!advisoryQuery.isError}
            className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-accent)] disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            重试
          </button>
        </div>
      ) : null}

      {advisory ? (
        <div className="mt-3 space-y-2.5">
          <p
            data-demand-ai-narrative
            className="whitespace-pre-wrap rounded-sm border border-[var(--nx-border-hairline)]/70 bg-[var(--nx-bg-0)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--nx-text-secondary)]"
          >
            {advisory.narrative}
          </p>

          {advisory.suggestedActions.length > 0 ? (
            <ul className="space-y-1">
              {advisory.suggestedActions.map((action, index) => (
                <li
                  key={action}
                  className="flex items-center gap-2 text-[11px] text-[var(--nx-text-secondary)]"
                >
                  <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                    {(index + 1).toString().padStart(2, '0')}
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {advisory.relatedGaps.length > 0 ? (
            <p className="text-[10px] text-[var(--nx-text-muted)]">
              关联缺口：{advisory.relatedGaps.length} 项（合计{' '}
              {advisory.relatedGaps
                .reduce((acc, gap) => acc + (gap.gapHours ?? 0), 0)
                .toLocaleString('zh-CN')}
              h）
            </p>
          ) : null}

          {/* AIMarker：来源 / 置信度 / 理由透明回显 */}
          <div
            data-ai-marker
            className="rounded-sm border border-[rgba(139,92,246,0.25)] bg-[rgba(139,92,246,0.06)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
          >
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                data-ai-marker-confidence
                className={cn(
                  'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                  confidenceMetaOf(advisory.confidence).chipClass,
                )}
              >
                置信度 {confidenceMetaOf(advisory.confidence).label}
              </span>
              <span data-ai-marker-source className="font-medium">
                来源：{advisory.model || 'AI 需求预测模型'}
              </span>
              <span className="text-[var(--nx-text-muted)]">
                advisoryOnly · writesApplied=false
              </span>
            </p>
            <p data-ai-marker-reason className="mt-1 text-[var(--nx-text-muted)]">
              理由：洞察基于当前预测窗口的需求/分配/缺口聚合与源数据新鲜度生成，
              仅供人工决策参考，未经确认不写入任何正式资源记录。
            </p>
          </div>

          {advisory.warnings.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {advisory.warnings.map((warning) => (
                <span
                  key={warning}
                  className={cn(
                    'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
                    demandWarningChipClass(warning),
                  )}
                >
                  {demandWarningLabel(warning)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export default DemandAiAdvisoryCard
