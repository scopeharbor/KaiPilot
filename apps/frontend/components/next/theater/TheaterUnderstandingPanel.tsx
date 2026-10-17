'use client'

import * as React from 'react'
import { CheckCircle2, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import type { ProjectPlanUnderstanding } from '@aiproj/types'
import { runTheaterUnderstanding, useTheaterRunnerStore } from '@/lib/next/theater-runner'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { mapUnderstandingText, maskMentions, unmaskMembers } from '@/lib/member-mask'
import { useLiveOutputLanes } from '@/lib/ai-draft/live-output-client'
import { LiveOutputPanel } from './TheaterLiveOutput'
import { VariantInput, VariantTextarea } from '@/components/locale/variant-field'

/** 模型只见过「成员#id」：展示与编辑时换回姓名，确认时再换回代号（姓名不进模型）。 */
function toDisplay(understanding: ProjectPlanUnderstanding): ProjectPlanUnderstanding {
  const members = useAiProjectDraftStore.getState().mentionedMembers
  return mapUnderstandingText(understanding, (text) =>
    unmaskMembers(text, (id) => members.find((member) => member.userId === id)?.name),
  )
}

function toModel(understanding: ProjectPlanUnderstanding): ProjectPlanUnderstanding {
  const members = useAiProjectDraftStore.getState().mentionedMembers
  return mapUnderstandingText(understanding, (text) => maskMentions(text, members))
}

/**
 * 就绪页「项目理解」确认面板（2026-09-27）。
 *
 * 拆解之前先让 AI 把项目讲清楚：要解决的问题、成功画面、业务流程与能力地图。用户确认（可直接编辑）后，
 * 它成为后续每一次模型调用的主干记忆，能力地图直接决定 WBS 一级分支。
 * 只调用理解接口并保存可恢复的分析结果，不发起草案生成、不创建正式项目（RL-01）。
 */
/** 一条待确认问题：就地作答（Enter 或「记下回答」提交）。 */
function OpenQuestionItem({
  question,
  onAnswer,
}: {
  question: string
  onAnswer: (answer: string) => void
}) {
  const [draft, setDraft] = React.useState('')
  const submit = () => {
    const answer = draft.trim()
    if (answer) onAnswer(answer)
  }
  return (
    <li
      data-understanding-open-question
      className="rounded-md border border-[var(--nx-border-hairline)] p-2"
    >
      <p className="text-xs text-[var(--nx-status-warning)]">{question}</p>
      <div className="mt-1.5 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder="直接回答；不确定可以留空，生成时会列为待你确认"
          aria-label={`回答：${question}`}
          className="min-w-0 flex-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        />
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={submit}
          className="shrink-0 rounded border border-[var(--nx-border-focus)] px-2 py-1 text-xs text-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          记下回答
        </button>
      </div>
    </li>
  )
}

export function TheaterUnderstandingPanel() {
  const context = useAiProjectDraftStore((state) => state.context)
  const status = useAiProjectDraftStore((state) => state.understandingStatus)
  const understanding = useAiProjectDraftStore((state) => state.understandingDraft)
  const error = useTheaterRunnerStore((state) => state.understandingError)
  const [editing, setEditing] = React.useState<ProjectPlanUnderstanding | null>(null)
  // 梳理由后台运行器驱动（就绪后自动梳理一次，离开本页也继续）；这里只展示与重试
  const liveOutputId = useTheaterRunnerStore((state) => state.understandingLiveId)
  const live = useLiveOutputLanes(liveOutputId)
  const run = React.useCallback(() => runTheaterUnderstanding(), [])

  // 梳理出新的理解（含后台运行器在别的页面梳理完成）时同步到编辑区
  const shownRef = React.useRef<ProjectPlanUnderstanding | null>(null)
  React.useEffect(() => {
    if (understanding && understanding !== shownRef.current) {
      shownRef.current = understanding
      setEditing(toDisplay(understanding))
    }
  }, [understanding])

  if (!context) return null

  if (status === 'loading' || status === 'idle') {
    return (
      <PanelShell>
        <p
          className="flex items-center gap-2 text-sm text-[var(--nx-text-secondary)]"
          data-understanding-loading
        >
          <Loader2 className="h-4 w-4 animate-spin text-[var(--nx-accent)]" aria-hidden />
          AI
          正在后台梳理项目理解：要解决的问题、成功画面、业务流程与能力地图。耗时取决于所选模型，重试可找回同一任务…
        </p>
        <div className="mt-3">
          <LiveOutputPanel
            compact
            lanes={live.lanes}
            totalChars={live.totalChars}
            title="模型实时输出"
            emptyText="正在连接模型，起草与自我审查的输出会在这里实时显示…"
          />
        </div>
      </PanelShell>
    )
  }

  if (status === 'error' || !editing) {
    return (
      <PanelShell>
        <p className="text-sm text-[var(--nx-status-danger)]" data-understanding-error>
          项目理解梳理失败：{error ?? '未知错误'}
        </p>
        <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
          原输入与已答内容仍保留。连接中断时，重新梳理会先找回后台任务；也可以直接开始生成。
        </p>
        <button type="button" onClick={() => void run()} className={SECONDARY_BUTTON}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新梳理
        </button>
      </PanelShell>
    )
  }

  const confirmed = status === 'confirmed'
  const update = (patch: Partial<ProjectPlanUnderstanding>) =>
    setEditing((current) => (current ? { ...current, ...patch, editedByUser: true } : current))

  if (confirmed) {
    return (
      <PanelShell>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-status-success)]">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              已确认项目理解，将作为拆解依据
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--nx-text-primary)]">
              {editing.problemStatement}
            </p>
            <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
              能力地图：{editing.capabilities.map((item) => item.name).join('、')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => useAiProjectDraftStore.getState().setUnderstandingStatus('ready')}
            className={SECONDARY_BUTTON}
          >
            修改
          </button>
        </div>
      </PanelShell>
    )
  }

  return (
    <PanelShell>
      <p className="text-xs leading-relaxed text-[var(--nx-text-muted)]">
        这是 AI 对项目的理解，后续每一步拆解都以它为准。请核对，不对的地方直接改。
      </p>

      <Field label="要解决的问题">
        <VariantTextarea
          data-understanding-problem
          value={editing.problemStatement}
          onValueChange={(value) => update({ problemStatement: value })}
          rows={3}
          className={TEXTAREA}
        />
      </Field>
      <Field label="成功画面">
        <VariantTextarea
          data-understanding-success
          value={editing.successPicture}
          onValueChange={(value) => update({ successPicture: value })}
          rows={3}
          className={TEXTAREA}
        />
      </Field>
      {editing.currentState ? (
        <Field label="现状">
          <VariantTextarea
            value={editing.currentState}
            onValueChange={(value) => update({ currentState: value })}
            rows={2}
            className={TEXTAREA}
          />
        </Field>
      ) : null}

      <Field label={`能力地图（${editing.capabilities.length} 项，将成为 WBS 一级分支）`}>
        <ul className="space-y-1.5" data-understanding-capabilities>
          {editing.capabilities.map((capability) => (
            <li
              key={capability.id}
              className="flex items-start gap-2 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <VariantInput
                  value={capability.name}
                  onValueChange={(value) =>
                    update({
                      capabilities: editing.capabilities.map((item) =>
                        item.id === capability.id ? { ...item, name: value } : item,
                      ),
                    })
                  }
                  className="w-full bg-transparent text-sm font-medium text-[var(--nx-text-primary)] focus:outline-none"
                  aria-label="能力名称"
                />
                <p className="mt-0.5 text-xs text-[var(--nx-text-secondary)]">
                  {capability.purpose}
                </p>
                {capability.deliverables.length > 0 ? (
                  <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                    交付：{capability.deliverables.join('、')}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={`移除能力 ${capability.name}`}
                onClick={() =>
                  update({
                    capabilities: editing.capabilities.filter((item) => item.id !== capability.id),
                  })
                }
                className="rounded p-1 text-[var(--nx-text-muted)] hover:text-[var(--nx-status-danger)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Field>

      {editing.suggestedTeam && editing.suggestedTeam.length > 0 ? (
        <Field label="建议团队（AI 按角色估算，人数会按工期调整，导入前可分配真人）">
          <ul className="flex flex-wrap gap-1.5" data-understanding-team>
            {editing.suggestedTeam.map((member) => (
              <li
                key={member.role}
                title={member.reason}
                className="rounded border border-[var(--nx-status-warning)]/50 px-2 py-0.5 text-xs text-[var(--nx-text-secondary)]"
              >
                {member.role} × {member.headcount}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}

      {editing.businessFlows.length > 0 ? (
        <Field label="核心业务流程">
          <ul className="space-y-1 text-xs text-[var(--nx-text-secondary)]">
            {editing.businessFlows.map((flow) => (
              <li key={flow.id}>
                <span className="font-medium text-[var(--nx-text-primary)]">{flow.name}：</span>
                {flow.steps.join(' → ')}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}

      {editing.assumptions.length > 0 ? (
        <Field label="规划假设（不成立时会影响计划）">
          <ul className="space-y-1 text-xs text-[var(--nx-text-secondary)]">
            {editing.assumptions.map((assumption) => (
              <li key={assumption.id}>
                · {assumption.statement}
                {assumption.impact ? (
                  <span className="text-[var(--nx-text-muted)]">（影响：{assumption.impact}）</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}

      {editing.openQuestions.length > 0 ? (
        <Field label="仍待确认的问题（能答的直接答；不答的会列入审查页「待你确认」）">
          <ul className="space-y-2">
            {editing.openQuestions.map((question) => (
              <OpenQuestionItem
                key={question}
                question={question}
                onAnswer={(answer) =>
                  setEditing((current) =>
                    current
                      ? {
                          ...current,
                          openQuestions: current.openQuestions.filter((item) => item !== question),
                          answeredQuestions: [
                            ...(current.answeredQuestions ?? []),
                            { question, answer },
                          ],
                          editedByUser: true,
                        }
                      : current,
                  )
                }
              />
            ))}
          </ul>
        </Field>
      ) : null}

      {editing.answeredQuestions?.length ? (
        <Field label="你已补充的回答（生成时作为已确认信息）">
          <ul
            className="space-y-1 text-xs text-[var(--nx-text-secondary)]"
            data-understanding-answered
          >
            {editing.answeredQuestions.map((item) => (
              <li key={item.question} className="flex items-start justify-between gap-2">
                <span>
                  · {item.question}
                  <span className="text-[var(--nx-text-primary)]"> → {item.answer}</span>
                </span>
                <button
                  type="button"
                  className="shrink-0 text-[11px] text-[var(--nx-text-muted)] underline-offset-2 hover:underline"
                  onClick={() =>
                    setEditing((current) =>
                      current
                        ? {
                            ...current,
                            openQuestions: [...current.openQuestions, item.question],
                            answeredQuestions: (current.answeredQuestions ?? []).filter(
                              (answered) => answered.question !== item.question,
                            ),
                          }
                        : current,
                    )
                  }
                >
                  改回答
                </button>
              </li>
            ))}
          </ul>
        </Field>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          data-understanding-confirm
          disabled={!editing.problemStatement.trim() || editing.capabilities.length === 0}
          onClick={() => useAiProjectDraftStore.getState().confirmUnderstanding(toModel(editing))}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--nx-status-success)] px-3 py-1.5 text-xs font-medium text-[var(--nx-status-success)] transition-colors hover:bg-[var(--nx-status-success)]/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          确认这份理解
        </button>
        <button type="button" onClick={() => void run()} className={SECONDARY_BUTTON}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          重新梳理
        </button>
      </div>
    </PanelShell>
  )
}

const TEXTAREA =
  'w-full resize-y rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-sm leading-relaxed text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none'

const SECONDARY_BUTTON =
  'mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] px-3 py-1.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]'

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      data-theater-understanding
      className="mt-6 rounded-md border border-[var(--nx-border-focus)]/40 bg-[var(--nx-space-surface)]/40 px-4 py-4"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-[var(--nx-accent)]">
        <Sparkles className="h-4 w-4" aria-hidden />
        AI 对项目的理解
      </h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-medium text-[var(--nx-text-muted)]">{label}</p>
      {children}
    </div>
  )
}
