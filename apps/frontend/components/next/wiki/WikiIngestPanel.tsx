'use client'

import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { WIKI_INGEST_RUN_STATUS_LABELS, type WikiIngestRunDto } from '@aiproj/types'
import { wikiApi, wikiErrorMessage, WIKI_QUERY_KEYS } from '@/lib/api/wiki'
import { WikiButton, WikiNotice } from './wiki-ui'

const ERROR_LABELS: Record<string, string> = {
  MODEL_OUTPUT_INVALID: 'AI 返回的内容格式不对，本次没有产生提议',
  ALL_PAGES_FAILED: '所有页面都没能通过写入校验（例如命中了撤回记录）',
  STALE_RUN: '上次运行中断，已自动收尾',
  INTERNAL_ERROR: '服务内部错误',
}

const isActive = (r: WikiIngestRunDto) => r.status === 'queued' || r.status === 'running'

/**
 * 项目维基「AI 编入」：把项目近期的关键动态交给 AI 整理成待审提议。
 * 结果一律进审阅队列，确认发布前不会生效；运行中自动轮询。
 */
export function WikiIngestPanel({ spaceId }: { spaceId: number }) {
  const queryClient = useQueryClient()
  const [error, setError] = React.useState<string | null>(null)
  const runs = useQuery({
    queryKey: WIKI_QUERY_KEYS.ingestRuns(spaceId),
    queryFn: () => wikiApi.ingestRuns(spaceId),
    refetchInterval: (query) => (query.state.data?.data.some(isActive) ? 2000 : false),
  })
  const latest = runs.data?.data[0]
  const wasActive = React.useRef(false)
  React.useEffect(() => {
    const active = latest ? isActive(latest) : false
    if (wasActive.current && !active)
      void queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
    wasActive.current = active
  }, [latest, queryClient])

  const trigger = useMutation({
    mutationFn: () => wikiApi.triggerIngest(spaceId),
    onSuccess: async () => {
      setError(null)
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.ingestRuns(spaceId) })
    },
    onError: (e) => setError(wikiErrorMessage(e)),
  })

  return (
    <section data-wiki-ingest className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-[var(--nx-text-secondary)]">
          AI
          会读取本项目自上次以来的关键动态（任务状态、里程碑、风险、变更等），整理进「项目简报」和本周摘要。
          它只能引用这些动态、不能编造数字，结果都是待审提议，要在审阅队列确认后才会生效。
        </p>
        <WikiButton
          data-wiki-ingest-trigger
          tone="primary"
          disabled={trigger.isPending || (latest ? isActive(latest) : false)}
          onClick={() => trigger.mutate()}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          AI 编入近期动态
        </WikiButton>
      </div>
      {error ? <WikiNotice tone="error">{error}</WikiNotice> : null}
      {runs.isError ? <WikiNotice tone="error">{wikiErrorMessage(runs.error)}</WikiNotice> : null}
      <ul className="flex flex-col gap-1.5 text-xs">
        {(runs.data?.data ?? []).map((r) => (
          <li
            key={r.id}
            data-wiki-ingest-run={r.status}
            className="rounded-md border border-[var(--nx-border-hairline)] px-3 py-2"
          >
            <p className="text-[var(--nx-text-primary)]">
              #{r.id} · {WIKI_INGEST_RUN_STATUS_LABELS[r.status]} ·{' '}
              {r.createdAt.slice(0, 16).replace('T', ' ')}
              {r.triggerKind === 'command' ? ' · 定时任务' : ''}
            </p>
            {r.status === 'succeeded' ? (
              <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                {[
                  `读取 ${r.eventsCount} 条动态，生成 ${r.proposalsCreated} 条待审提议`,
                  `采纳 ${r.opsAccepted} 条、拦下 ${r.opsRejected} 条不合规的说法`,
                  ...(r.hasMore ? ['还有更多动态，可再运行一次'] : []),
                ].join('；')}
                {r.tokensUsed ? ` · 约 ${r.tokensUsed} token` : ''}
              </p>
            ) : null}
            {r.errorCode ? (
              <p className="mt-0.5 text-[11px] text-[var(--nx-status-warning)]">
                {ERROR_LABELS[r.errorCode] ?? r.errorCode}
              </p>
            ) : null}
          </li>
        ))}
        {runs.data && runs.data.data.length === 0 ? (
          <li className="text-[var(--nx-text-muted)]">还没有运行过 AI 编入。</li>
        ) : null}
      </ul>
    </section>
  )
}
