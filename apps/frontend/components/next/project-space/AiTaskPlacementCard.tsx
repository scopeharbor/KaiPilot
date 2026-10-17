'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Scissors, Sparkles, X } from 'lucide-react'
import { KANBAN_COLUMNS, type KanbanColumn } from '@/lib/api/kanban'
import { tasksApi, type Task, type TaskPriority } from '@/lib/api/tasks'
import { dependenciesApi } from '@/lib/api/dependencies'
import { taskAiCreateInput, taskAiDraftApi, type TaskAiDraft } from '@/lib/api/task-ai-draft'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import {
  buildPlacementCreateInput,
  formatDateKey,
  inferTaskPlacementDraft,
} from '@/lib/next/task-placement-rule'
import { newLiveOutputId, useLiveOutputLanes } from '@/lib/ai-draft/live-output-client'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { LiveOutputPanel } from '@/components/next/theater/TheaterLiveOutput'
import { VariantInput, VariantTextarea } from '@/components/locale/variant-field'

export const AI_PLACEMENT_PLACEHOLDER =
  '用一两句话说说要做什么，例如：给食堂后台加订单导出 Excel。Enter 交给 AI 补全，Shift+Enter 换行'

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}
const DURATION_OPTIONS = [0.5, 1, 1.5, 2]
const durationText = (days: number) => (days === 0.5 ? '半天' : `${days} 天`)

