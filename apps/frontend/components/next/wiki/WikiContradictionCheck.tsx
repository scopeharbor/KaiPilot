'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { WIKI_INGEST_RUN_STATUS_LABELS, type WikiIngestRunDto } from '@aiproj/types'
import { wikiApi, wikiErrorMessage, WIKI_QUERY_KEYS } from '@/lib/api/wiki'
import { WikiButton, WikiNotice } from './wiki-ui'

const isActive = (r: WikiIngestRunDto) => r.status === 'queued' || r.status === 'running'

/** 矛盾体检运行结束后的说明文字。 */
export function wikiContradictionResultText(run: WikiIngestRunDto): string {
  if (isActive(run)) return 'AI 正在检查各页主张之间有没有矛盾…'
  const rejected = run.opsRejected ? `（拦下 ${run.opsRejected} 条不合规的结果）` : ''
  if (run.status === 'succeeded')
    return run.opsAccepted > 0
      ? `找到 ${run.opsAccepted} 处可能的矛盾${rejected}，已列在下方。AI 不会修改页面，请决定撤回或编辑哪一条。`
      : `没有发现矛盾${rejected}。`
  if (run.status === 'no_events') return '本空间已发布的主张不足两条，暂时无法检查矛盾。'
  return `${WIKI_INGEST_RUN_STATUS_LABELS[run.status]}，没有完成矛盾体检。`
}

/**
 * 体检页「AI 矛盾体检」（v3-llm-wiki-lint-consolidation）：审阅者触发，异步运行，
 * 轮询本空间运行记录显示结果；结果只是体检发现，不改页面。
 */
export function WikiContradictionCheck({ spaceId }: { spaceId: number }) {
  const queryClient = useQueryClient()
  const [runId, setRunId] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const trigger = useMutation({
    mutationFn: () => wikiApi.contradictionCheck(spaceId),
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
    if (finished && run?.opsAccepted)
      void queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.findings(spaceId) })
  }, [finished, run?.opsAccepted, queryClient, spaceId])

  const busy = trigger.isPending || (runId !== null && !finished)
  return (
    <div className="flex flex-col items-end gap-1.5">
      <WikiButton data-wiki-contradiction-check disabled={busy} onClick={() => trigger.mutate()}>
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        AI 矛盾体检
      </WikiButton>
      {error ? <WikiNotice tone="error">{error}</WikiNotice> : null}
      {runId !== null && !error ? (
        <WikiNotice
          data-wiki-contradiction-status
          tone={run?.status === 'failed' ? 'error' : 'info'}
        >
          {run ? wikiContradictionResultText(run) : 'AI 正在检查各页主张之间有没有矛盾…'}
        </WikiNotice>
      ) : null}
    </div>
  )
}
