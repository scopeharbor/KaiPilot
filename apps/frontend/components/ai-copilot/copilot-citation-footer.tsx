'use client'

import { useMemo } from 'react'
import type { CopilotCitationRender } from '@aiproj/types'
import { extractDomainFromUrl } from '@aiproj/types'

interface CopilotCitationFooterProps {
  readonly citations: readonly CopilotCitationRender[]
}

/**
 * Citation footnote footer — renders numbered footnote references
 * and a separate footnote list with full citation details.
 *
 * Design decisions:
 * - Footnote-style (§3.7): avoids inline expansion
 * - Fetch time displayed (§5.1)
 * - Drift indicator when snapshot differs (§5.2)
 * - Hash NOT displayed (§5.4) — only used internally
 * - Links open in new window without referrer (§6.1, §6.2)
 * - No iframe embedding (§6.3)
 */
export function CopilotCitationFooter({ citations }: CopilotCitationFooterProps) {
  const sorted = useMemo(
    () => [...citations].sort((a, b) => a.footNoteIndex - b.footNoteIndex),
    [citations],
  )

  if (sorted.length === 0) return null

  return (
    <div className="mt-4 border-t border-border pt-3">
      <h4 className="text-xs font-medium text-muted-foreground mb-2">引用来源</h4>
      <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground">
        {sorted.map((cr) => (
          <li key={cr.citation.citationId} id={`citation-${cr.footNoteIndex}`}>
            <a
              href={cr.citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {cr.citation.title}
            </a>
            <span className="ml-1 text-muted-foreground/70">
              ({extractDomainFromUrl(cr.citation.url) ?? '未知域名'})
            </span>
            <span className="ml-1 text-muted-foreground/50">
              · 抓取于 {new Date(cr.citation.fetchedAt).toLocaleDateString('zh-CN')}
            </span>
            {cr.isDrifted && (
              <span className="ml-1 text-amber-500 text-[10px]" role="status">
                此来源已更新
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
