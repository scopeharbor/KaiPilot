'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { wikiApi, WIKI_QUERY_KEYS } from '@/lib/api/wiki'

/** 输入停顿这么久才查询。 */
const DEBOUNCE_MS = 400
/** 至少这么多字才查询。 */
const MIN_CHARS = 4

/**
 * 「历史上遇到过」（v3-llm-wiki-retrospective-lessons）：登记风险时按标题与描述召回组织教训库的教训。
 * 组织未开启维基、文字太短或没有相关教训时什么都不显示；只提示，不影响登记。
 */
export function WikiLessonRecall({ text, projectId }: { text: string; projectId?: number }) {
  const [query, setQuery] = React.useState('')
  React.useEffect(() => {
    const trimmed = text.trim()
    const timer = setTimeout(
      () => setQuery(Array.from(trimmed).length >= MIN_CHARS ? trimmed : ''),
      DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [text])
  const settings = useQuery({
    queryKey: WIKI_QUERY_KEYS.settings(),
    queryFn: () => wikiApi.settings(),
    retry: false,
    staleTime: 60_000,
  })
  const enabled = settings.data?.enabled === true && query !== ''
  const recall = useQuery({
    queryKey: WIKI_QUERY_KEYS.lessonRecall(query, projectId),
    queryFn: () => wikiApi.recallLessons(query, projectId),
    enabled,
    retry: false,
    staleTime: 30_000,
  })
  const items = enabled ? (recall.data?.data ?? []) : []
  if (items.length === 0) return null
  return (
    <aside
      data-wiki-lesson-recall
      aria-label="历史上遇到过"
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)] px-3 py-2 text-xs"
    >
      <p className="mb-1 flex items-center gap-1.5 font-medium text-[var(--nx-text-primary)]">
        <History className="h-3.5 w-3.5" aria-hidden />
        历史上遇到过（组织教训库）
      </p>
      <ul className="flex flex-col gap-1 text-[var(--nx-text-secondary)]">
        {items.map((item) => (
          <li key={item.claimId}>
            {item.section ? (
              <span className="text-[var(--nx-text-muted)]">［{item.section}］</span>
            ) : null}
            {item.statement}
          </li>
        ))}
      </ul>
    </aside>
  )
}
