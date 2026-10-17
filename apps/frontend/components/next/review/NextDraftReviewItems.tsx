'use client'

import { AlertCircle, CheckCircle2, HelpCircle, Wrench } from 'lucide-react'
import type { ProjectDraftMeta } from '@aiproj/types'
import { unmaskMembers } from '@/lib/member-mask'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const KIND_ICON = {
  decision_needed: HelpCircle,
  assumption: AlertCircle,
  unresolved_issue: Wrench,
} as const

const DECISION_SOURCE = { user: '你确认', system: '系统', model: 'AI' } as const

const KIND_LABEL = {
  decision_needed: '需要你决定',
  assumption: '规划假设',
  unresolved_issue: '自动修复未解决',
} as const

/**
 * 「待你确认」清单：生成管线已自行批判并单点修复过一轮又一轮，这里只列修不掉、
 * 或本就需要人判断的事（开放问题、未确认的规划假设、多轮修复后仍存在的问题）。
 */
export function NextDraftReviewItems({ meta }: { meta: ProjectDraftMeta | null }) {
  const mentioned = useAiProjectDraftStore((state) => state.mentionedMembers)
  // 模型只见过「成员#id」：界面上换回姓名。
  const show = (value: string) =>
    unmaskMembers(value, (id) => mentioned.find((member) => member.userId === id)?.name)
  if (!meta) return null
  const items = meta.reviewItems ?? []
  const loop = meta.qualityLoop
  const understanding = meta.planUnderstanding
  const decisions = meta.decisions ?? []
  if (items.length === 0 && !loop && !understanding && decisions.length === 0) return null

  return (
    <section
      data-review-items
      aria-label="待你确认"
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
    >
      <h3 className="text-xs font-semibold text-[var(--nx-text-primary)]">
        待你确认 {items.length > 0 ? `· ${items.length}` : ''}
      </h3>
      {loop ? (
        <p
          className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
          data-quality-loop
        >
          生成后已自动审查 {loop.rounds} 轮：发现 {loop.issuesBefore} 个问题，修复{' '}
          {loop.repairedTasks} 个任务、补充 {loop.addedDependencies} 条依赖，剩余 {loop.issuesAfter}{' '}
          个。
        </p>
      ) : null}
      {understanding ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--nx-text-muted)]">
          <CheckCircle2
            className={`h-3.5 w-3.5 ${understanding.confirmedByUser ? 'text-[var(--nx-status-success)]' : 'text-[var(--nx-status-warning)]'}`}
            aria-hidden
          />
          {understanding.confirmedByUser
            ? '按你确认的项目理解拆解'
            : '项目理解由 AI 梳理，未经你确认'}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--nx-text-secondary)]">没有需要你额外判断的事项。</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind]
            return (
              <li
                key={item.id}
                data-review-item={item.kind}
                className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1.5"
              >
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-primary)]">
                  <Icon
                    className={`h-3.5 w-3.5 ${item.severity === 'high' ? 'text-[var(--nx-status-danger)]' : 'text-[var(--nx-status-warning)]'}`}
                    aria-hidden
                  />
                  {item.kind === 'unresolved_issue' ? item.title : KIND_LABEL[item.kind]}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                  {show(item.detail)}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      {decisions.length > 0 ? (
        <details data-decisions className="mt-3">
          <summary className="cursor-pointer text-[11px] font-medium text-[var(--nx-text-secondary)]">
            生成过程中的关键决定 · {decisions.length}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {decisions.map((item) => (
              <li
                key={item.id}
                className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
              >
                <span className="mr-1 rounded border border-[var(--nx-border-hairline)] px-1 text-[10px] text-[var(--nx-text-muted)]">
                  {DECISION_SOURCE[item.source]}
                </span>
                {show(item.decision)}
                <span className="text-[var(--nx-text-muted)]">：{show(item.reason)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
