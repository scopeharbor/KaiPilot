'use client'

import { BadgeCheck, Wrench } from 'lucide-react'
import type { DraftAutoFixDiff } from '@aiproj/types'
import { formatDurationDays } from '@/lib/next/draft-review-helpers'

export interface NextDraftAutoFixDiffProps {
  /** 校验报告中的自动修正条目（可为空数组）。 */
  diffs: DraftAutoFixDiff[]
}

/** 任意取值 → 展示文本（数组顿号连接，对象 JSON 化，空值中性占位）。 */
function formatPlainValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.map(formatPlainValue).join('、')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Diff 取值展示：工期/滞后天数类数字附加「天」单位（与假设清单口径一致）。 */
function formatDiffValue(path: string, value: unknown): string {
  if (typeof value === 'number' && /(?:durationDays|lagDays)$/.test(path)) {
    return formatDurationDays(value)
  }
  return formatPlainValue(value)
}

/** 单条自动修正对比卡：修正前红删除线、修正后绿高亮、中文修正原因。 */
function DiffCard({ diff }: { diff: DraftAutoFixDiff }) {
  return (
    <li
      data-fix-diff-card
      className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
    >
      <span data-fix-diff-path className="font-mono text-[10px] text-[var(--nx-text-secondary)]">
        {diff.path}
      </span>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <span className="block text-[10px] text-[var(--nx-text-muted)]">修正前</span>
          <span
            data-fix-diff-before
            className="mt-0.5 block truncate font-mono text-[11px] text-[var(--nx-status-danger)] line-through decoration-[var(--nx-status-danger)]/70"
          >
            {formatDiffValue(diff.path, diff.before)}
          </span>
        </div>
        <div className="min-w-0">
          <span className="block text-[10px] text-[var(--nx-text-muted)]">修正后</span>
          <span
            data-fix-diff-after
            className="mt-0.5 block truncate rounded border border-[var(--nx-status-success)]/40 bg-[var(--nx-status-success)]/10 px-1 font-mono text-[11px] text-[var(--nx-status-success)]"
          >
            {formatDiffValue(diff.path, diff.after)}
          </span>
        </div>
      </div>
      <div className="mt-1.5">
        <span className="block text-[10px] text-[var(--nx-text-muted)]">修正原因</span>
        <p
          data-fix-diff-reason
          className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-text-primary)]"
        >
          {diff.reason}
        </p>
      </div>
    </li>
  )
}

/**
 * 系统自动修正前后对比 Diff 栏（design D5 / tasks 2.4）。
 *
 * - 消费 `validation.autoFixDiffs`：展示字段路径、修正前（红删除线）、修正后（绿高亮）与原因；
 * - 空数组时展示「系统自检完成，无自动修正调整」只读提示；
 * - 纯只读呈现，绝不把修正值写回草案或发起任何写请求（RL-01、RL-06）。
 */
export function NextDraftAutoFixDiff({ diffs }: NextDraftAutoFixDiffProps) {
  return (
    <section
      data-next-auto-fix-diff
      aria-label="自动修正 Diff"
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)]">
          <Wrench className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          自动修正 Diff
        </h3>
        {diffs.length > 0 ? (
          <span data-fix-diff-count className="font-mono text-[10px] text-[var(--nx-text-muted)]">
            {diffs.length} 处
          </span>
        ) : null}
      </header>

      {diffs.length === 0 ? (
        <div
          data-fix-diff-empty
          className="flex items-center gap-2 px-3 py-4 text-xs text-[var(--nx-text-muted)]"
        >
          <BadgeCheck className="h-4 w-4 shrink-0 text-[var(--nx-status-success)]" aria-hidden />
          系统自检完成，无自动修正调整
        </div>
      ) : (
        <ul data-fix-diff-list className="space-y-1.5 px-3 py-2.5">
          {diffs.map((diff, index) => (
            <DiffCard key={`${diff.path}-${index}`} diff={diff} />
          ))}
        </ul>
      )}
    </section>
  )
}

export default NextDraftAutoFixDiff
