/**
 * v3-copilot-skill-injection — §5.5 方法论分区面板。
 *
 * 方法论切面在面板中标注为「方法论参考」而非事实。
 * 与项目事实分区视觉可区分且标注可读。
 *
 * @aiproj/frontend
 */
'use client'

import type { CopilotMethodologyFacet } from '@aiproj/types'
import { isCopilotMethodologyFacet } from '@aiproj/types'

interface CopilotMethodologyPanelProps {
  readonly facet: CopilotMethodologyFacet | undefined
}

/**
 * §5.5 方法论面板：标注为「方法论参考」而非事实。
 * §5.6 方法论分区与事实分区视觉可区分。
 */
export function CopilotMethodologyPanel({ facet }: CopilotMethodologyPanelProps) {
  if (!facet || !isCopilotMethodologyFacet(facet)) {
    return null
  }

  if (facet.guidanceItems.length === 0) {
    return null
  }

  return (
    <section
      className="copilot-methodology-panel"
      role="region"
      aria-label="方法论参考"
      data-partition="methodology"
    >
      {/* §5.5 标注为「方法论参考」而非事实 */}
      <header className="copilot-methodology-panel__header">
        <span className="copilot-methodology-panel__badge" data-variant="methodology">
          方法论参考
        </span>
        <span className="copilot-methodology-panel__skill-count">
          {facet.skillKeys.length} 个 Skill
        </span>
      </header>

      <ul className="copilot-methodology-panel__items" role="list">
        {facet.guidanceItems.map((item) => (
          <li
            key={item.itemId}
            className="copilot-methodology-panel__item"
            data-partition="methodology"
          >
            <div className="copilot-methodology-panel__item-label">{item.label}</div>
            <div className="copilot-methodology-panel__item-summary">{item.summary}</div>
            {/* §5.7 Provenance：可追溯到 Skill 与其知识片段 */}
            <div className="copilot-methodology-panel__item-source">
              <span className="copilot-methodology-panel__source-ref" title={item.sourceRef}>
                来源: {item.skillKey}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
