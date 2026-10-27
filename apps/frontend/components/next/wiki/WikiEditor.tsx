'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  WIKI_PAGE_TEMPLATES,
  WIKI_PAGE_TYPE_LABELS,
  isValidWikiSlug,
  parseWikiMarkdown,
  type WikiPageType,
} from '@aiproj/types'
import { wikiApi, wikiErrorMessage, WIKI_QUERY_KEYS } from '@/lib/api/wiki'
import { WikiButton, WikiNotice } from './wiki-ui'

const TEMPLATE_TYPES = Object.keys(WIKI_PAGE_TEMPLATES) as WikiPageType[]

export type WikiEditorTarget =
  | { mode: 'create'; spaceId: number }
  | { mode: 'edit'; spaceId: number; pageId: number; baseRevisionId: number | null; source: string }

/**
 * Markdown 编辑（单人提交修订，不做协同编辑）。
 * 保存前用共享编解码器校验，错误定位到行；审阅者提交即发布，其余成为待审提议。
 */
export function WikiEditor({
  target,
  canReview,
  onDone,
  onCancel,
}: {
  target: WikiEditorTarget
  canReview: boolean
  onDone: (result: { pageId: number; published: boolean }) => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [slug, setSlug] = React.useState('')
  const [body, setBody] = React.useState(
    target.mode === 'edit' ? target.source : (WIKI_PAGE_TEMPLATES.concept ?? ''),
  )
  const [summary, setSummary] = React.useState('')
  const [serverError, setServerError] = React.useState<string | null>(null)

  const parsed = React.useMemo(() => parseWikiMarkdown(body), [body])
  const slugError =
    target.mode === 'create' && slug && !isValidWikiSlug(slug)
      ? '页面标识只能包含文字、数字、点、下划线与短横线，且不能以符号开头'
      : null
  const canSubmit = parsed.ok && !slugError && (target.mode === 'edit' || slug.length > 0)

  const submit = useMutation({
    mutationFn: async () => {
      if (target.mode === 'create') {
        const r = await wikiApi.createPage(target.spaceId, slug, body, summary)
        return { pageId: r.page.id, published: r.published }
      }
      const r = await wikiApi.submitRevision(target.pageId, body, target.baseRevisionId, summary)
      return { pageId: target.pageId, published: r.published }
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: WIKI_QUERY_KEYS.all })
      onDone(result)
    },
    onError: (e) => {
      const details = (e as { details?: { errors?: Array<{ line: number; message: string }> } })
        .details
      setServerError(
        details?.errors?.length
          ? details.errors.map((x) => `第 ${x.line} 行：${x.message}`).join('；')
          : wikiErrorMessage(e),
      )
    },
  })

  return (
    <form
      data-wiki-editor={target.mode}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) submit.mutate()
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {target.mode === 'create' ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
              页面标识
              <input
                aria-label="页面标识"
                value={slug}
                onChange={(e) => setSlug(e.target.value.trim())}
                placeholder="如 release-process 或 灰度发布"
                className="h-8 w-56 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
              模板
              <select
                aria-label="页面模板"
                onChange={(e) => setBody(WIKI_PAGE_TEMPLATES[e.target.value as WikiPageType] ?? '')}
                defaultValue="concept"
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs"
              >
                {TEMPLATE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {WIKI_PAGE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--nx-text-secondary)]">
          修改说明
          <input
            aria-label="修改说明"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="这次改了什么、为什么（可选）"
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs"
          />
        </label>
      </div>
      {slugError ? <WikiNotice tone="error">{slugError}</WikiNotice> : null}

      <textarea
        aria-label="页面内容"
        data-wiki-editor-body
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          setServerError(null)
        }}
        spellCheck={false}
        className="min-h-[320px] w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3 font-mono text-xs leading-5"
      />
      <p className="text-[11px] text-[var(--nx-text-muted)]">
        可检验的说法在句末加标记 [^c:名称]，并在下方写脚注「[^c:名称]: task#12,
        risk#3」注明依据；链接其他页面用 [[页面标识|显示文字]]。
      </p>

      {!parsed.ok ? (
        <WikiNotice tone="error" data-wiki-editor-errors>
          <ul className="flex flex-col gap-0.5">
            {parsed.errors.map((err, i) => (
              <li key={`${err.line}-${i}`}>
                第 {err.line} 行：{err.message}
              </li>
            ))}
          </ul>
        </WikiNotice>
      ) : null}
      {serverError ? (
        <WikiNotice tone="error" data-wiki-editor-server-error>
          {serverError}
        </WikiNotice>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <WikiButton onClick={onCancel}>取消</WikiButton>
        <WikiButton
          data-wiki-editor-submit
          type="submit"
          tone="primary"
          disabled={!canSubmit || submit.isPending}
        >
          {canReview ? '保存并发布' : '提交审阅'}
        </WikiButton>
      </div>
    </form>
  )
}
