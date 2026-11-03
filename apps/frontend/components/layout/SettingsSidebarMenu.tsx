'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import type { NavItemConfig } from '@/lib/navigation'
import { activeSettingsHref, settingsMenuGroups } from '@/lib/settings-navigation'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { navItemClassName } from './NavItem'

export interface SettingsSidebarMenuProps {
  /** 侧栏可见性判断（与全局导航同一套权限 / 套餐 / 功能开关过滤）。 */
  isVisible: (item: NavItemConfig) => boolean
  collapsed?: boolean
  onNavigate?: () => void
}

/**
 * 设置与管理菜单（v3-classic-ui-openproject-pages，OpenProject 式 Administration 侧栏）：
 * 进入 `/settings`、`/admin` 后左侧导航改为本菜单，顶部「返回」回到仪表盘。
 */
export function SettingsSidebarMenu({
  isVisible,
  collapsed = false,
  onNavigate,
}: SettingsSidebarMenuProps) {
  const pathname = usePathname()
  const groups = settingsMenuGroups()
    .map((group) => ({ ...group, items: group.items.filter(isVisible) }))
    .filter((group) => group.items.length > 0)
  const active = activeSettingsHref(
    pathname,
    groups.flatMap((group) => group.items),
  )

  const back = (
    <Link
      href="/dashboard"
      onClick={onNavigate}
      className={cn(
        navItemClassName({ active: false, collapsed }),
        'text-[var(--shell-sidebar-muted)]',
        focusRing,
      )}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      {collapsed ? <span className="sr-only">返回</span> : <span>返回</span>}
    </Link>
  )

  return (
    <div data-settings-sidebar-menu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{back}</TooltipTrigger>
          <TooltipContent side="right">返回</TooltipContent>
        </Tooltip>
      ) : (
        back
      )}
      {collapsed ? null : (
        <div className="px-3 pb-1 pt-3 text-sm font-semibold text-[var(--shell-sidebar-fg)]">
          设置与管理
        </div>
      )}
      {groups.map((group) => (
        <div key={group.id} className="mt-2">
          {collapsed ? null : (
            <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--shell-sidebar-muted)]">
              {group.label}
            </div>
          )}
          <ul aria-label={group.label} className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = active === item.href
              const Icon = item.icon
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  data-active={isActive || undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(navItemClassName({ active: isActive, collapsed }), focusRing)}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {collapsed ? null : <span className="truncate">{item.label}</span>}
                </Link>
              )
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
