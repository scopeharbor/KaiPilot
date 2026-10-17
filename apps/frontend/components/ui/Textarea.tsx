'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { focusRing, invalidCls } from '@/lib/variants'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

/** Textarea——与 Input 同态；最小高度约 5rem，纵向可缩放。 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-20 w-full rounded-[var(--radius-sm)] border border-border bg-gray-0 px-3 py-2 text-sm text-gray-800',
        'transition-[border-color,box-shadow] duration-150',
        'placeholder:text-placeholder',
        focusRing,
        invalidCls,
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
