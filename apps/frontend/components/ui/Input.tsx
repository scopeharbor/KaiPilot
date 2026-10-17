'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { focusRing, invalidCls } from '@/lib/variants'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * Input——4 态（default/focus/error/disabled）。占位文字用 `--placeholder`（gray-500，达 4.5:1）；
 * error 由 `aria-invalid` 驱动 danger 边框 + ring；圆角 `--radius-sm`（stage2a §1.4）。
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-[var(--radius-sm)] border border-border bg-gray-0 px-3 py-1 text-sm text-gray-800',
        'transition-[border-color,box-shadow] duration-150',
        'placeholder:text-placeholder',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        focusRing,
        invalidCls,
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
