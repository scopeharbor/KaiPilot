'use client'

import type { RefObject } from 'react'
import { Download, GitCompareArrows, Save } from 'lucide-react'
import { toPng } from 'html-to-image'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useSaveGanttBaseline } from '@/hooks/use-gantt-baseline'
import type { GanttBaseline } from '@/lib/api/gantt-baseline'
import type { BaselineDeviationSummary } from '@/lib/gantt/baseline'

export interface GanttBaselineControlsProps {
  projectId: number
  baseline: GanttBaseline | null | undefined
  baselineLoading: boolean
  compareEnabled: boolean
  onCompareChange: (enabled: boolean) => void
  summary: BaselineDeviationSummary
  exportTarget: RefObject<HTMLElement | null>
  canSave: boolean
}

export async function exportCurrentGantt(target: HTMLElement): Promise<void> {
  const dataUrl = await toPng(target, { cacheBust: true, pixelRatio: 2 })
  const link = document.createElement('a')
  link.download = `gantt-current-view-${new Date().toISOString().slice(0, 10)}.png`
  link.href = dataUrl
  link.click()
}

export function GanttBaselineControls({
  projectId,
  baseline,
  baselineLoading,
  compareEnabled,
  onCompareChange,
  summary,
  exportTarget,
  canSave,
}: GanttBaselineControlsProps) {
  const save = useSaveGanttBaseline(projectId)
  const { toast } = useToast()

  async function handleExport() {
    if (!exportTarget.current) return
    try {
      await exportCurrentGantt(exportTarget.current)
      toast({ variant: 'success', title: '当前甘特视图已导出' })
    } catch {
      toast({ variant: 'error', title: '导出失败', description: '请稍后重试。' })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canSave ? (
        <Button variant="outline" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          <Save className="h-4 w-4" />
          保存基线
        </Button>
      ) : null}
      <Button
        variant={compareEnabled ? 'secondary' : 'outline'}
        size="sm"
        disabled={baselineLoading}
        aria-pressed={compareEnabled}
        onClick={() => onCompareChange(!compareEnabled)}
      >
        <GitCompareArrows className="h-4 w-4" />
        基线对比
      </Button>
      <Button variant="outline" size="sm" onClick={() => void handleExport()}>
        <Download className="h-4 w-4" />
        导出当前视图 PNG
      </Button>
      {compareEnabled && !baselineLoading && !baseline ? (
        <span className="text-xs font-medium text-warning" role="status">
          尚未保存基线，请先点「保存基线」后再对比
        </span>
      ) : null}
      {compareEnabled && baseline ? (
        summary.early + summary.late + summary.added + summary.deleted === 0 ? (
          <span className="text-xs text-muted" role="status">
            与基线一致，暂无变更
          </span>
        ) : (
          <span className="text-xs text-muted" role="status">
            提前 {summary.early} · 滞后 {summary.late} · 新增 {summary.added} · 已删除{' '}
            {summary.deleted}
          </span>
        )
      ) : null}
    </div>
  )
}
