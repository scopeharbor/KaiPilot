'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

const sheetVariants = cva(
  cn(
    'fixed z-[var(--z-modal)] max-h-dvh overflow-y-auto overscroll-contain bg-gray-0 text-gray-700 shadow-[var(--shadow-lg)]',
    'data-[state=open]:animate-drawer-slide-in',
  ),
  {
    variants: {
      side: {
        right: 'inset-y-0 right-0 h-full w-full max-w-[560px] border-l border-border',
        left: 'inset-y-0 left-0 h-full w-full max-w-[560px] border-r border-border',
        top: 'inset-x-0 top-0 border-b border-border',
        bottom: 'inset-x-0 bottom-0 border-t border-border',
      },
    },
    defaultVariants: { side: 'right' },
  },
)

/**
 * Sheet（抽屉）——任务详情等用右侧抽屉（560px，从右滑入 300ms）。
 * portal 到 body 避免被 overflow 裁切；<768px 由使用方改全屏（w-full 已默认全宽兜底）。
 */
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    VariantProps<typeof sheetVariants> & {
      /** 使用方自己放了关闭按钮（SheetClose）时隐藏内置的，避免右上角两个叉叉。 */
      hideClose?: boolean
    }
>(({ className, children, side = 'right', hideClose = false, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-[var(--overlay)] data-[state=open]:animate-fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      {hideClose ? null : (
        <DialogPrimitive.Close
          className={cn(
            'absolute right-4 top-4 rounded-[var(--radius-sm)] p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800',
            focusRing,
          )}
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
SheetContent.displayName = 'SheetContent'

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-1.5 border-b border-border p-6', className)} {...props} />
  )
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-auto flex flex-col gap-2 border-t border-border p-6 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-gray-800', className)}
    {...props}
  />
))
SheetTitle.displayName = 'SheetTitle'

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-gray-500', className)}
    {...props}
  />
))
SheetDescription.displayName = 'SheetDescription'
