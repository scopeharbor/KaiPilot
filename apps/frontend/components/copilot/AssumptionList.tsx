'use client'

/**
 * 假设清单组件（任务 7.2–7.6）
 *
 * 可折叠展开，逐条显示陈述、来源、置信度与默认值标记。
 * 每条可单独编辑（任务 7.3），编辑一条不丢弃其余。
 * 未明确信息独立警告块（任务 7.5），不与已确认信息混排。
 */
import * as React from 'react'
import { ChevronDown, ChevronRight, Edit2, Check, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CopilotAssumptionEntry } from '@aiproj/types'
import { ConfidenceIndicator } from './ConfidenceIndicator'

interface AssumptionListProps {
  assumptions: readonly CopilotAssumptionEntry[]
  onEdit?: (assumptionId: string, newStatement: string) => void
  className?: string
}

export function AssumptionList({ assumptions, onEdit, className }: AssumptionListProps) {
  const [expanded, setExpanded] = React.useState(true)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editValue, setEditValue] = React.useState('')

  const defaultAssumptions = assumptions.filter((a) => a.usedDefault)
  const otherAssumptions = assumptions.filter((a) => !a.usedDefault)

  function startEdit(assumption: CopilotAssumptionEntry) {
    setEditingId(assumption.assumptionId)
    setEditValue(assumption.statement)
  }

  function confirmEdit(assumptionId: string) {
    onEdit?.(assumptionId, editValue)
    setEditingId(null)
    setEditValue('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValue('')
  }

  if (assumptions.length === 0) return null

  return (
    <div
      className={cn(
        'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]',
        className,
      )}
    >
      {/* 折叠头 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))]"
      >
        <span className="flex items-center gap-2">
          🤔 AI 做了这些假设
          <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
            {assumptions.length}
          </span>
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
        )}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-[hsl(var(--border))] px-4 py-3">
          {/* 默认值替代警告块（任务 7.5）——独立成组，不与已确认信息混排 */}
          {defaultAssumptions.length > 0 && (
            <div className="mb-3 rounded-md border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--warning))]">
                <AlertTriangle className="h-3.5 w-3.5" />
                以下信息未明确，使用了默认值
              </div>
              <ul className="mt-2 space-y-2">
                {defaultAssumptions.map((a) => (
                  <AssumptionItem
                    key={a.assumptionId}
                    assumption={a}
                    isEditing={editingId === a.assumptionId}
                    editValue={editValue}
                    onEditChange={setEditValue}
                    onStartEdit={() => startEdit(a)}
                    onConfirmEdit={() => confirmEdit(a.assumptionId)}
                    onCancelEdit={cancelEdit}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* 其他假设 */}
          {otherAssumptions.length > 0 && (
            <ul className="space-y-2">
              {otherAssumptions.map((a) => (
                <AssumptionItem
                  key={a.assumptionId}
                  assumption={a}
                  isEditing={editingId === a.assumptionId}
                  editValue={editValue}
                  onEditChange={setEditValue}
                  onStartEdit={() => startEdit(a)}
                  onConfirmEdit={() => confirmEdit(a.assumptionId)}
                  onCancelEdit={cancelEdit}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── 单条假设项 ──

interface AssumptionItemProps {
  assumption: CopilotAssumptionEntry
  isEditing: boolean
  editValue: string
  onEditChange: (value: string) => void
  onStartEdit: () => void
  onConfirmEdit: () => void
  onCancelEdit: () => void
}

function AssumptionItem({
  assumption,
  isEditing,
  editValue,
  onEditChange,
  onStartEdit,
  onConfirmEdit,
  onCancelEdit,
}: AssumptionItemProps) {
  return (
    <li className="group flex items-start gap-2 text-xs">
      <ConfidenceIndicator confidence={assumption.confidence} size="sm" />
      <div className="flex-1">
        {isEditing ? (
          <div className="flex gap-1">
            <input
              type="text"
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              className="flex-1 rounded border border-[hsl(var(--border))] px-2 py-1 text-xs"
              autoFocus
            />
            <button onClick={onConfirmEdit} className="p-1 text-[hsl(var(--success))]">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={onCancelEdit} className="p-1 text-[hsl(var(--destructive))]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <span className="text-[hsl(var(--foreground))]">{assumption.statement}</span>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
          <span>来源：{assumption.source}</span>
          <span>可信度：{assumption.confidence}%</span>
          {assumption.usedDefault && (
            <span className="text-[hsl(var(--warning))]">使用了默认值</span>
          )}
          {assumption.needsConfirmation && (
            <span className="text-[hsl(var(--destructive))]">需确认</span>
          )}
        </div>
      </div>
      {!isEditing && assumption.editable && (
        <button
          onClick={onStartEdit}
          className="p-1 opacity-0 group-hover:opacity-100 transition-opacity text-[hsl(var(--muted-foreground))]"
          aria-label="编辑假设"
        >
          <Edit2 className="h-3 w-3" />
        </button>
      )}
    </li>
  )
}
