'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, Sparkles, ExternalLink, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  resolveCockpitTargetHref,
  cockpitTargetAriaLabel,
} from '@/lib/strategy-execution-cockpit-nav'
import type { CockpitAttentionItem } from '@aiproj/types'
import type { AiAttributionTarget } from './ObjectiveExecutionMatrix'

export interface AttentionCalloutQueueProps {
  /** 注意力关注项列表 */
  attentionItems: CockpitAttentionItem[]
  /** 唤起 AI 归因摘要抽屉回调 */
  onOpenAiAttribution?: (target: AiAttributionTarget) => void
  /** 外部样式 */
  className?: string
}

function getSeverityBadge(severity?: string) {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return {
        label: '紧急阻断',
        className: 'bg-rose-100 text-rose-800 border-rose-200',
      }
    case 'high':
      return {
        label: '高风险',
        className: 'bg-orange-100 text-orange-800 border-orange-200',
      }
    case 'warning':
    case 'medium':
      return {
        label: '中度偏离',
        className: 'bg-amber-100 text-amber-800 border-amber-200',
      }
    case 'info':
    case 'low':
      return {
        label: '轻度关注',
        className: 'bg-yellow-50 text-yellow-800 border-yellow-200',
      }
    default:
      return {
        label: severity || '关注',
        className: 'bg-stone-100 text-stone-700 border-stone-200',
      }
  }
}

/**
 * 有界注意力队列（v3-ui-next-batch1-strategy-launch-tasks §1.5 / spec「目标至执行对齐矩阵与注意力队列」）。
 * 呈现偏离目标与风险原因卡片，按严重等级高亮风险，提供 AI 归因操作点与只读安全下钻。
 */
export function AttentionCalloutQueue({
  attentionItems,
  onOpenAiAttribution,
  className,
}: AttentionCalloutQueueProps) {
  return (
    <section
      aria-label="战略注意力队列"
      data-attention-callout-queue="true"
      className={cn(
        'w-full rounded-xl border p-5 transition-colors',
        'border-[rgba(56,52,44,0.12)] bg-[var(--nx-role-surface,#ebe9e1)]',
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[var(--nx-role-text,#38342c)] flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--nx-role-accent,#d97706)]" />
            <span>战略注意力队列</span>
          </h2>
          <p className="text-xs text-[var(--nx-role-text,#38342c)]/60">
            按偏离程度收敛的需高管决策介入的关键风险项（有界队列）
          </p>
        </div>
        <span className="rounded-full bg-[var(--nx-role-bg,#f5f4ef)] border border-[rgba(56,52,44,0.1)] px-2.5 py-0.5 text-xs font-semibold text-[var(--nx-role-text,#38342c)]">
          共 {attentionItems.length} 项
        </span>
      </div>

      {attentionItems.length === 0 ? (
        <div
          data-testid="attention-empty"
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[rgba(56,52,44,0.15)] p-8 text-center text-sm text-[var(--nx-role-text,#38342c)]/70"
        >
          <ShieldCheck className="h-6 w-6 text-emerald-600" />
          <span>当前无关注项，战略执行状态良好受控。</span>
        </div>
      ) : (
        <div className="space-y-3" data-testid="attention-list">
          {attentionItems.map((item) => {
            const sev = getSeverityBadge(item.severity)
            return (
              <div
                key={item.id}
                data-testid={`attention-item-${item.id}`}
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  'border-[rgba(56,52,44,0.12)] bg-[var(--nx-role-bg,#f5f4ef)]',
                  'hover:border-[rgba(56,52,44,0.2)]',
                )}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  {/* 左侧主要信息 */}
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'rounded border px-2 py-0.5 text-xs font-medium',
                          sev.className,
                        )}
                      >
                        {sev.label}
                      </span>
                      <span className="font-mono text-xs text-[var(--nx-role-text,#38342c)]/60">
                        {item.reasonCode}
                      </span>
                      {item.ruleVersion && (
                        <span className="text-[10px] text-[var(--nx-role-text,#38342c)]/40">
                          v{item.ruleVersion}
                        </span>
                      )}
                    </div>

                    <p className="text-sm font-medium text-[var(--nx-role-text,#38342c)] leading-relaxed">
                      {item.message}
                    </p>

                    {item.basis && (
                      <p className="text-xs text-[var(--nx-role-text,#38342c)]/70 leading-normal">
                        <span className="font-medium">判定依据：</span>
                        {item.basis}
                      </p>
                    )}
                  </div>

                  {/* 右侧操作区：AI 归因操作点 + 安全跳转 */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-0 shrink-0">
                    {onOpenAiAttribution && (
                      <button
                        type="button"
                        data-testid={`ai-attribution-attn-${item.id}`}
                        onClick={() =>
                          onOpenAiAttribution({
                            id: item.id,
                            title: item.message,
                            reason: item.basis || item.reasonCode,
                            severity: item.severity,
                          })
                        }
                        title="查看 AI 战略归因与推演依据"
                        aria-label="查看 AI 战略归因与推演依据"
                        className={cn(
                          'inline-flex min-h-[32px] items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
                          'border-amber-600/30 bg-amber-50 text-amber-900 hover:bg-amber-100',
                          'focus-visible:outline-2 focus-visible:outline-amber-600',
                          'transition-colors motion-reduce:transition-none',
                        )}
                      >
                        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                        <span>AI 归因摘要</span>
                      </button>
                    )}

                    {item.target && item.target.authorized && (
                      <Link
                        href={resolveCockpitTargetHref(item.target)}
                        aria-label={cockpitTargetAriaLabel(item.target)}
                        className={cn(
                          'inline-flex min-h-[32px] items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium',
                          'border-[rgba(56,52,44,0.15)] bg-[var(--nx-role-surface,#ebe9e1)] text-[var(--nx-role-text,#38342c)]',
                          'hover:bg-[rgba(56,52,44,0.08)]',
                          'focus-visible:outline-2 focus-visible:outline-amber-600',
                        )}
                      >
                        <span>详情</span>
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
