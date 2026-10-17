'use client'

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { GLOBAL_RISK_TAXONOMY } from '@/lib/next/org-risk-global/global-risk-adapter'
import { cn } from '@/lib/utils'
import { IssueWorkbench } from './IssueWorkbench'
import { IssueRiskTaxonomyCards } from './IssueRiskTaxonomyCards'
import { RiskProjectsHub } from './RiskProjectsHub'

/**
 * 全局「问题与风险」Hub（v3-ui-next-org-portfolio-domains W8 · tasks 8.6/8.7，
 * spec「问题与风险入口」；问题工作台已由 8736bd79 接线投产）。
 *
 * 组织级全局视窗（无 projectId 上下文）：
 * - 三分语义卡（项目问题/项目风险/产品故障均「可用」）+「项目风险 / 项目问题」双 tab：
 *   项目问题 tab 为真实工作台（IssueWorkbench：项目选择/登记/筛选/状态机流转，
 *   resolved 强制回填根因与措施）；
 * - 项目风险登记册 Hub 深链 /next/projects/:id/risks（B6c 已迁）；本页零风险数据请求；
 * - 精确档降级：root 挂 data-immersion 剥离氛围光晕。
 */
export interface GlobalRiskHubProps {
  organizationId: number
}

type RiskHubTab = 'risk' | 'issue'

export function GlobalRiskHub({ organizationId }: GlobalRiskHubProps) {
  const tier = useImmersionTier()
  const [tab, setTab] = React.useState<RiskHubTab>('risk')

  return (
    <div
      data-global-risk-hub
      data-immersion={tier}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-workspace-surface)]',
      )}
    >
      {/* 页头 */}
      <header className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
          <ShieldAlert className="h-4 w-4 text-[var(--nx-status-danger)]" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">问题与风险</h1>
          <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
            「项目问题」是已发生且正在阻塞目标的事实；「项目风险」是尚未发生但有概率与影响的
            不确定事件；「产品故障」是软件/API/配置异常，请走故障排查，不进入项目风险记录。
          </p>
        </div>
      </header>

      {/* 三分语义卡（项目问题卡附「进入问题工作台」直达按钮，切到问题 tab） */}
      <IssueRiskTaxonomyCards
        taxonomy={GLOBAL_RISK_TAXONOMY}
        onIssueEntry={() => setTab('issue')}
      />

      {/* 双 tab：项目风险 / 项目问题（均可用） */}
      <div
        role="tablist"
        aria-label="问题与风险视图"
        data-risk-hub-tabs
        className="flex w-fit items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
      >
        <button
          type="button"
          role="tab"
          data-risk-hub-tab="risk"
          aria-selected={tab === 'risk'}
          onClick={() => setTab('risk')}
          className={cn(
            'h-7 rounded-sm px-3 text-xs transition-colors',
            tab === 'risk'
              ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
              : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
          )}
        >
          项目风险
        </button>
        <button
          type="button"
          role="tab"
          data-risk-hub-tab="issue"
          aria-selected={tab === 'issue'}
          onClick={() => setTab('issue')}
          className={cn(
            'h-7 rounded-sm px-3 text-xs transition-colors',
            tab === 'issue'
              ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
              : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
          )}
        >
          项目问题
        </button>
      </div>

      {tab === 'risk' ? (
        <section data-risk-hub-risk-tab>
          <RiskProjectsHub organizationId={organizationId} />
        </section>
      ) : (
        <section data-risk-hub-issue-tab>
          <IssueWorkbench organizationId={organizationId} />
        </section>
      )}
    </div>
  )
}

export default GlobalRiskHub
