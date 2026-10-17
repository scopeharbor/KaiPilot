'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Alert / Callout——克制版：语义浅底 + **全边框**（无左色条）。语义同时由图标 + 文字双通道传达。
 */
const alertVariants = cva('flex gap-3 rounded-[var(--radius-md)] border p-4 text-sm', {
  variants: {
    variant: {
      neutral: 'border-border bg-gray-50 text-gray-700',
      info: 'border-info bg-info-bg text-gray-800',
      success: 'border-success bg-success-bg text-gray-800',
      warning: 'border-warning bg-warning-bg text-gray-800',
      danger: 'border-danger bg-danger-bg text-gray-800',
      ai: 'border-ai bg-ai-bg text-gray-800',
    },
  },
  defaultVariants: { variant: 'neutral' },
})

const iconMap = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
  ai: Sparkles,
} as const

const iconToneMap = {
  neutral: 'text-gray-500',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  ai: 'text-ai',
} as const

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  /** 自定义图标；不传则按 variant 取语义图标。传 null 隐藏图标。 */
  icon?: React.ReactNode
  title?: React.ReactNode
}

export function Alert({
  className,
  variant = 'neutral',
  icon,
  title,
  children,
  ...props
}: AlertProps) {
  const key = variant ?? 'neutral'
  const Icon = iconMap[key]
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {icon === null ? null : (
        <span className={cn('mt-0.5 shrink-0', iconToneMap[key])}>
          {icon ?? <Icon className="h-5 w-5" aria-hidden />}
        </span>
      )}
      <div className="flex-1 space-y-1">
        {title ? <div className="font-medium text-gray-800">{title}</div> : null}
        {children ? <div className="text-gray-600">{children}</div> : null}
      </div>
    </div>
  )
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('font-medium text-gray-800', className)} {...props} />
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-gray-600', className)} {...props} />
}

export { alertVariants }
