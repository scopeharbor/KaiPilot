'use client'

import Link from 'next/link'
import { BookMarked } from 'lucide-react'
import {
  WIKI_PAGE_TYPE_LABELS,
  wikiPageHref,
  type WikiPageType,
  type WikiQueryIndexDto,
  type WikiQueryReadDto,
  type WikiQuerySearchDto,
  type WikiScopeKind,
} from '@aiproj/types'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * 记忆维基查阅结果卡（v3-llm-wiki-query-navigation）：`wiki_index` / `wiki_search` 列页面，`wiki_read` 显示所读页面。
 * 页面可点开到对应维基；底部固定提示「维基是推断，以实时数据为准」。字段经防御收敛，结构不符时由上层回落通用卡。
 */

const SCOPE_LABELS: Record<WikiScopeKind, string> = {
  project: '项目维基',
  department: '部门维基',
  organization: '组织维基',
  user: '我的维基',
}

const typeLabel = (type: unknown) =>
  typeof type === 'string' && type in WIKI_PAGE_TYPE_LABELS
    ? WIKI_PAGE_TYPE_LABELS[type as WikiPageType]
    : '页面'

interface Row {
  pageId: number
  title: string
  type: string
  summary: string
  scopeKind: WikiScopeKind
  scopeRefId: number
}

function PageRow({ row }: { row: Row }) {
  const href = wikiPageHref(row.scopeKind, row.scopeRefId, row.pageId)
  const title = (
    <span className="truncate text-xs font-medium text-[var(--nx-text-primary)]">{row.title}</span>
  )
  return (
    <li data-wiki-result-page={row.pageId} className="px-3 py-1.5">
      <div className="flex items-center gap-2">
        {href ? (
          <Link href={href} data-wiki-result-link className="min-w-0 truncate hover:underline">
            {title}
          </Link>
        ) : (
          title
        )}
        <span className="shrink-0 text-[10px] text-[var(--nx-text-muted)]">
          {typeLabel(row.type)}
        </span>
      </div>
      {row.summary ? (
        <p className="truncate text-[11px] text-[var(--nx-text-muted)]">{row.summary}</p>
      ) : null}
    </li>
  )
}

function Shell({
  title,
  toolName,
  notice,
  children,
}: {
  title: string
  toolName: string
  notice: string
  children: React.ReactNode
}) {
  return (
    <article
      data-card="wiki-result"
      data-wiki-tool={toolName}
      className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-primary)]">
          <BookMarked className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          {title}
        </span>
        <RuleMatchBadge toolName={toolName} />
      </div>
      {children}
      {notice ? (
        <p
          data-wiki-result-notice
          className="border-t border-[var(--nx-border-hairline)] px-3 py-1.5 text-[11px] text-[var(--nx-text-muted)]"
        >
          {notice}
        </p>
      ) : null}
    </article>
  )
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const scope = (v: unknown): WikiScopeKind =>
  v === 'project' || v === 'department' || v === 'organization' || v === 'user' ? v : 'organization'

export function WikiIndexCard({ data }: { data: WikiQueryIndexDto }) {
  const spaces = Array.isArray(data.spaces) ? data.spaces : []
  const total = spaces.reduce((n, s) => n + (Array.isArray(s.pages) ? s.pages.length : 0), 0)
  return (
    <Shell title="记忆维基目录" toolName="wiki_index" notice={str(data.notice)}>
      {total === 0 ? (
        <p data-wiki-result-empty className="px-3 py-3 text-xs text-[var(--nx-text-muted)]">
          还没有已发布的维基页面。
        </p>
      ) : (
        spaces.map((s) => (
          <section key={s.spaceId} data-wiki-result-space={s.scopeKind}>
            <h4 className="bg-[var(--nx-bg-0)] px-3 py-1 text-[11px] text-[var(--nx-text-secondary)]">
              {SCOPE_LABELS[scope(s.scopeKind)]} · {s.pages.length} 页
            </h4>
            <ul className="divide-y divide-[var(--nx-border-hairline)]">
              {s.pages.map((p) => (
                <PageRow
                  key={p.pageId}
                  row={{
                    pageId: num(p.pageId),
                    title: str(p.title),
                    type: str(p.type),
                    summary: str(p.summary),
                    scopeKind: scope(s.scopeKind),
                    scopeRefId: num(s.scopeRefId),
                  }}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      {data.truncated ? (
        <p className="px-3 py-1 text-[11px] text-[var(--nx-text-muted)]">
          页面较多，只列出前 300 页。
        </p>
      ) : null}
    </Shell>
  )
}

export function WikiSearchCard({ data }: { data: WikiQuerySearchDto }) {
  const results = Array.isArray(data.results) ? data.results : []
  return (
    <Shell title="维基检索结果" toolName="wiki_search" notice={str(data.notice)}>
      {results.length === 0 ? (
        <p data-wiki-result-empty className="px-3 py-3 text-xs text-[var(--nx-text-muted)]">
          没有找到相关的已发布页面。
        </p>
      ) : (
        <ul className="divide-y divide-[var(--nx-border-hairline)]">
          {results.map((r) => (
            <PageRow
              key={r.pageId}
              row={{
                pageId: num(r.pageId),
                title: str(r.title),
                type: str(r.type),
                summary: str(r.summary),
                scopeKind: scope(r.scopeKind),
                scopeRefId: num(r.scopeRefId),
              }}
            />
          ))}
        </ul>
      )}
    </Shell>
  )
}

export function WikiReadCard({ data }: { data: WikiQueryReadDto }) {
  const claims = Array.isArray(data.claims) ? data.claims : []
  const href = wikiPageHref(scope(data.scopeKind), num(data.scopeRefId), num(data.pageId))
  return (
    <Shell title="读过的维基页面" toolName="wiki_read" notice={str(data.notice)}>
      <div className="px-3 py-2 text-xs">
        <p className="flex items-center gap-2">
          {href ? (
            <Link
              href={href}
              data-wiki-result-link
              className="font-medium text-[var(--nx-text-primary)] hover:underline"
            >
              {str(data.title)}
            </Link>
          ) : (
            <span className="font-medium text-[var(--nx-text-primary)]">{str(data.title)}</span>
          )}
          <span className="text-[10px] text-[var(--nx-text-muted)]">{typeLabel(data.type)}</span>
        </p>
        <p data-wiki-read-meta className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
          {data.published
            ? [
                data.section ? `只读了「${data.section}」一节` : '读了整页',
                `${claims.length} 条有来源的说法`,
                ...(data.hasMaskedContent ? ['部分内容需更高权限'] : []),
                ...(data.truncated ? ['正文较长已截断'] : []),
              ].join(' · ')
            : '这一页还没有已发布的版本。'}
        </p>
      </div>
    </Shell>
  )
}
