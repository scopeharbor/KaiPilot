'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavItemConfig } from '@/lib/navigation'
import { activeNavHref } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'

export interface NavItemProps {
  item: NavItemConfig
  /** 侧栏是否处于折叠态（仅图标 + tooltip）。 */
  collapsed?: boolean
  /** 点击时的副作用（如关闭移动抽屉）。 */
  onNavigate?: () => void
}

/**
 * 侧栏导航项样式（v3-classic-ui-openproject-style）：颜色取自当前色系的侧栏令牌（`--shell-sidebar-*`），
 * 项目模块菜单（`ProjectSidebarMenu`）共用同一套样式。
 *
 * 选中态使用 3px 左侧竖线指示器——**是 `DESIGN.md` §12 唯一允许的侧边色条例外**，
 * 其他任何组件不得再引入侧边色条（防 slop 红线）。
 */
export function navItemClassName({ active, collapsed }: { active: boolean; collapsed: boolean }) {
  return cn(
    'relative flex h-8 items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-sm',
    'text-[var(--shell-sidebar-fg)] transition-colors',
    'hover:bg-[var(--shell-sidebar-hover)]',
    active &&
      'bg-[var(--shell-sidebar-active-bg)] font-medium text-[var(--shell-sidebar-active-fg)] hover:bg-[var(--shell-sidebar-active-bg)]',
    active &&
      'before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r-[var(--radius-sm)] before:bg-[var(--shell-sidebar-active-fg)]',
    collapsed && 'justify-center px-0',
  )
}

/**
 * 侧栏导航项——三态（默认/hover/选中）+ 折叠态图标 tooltip（spec app-shell-navigation）。
 */
export function NavItem({ item, collapsed = false, onNavigate }: NavItemProps) {
  const pathname = usePathname()
  // 唯一高亮最具体的命中项——父项在子项路径下不再误亮。
  const active = activeNavHref(pathname) === item.href
  const Icon = item.icon

  const content = (
    <Link
      href={item.href}
      onClick={onNavigate}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(navItemClassName({ active, collapsed }), focusRing)}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  )

  if (!collapsed) return content

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
