'use client'

import Link from 'next/link'
import { AlertCircle, ArrowRight, ShieldAlert, Wrench } from 'lucide-react'
import type {
  GlobalRiskTaxonomyEntry,
  GlobalRiskTaxonomyKind,
} from '@/lib/next/org-risk-global/global-risk-adapter'
import {
  getTaxonomyStatusChipClass,
  getTaxonomyStatusLabel,
  INCIDENT_HELP_SEARCH_HREF,
} from '@/lib/next/org-risk-global/global-risk-adapter'
import { cn } from '@/lib/utils'

/**
 * 问题 vs 风险 vs 产品故障三分语义卡（v3-ui-next-org-portfolio-domains W8 ·
 * tasks 8.6，spec「问题与风险入口」）。
 *
 * - taxonomy 数据源为新轨自建 `GLOBAL_RISK_TAXONOMY`（语义对齐旧轨 ISSUE_RISK_TAXONOMY）；
 * - 可用性徽标双通道（规划中 = 琥珀 / 可用 = 恢复绿 + 中文文字）；
 * - 项目问题已投产（implemented=true）→ 卡片附「进入问题工作台」按钮（onIssueEntry
 *   回调，由 GlobalRiskHub 切到项目问题 tab）；
 * - 产品故障卡附「去帮助中心故障排查」深链（/next/help/search?q=故障）。
 */
export interface IssueRiskTaxonomyCardsProps {
  taxonomy: readonly GlobalRiskTaxonomyEntry[]
  /** 项目问题卡直达回调（切到问题工作台 tab）；不传则不渲染入口按钮。 */
  onIssueEntry?: () => void
}

const KIND_ICONS: Record<GlobalRiskTaxonomyKind, typeof ShieldAlert> = {
  issue: AlertCircle,
  risk: ShieldAlert,
  incident: Wrench,
}

const KIND_ICON_TONES: Record<GlobalRiskTaxonomyKind, string> = {
  issue: 'var(--nx-status-warning)',
  risk: 'var(--nx-status-danger)',
  incident: 'var(--nx-accent)',
}

export function IssueRiskTaxonomyCards({ taxonomy, onIssueEntry }: IssueRiskTaxonomyCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-risk-taxonomy-cards>
      {taxonomy.map((entry) => {
        const Icon = KIND_ICONS[entry.kind] ?? ShieldAlert
        return (
          <article
            key={entry.kind}
            data-risk-taxonomy-card={entry.kind}
            className="flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--nx-text-primary)]">
                <Icon
                  className="h-4 w-4"
                  style={{ color: KIND_ICON_TONES[entry.kind] }}
                  aria-hidden
                />
                {entry.label}
              </span>
              <span
                data-risk-taxonomy-status={entry.kind}
                className={cn(
                  'shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px]',
                  getTaxonomyStatusChipClass(entry.implemented),
                )}
              >
                {getTaxonomyStatusLabel(entry.implemented)}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
              {entry.definition}
            </p>
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              <span className="font-medium text-[var(--nx-text-secondary)]">示例：</span>
              {entry.example}
            </p>
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">{entry.where}</p>

            {entry.kind === 'issue' && onIssueEntry ? (
              <button
                type="button"
                onClick={onIssueEntry}
                data-risk-taxonomy-issue-link
                className="mt-auto inline-flex h-7 w-fit items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
              >
                进入问题工作台
                <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
            {entry.kind === 'incident' ? (
              <Link
                href={INCIDENT_HELP_SEARCH_HREF}
                data-risk-taxonomy-incident-link
                className="mt-auto inline-flex h-7 w-fit items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
              >
                去帮助中心故障排查
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

export default IssueRiskTaxonomyCards
