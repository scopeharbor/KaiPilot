'use client'

import { useCallback, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
  Play,
  XCircle,
  FileWarning,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWhatIfSession } from '@/hooks/use-what-if-session'
import { GanttWhatIfApplyDrawer } from './GanttWhatIfApplyDrawer'
import type { GanttModel } from '@/lib/gantt/types'
import type { WorkingCalendarSettingsInput } from '@/lib/gantt/working-calendar'

const BTN_BASE =
  'inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50'

const BTN_PRIMARY =
  'inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-transparent bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50'

export interface GanttWhatIfControlsProps {
  projectId: number
  model: GanttModel | null
  calendarSettings: WorkingCalendarSettingsInput | null
}

export function GanttWhatIfControls({
  projectId,
  model,
  calendarSettings,
}: GanttWhatIfControlsProps) {
  const whatIf = useWhatIfSession(projectId, { model, calendarSettings })
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleApply = useCallback(() => {
    if (!whatIf.controls.canApply) return
    setDrawerOpen(true)
  }, [whatIf.controls.canApply])

  if (!whatIf.isActive) {
    return (
      <div className="inline-flex items-center gap-2" role="group" aria-label="What-if 模式">
        <button
          type="button"
          className={cn(BTN_PRIMARY, 'bg-amber-600 hover:bg-amber-700')}
          onClick={whatIf.enterSession}
          aria-label="进入 What-if 模式"
        >
          <Play className="h-3.5 w-3.5" aria-hidden />
          试算方案
        </button>
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          'inline-flex flex-wrap items-center gap-1 rounded-lg border p-1',
          whatIf.status === 'stale'
            ? 'border-orange-300 bg-orange-50'
            : whatIf.status === 'error'
              ? 'border-red-300 bg-red-50'
              : 'border-amber-200 bg-amber-50',
        )}
        role="group"
        aria-label="What-if 试算控件"
      >
        {whatIf.status === 'stale' && (
          <span className="inline-flex items-center gap-1 px-1.5 text-xs font-medium text-orange-700">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            数据已变更
          </span>
        )}
        {whatIf.status === 'error' && (
          <span className="inline-flex items-center gap-1 px-1.5 text-xs font-medium text-red-700">
            <XCircle className="h-3.5 w-3.5" aria-hidden />
            应用失败
          </span>
        )}
        {whatIf.hasUnsavedChanges && whatIf.status !== 'stale' && whatIf.status !== 'error' && (
          <span className="inline-flex items-center gap-1 px-1.5 text-xs font-medium text-amber-700">
            <FileWarning className="h-3.5 w-3.5" aria-hidden />
            有未保存变更
          </span>
        )}

        <button
          type="button"
          className={BTN_BASE}
          onClick={whatIf.undo}
          disabled={!whatIf.controls.canUndo}
          aria-label="撤销"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          撤销
        </button>
        <button
          type="button"
          className={BTN_BASE}
          onClick={whatIf.redo}
          disabled={!whatIf.controls.canRedo}
          aria-label="重做"
        >
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          重做
        </button>
        <button
          type="button"
          className={BTN_BASE}
          onClick={whatIf.resetSession}
          disabled={!whatIf.controls.canReset}
          aria-label="重置"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          重置
        </button>

        <div className="mx-1 h-5 w-px bg-border" aria-hidden />

        <button
          type="button"
          className={BTN_PRIMARY}
          onClick={handleApply}
          disabled={!whatIf.controls.canApply}
          aria-label="应用方案"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          应用方案
        </button>
        <button
          type="button"
          className={cn(BTN_BASE, 'text-red-600 hover:bg-red-50')}
          onClick={whatIf.discardSession}
          aria-label="丢弃"
        >
          <XCircle className="h-3.5 w-3.5" aria-hidden />
          丢弃
        </button>
        <button type="button" className={BTN_BASE} onClick={whatIf.exitSession} aria-label="退出">
          退出
        </button>
      </div>

      <GanttWhatIfApplyDrawer
        projectId={projectId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onApply={whatIf.applySession}
        commands={whatIf.history.entries.slice(0, whatIf.history.cursor)}
        backendPreview={whatIf.backendPreview}
      />
    </>
  )
}
