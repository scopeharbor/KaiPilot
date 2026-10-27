'use client'

import * as React from 'react'
import { QueryClientContext, useMutation, useQuery } from '@tanstack/react-query'
import { BookmarkPlus } from 'lucide-react'
import { truncateWikiSummary } from '@aiproj/types'
import { wikiApi, wikiErrorMessage, WIKI_QUERY_KEYS } from '@/lib/api/wiki'

/**
 * 「存进维基」（v3-llm-wiki-query-navigation）：把一条 AI 同事回答存成待审的归档回答页。
 * 组织未开启维基时不显示；保存后进入审阅队列，审阅者确认后才生效（AI 产出必须经人工确认）。
 * 没有 QueryClientProvider 的环境（部分独立渲染场景）直接不显示。
 */
export interface WikiFileBackButtonProps {
  question: string
  answer: string
  projectId: number | null
}

export function WikiFileBackButton(props: WikiFileBackButtonProps) {
  const client = React.useContext(QueryClientContext)
  if (!client) return null
  return <WikiFileBackInner {...props} />
}

function WikiFileBackInner({ question, answer, projectId }: WikiFileBackButtonProps) {
  const settings = useQuery({
    queryKey: WIKI_QUERY_KEYS.settings(),
    queryFn: () => wikiApi.settings(),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState(() => truncateWikiSummary(question, 40))
  const [target, setTarget] = React.useState<'project' | 'organization'>(
    projectId !== null ? 'project' : 'organization',
  )
  const save = useMutation({
    mutationFn: () =>
      wikiApi.fileBack({
        projectId: target === 'project' ? projectId : null,
        title: title.trim(),
        question,
        answer,
      }),
  })

  if (!settings.data?.enabled) return null
  if (save.isSuccess) {
    return (
      <p data-wiki-file-back-done className="text-[11px] text-[var(--nx-text-muted)]">
        已存进{target === 'project' ? '项目' : '组织'}维基的审阅队列，审阅者确认后才会生效。
      </p>
    )
  }
  if (!open) {
    return (
      <button
        type="button"
        data-wiki-file-back
        onClick={() => setOpen(true)}
        className="flex w-fit items-center gap-1 text-[11px] text-[var(--nx-text-muted)] hover:text-[var(--nx-accent)]"
      >
        <BookmarkPlus className="h-3 w-3" aria-hidden />
        存进维基
      </button>
    )
  }
  return (
    <form
      data-wiki-file-back-form
      className="flex flex-col gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2 text-[11px]"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <label className="flex flex-col gap-0.5 text-[var(--nx-text-secondary)]">
        页面标题
        <input
          aria-label="页面标题"
          value={title}
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
          className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 text-xs text-[var(--nx-text-primary)]"
        />
      </label>
      {projectId !== null ? (
        <fieldset className="flex gap-3 text-[var(--nx-text-secondary)]">
          <legend className="sr-only">存到哪里</legend>
          {(
            [
              ['project', '当前项目维基'],
              ['organization', '组织维基'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1">
              <input
                type="radio"
                name="wiki-file-back-target"
                checked={target === value}
                onChange={() => setTarget(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <p className="text-[var(--nx-text-muted)]">保存后进入审阅队列，审阅者确认后才会生效。</p>
      {save.isError ? (
        <p role="alert" className="text-[var(--nx-status-warning)]">
          {wikiErrorMessage(save.error)}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          data-wiki-file-back-submit
          disabled={save.isPending || !title.trim()}
          className="rounded bg-[var(--nx-accent)] px-2 py-0.5 text-white disabled:opacity-50"
        >
          提交审阅
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-2 py-0.5 text-[var(--nx-text-muted)]"
        >
          取消
        </button>
      </div>
    </form>
  )
}
