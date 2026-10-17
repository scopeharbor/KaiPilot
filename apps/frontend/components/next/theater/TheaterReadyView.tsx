'use client'

import * as React from 'react'
import { ArrowRight, CalendarClock, History, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { projectTypeLabel } from './TheaterIntentFeedback'
import { TheaterFeasibilityPanel } from './TheaterFeasibilityPanel'
import { TheaterUnderstandingPanel } from './TheaterUnderstandingPanel'
import { unmaskMembers } from '@/lib/member-mask'
import type { AdaptiveClarificationSession, ClarificationField } from '@aiproj/types'
import type { AiMarkerSource } from '@aiproj/types'

/**
 * 澄清完成就绪态视图（tasks 3.2 / design D8）。
 *
 * - 结构化汇总 ConfirmedProjectContext：项目名称、范围交付物、周期假设、团队资源与
 *   AI 默认假设免责清单；
 * - **RL-01 人工确认关卡**：纯展示组件，零 useEffect / 零网络请求 / 零落库；
 *   主行动按钮「开始生成项目草案」仅触发 `onStartGeneration` 回调，作为向 B2b
 *   场景叙事生成移交控制权的权威对接点；
 * - 「重新调整回答」反悔入口通过 `onEditContext` 回调交由装配层（W4）退回澄清流。
 */
export interface TheaterReadyViewProps {
  /** 用户显式点击「开始生成项目草案」时的交接回调（B2b 对接点）。 */
  onStartGeneration: () => void
  /** 用户点击「重新调整回答」时的反悔入口回调（退回澄清卡片流）。 */
  onEditContext?: () => void
}

/** ClarificationField 确定性中文标签（RL-14：静态映射，禁止运行时注入）。 */
export const CLARIFICATION_FIELD_LABELS: Readonly<Record<ClarificationField, string>> = {
  projectGoal: '核心目标',
  corePain: '痛点背景',
  targetUser: '目标用户',
  successMetrics: '成功指标',
  scopeBoundary: '范围边界',
  startDate: '开工日期',
  teamSize: '团队规模',
  techStack: '技术栈',
  methodology: '研发方法',
  qualityStandard: '质量标准',
  communicationFreq: '沟通频率',
  integration: '系统集成',
  compliance: '合规要求',
  designPreference: '设计偏好',
  hosting: '部署环境',
  thirdPartyServices: '第三方服务',
  securityControls: '安全控制',
  performanceTarget: '性能指标',
  migrationScope: '迁移范围',
  rolloutStrategy: '发布策略',
  agentRisk: '智能体风险',
  agentDependency: '智能体依赖',
  agentAcceptance: '智能体验收',
  agentStakeholder: '智能体干系人',
  agentConstraint: '智能体约束',
}

const SOURCE_META: Readonly<Record<AiMarkerSource, { label: string; token: string }>> = {
  explicit: { label: '用户确认', token: 'var(--nx-status-success)' },
  inferred: { label: 'AI 推断', token: 'var(--nx-status-warning)' },
  default: { label: 'AI 默认', token: 'var(--nx-status-warning)' },
}

const CALENDAR_NOTE_PREFIX = '📅 日历提醒：'

/** 追问最后一轮（答完时间就结束）带出的日历提醒；提示改成就绪页能用的入口。 */
export function lastCalendarNote(session: AdaptiveClarificationSession | null): string | null {
  if (session?.status !== 'ready' || !session.calendarNote) return null
  return session.calendarNote
    .replace(CALENDAR_NOTE_PREFIX, '')
    .replace(
      /如果时间说错了，回答「我想修改之前的回答」就能改。$/,
      '如果时间说错了，可以点下方「重新调整回答」修改。',
    )
}

function renderValue(value: string | number | string[]): string {
  return Array.isArray(value) ? value.join('、') : String(value)
}

export function TheaterReadyView({ onStartGeneration, onEditContext }: TheaterReadyViewProps) {
  const context = useAiProjectDraftStore((state) => state.context)
  const mentionedMembers = useAiProjectDraftStore((state) => state.mentionedMembers)
  // 开工日 / 工期 / 团队由服务端从原话与回答里解析，随「项目理解」一起回写 context；
  // 回写之前显示「核对中」，不要让已经说过的信息看起来像被忽略了。
  const understandingStatus = useAiProjectDraftStore((state) => state.understandingStatus)
  const understanding = useAiProjectDraftStore((state) => state.understandingDraft)
  const checking = understandingStatus === 'loading'
  // 检查点 A 的日历提醒附在下一题说明里；追问在答完时间那一题就结束时没有下一题，改在这里显示。
  const calendarNote = useAiProjectDraftStore((state) => lastCalendarNote(state.adaptiveSession))
  const showNames = (text: string) =>
    unmaskMembers(text, (id) => mentionedMembers.find((member) => member.userId === id)?.name)

  if (!context) return null

  const parsed = context.parsedIntent
  const resolved = context.resolvedFields
  const teamSize = resolved.teamSize
  const techStack = resolved.techStack
  const timeline = parsed.timeline
  const assumptionEntries = Object.entries(context.assumptions)

  return (
    <section
      data-theater-ready
      aria-label="澄清完成 · 生成就绪"
      className="nx-space-atmosphere mx-auto w-full max-w-3xl rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/80 px-6 py-6"
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--nx-text-primary)]">
            澄清完成 · 生成就绪
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--nx-text-muted)]">
            以下为已确认的项目上下文。系统处于等待确认状态，未发起任何生成或落库请求。
          </p>
        </div>
        <span
          data-ready-status
          className="flex shrink-0 items-center gap-1.5 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 py-1 text-[11px] text-[var(--nx-accent)]"
        >
          <LockKeyhole className="h-3.5 w-3.5" aria-hidden />
          等待人工确认
        </span>
      </header>

      <dl className="mt-5 divide-y divide-[var(--nx-border-hairline)] border-y border-[var(--nx-border-hairline)]">
        <div className="flex gap-4 py-3" data-ready-row="project-name">
          <dt className="w-24 shrink-0 text-xs leading-relaxed text-[var(--nx-text-muted)]">
            项目名称
          </dt>
          <dd className="text-sm leading-relaxed text-[var(--nx-text-primary)]">
            {parsed.projectName ?? '未命名项目'}
          </dd>
        </div>
        <div className="flex gap-4 py-3" data-ready-row="project-type">
          <dt className="w-24 shrink-0 text-xs leading-relaxed text-[var(--nx-text-muted)]">
            项目类型
          </dt>
          <dd className="text-sm leading-relaxed text-[var(--nx-text-primary)]">
            {projectTypeLabel(parsed.projectType)}
          </dd>
        </div>
        <div className="flex gap-4 py-3" data-ready-row="objective">
          <dt className="w-24 shrink-0 text-xs leading-relaxed text-[var(--nx-text-muted)]">
            核心目标
          </dt>
          <dd className="text-sm leading-relaxed text-[var(--nx-text-primary)]">
            {parsed.objectives.length > 0
              ? parsed.objectives.join('；')
              : understanding?.successPicture
                ? showNames(understanding.successPicture)
                : checking
                  ? '正在从项目理解中整理…'
                  : '未提取到明确目标，建议生成前补充'}
          </dd>
        </div>
        <div className="flex gap-4 py-3" data-ready-row="deliverables">
          <dt className="w-24 shrink-0 text-xs leading-relaxed text-[var(--nx-text-muted)]">
            范围交付物
          </dt>
          <dd className="flex flex-wrap gap-1.5 text-sm leading-relaxed text-[var(--nx-text-primary)]">
            {parsed.deliverables.length > 0 ? (
              parsed.deliverables.map((deliverable) => (
                <span
                  key={deliverable}
                  className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-0.5 text-xs text-[var(--nx-text-secondary)]"
                >
                  {deliverable}
                </span>
              ))
            ) : understanding && understanding.capabilities.length > 0 ? (
              understanding.capabilities.map((capability) => (
                <span
                  key={capability.name}
                  className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-0.5 text-xs text-[var(--nx-text-secondary)]"
                >
                  {showNames(capability.name)}
                </span>
              ))
            ) : (
              <span className="text-[var(--nx-text-muted)]">
                {checking ? '正在从项目理解中整理…' : '暂未识别交付物'}
              </span>
            )}
          </dd>
        </div>
        <div className="flex gap-4 py-3" data-ready-row="schedule">
          <dt className="w-24 shrink-0 text-xs leading-relaxed text-[var(--nx-text-muted)]">
            周期假设
          </dt>
          <dd className="text-sm leading-relaxed text-[var(--nx-text-primary)]">
            {timeline.startDate
              ? `开工 ${timeline.startDate}`
              : checking
                ? '开工日期核对中'
                : '开工日期未指定'}
            <span className="mx-2 text-[var(--nx-text-muted)]">·</span>
            {timeline.deadline
              ? `截止 ${timeline.deadline}`
              : checking
                ? '截止日期核对中'
                : '截止日期未指定'}
            <span className="mx-2 text-[var(--nx-text-muted)]">·</span>
            {timeline.durationDays !== null
              ? `预计工期 ${timeline.durationDays} 天`
              : checking
                ? '工期核对中'
                : '工期未指定'}
          </dd>
        </div>
        <div className="flex gap-4 py-3" data-ready-row="resource">
          <dt className="w-24 shrink-0 text-xs leading-relaxed text-[var(--nx-text-muted)]">
            团队资源
          </dt>
          <dd className="flex flex-col gap-1.5 text-sm leading-relaxed text-[var(--nx-text-primary)]">
            {teamSize ? (
              <span className="flex items-center gap-2">
                {typeof teamSize.value === 'number' || /^\d+$/.test(String(teamSize.value))
                  ? `${renderValue(teamSize.value)} 人`
                  : showNames(renderValue(teamSize.value))}
                <SourceTag
                  source={teamSize.marker.source}
                  needsConfirmation={teamSize.marker.needsConfirmation}
                />
              </span>
            ) : (
              <span className="text-[var(--nx-text-muted)]">
                {checking ? '团队规模核对中' : '团队规模未指定'}
              </span>
            )}
            {techStack ? (
              <span className="flex items-center gap-2">
                {renderValue(techStack.value)}
                <SourceTag
                  source={techStack.marker.source}
                  needsConfirmation={techStack.marker.needsConfirmation}
                />
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {context.planningMemory && context.planningMemory.facts.length > 0 ? (
        // 跨生成记忆：服务端从本组织过去的计划与执行数据推出，生成时会一并参考。
        <section className="mt-6" data-theater-planning-memory>
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
            参考了你们过去的计划
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--nx-text-muted)]">
            以下来自本组织已转正的计划和已完成任务的实际用时，生成时会作为参考，不会直接改动你确认的信息。
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-relaxed text-[var(--nx-text-secondary)]">
            {context.planningMemory.facts.map((fact) => (
              <li key={fact}>· {showNames(fact)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6" data-theater-assumptions>
        <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-[var(--nx-text-muted)]">
          <ShieldCheck className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
          AI 默认假设免责清单
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--nx-text-muted)]">
          以下内容为 AI 依据缺省信息推断的假设，未经过您的显式确认。生成草案前请逐项核对。
        </p>
        {assumptionEntries.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {assumptionEntries.map(([field, marked]) => (
              <li
                key={field}
                className="flex flex-wrap items-center gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-xs"
              >
                <span className="text-[var(--nx-text-secondary)]">
                  {CLARIFICATION_FIELD_LABELS[field as ClarificationField] ?? field}
                </span>
                <span className="font-mono text-[var(--nx-text-primary)]">
                  {renderValue(marked.value)}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  {marked.marker.needsConfirmation ? (
                    <span
                      data-assumption-flag="needs-confirmation"
                      className="rounded border border-[var(--nx-status-warning)]/50 px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]"
                    >
                      待您确认
                    </span>
                  ) : null}
                  <span
                    data-assumption-flag="default"
                    className="rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-1.5 py-0.5 text-[10px] text-[var(--nx-accent)]"
                  >
                    AI 假设免责
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-[var(--nx-text-muted)]">
            本会话未产生 AI 默认假设，全部要素均来自您的明确输入。
          </p>
        )}
      </section>

      {calendarNote ? (
        <p
          data-ready-calendar-note
          className="mt-4 flex gap-2 rounded-md border border-[var(--nx-status-warning)]/50 px-3 py-2 text-xs leading-relaxed text-[var(--nx-text-primary)]"
        >
          <CalendarClock
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
            aria-hidden
          />
          <span>{calendarNote}</span>
        </p>
      ) : null}

      <TheaterUnderstandingPanel />

      <TheaterFeasibilityPanel />

      <footer className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-theater-start-generation
          onClick={onStartGeneration}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 py-2 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)]"
        >
          开始生成项目草案
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
        {onEditContext ? (
          <button
            type="button"
            data-theater-edit-context
            onClick={onEditContext}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 py-2 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <History className="h-4 w-4" aria-hidden />
            重新调整回答
          </button>
        ) : null}
      </footer>
    </section>
  )
}

function SourceTag({
  source,
  needsConfirmation,
}: {
  source: AiMarkerSource
  needsConfirmation: boolean
}) {
  const meta = SOURCE_META[source] ?? SOURCE_META.inferred
  return (
    <span className="flex items-center gap-1.5">
      <span
        data-source-tag={source}
        className="rounded border px-1.5 py-0.5 text-[10px]"
        style={{ color: meta.token, borderColor: meta.token }}
      >
        {needsConfirmation ? `${meta.label} · 需确认` : meta.label}
      </span>
    </span>
  )
}
