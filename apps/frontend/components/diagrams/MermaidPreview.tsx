'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/Button'
import { Alert } from '@/components/ui/Alert'

interface MermaidPreviewProps {
  mermaid: string
  warnings?: string[]
  title?: string
  className?: string
}

export function MermaidPreview({ mermaid, warnings = [], title, className }: MermaidPreviewProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(mermaid)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [mermaid])

  return (
    <div className={className}>
      {title && <h3 className="text-sm font-medium mb-2">{title}</h3>}

      {warnings.length > 0 && (
        <div className="mb-3">
          {warnings.map((w, i) => (
            <Alert key={i} variant="warning" className="text-xs mb-1">
              {w}
            </Alert>
          ))}
        </div>
      )}

      <div className="relative">
        <pre className="bg-muted rounded-md p-4 text-xs overflow-x-auto max-h-96">
          <code>{mermaid}</code>
        </pre>
        <Button variant="outline" size="sm" className="absolute top-2 right-2" onClick={handleCopy}>
          {copied ? '已复制' : '复制 Mermaid'}
        </Button>
      </div>
    </div>
  )
}
