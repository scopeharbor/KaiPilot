'use client'

import { useState, useCallback } from 'react'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { MermaidPreview } from '@/components/diagrams/MermaidPreview'
import { exportMermaid } from '@/lib/api/diagrams'
import { useToast } from '@/components/ui/Toast'

interface DiagramExportButtonProps {
  diagramId: number
  diagramTitle: string
  canView?: boolean
}

export function DiagramExportButton({
  diagramId,
  diagramTitle,
  canView = true,
}: DiagramExportButtonProps) {
  const [open, setOpen] = useState(false)
  const [mermaid, setMermaid] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  const handleExport = useCallback(async () => {
    setLoading(true)
    try {
      const result = await exportMermaid(diagramId)
      setMermaid(result.data.mermaid)
      setWarnings(result.data.warnings)
      setOpen(true)
    } catch {
      toast({ variant: 'error', title: '导出 Mermaid 失败' })
    } finally {
      setLoading(false)
    }
  }, [diagramId, toast])

  if (!canView) return null

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
        <Eye className="h-4 w-4 mr-1" />
        预览 Mermaid
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{diagramTitle} - Mermaid 导出</DialogTitle>
          </DialogHeader>
          <MermaidPreview mermaid={mermaid} warnings={warnings} />
        </DialogContent>
      </Dialog>
    </>
  )
}
