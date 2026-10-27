'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, MessageSquareText } from 'lucide-react'
import {
  WIKI_ANSWER_EVAL_PATH_LABELS,
  WIKI_EVAL_GATE_LABELS,
  WIKI_EVAL_KIND_LABELS,
  WIKI_EVAL_METHOD_LABELS,
  WIKI_EVAL_METHODS,
  type WikiAnswerEvalEstimateDto,
  type WikiEvalRunDto,
  type WikiIngestRunStatus,
} from '@aiproj/types'
import { wikiApi, wikiErrorMessage, WIKI_QUERY_KEYS } from '@/lib/api/wiki'
import { WikiButton, WikiNotice } from './wiki-ui'

const EXAMPLE = JSON.stringify(
  [
    { question: '上线要几个人审批？', expect: ['双人审批'] },
    { question: '证书申请要预留多久？', expect: ['三周'], forbid: ['薪资'] },
  ],
  null,
  2,
)

const pct = (n: number) => `${Math.round(n * 100)}%`

/** 两条路径的名称：检索层是旧检索 / 维基材料，答案层是无记忆 / 带维基记忆的回答。 */
function pathLabels(report: WikiEvalRunDto) {
  return report.kind === 'answer'
    ? WIKI_ANSWER_EVAL_PATH_LABELS
    : { legacy: '旧检索', wiki: '维基上下文包' }
}

