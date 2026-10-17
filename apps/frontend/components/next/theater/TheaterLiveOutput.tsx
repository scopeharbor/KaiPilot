'use client'

import * as React from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { selectDraftEta } from '@/lib/ai-draft/progress-projection'
import type { OutputLane } from '@/lib/ai-draft/output-lanes'
import { PROGRESS_PHASE_COPY } from './TheaterGenerationLoader'

/** 服务端步骤名里的阶段代号换成中文（「生成项目草案阶段：wbs_tasks（任务批次 2/5）」）。 */
const STAGE_LABELS: ReadonlyArray<[string, string]> = [
  ['charter_scope', '起草项目章程与范围'],
  ['wbs_tasks', '拆分 WBS 与任务'],
  ['schedule_dependencies', '梳理任务依赖与排期'],
  ['resources_risks_acceptance', '资源、风险与验收标准'],
  ['reconcile_review', '汇总审查'],
]

export function friendlyLaneLabel(label: string): string {
  let text = label.replace(/^生成项目草案阶段：/u, '')
  for (const [code, name] of STAGE_LABELS) text = text.replace(code, name)
  return text
}

/** 同时展开的进行中调用数：并发时最多看最近 3 路，其余只列标题。 */
const EXPANDED_LIMIT = 3
/** 已完成调用只列最近几条。 */
const DONE_LIMIT = 6

export interface LiveOutputPanelProps {
  lanes: OutputLane[]
  totalChars: number
  title: string
  /** 标题旁的状态说明（阶段 / 预计剩余等）。 */
  status?: string
  /** 还没有任何输出时的提示。 */
  emptyText?: string
  /** 紧凑样式：嵌在输入框或就绪页里时用，进行中的输出框更矮。 */
  compact?: boolean
}

/**
 * 模型实时输出面板：逐字显示模型正在吐出的内容，按调用分道（并发调用互不穿插），
 * 让用户确认模型确实在工作、正在做哪一步。生成剧场、意图分析、项目理解共用。
 */
