'use client'

import type { CopilotSourceProvenance } from '@aiproj/types'

interface CopilotSourceTypeBadgeProps {
  readonly provenance: CopilotSourceProvenance
  /** Override default label text. */
  readonly label?: string
}

const PROVENANCE_CONFIG: Record<CopilotSourceProvenance, { label: string; className: string }> = {
  internal: {
    label: '项目数据',
    className:
      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
  },
  external: {
    label: '外部来源',
    className:
      'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  },
}

/**
 * Non-dismissible source type badge (§4.1).
 *
 * Design decisions:
 * - Structural distinction (§4.2): color + text, not icon-only
 * - Non-dismissible (§4.1): always visible, cannot be closed
 * - Screen reader accessible (§4.6): aria-label with provenance
 * - Rules hold even without external retrieval (§4.4)
 */
export function CopilotSourceTypeBadge({ provenance, label }: CopilotSourceTypeBadgeProps) {
  const config = PROVENANCE_CONFIG[provenance]
  const displayLabel = label ?? config.label

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${config.className}`}
      role="status"
      aria-label={`来源类型: ${displayLabel}`}
    >
      {provenance === 'external' && (
        <svg
          className="mr-1 h-2.5 w-2.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
      )}
      {displayLabel}
    </span>
  )
}
