/**
 * v3-copilot-citations — §3 出处强制执行服务。
 *
 * 职责：
 * - 过滤缺少完整引用的外部结论（§3.1）
 * - 按 URL 合并引用用于渲染（§3.5）
 * - 为引用分配脚注编号（§3.7）
 *
 * 纯逻辑服务，零 DB / 网络依赖。
 */
import type { CopilotCitation } from '@aiproj/types'
import { isCitationComplete, mergeCitationsByUrl } from '@aiproj/types'

export interface ExternalConclusion {
  readonly conclusionId: string
  readonly statement: string
  readonly sourceKind: string
  readonly citation?: CopilotCitation
}

export interface FilteredConclusions {
  /** Conclusions that are safe to present (internal or external with complete citation). */
  readonly presented: readonly ExternalConclusion[]
  /** External conclusions suppressed due to missing citation (never shown to user). */
  readonly suppressed: readonly ExternalConclusion[]
}

export class CopilotCitationFilterService {
  /**
   * Filter a list of conclusions: external conclusions without complete citation
   * are suppressed (§3.1). Internal conclusions pass through unchanged.
   *
   * D1: No citation → conclusion MUST be absent (not labeled "unknown source").
   */
  filterConclusions(conclusions: readonly ExternalConclusion[]): FilteredConclusions {
    const presented: ExternalConclusion[] = []
    const suppressed: ExternalConclusion[] = []

    for (const c of conclusions) {
      if (this.isExternal(c.sourceKind)) {
        if (c.citation && isCitationComplete(c.citation)) {
          presented.push(c)
        } else {
          suppressed.push(c)
        }
      } else {
        // Internal conclusions always pass through
        presented.push(c)
      }
    }

    return { presented, suppressed }
  }

  /**
   * Merge citations by URL for rendering (§3.5).
   * Same URL supporting multiple conclusions → single citation with merged scope.
   */
  mergeForRendering(citations: readonly CopilotCitation[]): CopilotCitation[] {
    return mergeCitationsByUrl(citations)
  }

  /**
   * Assign footnote indices to citations (§3.7).
   * Returns citations sorted by first appearance, with 1-based footnote numbers.
   */
  assignFootnotes(
    citations: readonly CopilotCitation[],
  ): Array<CopilotCitation & { footNoteIndex: number }> {
    const seen = new Map<string, number>()
    let nextIndex = 1

    return citations.map((c) => {
      let idx = seen.get(c.url)
      if (idx === undefined) {
        idx = nextIndex++
        seen.set(c.url, idx)
      }
      return { ...c, footNoteIndex: idx }
    })
  }

  private isExternal(sourceKind: string): boolean {
    const externalKinds = ['external_content', 'search_result', 'help_article', 'general_knowledge']
    return externalKinds.includes(sourceKind)
  }
}
