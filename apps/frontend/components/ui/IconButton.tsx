'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants, type ButtonProps } from '@/components/ui/Button'

export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'asChild'> {
  /** 无障碍必填：图标按钮须有可读标签。 */
  'aria-label': string
  size?: 'default' | 'sm' | 'lg'
}

/** 纯图标按钮——强制 `aria-label`，方形触摸目标，默认 ghost 变体。 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      variant = 'ghost',
      size = 'default',
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const box = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant }), box, 'px-0', className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : children}
      </button>
    )
  },
)
IconButton.displayName = 'IconButton'
