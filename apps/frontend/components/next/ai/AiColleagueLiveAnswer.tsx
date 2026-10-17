'use client'

import * as React from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// 中文标点紧邻 ** 时 CommonMark 不认粗体（如「**所属项目 ID：**1」原样露出星号）
import remarkCjkFriendly from 'remark-cjk-friendly'
import { AlertTriangle, ExternalLink, Globe } from 'lucide-react'
import type { ColleagueLiveAnswer } from '@/stores/next-ai-colleague-store'
import { AiConnectionRequiredAction } from '@/components/ai/AiConnectionRequiredAction'
import { AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND } from '@aiproj/types'
import { AiDiagramBlock, DIAGRAM_LANGUAGES, type DiagramLanguage } from './AiDiagramBlock'
import {
  hasMemberAlias,
  resolveMemberAliases,
  useMemberAliasNames,
} from '@/hooks/use-member-alias-names'

// 成员代号换回姓名：沿用 hooks/use-member-alias-names（导出供旧调用方与单测）
export { resolveMemberAliases }

/**
 * 回答里的站内链接：只认 `/next` 开头的路径（模型按应用地图给出）；`:id` 换成当前项目，
 * 没有项目时不当作站内链接。导出供单测。
 */
export function resolveInternalHref(
  href: string | undefined,
  projectId: number | null,
): string | null {
  if (!href || !href.startsWith('/next') || /\s/.test(href)) return null
  if (!href.includes(':id')) return href
  return projectId === null ? null : href.replace(/:id/g, String(projectId))
}

/** hast 节点里的纯文本（代码块内容）。 */
function hastText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const record = node as { type?: string; value?: unknown; children?: unknown[] }
  if (record.type === 'text' && typeof record.value === 'string') return record.value
  return Array.isArray(record.children) ? record.children.map(hastText).join('') : ''
}

/** ```mermaid / ```svg / ```html 代码块 → 图的语言；其它代码块返回 null。 */
export function diagramLanguageOf(preNode: unknown): DiagramLanguage | null {
  const children = (preNode as { children?: unknown[] } | undefined)?.children
  const code = children?.find((child) => (child as { tagName?: string }).tagName === 'code') as
    { properties?: { className?: unknown } } | undefined
  const classes = code?.properties?.className
  const list = Array.isArray(classes) ? classes.map(String) : []
  const language = list.find((name) => name.startsWith('language-'))?.slice('language-'.length)
  return language && DIAGRAM_LANGUAGES.has(language) ? (language as DiagramLanguage) : null
}

/**
 * AI 同事 · 模型回答气泡：流式逐字显示（Markdown），底部披露作答模型与网页搜索情况。
 * 链接一律新窗口打开并带 noopener（回答里的网页来源来自外部）。
 */
export function AiColleagueLiveAnswerBubble({
  content,
  live,
}: {
  content: string
  live: ColleagueLiveAnswer
}) {
  const streaming = live.status === 'streaming'
  const hasAliases = hasMemberAlias(content)
  const projectId = live.projectId ?? null
  const aliasNames = useMemberAliasNames(hasAliases ? content : '')
  const displayContent = React.useMemo(
    () => (hasAliases ? resolveMemberAliases(content, aliasNames) : content),
    [content, hasAliases, aliasNames],
  )
  return (
    <div
      data-live-answer={live.status}
      className="rounded-lg rounded-tl-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 py-2 text-sm leading-6 text-[var(--nx-text-secondary)]"
    >
      {live.status === 'error' ? (
        <div className="space-y-2">
          <p className="flex items-start gap-1.5 text-[var(--nx-status-warning)]">
            <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{live.errorMessage ?? '回答失败，请稍后重试。'}</span>
          </p>
          {live.errorKind === AI_CONNECTION_REQUIRED_STREAM_ERROR_KIND ? (
            <AiConnectionRequiredAction />
          ) : null}
        </div>
      ) : content.trim() ? (
        <div className="nx-live-answer-md break-words [&_a]:text-[var(--nx-accent)] [&_a]:underline [&_code]:rounded [&_code]:bg-[var(--nx-bg-2)] [&_code]:px-1 [&_code]:text-[12px] [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-[var(--nx-bg-2)] [&_pre]:p-2 [&_strong]:text-[var(--nx-text-primary)] [&_table]:my-2 [&_table]:text-xs [&_td]:border [&_td]:border-[var(--nx-border-hairline)] [&_td]:px-1.5 [&_th]:border [&_th]:border-[var(--nx-border-hairline)] [&_th]:px-1.5 [&_ul]:list-disc [&_ul]:pl-5">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkCjkFriendly]}
            components={{
              a: ({ node: _node, href, ...props }) => {
                // 站内页面（应用地图给出的 /next 路径）：当前页直接打开；外部来源仍新窗口
                const internal = resolveInternalHref(href, projectId)
                return internal ? (
                  <Link {...props} href={internal} data-internal-link />
                ) : (
                  <a {...props} href={href} target="_blank" rel="noopener noreferrer" />
                )
              },
              // 画图：```mermaid / ```svg / ```html 代码块渲染成图（可切换源码、复制、下载）
              pre: ({ node, children, ...props }) => {
                const language = diagramLanguageOf(node)
                if (!language) return <pre {...props}>{children}</pre>
                return (
                  <AiDiagramBlock language={language} code={hastText(node)} streaming={streaming} />
                )
              },
            }}
          >
            {displayContent}
          </ReactMarkdown>
          {streaming ? (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--nx-accent)] align-middle"
            />
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-[var(--nx-text-muted)]">
          {live.webSearchRequested ? '正在联网搜索并思考…' : '正在思考…'}
        </p>
      )}

      {live.status === 'done' && live.autoOpenPath ? (
        <Link
          href={live.autoOpenPath}
          data-live-answer-opened
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--nx-accent)] hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          已为你打开 · {live.autoOpenPath}
        </Link>
      ) : null}

      {!streaming ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-[var(--nx-border-hairline)] pt-1 text-[10px] text-[var(--nx-text-muted)]">
          <span>模型：{live.modelLabel ?? '组织默认模型'}</span>
          {live.webSearchRequested ? (
            <span className="flex items-center gap-1" data-live-answer-web-note>
              <Globe className="h-3 w-3" aria-hidden />
              {live.webSearchNote ?? '已开启网页搜索（本题不需要外部资料时不会搜索）'}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
