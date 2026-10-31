'use client'

import Link from 'next/link'
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
 * 底色与文字取当前色系的侧栏令牌；折叠开关、品牌与用户菜单在顶栏。
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

      {/* 工作区选择器 */}
      <div className={cn('px-3 pt-3', collapsed && 'px-2')}>
        <WorkspaceSwitcher collapsed={collapsed} />
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