function errorText(failure: unknown, fallback: string): string {
  const message = (failure as { message?: unknown } | null)?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

export interface AiTaskPlacementCardProps {
  projectId: number
  columnId: KanbanColumn
  onClose: () => void
  onCreated?: (task: Task) => void
}

type Phase = 'input' | 'drafting' | 'preview'

/**
 * 看板「在此列新建任务」：一句话 → AI 补全成任务卡 → 核对修改 → 确认创建（2026-09-28）。
 *
 * - 描述态：多行输入，Enter 交给 AI；也可以「不用 AI，直接建」（按原规则推断工期 / 优先级）；
 * - 补全中：模型的思考与回答实时显示；
 * - 预览态：名称、说明、工期（半天–2 天）、优先级、完成标准、执行步骤都能改；
 *   AI 判断超过 2 天时给出拆分建议，可一键拆成多张卡（按顺序自动接上先后依赖）；
 * - 只有点「确认创建」才写库（AI 只建议、不自动执行）。执行步骤写成可打勾的清单。
 */
export function AiTaskPlacementCard({
  projectId,
  columnId,
  onClose,
  onCreated,
}: AiTaskPlacementCardProps) {
  const queryClient = useQueryClient()
  const column = KANBAN_COLUMNS.find((item) => item.id === columnId) ?? KANBAN_COLUMNS[0]!
  const status = column.statuses[0]!

  const [phase, setPhase] = React.useState<Phase>('input')
  const [input, setInput] = React.useState('')
  const [draft, setDraft] = React.useState<TaskAiDraft | null>(null)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [durationDays, setDurationDays] = React.useState(1)
  const [priority, setPriority] = React.useState<TaskPriority>('medium')
  const [doneCriteria, setDoneCriteria] = React.useState('')
  const [steps, setSteps] = React.useState('')
  const [liveId, setLiveId] = React.useState<string | null>(null)
  // 互动调整：用户对草稿提的修改意见（「拆细一点」「工期改半天」……）与历史
  const [instruction, setInstruction] = React.useState('')
  const [revisions, setRevisions] = React.useState<string[]>([])
  const live = useLiveOutputLanes(liveId)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const lines = (text: string) =>
    text
      .split('\n')
      .map((line) => line.replace(/^[-*\d.、\s[\]x]+/i, '').trim())
      .filter(Boolean)

  /** 当前预览（含用户手改过的内容），作为「让 AI 改」的上一版。 */
  const currentDraft = (): TaskAiDraft | null =>
    draft
      ? {
          ...draft,
          name,
          description,
          durationDays,
          priority,
          doneCriteria: lines(doneCriteria),
          steps: lines(steps),
        }
      : null

  const askAi = async (change?: string) => {
    const text = input.trim()
    if (text.length < 2 || phase === 'drafting') return
    const previous = change ? currentDraft() : null
    setError(null)
    setPhase('drafting')
    const id = newLiveOutputId()
    setLiveId(id)
    try {
      const selection = useAiProjectDraftStore.getState().modelSelection
      const result = await taskAiDraftApi.draft(projectId, {
        description: text,
        liveOutputId: id,
        ...(selection ?? {}),
        ...(change && previous ? { instruction: change, previous } : {}),
      })
      if (change) {
        setRevisions((current) => [...current, change])
        setInstruction('')
      }
      setDraft(result)
      setName(result.name)
      setDescription(result.description)
      setDurationDays(result.durationDays)
      setPriority(result.priority)
      setDoneCriteria(result.doneCriteria.join('\n'))
      setSteps(result.steps.join('\n'))
      setPhase('preview')
    } catch (failure) {
      setError(errorText(failure, 'AI 这次没能补全，请再试一次，或直接手动建'))
      // 调整失败时回到原来的预览，已有内容不丢
      setPhase(change && draft ? 'preview' : 'input')
    }
  }

  /** 不用 AI：按原规则推断后直接建。 */
  const createWithoutAi = async () => {
    const rule = inferTaskPlacementDraft(input, columnId)
    if (!rule || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const task = await tasksApi.create(projectId, buildPlacementCreateInput(rule))
      await invalidateTaskQueries(queryClient, projectId)
      onCreated?.(task)
      onClose()
    } catch (failure) {
      setError(errorText(failure, '创建任务失败，请稍后重试'))
      setSubmitting(false)
    }
  }

  const createOne = async () => {
    if (!draft || submitting || !name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const task = await tasksApi.create(
        projectId,
        taskAiCreateInput({
          name,
          description,
          durationDays,
          priority,
          status,
          startDate: formatDateKey(new Date()),
          wbsNodeId: draft.wbsNodeId,
          roleHint: draft.roleHint,
          doneCriteria: lines(doneCriteria),
          steps: lines(steps),
        }),
      )
      await invalidateTaskQueries(queryClient, projectId)
      onCreated?.(task)
      onClose()
    } catch (failure) {
      setError(errorText(failure, '创建任务失败，请稍后重试'))
      setSubmitting(false)
    }
  }

  /** 按拆分建议建多张小卡，按顺序接上「完成 → 开始」依赖。 */
  const createSplit = async () => {
    if (!draft || submitting || draft.split.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      let previous: Task | null = null
      let first: Task | null = null
      for (const item of draft.split) {
        const task: Task = await tasksApi.create(
          projectId,
          taskAiCreateInput({
            name: item.name,
            description: `拆自「${input.trim().slice(0, 60)}」。`,
            durationDays: item.durationDays,
            priority,
            status,
            startDate: formatDateKey(new Date()),
            wbsNodeId: draft.wbsNodeId,
            roleHint: draft.roleHint,
            doneCriteria: item.doneCriteria ?? [],
            steps: item.steps,
          }),
        )
        if (previous) {
          await dependenciesApi.create(projectId, task.id, {
            predecessorId: previous.id,
            type: 'fs',
          })
        }
        first ??= task
        previous = task
      }
      await invalidateTaskQueries(queryClient, projectId)
      if (first) onCreated?.(first)
      onClose()
    } catch (failure) {
      await invalidateTaskQueries(queryClient, projectId)
      setError(errorText(failure, '拆分建卡中途失败：已建好的卡保留，请检查后补建剩下的'))
      setSubmitting(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (phase === 'input' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void askAi()
    }
  }

  const fieldClass =
    'w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none'

  return (
    <div
      data-ai-task-placement-card
      data-placement-phase={phase}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] p-2.5"
    >
      {phase === 'input' ? (
        <>
          <textarea
            data-placement-input
            autoFocus
            rows={3}
            value={input}
            maxLength={1000}
            placeholder={AI_PLACEMENT_PLACEHOLDER}
            onChange={(event) => setInput(event.target.value)}
            aria-label="描述要做的事"
            className={`${fieldClass} resize-none text-sm`}
          />
          {error ? (
            <p data-placement-error role="alert" className="text-xs text-[var(--nx-status-danger)]">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              data-placement-cancel
              onClick={onClose}
              className="h-7 rounded-md px-2 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
            >
              取消
            </button>
            <button
              type="button"
              data-placement-direct
              disabled={input.trim().length < 2 || submitting}
              onClick={() => void createWithoutAi()}
              className="h-7 rounded-md border border-[var(--nx-border-hairline)] px-2 text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
            >
              不用 AI，直接建
            </button>
            <button
              type="button"
              data-placement-ai
              disabled={input.trim().length < 2}
              onClick={() => void askAi()}
              className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-2.5 text-xs font-medium text-[var(--nx-space-bg)] disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              AI 补全
            </button>
          </div>
        </>
      ) : null}

      {phase === 'drafting' ? (
        <div data-placement-drafting className="flex flex-col gap-2">
          <p className="text-xs text-[var(--nx-text-secondary)]">
            AI 正在把「{input.trim().slice(0, 40)}」补成任务卡…
          </p>
          <LiveOutputPanel
            compact
            lanes={live.lanes}
            totalChars={live.totalChars}
            title="模型实时输出"
            emptyText="正在连接模型…"
          />
        </div>
      ) : null}

      {phase === 'preview' && draft ? (
        <div data-placement-preview className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <VariantInput
              data-placement-name
              value={name}
              maxLength={255}
              onValueChange={setName}
              aria-label="任务名称"
              className={`${fieldClass} text-sm font-medium`}
            />
            <button
              type="button"
              aria-label="取消"
              onClick={onClose}
              className="shrink-0 rounded p-1 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          {draft.note ? (
            <p
              data-placement-note
              className="rounded border border-[var(--nx-status-warning)]/50 bg-[var(--nx-status-warning)]/10 px-2 py-1 text-[11px] leading-relaxed text-[var(--nx-text-primary)]"
            >
              {draft.note}
            </p>
          ) : null}

          {draft.split.length > 0 ? (
            <div
              data-placement-split
              className="rounded border border-[var(--nx-border-hairline)] p-2"
            >
              <p className="flex items-center gap-1 text-[11px] font-medium text-[var(--nx-text-secondary)]">
                <Scissors className="h-3 w-3" aria-hidden />
                建议拆成 {draft.split.length} 张小卡（按顺序接上先后）
              </p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] text-[var(--nx-text-primary)]">
                {draft.split.map((item) => (
                  <li key={item.name}>
                    {item.name}
                    <span className="text-[var(--nx-text-muted)]">
                      {' '}
                      · {durationText(item.durationDays)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <VariantTextarea
            data-placement-description
            rows={2}
            value={description}
            onValueChange={setDescription}
            aria-label="任务说明"
            placeholder="任务说明"
            className={`${fieldClass} resize-none`}
          />

          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
            <label className="flex items-center gap-1">
              工期
              <select
                data-placement-duration
                value={durationDays}
                onChange={(event) => setDurationDays(Number(event.target.value))}
                className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 text-xs"
              >
                {DURATION_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {durationText(days)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              优先级
              <select
                data-placement-priority
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 text-xs"
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {draft.wbsNodeName ? (
              <span className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5">
                归属 {draft.wbsNodeName}
              </span>
            ) : null}
            {draft.roleHint ? (
              <span className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5">
                建议 {draft.roleHint}
              </span>
            ) : null}
          </div>

          <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
            执行步骤（一行一步，建好后可逐项打勾）
            <VariantTextarea
              data-placement-steps
              rows={Math.min(6, Math.max(3, lines(steps).length))}
              value={steps}
              onValueChange={setSteps}
              className={`${fieldClass} resize-none`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[var(--nx-text-secondary)]">
            完成标准（一行一条）
            <VariantTextarea
              data-placement-done
              rows={Math.min(4, Math.max(2, lines(doneCriteria).length))}
              value={doneCriteria}
              onValueChange={setDoneCriteria}
              className={`${fieldClass} resize-none`}
            />
          </label>

          {/* 互动调整：用自己的话让 AI 改，改完仍可手动微调 */}
          <div data-placement-refine className="flex flex-col gap-1">
            {revisions.length > 0 ? (
              <ul className="flex flex-col gap-0.5 text-[11px] text-[var(--nx-text-muted)]">
                {revisions.map((item, index) => (
                  <li key={`${index}-${item}`}>你：{item}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-end gap-1.5">
              <textarea
                data-placement-instruction
                rows={1}
                value={instruction}
                maxLength={500}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    event.stopPropagation()
                    if (instruction.trim()) void askAi(instruction.trim())
                  }
                }}
                aria-label="让 AI 修改这张卡"
                placeholder="还想改什么？例如：再拆细一点 / 工期改半天 / 加一步写单元测试"
                className={`${fieldClass} resize-none`}
              />
              <button
                type="button"
                data-placement-refine-send
                disabled={!instruction.trim() || submitting}
                onClick={() => void askAi(instruction.trim())}
                className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2 text-xs text-[var(--nx-text-primary)] disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />让 AI 改
              </button>
            </div>
          </div>

          {error ? (
            <p data-placement-error role="alert" className="text-xs text-[var(--nx-status-danger)]">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              data-placement-retry
              disabled={submitting}
              onClick={() => {
                setPhase('input')
                setDraft(null)
              }}
              className="h-7 rounded-md px-2 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
            >
              重新描述
            </button>
            {draft.split.length > 0 ? (
              <button
                type="button"
                data-placement-split-confirm
                disabled={submitting}
                onClick={() => void createSplit()}
                className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2 text-xs text-[var(--nx-text-primary)] disabled:opacity-40"
              >
                <Scissors className="h-3.5 w-3.5" aria-hidden />
                拆成 {draft.split.length} 张卡
              </button>
            ) : null}
            <button
              type="button"
              data-placement-confirm
              disabled={submitting || !name.trim()}
              onClick={() => void createOne()}
              className="flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-2.5 text-xs font-medium text-[var(--nx-space-bg)] disabled:opacity-40"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              {draft.split.length > 0 ? '只建这一张' : '确认创建'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default AiTaskPlacementCard
