'use client'

import { useState, type KeyboardEvent, type ReactNode } from 'react'

/**
 * 任务表格行内编辑单元格（v3-classic-ui-openproject-table，OpenProject 式）：
 * 平时是显示值的按钮，点击后换成原生下拉或日期输入并自动聚焦；
 * 下拉选中即提交，日期按 Enter 或失焦提交；Esc 取消。提交与错误处理由调用方负责。
 */

const triggerClass =
  'group/inline -mx-1 flex min-h-7 w-[calc(100%+0.5rem)] min-w-0 items-center rounded px-1 text-left hover:bg-gray-100 hover:ring-1 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-wait disabled:opacity-60'

const editorClass =
  'h-7 w-full min-w-0 rounded-[var(--radius-sm)] border border-primary-400 bg-gray-0 px-1.5 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400'

export interface InlineSelectCellProps<T extends string> {
  /** 字段名，用于可访问名：「编辑状态：进行中」。 */
  field: string
  value: T
  valueLabel: string
  options: ReadonlyArray<readonly [T, string]>
  display: ReactNode
  pending?: boolean
  onCommit: (value: T) => void
}

export function InlineSelectCell<T extends string>({
  field,
  value,
  valueLabel,
  options,
  display,
  pending = false,
  onCommit,
}: InlineSelectCellProps<T>) {
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        className={triggerClass}
        aria-label={`编辑${field}：${valueLabel}`}
        disabled={pending}
        data-inline-edit={field}
        onClick={() => setEditing(true)}
      >
        {display}
      </button>
    )
  }

  return (
    <select
      autoFocus
      className={editorClass}
      aria-label={field}
      value={value}
      onChange={(event) => {
        setEditing(false)
        const next = event.target.value as T
        if (next !== value) onCommit(next)
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setEditing(false)
        }
      }}
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  )
}

export interface InlineDateCellProps {
  field: string
  value: string | null
  valueLabel: string
  display: ReactNode
  pending?: boolean
  onCommit: (value: string) => void
}

export function InlineDateCell({
  field,
  value,
  valueLabel,
  display,
  pending = false,
  onCommit,
}: InlineDateCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  function commit() {
    setEditing(false)
    if (/^\d{4}-\d{2}-\d{2}$/.test(draft) && draft !== value) onCommit(draft)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(value ?? '')
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={triggerClass}
        aria-label={`编辑${field}：${valueLabel}`}
        disabled={pending}
        data-inline-edit={field}
        onClick={() => {
          setDraft(value ?? '')
          setEditing(true)
        }}
      >
        {display}
      </button>
    )
  }

  return (
    <input
      autoFocus
      type="date"
      className={editorClass}
      aria-label={field}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}
