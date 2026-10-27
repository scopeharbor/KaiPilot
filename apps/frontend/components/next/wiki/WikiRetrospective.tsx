'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lightbulb, Sparkles } from 'lucide-react'
import { WIKI_INGEST_RUN_STATUS_LABELS, type WikiIngestRunDto } from '@aiproj/types'
import { wikiApi, wikiErrorMessage, WIKI_QUERY_KEYS } from '@/lib/api/wiki'
import { WikiButton, WikiNotice } from './wiki-ui'

const isActive = (r: WikiIngestRunDto) => r.status === 'queued' || r.status === 'running'

/** 提炼教训运行结束后的说明文字。 */
export function wikiLessonsResultText(run: WikiIngestRunDto): string {
  if (isActive(run)) return 'AI 正在根据复盘统计、风险与变更记录提炼教训…'
  if (run.status === 'succeeded') {
    const rejected = run.opsRejected ? `，拦下 ${run.opsRejected} 条不合规的说法` : ''
    return run.proposalsCreated > 0
      ? `已生成教训提议（${run.opsAccepted} 条）${rejected}，请到「审阅队列」确认后才会生效。`
      : `AI 没有找到值得写进复盘的教训${rejected}。`
  }
  if (run.status === 'no_events') return '这一页没有复盘统计，请先生成项目复盘。'
  return `${WIKI_INGEST_RUN_STATUS_LABELS[run.status]}，没有生成教训。`
}

/** 复盘页「请 AI 提炼教训」（v3-llm-wiki-retrospective-lessons）：异步运行，轮询运行记录；结果只是待审提议。 */
export function WikiLessonsDraft({ pageId, spaceId }: { pageId: number; spaceId: number }) {
  const queryClient = useQueryClient()
  const [runId, setRunId] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const trigger = useMutation({
    mutationFn: () => wikiApi.draftLessons(pageId),
    onSuccess: (run) => {
      setError(null)
      setRunId(run.id)
    },
    onError: (e) => setError(wikiErrorMessage(e)),
  })
  const runs = useQuery({
    queryKey: WIKI_QUERY_KEYS.ingestRuns(spaceId),
    queryFn: () => wikiApi.ingestRuns(spaceId),
    enabled: runId !== null,
    refetchInterval: (query) => {
      const run = query.state.data?.data.find((r) => r.id === runId)
      return !run || isActive(run) ? 2000 : false
    },
  })
  const run = runs.data?.data.find((r) => r.id === runId) ?? null
  const finished = run !== null && !isActive(run)
  React.useEffect(() => {
    if (finished && run?.proposalsCreated)
      void queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
  }, [finished, run?.proposalsCreated, queryClient])
  const busy = trigger.isPending || (runId !== null && !finished)
  return (
    <div className="flex flex-col items-end gap-1.5">
      <WikiButton data-wiki-draft-lessons disabled={busy} onClick={() => trigger.mutate()}>
        <Sparkles className="h-3.5 w-3.5" aria-hidden />请 AI 提炼教训
      </WikiButton>
      {error ? <WikiNotice tone="error">{error}</WikiNotice> : null}
      {runId !== null && !error ? (
        <WikiNotice data-wiki-lessons-status tone={run?.status === 'failed' ? 'error' : 'info'}>
          {run ? wikiLessonsResultText(run) : 'AI 正在根据复盘统计、风险与变更记录提炼教训…'}
        </WikiNotice>
      ) : null}
    </div>
  )
}

/** 教训主张旁「晋升到组织教训库」：结果是组织空间的待审提议。 */
export function WikiPromoteLesson({
  claimId,
  onResult,
}: {
  claimId: number
  onResult: (message: { tone: 'info' | 'error'; text: string }) => void
}) {
  const promote = useMutation({
    mutationFn: () => wikiApi.promoteLesson(claimId),
    onSuccess: () =>
      onResult({
        tone: 'info',
        text: '已提交到组织教训库，组织维基的审阅者确认后，全组织登记风险和生成计划时都能看到这条教训。',
      }),
    onError: (e) => onResult({ tone: 'error', text: wikiErrorMessage(e) }),
  })
  return (
    <WikiButton
      data-wiki-promote={claimId}
      disabled={promote.isPending || promote.isSuccess}
      onClick={() => promote.mutate()}
    >
      <Lightbulb className="h-3.5 w-3.5" aria-hidden />
      晋升到组织教训库
    </WikiButton>
  )
}
