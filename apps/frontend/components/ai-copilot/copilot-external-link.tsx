'use client'

import { type ReactNode, useCallback } from 'react'

interface CopilotExternalLinkProps {
  readonly href: string
  readonly children: ReactNode
  readonly className?: string
}

/**
 * Safe external link component (§6).
 *
 * Design decisions:
 * - Opens in new browsing context (§6.1)
 * - No referrer leakage (§6.2): rel="noopener noreferrer"
 * - No iframe embedding (§6.3): this component only creates <a> tags
 * - Never renders external page content inline (§6.5)
 */
export function CopilotExternalLink({ href, children, className }: CopilotExternalLinkProps) {
  const handleClick = useCallback(() => {
    // Open in new window without referrer
    window.open(href, '_blank', 'noopener,noreferrer')
  }, [href])

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(e) => {
        e.preventDefault()
        handleClick()
      }}
    >
      {children}
    </a>
  )
}
