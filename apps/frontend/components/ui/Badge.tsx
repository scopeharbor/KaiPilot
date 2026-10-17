'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Badge——状态/计数标签，圆角 `--radius-sm`。语义色以「浅底 + 语义前景」双通道，
 * 建议同时带图标/文字，不以颜色单通道承载信息。
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium [&_svg]:h-3 [&_svg]:w-3',
  {
    variants: {
      variant: {
        neutral: 'bg-gray-100 text-gray-700',
        primary: 'bg-primary-50 text-primary-700',
        success: 'bg-success-bg text-success',
        warning: 'bg-warning-bg text-warning',
        danger: 'bg-danger-bg text-danger',
        info: 'bg-info-bg text-info',
        ai: 'bg-ai-bg text-ai',
        outline: 'border border-border text-gray-600',
        solid: 'bg-primary-500 text-white',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { badgeVariants }
