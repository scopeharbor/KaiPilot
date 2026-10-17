'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing, disabledCls, invalidCls } from '@/lib/variants'

/**
 * Button——7 态齐备（default/hover/focus/active/disabled/loading/error）。
 * - hover 加深到 600 阶、active `scale(0.98)`、focus 显 `--shadow-focus` ring；
 * - loading：同色系 spinner 替换/前置并禁用；error：`aria-invalid` → danger ring + shake。
 * 主按钮圆角 `--radius-md`（stage2a §1.4）。
 */
const buttonVariants = cva(
  cn(
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] font-medium',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
    focusRing,
    disabledCls,
    invalidCls,
  ),
  {
    variants: {
      variant: {
        primary:
          'bg-primary-500 text-white hover:bg-primary-600 active:scale-[0.98] active:bg-primary-700',
        secondary:
          'border border-border bg-gray-0 text-gray-700 hover:bg-gray-50 hover:text-gray-800 active:scale-[0.98] active:bg-gray-100',
        outline:
          'border border-border bg-transparent text-gray-700 hover:bg-gray-50 active:bg-gray-100',
        ghost:
          'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800 active:bg-gray-200',
        danger: 'bg-danger text-white hover:brightness-95 active:scale-[0.98] active:brightness-90',
        link: 'text-primary-500 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 text-sm',
        sm: 'h-8 rounded-[var(--radius-sm)] px-3 text-sm',
        lg: 'h-11 px-6 text-md',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** 用 Radix Slot 把样式合并到子元素（如 `<Link>`）。 */
  asChild?: boolean
  /** loading 态：显示 spinner 并禁用。 */
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          // Slot 要求「单一有效元素子节点」：仅透传 children，禁止再塞入 loading 兄弟（否则 [null, child] 触发
          // "Slot failed to slot onto its children" 使整页崩溃）。asChild 场景不渲染内置指示器。
          children
        ) : (
          <>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {children}
          </>
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
