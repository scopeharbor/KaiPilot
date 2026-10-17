'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 可选中态（如筛选芯片）。 */
  selected?: boolean
  /** 提供后显示删除按钮。 */
  onRemove?: () => void
  disabled?: boolean
}

/**
 * Chip——pill 形（`--radius-full`）筛选/标签芯片。hover `--primary-50`，
 * 选中态 primary 浅底描边；可选删除按钮（stage2a §4.8）。
 */
export function Chip({ className, selected, onRemove, disabled, children, ...props }: ChipProps) {
  return (
    <span
      data-selected={selected || undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors',
        selected
          ? 'border-primary-200 bg-primary-50 text-primary-700'
          : 'border-transparent bg-gray-100 text-gray-700 hover:bg-primary-50 hover:text-primary-700',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="移除"
          className={cn('-mr-1 rounded-full p-0.5 text-gray-500 hover:text-gray-800', focusRing)}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  )
}