export function LiveOutputPanel({
  lanes,
  totalChars,
  title,
  status,
  emptyText = '正在连接模型，收到第一段输出后会在这里实时显示…',
  compact = false,
}: LiveOutputPanelProps) {
  const active = lanes.filter((lane) => !lane.done).sort((a, b) => b.order - a.order)
  const done = lanes.filter((lane) => lane.done).sort((a, b) => b.order - a.order)

  return (
    <section
      data-theater-live-output
      aria-label="模型实时输出"
      className={`w-full rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)] ${compact ? 'p-3' : 'max-w-4xl p-4'}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--nx-ai)]" aria-hidden />
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
          {status ? (
            <span className="text-xs text-[var(--nx-text-muted)]" role="status" aria-live="polite">
              {status}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-[var(--nx-text-muted)]">
          {active.length > 0 ? `${active.length} 路模型调用进行中` : '等待下一次模型调用'}
          {totalChars > 0 ? ` · 已接收 ${totalChars.toLocaleString('zh-CN')} 字` : ''}
        </p>
      </header>

      {lanes.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--nx-text-muted)]">{emptyText}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {active.slice(0, EXPANDED_LIMIT).map((lane) => (
            <ActiveLane key={lane.id} lane={lane} compact={compact} />
          ))}
          {active.length > EXPANDED_LIMIT ? (
            <p className="text-xs text-[var(--nx-text-muted)]">
              另有 {active.length - EXPANDED_LIMIT} 路在并行输出：
              {active
                .slice(EXPANDED_LIMIT)
                .map((lane) => friendlyLaneLabel(lane.label))
                .join('、')}
            </p>
          ) : null}
          {done.length > 0 ? (
            <ul className="flex flex-col gap-1" aria-label="已完成的模型调用">
              {done.slice(0, DONE_LIMIT).map((lane) => (
                <li
                  key={lane.id}
                  data-output-lane-done
                  className="flex items-center gap-2 text-xs text-[var(--nx-text-muted)]"
                >
                  <CheckCircle2
                    className="h-3.5 w-3.5 shrink-0 text-[var(--nx-status-success)]"
                    aria-hidden
                  />
                  <span className="truncate">{friendlyLaneLabel(lane.label)}</span>
                </li>
              ))}
              {done.length > DONE_LIMIT ? (
                <li className="text-xs text-[var(--nx-text-muted)]">
                  以及更早完成的 {done.length - DONE_LIMIT} 次调用
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  )
}

/**
 * 生成剧场的实时输出面板：取代循环等待动画。
 * 数据来自 generation.output 瞬时事件（不落库、刷新后不回放）；刷新后面板从空白重新累积。
 */
export function TheaterLiveOutput() {
  const lanes = useAiProjectDraftStore((state) => state.streamLanes)
  const projection = useAiProjectDraftStore((state) => state.progressProjection)
  const totalChars = useAiProjectDraftStore((state) => state.streamOutput.length)

  const eta = selectDraftEta(projection)
  const showEta = eta.etaMs !== null && eta.confidence !== 'initial' && eta.formatted !== ''
  const phaseLabel = projection.phase ? PROGRESS_PHASE_COPY[projection.phase] : '草案生成中'
  const etaText = showEta
    ? ` · ${eta.confidence === 'converging' ? '估算中…' : '预计剩余'} ${eta.formatted}`
    : ''

  return (
    <LiveOutputPanel
      lanes={lanes}
      totalChars={totalChars}
      title="AI 正在生成项目草案"
      status={`${phaseLabel}${etaText}`}
    />
  )
}

/** 等待首字的秒数：让「正在思考」不显得卡死。 */
function useWaitingSeconds(active: boolean): number {
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    if (!active) return
    setSeconds(0)
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])
  return seconds
}

function ActiveLane({ lane, compact }: { lane: OutputLane; compact: boolean }) {
  const ref = React.useRef<HTMLPreElement>(null)
  const thinkingRef = React.useRef<HTMLPreElement>(null)
  // 新文本到达时滚到底部，始终看到最新输出。
  React.useEffect(() => {
    const node = ref.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lane.text])
  React.useEffect(() => {
    const node = thinkingRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lane.reasoning])
  const waiting = !lane.text && !lane.reasoning
  const seconds = useWaitingSeconds(waiting)
  const modelName = lane.model ?? '模型'
  // 正文开始后思考过程默认收起（可展开回看）；只有思考、还没有正文时展开。
  const [showThinking, setShowThinking] = React.useState(true)
  React.useEffect(() => {
    if (lane.text) setShowThinking(false)
  }, [Boolean(lane.text)])

  return (
    <div
      data-output-lane
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-[var(--nx-border-hairline)] px-3 py-1.5 text-xs font-medium text-[var(--nx-text-secondary)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--nx-ai)]" aria-hidden />
        <span className="min-w-0 truncate">{friendlyLaneLabel(lane.label)}</span>
        {!waiting ? (
          <span
            data-output-lane-phase={lane.phase}
            className="shrink-0 font-normal text-[var(--nx-ai)]"
          >
            {lane.phase === 'thinking'
              ? `${modelName} 正在思考 · 已思考 ${lane.reasoningChars.toLocaleString('zh-CN')} 字`
              : `正在回答 · 已输出 ${lane.textChars.toLocaleString('zh-CN')} 字`}
          </span>
        ) : null}
        {lane.model ? (
          <span
            data-output-lane-model
            className="ml-auto min-w-0 max-w-full truncate font-mono text-[10px] font-normal text-[var(--nx-text-muted)]"
          >
            {lane.model}
          </span>
        ) : null}
      </p>
      {lane.reasoning ? (
        <div data-output-lane-reasoning className="border-b border-[var(--nx-border-hairline)]">
          <button
            type="button"
            aria-expanded={showThinking}
            onClick={() => setShowThinking((value) => !value)}
            className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-secondary)]"
          >
            思考过程（{lane.reasoningChars.toLocaleString('zh-CN')} 字）
            <span aria-hidden>{showThinking ? '▾' : '▸'}</span>
          </button>
          {showThinking ? (
            <pre
              ref={thinkingRef}
              // AI 写的文字：跟随简繁切换（<pre> 只为保留换行，不是代码）
              data-cc
              className={`${compact ? 'max-h-24' : 'max-h-32'} overflow-y-auto whitespace-pre-wrap break-all px-3 pb-2 text-[11px] italic leading-5 text-[var(--nx-text-muted)]`}
            >
              {lane.reasoning}
            </pre>
          ) : null}
        </div>
      ) : null}
      {waiting || lane.text ? (
        <pre
          ref={ref}
          data-cc
          className={`${compact ? 'max-h-28' : 'max-h-40'} overflow-y-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-[11px] leading-5 text-[var(--nx-text-secondary)]`}
        >
          {lane.text || (
            <span data-output-lane-thinking className="text-[var(--nx-text-muted)]">
              {modelName} 正在思考中…{seconds >= 3 ? `（${seconds} 秒）` : ''}
              {seconds >= 20 ? ' 这个模型不公开思考过程，想好后会直接输出结果。' : ''}
            </span>
          )}
          <span className="animate-pulse text-[var(--nx-ai)]">▍</span>
        </pre>
      ) : null}
    </div>
  )
}
