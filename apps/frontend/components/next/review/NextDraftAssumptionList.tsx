'use client'

import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'
import type { AiMarkerSource, ProjectDraft } from '@aiproj/types'
import {
  extractDraftAssumptions,
  formatConfidence,
  formatDurationDays,
  type DraftAssumptionItem,
} from '@/lib/next/draft-review-helpers'

/** 推断来源分类中文标签（静态映射，禁止运行时注入）。 */
const SOURCE_LABELS: Readonly<Record<AiMarkerSource, string>> = {
  inferred: 'AI 推断（inferred）',
  explicit: '显式输入（explicit）',
  default: '系统兜底（default）',
}

export interface NextDraftAssumptionListProps {
  /** 当前审查草案（9 模块完整对象）；为 null 时不渲染（由主容器兜底空态）。 */
  draft: ProjectDraft | null
}

/** 任意推断取值 → 展示文本（数组以顿号连接，对象 JSON 化，空值中性占位）。 */
function formatPlainValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.map(formatPlainValue).join('、')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** 推断取值展示：工期/滞后天数类数字附加「天」单位（与 Diff 栏口径一致）。 */
function formatAssumptionValue(path: string, value: unknown): string {
  if (typeof value === 'number' && /(?:durationDays|lagDays)$/.test(path)) {
    return formatDurationDays(value)
  }
  return formatPlainValue(value)
}

/** 单条待确认假设卡片（只读呈现，无任何交互控件）。 */
function AssumptionCard({ item }: { item: DraftAssumptionItem }) {
  return (
    <li
      data-assumption-card
      data-assumption-path={item.path}
      data-assumption-high-impact={item.isHighImpact ? 'true' : undefined}
      className={
        item.isHighImpact
          ? 'border-l-2 border-[var(--nx-status-warning)]/60 px-3 py-2.5'
          : 'px-3 py-2.5'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span data-assumption-label className="text-xs font-medium text-[var(--nx-text-primary)]">
          {item.label}
        </span>
        {item.isHighImpact ? (
          <span
            data-assumption-high-impact-badge
            className="inline-flex items-center gap-1 rounded border border-[var(--nx-status-warning)]/60 bg-[var(--nx-status-warning)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--nx-status-warning)]"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden />
            高影响假设
          </span>
        ) : null}
      </div>
      <span className="mt-1 block font-mono text-[10px] text-[var(--nx-text-muted)]">
        {item.path}
      </span>

      <div className="mt-2 flex items-baseline gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5">
        <span className="shrink-0 text-[10px] text-[var(--nx-text-muted)]">推断取值</span>
        <span
          data-assumption-value
          className="font-mono text-xs break-all text-[var(--nx-text-primary)]"
        >
          {formatAssumptionValue(item.path, item.value)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          data-assumption-source
          className="rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
        >
          {SOURCE_LABELS[item.source]}
        </span>
        <span
          data-assumption-confidence
          className="font-mono text-[10px] text-[var(--nx-text-secondary)]"
        >
          置信度: {formatConfidence(item.confidence)}
        </span>
      </div>

      <p
        data-assumption-reason
        className="mt-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
      >
        {item.reason}
      </p>
    </li>
  )
}

/** 逐任务 / 逐依赖的同类字段合并成一组的标签（其余字段逐条展示）。 */
const GROUP_LABELS: Readonly<Record<string, string>> = {
  'tasks.durationDays': '任务工期',
  'tasks.startDate': '任务开始日期',
  'tasks.endDate': '任务完成日期',
  'tasks.assigneeHint': '负责人建议',
  'tasks.assigneeRoleIds': '负责角色',
  'dependencies.lagDays': '依赖间隔天数',
}

/** 同类字段至少这么多条才折叠成一组；少量时逐条展示更直观。 */
const GROUP_THRESHOLD = 4

function groupKey(path: string): string | null {
  const match = /^(tasks|dependencies)\[\d+\]\.(\w+)/u.exec(path)
  return match ? `${match[1]}.${match[2]}` : null
}

/**
 * 按字段归组：计划里每个任务的工期、起止日、负责人都是 AI 推断（HL-004 要求全部标待确认），
 * 一份 150 个任务的计划会铺出 500+ 张卡片、看不过来。同类字段合并成可展开的一组，一项不少。
 */
function groupAssumptions(items: DraftAssumptionItem[]) {
  const buckets = new Map<string, DraftAssumptionItem[]>()
  for (const item of items) {
    const key = groupKey(item.path)
    if (key) buckets.set(key, [...(buckets.get(key) ?? []), item])
  }
  const grouped = new Set(
    [...buckets.entries()].filter(([, list]) => list.length >= GROUP_THRESHOLD).map(([key]) => key),
  )
  return {
    singles: items.filter((item) => !grouped.has(groupKey(item.path) ?? '')),
    groups: [...grouped].map((key) => ({
      key,
      label: GROUP_LABELS[key] ?? '任务其他字段',
      items: buckets.get(key)!,
    })),
  }
}

/**
 * AIMarker 待确认假设清单（design D4 / tasks 2.2）。
 *
 * - 自动遍历草案提取 `needsConfirmation === true` 的 Marked 字段；
 * - 高影响字段（工期/起止日/负责人/风险等级等）琥珀色发丝边框 + 「高影响假设」徽章；
 * - 顶部常驻「待确认转正阶段人工裁决」提示（RL-02）；纯只读，零表单控件（RL-01、RL-06）。
 */
export function NextDraftAssumptionList({ draft }: NextDraftAssumptionListProps) {
  if (draft === null) return null
  const assumptions = extractDraftAssumptions(draft)

  return (
    <section
      data-next-assumption-list
      aria-label="AI 假设检查清单"
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          AI 假设检查清单
        </h3>
        <span data-assumption-count className="font-mono text-[10px] text-[var(--nx-text-muted)]">
          {assumptions.length} 项待确认
        </span>
      </header>

      <p
        data-assumption-notice
        className="border-b border-[var(--nx-border-hairline)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
      >
        以下要素由 AI 启发式推断得出，待确认转正阶段人工裁决
      </p>

      {assumptions.length === 0 ? (
        <div
          data-assumptions-empty
          className="flex items-center gap-2 px-3 py-4 text-xs text-[var(--nx-text-muted)]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--nx-status-success)]" aria-hidden />
          自检完毕，本次生成未检测到需特别关注的高风险推断假设
        </div>
      ) : (
        <>
          {groupAssumptions(assumptions).groups.map((group) => (
            <details
              key={group.key}
              data-assumption-group={group.key}
              className="border-b border-[var(--nx-border-hairline)]"
            >
              <summary className="cursor-pointer px-3 py-2.5 text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]">
                <span className="font-medium">{group.label}</span>
                <span className="ml-2 font-mono text-[10px] text-[var(--nx-text-muted)]">
                  {group.items.length} 项 · 点击展开逐项核对
                </span>
              </summary>
              <ul className="divide-y divide-[var(--nx-border-hairline)]">
                {group.items.map((item) => (
                  <AssumptionCard key={item.id} item={item} />
                ))}
              </ul>
            </details>
          ))}
          <ul className="divide-y divide-[var(--nx-border-hairline)]">
            {groupAssumptions(assumptions).singles.map((item) => (
              <AssumptionCard key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export default NextDraftAssumptionList
