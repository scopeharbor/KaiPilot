'use client'

import * as React from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Flag, Users } from 'lucide-react'
import type {
  ProjectDraftAcceptanceCriterion,
  ProjectDraftMilestoneHint,
  ProjectDraftResourceHint,
  ProjectDraftRiskHint,
  ProjectDraftRiskLevel,
} from '@aiproj/types'
import { extractMarkedValue, formatDateSpan } from '@/lib/next/draft-review-helpers'

/** 风险等级中文标签与状态令牌（双通道：颜色 + 中文文字，RL-15）。 */
export const RISK_LEVEL_META: Readonly<
  Record<ProjectDraftRiskLevel, { label: string; token: string }>
> = {
  low: { label: '低风险', token: 'var(--nx-status-success)' },
  medium: { label: '中风险', token: 'var(--nx-status-warning)' },
  high: { label: '高风险', token: 'var(--nx-status-danger)' },
}

interface AccordionItemProps {
  id: string
  title: string
  icon: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

function AccordionItem({ id, title, icon, open, onToggle, children }: AccordionItemProps) {
  const panelId = `nx-support-panel-${id}`
  return (
    <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
      <h4 className="flex">
        <button
          type="button"
          data-support-toggle
          data-support-panel-id={id}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:text-[var(--nx-text-secondary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <span className="flex items-center gap-2">
            <span className="text-[var(--nx-text-muted)]">{icon}</span>
            {title}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-[var(--nx-text-muted)] transition-transform ${
              open ? '' : '-rotate-90'
            }`}
            aria-hidden
          />
        </button>
      </h4>
      <div
        id={panelId}
        hidden={!open}
        className="border-t border-[var(--nx-border-hairline)] px-4 py-3"
      >
        {children}
      </div>
    </div>
  )
}

/**
 * 配套辅助信息折叠区（v3-ui-next-draft-review-panel tasks 1.6）。
 *
 * 手风琴只读呈现验收标准清单、资源建议、风险提示（含等级与缓解措施）与里程碑计划。
 * 纯展示组件：零输入框、零网络请求（RL-01、RL-06）。
 */
export interface NextDraftSupportingSectionProps {
  acceptanceCriteria: ProjectDraftAcceptanceCriterion[]
  resourceHints: ProjectDraftResourceHint[]
  riskHints: ProjectDraftRiskHint[]
  milestoneHints: ProjectDraftMilestoneHint[]
}

export function NextDraftSupportingSection({
  acceptanceCriteria,
  resourceHints,
  riskHints,
  milestoneHints,
}: NextDraftSupportingSectionProps) {
  const [openPanels, setOpenPanels] = React.useState<ReadonlySet<string>>(new Set())

  const togglePanel = React.useCallback((panelId: string) => {
    setOpenPanels((current) => {
      const next = new Set(current)
      if (next.has(panelId)) {
        next.delete(panelId)
      } else {
        next.add(panelId)
      }
      return next
    })
  }, [])

  return (
    <section data-supporting-section aria-label="配套辅助信息" className="space-y-2 text-left">
      <AccordionItem
        id="acceptance"
        title="验收标准"
        icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
        open={openPanels.has('acceptance')}
        onToggle={() => togglePanel('acceptance')}
      >
        {acceptanceCriteria.length > 0 ? (
          <ul className="space-y-2">
            {acceptanceCriteria.map((criterion, index) => (
              <li
                key={criterion.id}
                data-acceptance-item
                className="flex items-start gap-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
              >
                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-[var(--nx-border-hairline)] font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {index + 1}
                </span>
                <span>{extractMarkedValue(criterion.statement)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--nx-text-muted)]">暂无验收标准</p>
        )}
      </AccordionItem>

      <AccordionItem
        id="resource"
        title="资源建议"
        icon={<Users className="h-3.5 w-3.5" aria-hidden />}
        open={openPanels.has('resource')}
        onToggle={() => togglePanel('resource')}
      >
        {resourceHints.length > 0 ? (
          <ul className="space-y-2">
            {resourceHints.map((hint) => (
              <li
                key={hint.id}
                data-resource-item
                className="flex flex-wrap items-center gap-2 text-xs text-[var(--nx-text-secondary)]"
              >
                <span className="font-medium text-[var(--nx-text-primary)]">
                  {extractMarkedValue(hint.role)}
                </span>
                <span className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {extractMarkedValue(hint.headcount)} 人
                </span>
                <ResourceSourceBadge marker={hint.headcount.marker} />
                <span className="text-[var(--nx-text-muted)]">
                  {extractMarkedValue(hint.allocationNote)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--nx-text-muted)]">暂无资源建议</p>
        )}
      </AccordionItem>

      <AccordionItem
        id="risk"
        title="风险提示"
        icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
        open={openPanels.has('risk')}
        onToggle={() => togglePanel('risk')}
      >
        {riskHints.length > 0 ? (
          <ul className="space-y-2.5">
            {riskHints.map((hint) => {
              const level = extractMarkedValue(hint.level)
              const meta = RISK_LEVEL_META[level]
              return (
                <li
                  key={hint.id}
                  data-risk-item
                  className="rounded border border-[var(--nx-border-hairline)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-[var(--nx-text-primary)]">
                      {extractMarkedValue(hint.description)}
                    </span>
                    <span
                      data-risk-level
                      className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px]"
                      style={{ color: meta.token, borderColor: meta.token }}
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {meta.label}
                    </span>
                  </div>
                  {extractMarkedValue(hint.mitigation) !== '' ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                      缓解措施：{extractMarkedValue(hint.mitigation)}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-[var(--nx-text-muted)]">暂无风险提示</p>
        )}
      </AccordionItem>

      <AccordionItem
        id="milestone"
        title="里程碑"
        icon={<Flag className="h-3.5 w-3.5" aria-hidden />}
        open={openPanels.has('milestone')}
        onToggle={() => togglePanel('milestone')}
      >
        {milestoneHints.length > 0 ? (
          <ul className="space-y-2">
            {milestoneHints.map((hint) => (
              <li
                key={hint.id}
                data-milestone-item
                className="flex flex-wrap items-center gap-2 text-xs text-[var(--nx-text-secondary)]"
              >
                <span className="font-medium text-[var(--nx-text-primary)]">
                  {extractMarkedValue(hint.name)}
                </span>
                <span className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {formatDateSpan(
                    extractMarkedValue(hint.targetDate),
                    extractMarkedValue(hint.targetDate),
                  )}
                </span>
                {hint.linkedTaskIds.length > 0 ? (
                  <span className="text-[10px] text-[var(--nx-text-muted)]">
                    关联任务 {hint.linkedTaskIds.length} 项
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--nx-text-muted)]">暂无里程碑计划</p>
        )}
      </AccordionItem>
    </section>
  )
}

export default NextDraftSupportingSection

const RESOURCE_SOURCE_META = {
  user: { label: '你提供的', color: 'var(--nx-status-success)' },
  organization: { label: '组织数据', color: 'var(--nx-accent)' },
  assumption: { label: 'AI 假设', color: 'var(--nx-status-warning)' },
} as const

/**
 * 人数来源（E）：用户在澄清中给出的 → 你提供的；按组织成员数推定的 → 组织数据；其余 → AI 假设（需确认）。
 */
export function resourceSourceOf(marker: {
  source: string
  reason: string
  needsConfirmation: boolean
}): keyof typeof RESOURCE_SOURCE_META {
  if (marker.source === 'explicit' && !/组织/.test(marker.reason)) return 'user'
  if (/组织/.test(marker.reason)) return 'organization'
  return 'assumption'
}

function ResourceSourceBadge({
  marker,
}: {
  marker: { source: string; reason: string; needsConfirmation: boolean }
}) {
  const meta = RESOURCE_SOURCE_META[resourceSourceOf(marker)]
  return (
    <span
      data-resource-source={resourceSourceOf(marker)}
      title={marker.reason}
      className="rounded-sm border px-1.5 py-0.5 text-[10px]"
      style={{ color: meta.color, borderColor: meta.color }}
    >
      {meta.label}
    </span>
  )
}
