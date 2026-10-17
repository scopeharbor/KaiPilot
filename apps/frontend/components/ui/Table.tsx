'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <table
    ref={ref}
    className={cn('w-full border-separate border-spacing-0 text-sm text-gray-700', className)}
    {...props}
  />
))
Table.displayName = 'Table'

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('text-xs font-medium text-gray-500', className)} {...props} />
))
TableHeader.displayName = 'TableHeader'

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child>*]:border-b-0', className)} {...props} />
))
TableBody.displayName = 'TableBody'

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'transition-colors duration-150 hover:bg-gray-50 focus-within:bg-gray-50',
      className,
    )}
    {...props}
  />
))
TableRow.displayName = 'TableRow'

const cellClassName =
  'border-b border-border px-[var(--space-4)] py-[var(--space-3)] text-left align-middle [[data-density=compact]_&]:py-[var(--space-2)]'

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, scope = 'col', ...props }, ref) => (
  <th
    ref={ref}
    scope={scope}
    className={cn(cellClassName, 'whitespace-nowrap font-medium', className)}
    {...props}
  />
))
TableHead.displayName = 'TableHead'

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn(cellClassName, className)} {...props} />
))
TableCell.displayName = 'TableCell'

export interface TableCaptionProps extends React.HTMLAttributes<HTMLTableCaptionElement> {
  visualHidden?: boolean
}

export const TableCaption = React.forwardRef<HTMLTableCaptionElement, TableCaptionProps>(
  ({ className, visualHidden = true, ...props }, ref) => (
    <caption
      ref={ref}
      className={cn(
        visualHidden ? 'sr-only' : 'caption-bottom py-[var(--space-3)] text-sm text-gray-500',
        className,
      )}
      {...props}
    />
  ),
)
TableCaption.displayName = 'TableCaption'
