'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { WIKI_INGEST_RUN_STATUS_LABELS, type WikiIngestRunDto } from '@aiproj/types'
import { wikiApi, wikiErrorMessage, WIKI_QUERY_KEYS } from '@/lib/api/wiki'
import { WikiButton, WikiNotice } from './wiki-ui'

const isActive = (r: WikiIngestRunDto) => r.status === 'queued' || r.status === 'running'

/** 解读运行结束后的说明文字。 */
export function wikiInterpretResultText(run: WikiIngestRunDto): string {
  if (isActive(run)) return 'AI 正在对比声明与实际…'
  if (run.status === 'succeeded') {
    const rejected = run.opsRejected ? `，拦下 ${run.opsRejected} 条不合规的说法` : ''
    return run.proposalsCreated > 0
      ? `已生成解读提议（${run.opsAccepted} 条）${rejected}，请到「审阅队列」确认后才会生效。`
      : `AI 没有找到值得写进页面的差异${rejected}。`
  }
  if (run.status === 'no_events') return '这一页没有可对比的实际数据，请先刷新流程实况。'
  return `${WIKI_INGEST_RUN_STATUS_LABELS[run.status]}，没有生成解读。`
}

/**
 * 流程页「请 AI 解读差异」（v3-llm-wiki-process-reality）：审阅者触发，异步运行，
 * 轮询本空间运行记录显示结果；结果只是待审提议。
 */
export function WikiProcessInterpret({ pageId, spaceId }: { pageId: number; spaceId: number }) {
  const queryClient = useQueryClient()
  const [runId, setRunId] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const trigger = useMutation({
    mutationFn: () => wikiApi.interpretProcess(pageId),
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
      <WikiButton data-wiki-interpret disabled={busy} onClick={() => trigger.mutate()}>
        <Sparkles className="h-3.5 w-3.5" aria-hidden />请 AI 解读差异
      </WikiButton>
      {error ? <WikiNotice tone="error">{error}</WikiNotice> : null}
      {runId !== null && !error ? (
        <WikiNotice data-wiki-interpret-status tone={run?.status === 'failed' ? 'error' : 'info'}>
          {run ? wikiInterpretResultText(run) : 'AI 正在对比声明与实际…'}
        </WikiNotice>
      ) : null}
    </div>
  )
}
