'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * 意图来源诚实呈现微标（v3-ui-next-ai-colleague D-intent / spec「诚实呈现与意图路由透明度」）。
 *
 * - 前端确定性规则命中：「⚡ 快捷规则匹配 · <toolName>」（RL-07）；
 * - 模型把一句话理解成操作序列（`/ai/tools/plan`）后执行的步骤：
 *   「🤖 AI 意图理解 · <模型>」——由上层以 `IntentSourceContext` 注入来源，
 *   各结果卡片无需逐个改签名；
 * - 禁止任何「大语言模型正在深思熟虑」类欺骗性叙事。
 */
export interface IntentSourceInfo {
  source: 'rule_preset' | 'llm_inference'
  modelLabel?: string | null
}

export const IntentSourceContext = React.createContext<IntentSourceInfo>({ source: 'rule_preset' })

export interface RuleMatchBadgeProps {
  /** 命中的后端工具名，如 `get_project_summary`。 */
  toolName: string
  className?: string
}

export function RuleMatchBadge({ toolName, className }: RuleMatchBadgeProps) {
  const intent = React.useContext(IntentSourceContext)
  const inferred = intent.source === 'llm_inference'
  return (
    <span
      data-rule-match-badge
      data-intent-source={intent.source}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--nx-text-secondary)]',
        className,
      )}
    >
      <span aria-hidden>{inferred ? '🤖' : '⚡'}</span>
      {inferred
        ? ` AI 意图理解${intent.modelLabel ? ` · ${intent.modelLabel}` : ''}`
        : ' 快捷规则匹配 · '}
      {inferred ? null : toolName}
    </span>
  )
}

export default RuleMatchBadge
