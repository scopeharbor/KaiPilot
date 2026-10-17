'use client'

import { CheckCircle2, X, AlertTriangle, FileWarning } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WhatIfCommand, WhatIfBackendPreview } from '@/lib/gantt/what-if-types'

interface GanttWhatIfApplyDrawerProps {
  projectId: number
  open: boolean
  onClose: () => void
  onApply: () => void
  commands: WhatIfCommand[]
  backendPreview: WhatIfBackendPreview | null
}

export function GanttWhatIfApplyDrawer({
  open,
  onClose,
  onApply,
  commands,
  backendPreview,
}: GanttWhatIfApplyDrawerProps) {
  if (!open) return null

  const conflicts = backendPreview?.conflicts ?? []
  const warnings = backendPreview?.warnings ?? []
  const changes = backendPreview?.changes ?? []

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-white shadow-lg transition-transform',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
      role="dialog"
      aria-modal="true"
      aria-label="应用 What-if 方案确认"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">应用方案确认</h2>
        <button
          type="button"
          className="rounded-md p-1 text-foreground hover:bg-gray-100"
          onClick={onClose}
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {conflicts.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-red-700">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {conflicts.length} 个排程冲突
            </div>
            <ul className="space-y-1">
              {conflicts.map((c, i) => (
                <li key={i} className="text-xs text-red-600">
                  {c.taskName}: {c.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-amber-700">
              <FileWarning className="h-4 w-4" aria-hidden />
              警告
            </div>
            <ul className="space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-600">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-4">
          <h3 className="mb-2 text-sm font-medium text-foreground">
            变更摘要 ({commands.length} 条命令)
          </h3>
          <div className="space-y-2">
            {commands.map((cmd, i) => (
              <CommandSummary key={i} command={cmd} />
            ))}
          </div>
        </div>

        {changes.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-sm font-medium text-foreground">排程变更详情</h3>
            <div className="space-y-2">
              {changes.map((c, i) => (
                <div key={i} className="rounded-lg border border-border bg-gray-50 p-2 text-xs">
                  <div className="font-medium text-foreground">{c.taskName}</div>
                  <div className="mt-0.5 text-gray-500">
                    {c.before.startDate} ~ {c.before.endDate}
                    <span className="mx-1">→</span>
                    {c.after.startDate} ~ {c.after.endDate}
                  </div>
                  <div className="mt-0.5 text-gray-400">direct_move</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
          <CheckCircle2 className="mb-1 h-4 w-4" aria-hidden />
          点击下方确认后，方案中的变更将写入正式项目数据。此操作不可撤销。
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs text-foreground hover:bg-gray-50"
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            onApply()
            onClose()
          }}
          disabled={conflicts.length > 0}
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          确认应用
        </button>
      </div>
    </div>
  )
}

function CommandSummary({ command }: { command: WhatIfCommand }) {
  switch (command.kind) {
    case 'move-task':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-white p-2 text-xs">
          <span className="mt-0.5 rounded bg-blue-100 px-1 font-medium text-blue-700">移动</span>
          <div>
            <div className="text-foreground">任务 #{command.taskId}</div>
            <div className="text-gray-500">移至 {command.newStartDate}</div>
          </div>
        </div>
      )
    case 'resize-duration':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-white p-2 text-xs">
          <span className="mt-0.5 rounded bg-purple-100 px-1 font-medium text-purple-700">
            调整
          </span>
          <div>
            <div className="text-foreground">任务 #{command.taskId}</div>
            <div className="text-gray-500">
              {command.newStartDate} ~ {command.newEndDate}
            </div>
          </div>
        </div>
      )
    case 'add-dependency':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-white p-2 text-xs">
          <span className="mt-0.5 rounded bg-green-100 px-1 font-medium text-green-700">
            新增依赖
          </span>
          <div>
            <div className="text-foreground">
              #{command.predecessorId} → #{command.successorId}
            </div>
          </div>
        </div>
      )
    case 'remove-dependency':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-white p-2 text-xs">
          <span className="mt-0.5 rounded bg-red-100 px-1 font-medium text-red-700">移除依赖</span>
          <div>
            <div className="text-foreground">依赖 #{command.dependencyId}</div>
          </div>
        </div>
      )
    case 'milestone-move':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-white p-2 text-xs">
          <span className="mt-0.5 rounded bg-amber-100 px-1 font-medium text-amber-700">
            里程碑
          </span>
          <div>
            <div className="text-foreground">里程碑 #{command.milestoneId}</div>
            <div className="text-gray-500">移至 {command.newDate}</div>
          </div>
        </div>
      )
  }
}
