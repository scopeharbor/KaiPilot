'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

export const Tabs = TabsPrimitive.Root

/** 下划线式 Tab 列表（当前项 primary 文字 + 下划线指示器，DESIGN.md §3.6）。 */
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('flex items-center gap-1 border-b border-border', className)}
    {...props}
  />
))
TabsList.displayName = 'TabsList'

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative -mb-px inline-flex h-9 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-gray-500',
      'transition-colors hover:text-gray-800',
      'data-[state=active]:border-primary-500 data-[state=active]:text-primary-600',
      'disabled:pointer-events-none disabled:opacity-50',
      focusRing,
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = 'TabsTrigger'

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-4', focusRing, className)} {...props} />
))
TabsContent.displayName = 'TabsContent'
