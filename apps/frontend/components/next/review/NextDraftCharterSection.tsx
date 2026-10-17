'use client'

import { CalendarRange, CheckCircle2 } from 'lucide-react'
import type { ProjectDraftCharter } from '@aiproj/types'
import { extractMarkedValue, formatDateSpan } from '@/lib/next/draft-review-helpers'

/**
 * 项目章程只读检视（v3-ui-next-draft-review-panel tasks 1.2）。
 *
 * 以暗黑仪器卡片只读呈现标题、愿景、业务范围、阶段目标、成功标准与整体计划起止日。
 * 纯展示组件：零输入框、零选择器、零网络请求（RL-01、RL-06）。
 */
export interface NextDraftCharterSectionProps {
  charter: ProjectDraftCharter
}

export function NextDraftCharterSection({ charter }: NextDraftCharterSectionProps) {
  const startDate = extractMarkedValue(charter.startDate)
  const endDate = extractMarkedValue(charter.endDate)
  const objectives = extractMarkedValue(charter.objectives)
  const successCriteria = extractMarkedValue(charter.successCriteria)

  return (
    <section data-charter-section aria-label="项目章程" className="space-y-3 text-left">
      <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3">
        <h3 data-charter-title className="text-sm font-semibold text-[var(--nx-text-primary)]">
          {extractMarkedValue(charter.title)}
        </h3>
        <p
          data-charter-vision
          className="mt-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
        >
          {extractMarkedValue(charter.vision)}
        </p>
      </div>

      <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
          业务范围
        </h4>
        <p
          data-charter-scope
          className="mt-1.5 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
        >
          {extractMarkedValue(charter.scope)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
            阶段目标
          </h4>
          {objectives.length > 0 ? (
            <ol data-charter-objectives className="mt-1.5 space-y-1.5">
              {objectives.map((objective, index) => (
                <li
                  key={`${index}-${objective}`}
                  className="flex items-start gap-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
                >
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-[var(--nx-border-hairline)] font-mono text-[10px] text-[var(--nx-text-muted)]">
                    {index + 1}
                  </span>
                  <span>{objective}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-1.5 text-xs text-[var(--nx-text-muted)]">暂无阶段目标</p>
          )}
        </div>

        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
            成功标准
          </h4>
          {successCriteria.length > 0 ? (
            <ul data-charter-success-criteria className="mt-1.5 space-y-1.5">
              {successCriteria.map((criterion, index) => (
                <li
                  key={`${index}-${criterion}`}
                  className="flex items-start gap-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
                >
                  <CheckCircle2
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-success)]"
                    aria-hidden
                  />
                  <span>{criterion}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-xs text-[var(--nx-text-muted)]">暂无成功标准</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-2.5">
        <CalendarRange className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
        <span className="text-[11px] text-[var(--nx-text-muted)]">整体计划周期</span>
        <span
          data-charter-dates
          className="rounded border border-[var(--nx-border-hairline)] px-2 py-0.5 font-mono text-[11px] text-[var(--nx-text-primary)]"
        >
          {formatDateSpan(startDate, endDate)}
        </span>
      </div>
    </section>
  )
}

export default NextDraftCharterSection
