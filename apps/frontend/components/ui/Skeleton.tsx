'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Skeleton——骨架屏占位（形状与实际内容一致：矩形=图/头像，长条=文字行）。
 * shimmer 用 gray-100→gray-50→gray-100 线性渐变横扫；减弱动画时由全局媒体查询停动。
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-[var(--radius-sm)] bg-[length:200%_100%]',
        'bg-[linear-gradient(90deg,var(--gray-100)_25%,var(--gray-50)_50%,var(--gray-100)_75%)]',
        className,
      )}
      {...props}
    />
  )
}