/** 评测报告：两条路径问答对比、三种方法回测（检索层）、门禁结论与原因。 */
export function WikiEvalReport({ report }: { report: WikiEvalRunDto }) {
  const tone = report.status === 'passed' ? 'info' : 'error'
  const labels = pathLabels(report)
  return (
    <div data-wiki-eval-report={report.status} className="flex flex-col gap-3 text-xs">
      <WikiNotice tone={tone}>
        门禁结论：{WIKI_EVAL_GATE_LABELS[report.status]}。{report.reasons.join('；')}
      </WikiNotice>
      <table className="w-full border-collapse" aria-label="问答集对比">
        <thead>
          <tr className="text-left text-[var(--nx-text-muted)]">
            <th className="py-1">
              {WIKI_EVAL_KIND_LABELS[report.kind]}（{report.qa.questions} 题）
            </th>
            <th>正确率</th>
            <th>平均命中</th>
            <th>泄露</th>
            <th>{report.kind === 'answer' ? '平均回答字节' : '平均字节'}</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              [labels.legacy, report.qa.legacy],
              [labels.wiki, report.qa.wiki],
            ] as const
          ).map(([label, s]) => (
            <tr key={label} className="border-t border-[var(--nx-border-hairline)]">
              <td className="py-1">{label}</td>
              <td>{pct(s.correctRate)}</td>
              <td>{pct(s.avgRecall)}</td>
              <td>{s.leaks}</td>
              <td>{s.avgBytes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.kind === 'answer' ? (
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          用 {report.modelName ?? 'AI'} 生成回答，共消耗约 {report.tokensUsed}{' '}
          token。回答原文不保存。
        </p>
      ) : (
        <table className="w-full border-collapse" aria-label="计划回测">
          <thead>
            <tr className="text-left text-[var(--nx-text-muted)]">
              <th className="py-1">
                计划回测（{report.backtest.projects} 个项目、{report.backtest.tasks} 个任务）
              </th>
              <th>工期误差（MAPE）</th>
              <th>P80 覆盖</th>
            </tr>
          </thead>
          <tbody>
            {WIKI_EVAL_METHODS.map((m) => (
              <tr key={m} className="border-t border-[var(--nx-border-hairline)]">
                <td className="py-1">{WIKI_EVAL_METHOD_LABELS[m]}</td>
                <td>{pct(report.backtest.methods[m].mape)}</td>
                <td>{report.backtest.methods[m].p80Coverage}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.kind === 'retrieval' ? (
        <p className="text-[11px] text-[var(--nx-text-muted)]">
          检索评测只比较给 AI 的材料，不调用 AI；要看 AI 实际回答得好不好，用下方的「回答评测」。
        </p>
      ) : null}
    </div>
  )
}

/**
 * 组织维基「评测」页签（v3-llm-wiki-eval-gate）：管理者粘贴问答集、运行确定性评测、查看报告与历史。
 */
export function WikiEvalPanel() {
  const queryClient = useQueryClient()
  const [text, setText] = React.useState(EXAMPLE)
  const [error, setError] = React.useState<string | null>(null)
  const [report, setReport] = React.useState<WikiEvalRunDto | null>(null)
  const runs = useQuery({ queryKey: WIKI_QUERY_KEYS.evalRuns(), queryFn: () => wikiApi.evalRuns() })
  const run = useMutation({
    mutationFn: (questions: unknown) => wikiApi.runEval(questions),
    onSuccess: async (r) => {
      setError(null)
      setReport(r)
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.evalRuns() })
    },
    onError: (e) => setError(wikiErrorMessage(e)),
  })
  const parseQuestions = (): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  const submit = () => {
    const questions = parseQuestions()
    if (questions === undefined) {
      setError('问答集不是合法的 JSON。')
      return
    }
    run.mutate(questions)
  }
  return (
    <section data-wiki-eval className="flex flex-col gap-3">
      <p className="text-xs text-[var(--nx-text-secondary)]">
        检查维基给 AI 的记忆对不对：每道题写出必须出现的要点（expect）和不得出现的内容（forbid）。
        检索评测以你的身份分别取旧检索与维基的材料对比，并用已完成项目回测工期估计；只读，不调用
        AI。
      </p>
      <textarea
        data-wiki-eval-input
        aria-label="问答集（JSON）"
        value={text}
        rows={8}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-[var(--nx-border-hairline)] bg-transparent p-2 font-mono text-xs"
      />
      <div className="flex justify-end">
        <WikiButton data-wiki-eval-run tone="primary" disabled={run.isPending} onClick={submit}>
          <FlaskConical className="h-3.5 w-3.5" aria-hidden />
          运行评测
        </WikiButton>
      </div>
      {error ? <WikiNotice tone="error">{error}</WikiNotice> : null}
      {report ? <WikiEvalReport report={report} /> : null}
      <WikiAnswerEvalSection parse={parseQuestions} />
      <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">最近的评测</h3>
      <ul className="flex flex-col gap-1 text-xs">
        {(runs.data?.data ?? []).map((r) => (
          <li key={r.id} data-wiki-eval-history={r.id}>
            {r.createdAt.slice(0, 10)} · {WIKI_EVAL_GATE_LABELS[r.status]} ·{' '}
            {r.kind === 'answer'
              ? `回答评测：带维基记忆正确率 ${pct(r.qa.wiki.correctRate)}（无记忆 ${pct(r.qa.legacy.correctRate)}）· ${r.tokensUsed} token`
              : `维基正确率 ${pct(r.qa.wiki.correctRate)}（旧检索 ${pct(r.qa.legacy.correctRate)}）· 回测 ${r.backtest.projects} 个项目`}
          </li>
        ))}
        {runs.data && runs.data.data.length === 0 ? (
          <li className="text-[var(--nx-text-muted)]">还没有评测记录。</li>
        ) : null}
      </ul>
    </section>
  )
}

const ANSWER_RUN_STATUS_LABELS: Record<WikiIngestRunStatus, string> = {
  queued: '排队中',
  running: '进行中',
  succeeded: '已完成，结果见下方「最近的评测」',
  no_events: '没有可评测的题目',
  budget_exhausted: '今日 AI 预算不足，没有调用 AI',
  model_unavailable: '组织没有可用的 AI 连接，没有调用 AI',
  failed: '失败',
}

/**
 * 回答评测（v3-llm-wiki-rag-retirement，会调用组织的 AI 连接）：先估算调用次数与 token，确认后才开始；
 * 后台对每题生成「无记忆」与「带维基记忆」两种回答，按同一要点与禁止内容判定。
 */
function WikiAnswerEvalSection({ parse }: { parse: () => unknown }) {
  const queryClient = useQueryClient()
  const [estimate, setEstimate] = React.useState<{
    questions: unknown
    data: WikiAnswerEvalEstimateDto
  } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const latest = useQuery({
    queryKey: WIKI_QUERY_KEYS.answerEvalLatest(),
    queryFn: () => wikiApi.latestAnswerEval(),
    refetchInterval: (q) =>
      q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 3000 : false,
  })
  const status = latest.data?.status
  React.useEffect(() => {
    if (status === 'succeeded')
      void queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.evalRuns() })
  }, [status, queryClient])
  const estimating = useMutation({
    mutationFn: (questions: unknown) => wikiApi.estimateAnswerEval(questions),
    onSuccess: (data, questions) => {
      setError(null)
      setEstimate({ questions, data })
    },
    onError: (e) => setError(wikiErrorMessage(e)),
  })
  const start = useMutation({
    mutationFn: (questions: unknown) => wikiApi.runAnswerEval(questions),
    onSuccess: async () => {
      setError(null)
      setEstimate(null)
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.answerEvalLatest() })
    },
    onError: (e) => setError(wikiErrorMessage(e)),
  })
  const askEstimate = () => {
    const questions = parse()
    if (questions === undefined) {
      setError('问答集不是合法的 JSON。')
      return
    }
    estimating.mutate(questions)
  }
  const busy = status === 'queued' || status === 'running'
  return (
    <div
      data-wiki-answer-eval
      className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] p-3"
    >
      <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
        回答评测（会调用 AI，产生费用）
      </h3>
      <p className="text-xs text-[var(--nx-text-secondary)]">
        用同一份问答集，让组织的 AI
        对每题各回答两次：一次不带记忆、一次带上维基记忆，比较哪种答得对、有没有说出不该说的内容。
        先估算费用，确认后才会开始；只保存统计，不保存题目与回答原文。
      </p>
      <div className="flex justify-end">
        <WikiButton
          data-wiki-answer-estimate
          disabled={estimating.isPending || busy}
          onClick={askEstimate}
        >
          <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
          估算回答评测费用
        </WikiButton>
      </div>
      {estimate ? (
        <WikiNotice tone={estimate.data.exceedsBudget ? 'error' : 'info'}>
          共 {estimate.data.questions} 题，将调用 AI {estimate.data.calls} 次，约{' '}
          {estimate.data.estimatedTokens} token
          {estimate.data.dailyBudget > 0
            ? `（今日已用 ${estimate.data.usedTokensToday} / 每日预算 ${estimate.data.dailyBudget}）`
            : `（今日已用 ${estimate.data.usedTokensToday}，不设每日上限）`}
          {estimate.data.exceedsBudget
            ? '。超出今日剩余预算，开始后会停在「预算不足」，不会调用 AI。'
            : '。'}
          <span className="ml-2 inline-flex gap-2">
            <WikiButton
              data-wiki-answer-confirm
              tone="primary"
              disabled={start.isPending}
              onClick={() => start.mutate(estimate.questions)}
            >
              确认费用并开始
            </WikiButton>
            <WikiButton onClick={() => setEstimate(null)}>取消</WikiButton>
          </span>
        </WikiNotice>
      ) : null}
      {error ? <WikiNotice tone="error">{error}</WikiNotice> : null}
      {latest.data ? (
        <p
          data-wiki-answer-status={latest.data.status}
          className="text-[11px] text-[var(--nx-text-muted)]"
        >
          最近一次回答评测：{ANSWER_RUN_STATUS_LABELS[latest.data.status]}
          {latest.data.status === 'running' && latest.data.eventsCount > 0
            ? `（已调用 ${latest.data.opsAccepted} / ${latest.data.eventsCount * 2} 次）`
            : ''}
        </p>
      ) : null}
    </div>
  )
}
