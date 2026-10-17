'use client'

import Link from 'next/link'
import { CopyableCode } from '@/components/next/common/CopyableCode'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * AI 同事 ·「我的工作」卡（工具 `get_my_work`）：跨项目未完成任务清单。
 *
 * - 已按紧急程度排好（逾期 → 今天到期 → 受阻 → 优先级 → 截止日），带序号，
 *   可以直接对 AI 同事说「把第 2 个延到明天」「第 1 个标为完成」；
 * - 每条可直接前往（打开项目并展开任务详情），编号点一下即复制。
 */
export interface MyWorkCardItem {
  code: string
  id: number
  name: string
  statusLabel: string
  priority: string | null
  endDate: string | null
  dueState: 'overdue' | 'due_today' | 'due_this_week' | 'later' | 'no_due'
  overdueDays: number | null
  project: { id: number; code: string; name: string }
  path: string
}

export interface MyWorkCardData {
  filter?: string
  today?: string
  items?: MyWorkCardItem[]
  summary?: {
    total?: number
    overdue?: number
    dueToday?: number
    dueThisWeek?: number
    blocked?: number
    projects?: { id: number; code: string; name: string; count: number }[]
  }
  truncated?: boolean
}

const DUE_LABEL: Record<MyWorkCardItem['dueState'], string> = {
  overdue: '已逾期',
  due_today: '今天到期',
  due_this_week: '本周到期',
  later: '稍后',
  no_due: '无截止日',
}

const DUE_TONE: Record<MyWorkCardItem['dueState'], string> = {
  overdue: 'text-[var(--nx-status-danger)]',
  due_today: 'text-[var(--nx-status-warning)]',
  due_this_week: 'text-[var(--nx-text-secondary)]',
  later: 'text-[var(--nx-text-muted)]',
  no_due: 'text-[var(--nx-text-muted)]',
}

export function MyWorkCard({ data, toolName }: { data: MyWorkCardData; toolName: string }) {
  const items = Array.isArray(data.items) ? data.items : []
  const summary = data.summary ?? {}
  const projectCount = summary.projects?.length ?? 0

  return (
    <article
      data-card="my-work"
      className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <p className="text-xs font-medium text-[var(--nx-text-primary)]">
          我的工作 · {summary.total ?? items.length} 项
          {projectCount > 0 ? `，分布在 ${projectCount} 个项目` : ''}
        </p>
        <RuleMatchBadge toolName={toolName} />
      </div>
      {(summary.overdue ?? 0) + (summary.dueToday ?? 0) + (summary.blocked ?? 0) > 0 ? (
        <p data-my-work-summary className="px-3 pt-2 text-[11px] text-[var(--nx-text-secondary)]">
          {[
            summary.overdue ? `逾期 ${summary.overdue}` : null,
            summary.dueToday ? `今天到期 ${summary.dueToday}` : null,
            summary.blocked ? `受阻 ${summary.blocked}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="px-3 py-3 text-xs text-[var(--nx-text-muted)]">
          没有需要你处理的未完成任务。
        </p>
      ) : (
        <ol data-my-work-list className="divide-y divide-[var(--nx-border-hairline)]">
          {items.map((item, index) => (
            <li
              key={item.id}
              data-my-work-item={item.id}
              className="flex items-start gap-2 px-3 py-2"
            >
              <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-[11px] text-[var(--nx-text-muted)]">
                {index + 1}.
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  href={item.path}
                  className="block truncate text-xs font-medium text-[var(--nx-text-primary)] hover:text-[var(--nx-accent)] hover:underline"
                  title={item.name}
                >
                  {item.name}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--nx-text-muted)]">
                  <CopyableCode
                    code={item.code}
                    className="border-transparent px-0 py-0 text-[10px]"
                  />
                  <span className="truncate">{item.project.name}</span>
                  <span>{item.statusLabel}</span>
                  <span className={DUE_TONE[item.dueState]}>
                    {DUE_LABEL[item.dueState]}
                    {item.dueState === 'overdue' && item.overdueDays
                      ? ` ${item.overdueDays} 天`
                      : ''}
                    {item.endDate && item.dueState !== 'no_due' ? ` · ${item.endDate}` : ''}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {data.truncated ? (
        <p className="px-3 pb-2 text-[10px] text-[var(--nx-text-muted)]">只显示最紧急的 50 项。</p>
      ) : null}
    </article>
  )
}

export default MyWorkCard
