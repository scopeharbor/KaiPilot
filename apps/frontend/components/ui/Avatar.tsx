'use client'

import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

export const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn('relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full', className)}
    {...props}
  />
))
Avatar.displayName = 'Avatar'

export const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn('aspect-square h-full w-full object-cover', className)}
    {...props}
  />
))
AvatarImage.displayName = 'AvatarImage'

export const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center bg-primary-100 text-sm font-medium text-primary-700',
      className,
    )}
    {...props}
  />
))
AvatarFallback.displayName = 'AvatarFallback'

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 超出后折叠为 +N（默认最多显示 3 个，DESIGN.md §8 项目卡片）。 */
  max?: number
}

/** 头像组——重叠排列，超出 max 显示 +N。 */
export function AvatarGroup({ max = 3, className, children, ...props }: AvatarGroupProps) {
  const items = React.Children.toArray(children)
  const visible = items.slice(0, max)
  const overflow = items.length - visible.length
  return (
    <div className={cn('flex items-center -space-x-2', className)} {...props}>
      {visible.map((child, i) => (
        <div key={i} className="rounded-full ring-2 ring-gray-0">
          {child}
        </div>
      ))}
      {overflow > 0 ? (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600 ring-2 ring-gray-0">
          +{overflow}
        </div>
      ) : null}
    </div>
  )
}
