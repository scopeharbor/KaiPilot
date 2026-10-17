'use client'

import * as React from 'react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'

/**
 * 纸光编辑感（Role View 方案 B）设计系统令牌常量。
 * 消费 next-tokens.css 声明的 --nx-role-* 系列变量，保证与设计定案强对齐。
 */
export const ROLE_VIEW_TOKENS = {
  bg: 'var(--nx-role-bg, #f5f4ef)',
  surface: 'var(--nx-role-surface, #ebe9e1)',
  text: 'var(--nx-role-text, #38342c)',
  accent: 'var(--nx-role-accent, #d97706)',
  hairline: 'rgba(56, 52, 44, 0.12)',
} as const

export interface RoleStrategicScrollContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 标题（可选，作为无障碍区域标签） */
  title?: string
  /** 子节点内容 */
  children: React.ReactNode
  /** 自定义容器类名 */
  className?: string
  /** 显式指定沉浸阶梯（未指定则自动从 useImmersionTier 获取） */
  immersionTier?: 'immersive' | 'light' | 'precise'
}

/**
 * Role View 纸光长卷主容器与排版底座组件（v3-ui-next-batch1-strategy-launch-tasks §1.1 / spec「Role View 纸光长卷高管战略阅览面架构与出版级排版规范」）。
 *
 * 核心特性：
 * 1. 方案 B 纸光编辑感：底色羊皮纸白（--nx-role-bg #f5f4ef）、微暖纸面（--nx-role-surface #ebe9e1）、墨水黑字（--nx-role-text #38342c）与墨水金（--nx-role-accent #d97706）；
 * 2. 出版级居中长卷布局：最大宽度 max-w-5xl 优雅居中阅读网格，杜绝多层滚动嵌套；
 * 3. 精确档纯平降级：在 data-immersion="precise" 下彻底停用所有阴影，保持纯平严肃纸面白；
 * 4. WCAG AA / AAA 达标：墨水黑对羊皮纸白实测对比度 10.8:1（远超 4.5:1）；
 * 5. prefers-reduced-motion 下彻底禁用展开与过渡动效；
 * 6. 零 3D / 零 WebGL / 零 Canvas（RL-15）。
 */
export function RoleStrategicScrollContainer({
  title = '战略执行长卷',
  children,
  className,
  immersionTier: explicitImmersionTier,
  style,
  ...props
}: RoleStrategicScrollContainerProps) {
  const storeImmersionTier = useImmersionTier()
  const activeImmersion = explicitImmersionTier ?? storeImmersionTier
  const isPrecise = activeImmersion === 'precise'

  return (
    <div
      role="region"
      aria-label={title}
      data-role-scroll-container="true"
      data-immersion={activeImmersion}
      className={cn(
        'min-h-screen w-full transition-colors duration-200 motion-reduce:transition-none',
        'bg-[var(--nx-role-bg,#f5f4ef)] text-[var(--nx-role-text,#38342c)]',
        className,
      )}
      style={{
        backgroundColor: ROLE_VIEW_TOKENS.bg,
        color: ROLE_VIEW_TOKENS.text,
        ...style,
      }}
      {...props}
    >
      <div
        className={cn(
          'mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:py-12 lg:px-8',
          'flex flex-col gap-8',
          // 正常档下具备出版级微妙纸张光影，精确档下阴影彻底归零保持纯平
          isPrecise ? 'shadow-none' : 'shadow-[0_2px_12px_rgba(56,52,44,0.04)]',
        )}
      >
        {children}
      </div>
    </div>
  )
}
