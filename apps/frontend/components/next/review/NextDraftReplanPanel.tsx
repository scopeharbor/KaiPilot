'use client'

import * as React from 'react'
import { ArrowRight, CalendarClock, CheckCircle2, ChevronDown, Loader2 } from 'lucide-react'
import type {
  FeasibilityAssessment,
  FeasibilityNegotiationTurn,
  FeasibilityOption,
  ReplanPreview,
} from '@aiproj/types'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import {
  FeasibilityChat,
  OptionCard,
  VerdictBadge,
  errorMessage,
} from '@/components/next/theater/FeasibilityParts'
import { FeasibilityDetails } from '@/components/next/theater/TheaterFeasibilityPanel'

function endText(snapshot: ReplanPreview['before']): string {
  if (!snapshot.plannedEndDate) return '—'
  if (snapshot.exceededWorkdays > 0) {
    return `${snapshot.plannedEndDate} 完工，晚于截止日 ${snapshot.deadline} 约 ${snapshot.exceededWorkdays} 个工作日`
  }
  if (snapshot.deadline && snapshot.plannedEndDate === snapshot.deadline) {
    return `${snapshot.plannedEndDate} 完工，正好是截止日当天`
  }
  return snapshot.deadline
    ? `${snapshot.plannedEndDate} 完工，截止日 ${snapshot.deadline} 前完成`
    : `${snapshot.plannedEndDate} 完工`
}

const CHAT_KEY_PREFIX = 'aiproj-replan-chat:'

/** 审查页协商对话按草案存在本标签页（刷新不丢，关掉标签页即清）；存取失败时退化为只在内存里。 */
export function readReplanChat(draftId: string): FeasibilityNegotiationTurn[] {
  try {
    const raw = window.sessionStorage.getItem(CHAT_KEY_PREFIX + draftId)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as FeasibilityNegotiationTurn[]) : []
  } catch {
    return []
  }
}

function writeReplanChat(draftId: string, chat: FeasibilityNegotiationTurn[]): void {
  try {
    if (chat.length === 0) window.sessionStorage.removeItem(CHAT_KEY_PREFIX + draftId)
    else window.sessionStorage.setItem(CHAT_KEY_PREFIX + draftId, JSON.stringify(chat))
  } catch {
    // 存储不可用（隐私模式等）：对话只留在当前页面
  }
}

function teamText(snapshot: ReplanPreview['before']): string {
  return snapshot.team.map((member) => `${member.role} ${member.headcount}`).join('、')
}

/**
 * 审查页「能否如期完成」（2026-09-28，检查点 C）。
 *
 * 生成完后按这份草案的实际排期给结论：超期 / 很紧 / 可以提前。用户可以选方案，也可以用自己的话商量；
 * 选定后程序在草案上改截止日 / 团队 / 范围并重排（几秒），给出前后对比；用户点「确认调整」才存成
 * 新的草案版本——仍是草案，转正仍要走审查确认（AI 只建议、不自动执行）。
 */
