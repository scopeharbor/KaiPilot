'use client'

import Link from 'next/link'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { usePathname } from 'next/navigation'
import {
  primaryNavGroups,
  secondaryNavItems,
  isEnterpriseEntryVisible,
  type NavItemConfig,
} from '@/lib/navigation'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { IconButton } from '@/components/ui/IconButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { sidebarToggleShortcut } from '@/lib/command-registry/built-in/layout'
import { NavItem } from './NavItem'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { ProjectSidebarMenu, projectIdFromPath } from './ProjectSidebarMenu'
import { useShellTone } from './use-shell-tone'
import { SettingsSidebarMenu } from './SettingsSidebarMenu'
import { isSettingsPath } from '@/lib/settings-navigation'

/**
 * 导航可见性（侧栏与顶栏全局模块菜单共用，v3-classic-ui-openproject-style D3）。
 *
 * 权限过滤：`usePermissions().canAny(item.requiresPermission)` 命中才渲染；
 * 无 `requiresPermission` 视为任何登录用户可见（`use-permissions.ts` 与后端 RBAC 对齐）。
 * 展示层过滤——服务端仍是安全边界（`design.md` D6 与 `PermissionGuard.tsx` 注释一致）。
 */
export function useNavItemVisibility(): (item: NavItemConfig) => boolean {
  const { canAny } = usePermissions()
  const planTier = useAuthStore((state) => state.planTier)
  const isSuperAdmin = useAuthStore((state) => Boolean(state.user?.isSuperAdmin))
  // 功能开关就绪表：带 featureGate 的条目只在对应开关就绪时显示（个人版没有带开关的条目）
  const featureGatesReady: Partial<Record<string, boolean>> = {}

  return (item: NavItemConfig) => {
    // 企业能力入口：free（或缺失/未知）套餐不显示——个人免费组织不出企业界面。
    if (item.enterpriseOnly && !isEnterpriseEntryVisible(planTier, isSuperAdmin)) return false
    if (item.featureGate && !featureGatesReady[item.featureGate]) return false
    if (!item.requiresPermission || item.requiresPermission.length === 0) return true
    return canAny(item.requiresPermission)
  }
}

/**
 * 侧栏折叠开关（v3-classic-ui-openproject-parity：对齐 OpenProject 16.2，开关在侧栏内顶部）。
 * 只在桌面偏好形态出现；平板强制折叠与移动抽屉不显示。
 */
export function SidebarCollapseToggle({ className }: { className?: string }) {
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggle = useUiStore((state) => state.toggleSidebarCollapsed)
  const label = collapsed ? '展开侧栏' : '折叠侧栏'
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          aria-label={label}
          aria-expanded={!collapsed}
          onClick={toggle}
          className={cn(
            'shrink-0 text-[color:var(--shell-sidebar-muted)] hover:bg-[color:var(--shell-sidebar-hover)] hover:text-[color:var(--shell-sidebar-fg)]',
            className,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </IconButton>
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
        {label}
        <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-current px-1.5 py-0.5 text-[10px] font-medium opacity-70">
          {sidebarToggleShortcut()}
        </kbd>
      </TooltipContent>
    </Tooltip>
  )
}

export interface SidebarProps {
  /**
   * 强制折叠——由父级驱动（平板强制折叠、移动抽屉固定展开）。
   * 不传时读 `ui-store.sidebarCollapsed`（用户偏好，开关在顶栏）。
   */
  forceCollapsed?: boolean
  /** 显示品牌行——移动抽屉用（抽屉会盖住顶栏）。 */
  showBrand?: boolean
  /** 点击导航后的副作用（如关闭移动抽屉）。 */
  onNavigate?: () => void
}

/**
 * 侧栏（v3-classic-ui-openproject-style，OpenProject 式主菜单）——240px 常驻 / 64px 折叠。
 *
 * 结构：工作区选择器 → 导航（项目外：两组全局导航 + 管理与帮助；项目内：项目模块菜单；`/settings`、`/admin` 下：设置与管理菜单。
 * 全局入口经顶栏全局模块菜单）。
 * 底色与文字取当前色系的侧栏令牌；桌面折叠开关在侧栏顶部（对齐 OpenProject 16.2），品牌与用户菜单在顶栏。
 * 宽度切换不做过渡——侧栏宽属布局属性，逐帧动它会带着内容列（含 1000 任务甘特）一起重排。
 */
export function Sidebar({ forceCollapsed, showBrand = false, onNavigate }: SidebarProps) {
  const storedCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const collapsed = forceCollapsed ?? storedCollapsed
  const isVisible = useNavItemVisibility()
  const pathname = usePathname()
  const projectId = projectIdFromPath(pathname)
  const { sidebarOnDark } = useShellTone()

  return (
    <aside
      data-collapsed={collapsed || undefined}
      aria-label="主导航"
      className={cn(
        'flex h-full flex-col border-r border-[var(--shell-sidebar-border)] bg-[var(--shell-sidebar-bg)] text-[var(--shell-sidebar-fg)]',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {showBrand ? (
        <div className="flex h-12 shrink-0 items-center px-3">
          <Link
            href="/dashboard"
            onClick={onNavigate}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] text-sm font-semibold',
              focusRing,
            )}
            aria-label="开项 KaiPilot 首页"
          >
            <BrandLogo size={28} imageClassName="h-7 w-7" onDark={sidebarOnDark} />
          </Link>
        </div>
      ) : null}

      {/* 工作区选择器 + 折叠开关（桌面偏好形态；折叠态开关在选择器上方） */}
      <div
        className={cn(
          'flex items-center gap-1 px-3 pt-3',
          collapsed && 'flex-col-reverse gap-2 px-2',
        )}
      >
        <div className="w-full min-w-0 flex-1">
          <WorkspaceSwitcher collapsed={collapsed} />
        </div>
        {forceCollapsed === undefined ? <SidebarCollapseToggle /> : null}
      </div>

      {/* 导航：项目内为项目模块菜单，项目外为两组全局导航 + 管理与帮助（同一滚动区，避免底部入口挤压主菜单） */}
      <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-3">
        {projectId !== null ? (
          <ProjectSidebarMenu projectId={projectId} collapsed={collapsed} onNavigate={onNavigate} />
        ) : isSettingsPath(pathname) ? (
          <SettingsSidebarMenu
            isVisible={isVisible}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ) : (
          [
            ...primaryNavGroups,
            { id: 'secondary', label: '管理与帮助', items: secondaryNavItems },
          ].map((group) => {
            const visibleItems = group.items.filter(isVisible)
            if (visibleItems.length === 0) return null
            return (
              <div key={group.id} className="mb-4 last:mb-0">
                {collapsed ? null : (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--shell-sidebar-muted)]">
                    {group.label}
                  </div>
                )}
                <ul className="space-y-0.5">
                  {visibleItems.map((item) => (
                    <li key={item.href}>
                      <NavItem item={item} collapsed={collapsed} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              </div>
            )
          })
        )}
      </nav>
    </aside>
  )
}