export function NextDraftReplanPanel({ draftId, version }: { draftId: string; version: number }) {
  const draftStatus = useAiProjectDraftStore((state) => state.draftStatus)
  const [assessment, setAssessment] = React.useState<FeasibilityAssessment | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [chat, setChat] = React.useState<FeasibilityNegotiationTurn[]>(() =>
    readReplanChat(draftId),
  )
  const [preview, setPreview] = React.useState<ReplanPreview | null>(null)
  const [previewing, setPreviewing] = React.useState<string | null>(null)
  const [applying, setApplying] = React.useState(false)
  const [message, setMessage] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  React.useEffect(() => {
    writeReplanChat(draftId, chat)
  }, [draftId, chat])

  React.useEffect(() => {
    let cancelled = false
    setAssessment(null)
    setLoadError(null)
    // 包进 Promise：辅助面板任何同步异常都只落到本面板的错误提示，不能拖垮整个审查面板。
    Promise.resolve()
      .then(() => aiDraftApi.replanAssessment(draftId))
      .then((result) => {
        if (cancelled) return
        setAssessment(result.assessment)
        // 超期 / 可以提前时默认展开；做得完只留一行
        setExpanded(result.assessment.verdict === 'over' || result.assessment.verdict === 'early')
      })
      .catch((failure) => {
        if (!cancelled) setLoadError(errorMessage(failure, '没能读取排期结论'))
      })
    return () => {
      cancelled = true
    }
  }, [draftId, version])

  if (draftStatus === 'confirmed') return null
  if (loadError) {
    return (
      <p className="mt-3 text-xs text-[var(--nx-text-muted)]" data-replan-error>
        能否如期完成：{loadError}
      </p>
    )
  }
  if (!assessment) return null

  const showPreview = async (option: FeasibilityOption) => {
    setPreviewing(option.decision.summary)
    setMessage(null)
    try {
      const result = await aiDraftApi.replanPreview(draftId, option.decision)
      setPreview(result.preview)
    } catch (failure) {
      setMessage({ kind: 'error', text: errorMessage(failure, '重排没有成功，请稍后重试') })
    } finally {
      setPreviewing(null)
    }
  }

  const apply = async () => {
    if (!preview || applying) return
    setApplying(true)
    setMessage(null)
    try {
      const detail = await aiDraftApi.replanApply(draftId, { decision: preview.decision, version })
      if (!detail.draft || !detail.meta || !detail.validation) throw new Error('调整后的草案不完整')
      const store = useAiProjectDraftStore.getState()
      store.setDraftCompleted(detail.draft, detail.meta, detail.validation)
      useAiProjectDraftStore.setState({ draftId: detail.draftId, draftVersion: detail.version })
      store.enterReview()
      const confirmStore = useAiDraftConfirmStore.getState()
      confirmStore.resetConfirmState()
      confirmStore.initSelection(detail.draft)
      setPreview(null)
      setChat([])
      setMessage({
        kind: 'ok',
        text: `已调整并存为第 ${detail.version} 版：${preview.decision.summary}`,
      })
    } catch (failure) {
      setMessage({ kind: 'error', text: errorMessage(failure, '保存调整没有成功，请刷新后再试') })
    } finally {
      setApplying(false)
    }
  }

  return (
    <section
      data-next-draft-replan
      aria-label="能否如期完成"
      className="mt-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-primary)]">
          <CalendarClock className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          能否如期完成
          <VerdictBadge verdict={assessment.verdict} />
        </h3>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center gap-1 text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`}
            aria-hidden
          />
          {expanded ? '收起' : '调整'}
        </button>
      </header>
      <p
        data-replan-summary
        className="mt-1.5 text-sm leading-relaxed text-[var(--nx-text-primary)]"
      >
        {assessment.summary}
      </p>
      {message ? (
        <p
          data-replan-message={message.kind}
          className={`mt-2 flex items-center gap-1.5 text-xs ${
            message.kind === 'ok' ? 'text-[var(--nx-accent)]' : 'text-[var(--nx-status-danger)]'
          }`}
        >
          {message.kind === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : null}
          {message.text}
        </p>
      ) : null}

      {expanded ? (
        <div className="mt-3 flex flex-col gap-3">
          <FeasibilityDetails assessment={assessment} />
          {assessment.options.length > 0 ? (
            <div role="radiogroup" aria-label="怎么调整" className="flex flex-col gap-2">
              {assessment.options.map((option) => (
                <OptionCard
                  key={option.id}
                  option={option}
                  selected={preview?.decision.summary === option.decision.summary}
                  onChoose={() => void showPreview(option)}
                  chooseLabel={previewing === option.decision.summary ? '重排中…' : '重排看看'}
                  busy={Boolean(previewing) || applying}
                />
              ))}
            </div>
          ) : null}

          {preview ? (
            <div
              data-replan-preview
              className="rounded-md border border-[var(--nx-border-focus)] p-3"
            >
              <p className="text-xs font-medium text-[var(--nx-text-secondary)]">
                按「{preview.decision.summary}」重排后的对比
              </p>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-[var(--nx-text-muted)]">调整前</dt>
                <dd className="text-[var(--nx-text-secondary)]">{endText(preview.before)}</dd>
                <dt className="text-[var(--nx-text-muted)]">调整后</dt>
                <dd className="font-medium text-[var(--nx-text-primary)]">
                  {endText(preview.after)}
                </dd>
                {teamText(preview.before) !== teamText(preview.after) ? (
                  <>
                    <dt className="text-[var(--nx-text-muted)]">团队</dt>
                    <dd className="text-[var(--nx-text-secondary)]">
                      {teamText(preview.before)}{' '}
                      <ArrowRight className="inline h-3 w-3" aria-hidden />{' '}
                      {teamText(preview.after)}
                    </dd>
                  </>
                ) : null}
                {preview.removedTasks > 0 ? (
                  <>
                    <dt className="text-[var(--nx-text-muted)]">范围</dt>
                    <dd className="text-[var(--nx-text-secondary)]">
                      {preview.removedTasks} 个任务移到第二期（{preview.before.taskCount} →{' '}
                      {preview.after.taskCount}）
                    </dd>
                  </>
                ) : null}
              </dl>
              {preview.note ? (
                <p
                  data-replan-note
                  className="mt-2 rounded border border-[var(--nx-status-warning)]/50 px-2 py-1.5 text-xs text-[var(--nx-status-warning)]"
                >
                  {preview.note}
                </p>
              ) : null}
              {preview.movedTasks.length > 0 ? (
                <details className="mt-2 text-xs text-[var(--nx-text-secondary)]">
                  <summary className="cursor-pointer">完工日变化最大的任务</summary>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {preview.movedTasks.map((task) => (
                      <li key={task.name} className="truncate" title={task.name}>
                        {task.name}：{task.fromEnd} → {task.toEnd}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-replan-apply
                  disabled={applying}
                  onClick={() => void apply()}
                  className="inline-flex items-center gap-1.5 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-3 py-1.5 text-xs font-medium text-[var(--nx-space-bg)] disabled:opacity-60"
                >
                  {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  确认调整（存成新版本）
                </button>
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => setPreview(null)}
                  className="rounded border border-[var(--nx-border-hairline)] px-3 py-1.5 text-xs text-[var(--nx-text-secondary)]"
                >
                  再想想
                </button>
              </div>
            </div>
          ) : null}

          <FeasibilityChat
            assessment={assessment}
            history={chat}
            onAppend={(turn) => setChat((current) => [...current, turn].slice(-20))}
            onAdopt={(option) => void showPreview(option)}
            adoptedSummary={preview?.decision.summary ?? null}
            adoptLabel="重排看看"
            draftId={draftId}
            placeholder="例如：截止日不能动，测试可以找外包加一个人；或者：管理后台先用 Excel 顶着，放第二期"
          />
        </div>
      ) : null}
    </section>
  )
}
