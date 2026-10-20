'use client'

import Link from 'next/link'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
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
import { UserMenu } from './UserMenu'

export interface SidebarProps {
  /**
   * 强制折叠——由父级驱动（如移动抽屉内固定展开）。
   * 不传时读 `ui-store.sidebarCollapsed`（用户偏好）。
   */
  forceCollapsed?: boolean
  /** 隐藏折叠按钮——移动抽屉/固定形态用。 */
  hideCollapseToggle?: boolean
  /** 点击导航后的副作用（如关闭移动抽屉）。 */
  onNavigate?: () => void
}

/**
 * tooltip 内的快捷键 kbd。
 * 用 `border-current` + 整体降透明度，而不是命令面板里那套浅底 kbd——tooltip 底色
 * 是 `gray-800`，深色模式下该 token 会翻成浅色，写死的白色描边会在其中一套主题里消失。
 */
function ShortcutHint({ chord }: { chord: string }) {
  return (
    <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-current px-1.5 py-0.5 text-[10px] font-medium opacity-70">
      {chord}
    </kbd>
  )
}

/**
 * 侧栏——240px 常驻 / 64px 折叠（build-app-shell-layout / spec app-shell-navigation）。
 *
 * 结构：
 *   顶部品牌 + 折叠按钮 → 工作区选择器 → 两组导航 → 底部（设置/帮助 + UserMenu）
 *
 * 折叠控件（对齐 VS Code / Linear / ChatGPT 的通行做法）：
 *   - 图标用 `PanelLeft*` 面板字形而非箭头——箭头表达「往左移」，面板字形才表达「侧栏」；
 *   - 展开态与品牌**同一行**右对齐，静息 `gray-500`（非文本对比度 ≥3:1），hover 才加深上底；
 *   - 折叠态**不另占一行**：logo 位就地换手，hover/键盘聚焦时交叉淡入 `PanelLeftOpen`；
 *   - 宽度切换不做过渡——侧栏宽属布局属性，逐帧动它会带着内容列（含 1000 任务甘特）一起重排，
 *     与 DESIGN.md §11「只动 transform/opacity」冲突；
 *   - 快捷键由 `command-registry/built-in/layout` 提供，此处只借它的显示文本，不重复绑定。
 *
 * 权限过滤：`usePermissions().canAny(item.requiresPermission)` 命中才渲染；
 * 无 `requiresPermission` 视为任何登录用户可见（`use-permissions.ts` 与后端 RBAC 对齐）。
 * 展示层过滤——服务端仍是安全边界（`design.md` D6 与 `PermissionGuard.tsx` 注释一致）。
 */
export function Sidebar({ forceCollapsed, hideCollapseToggle = false, onNavigate }: SidebarProps) {
  const storedCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebarCollapsed = useUiStore((state) => state.toggleSidebarCollapsed)
  const collapsed = forceCollapsed ?? storedCollapsed
  const { canAny } = usePermissions()
  const planTier = useAuthStore((state) => state.planTier)
  const isSuperAdmin = useAuthStore((state) => Boolean(state.user?.isSuperAdmin))
  // 功能开关就绪表：带 featureGate 的条目只在对应开关就绪时显示（个人版没有带开关的条目）
  const featureGatesReady: Partial<Record<string, boolean>> = {}
  const shortcut = sidebarToggleShortcut()

  function isVisible(item: NavItemConfig): boolean {
    // 企业能力入口：free（或缺失/未知）套餐不显示——个人免费组织不出企业界面。
    if (item.enterpriseOnly && !isEnterpriseEntryVisible(planTier, isSuperAdmin)) return false
    if (item.featureGate && !featureGatesReady[item.featureGate]) return false
    if (!item.requiresPermission || item.requiresPermission.length === 0) return true
    return canAny(item.requiresPermission)
  }

  return (
    <aside
      data-collapsed={collapsed || undefined}
      aria-label="主导航"
      className={cn(
        'flex h-full flex-col border-r border-border bg-gray-0',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* 品牌 + 折叠按钮——恒为单行 56px，折叠态由 logo 位换手承担，不向下堆叠 */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        {collapsed && !hideCollapseToggle ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                aria-label="展开侧栏"
                aria-expanded={false}
                className={cn(
                  'group/toggle relative mx-auto grid h-10 w-10 place-items-center',
                  'rounded-[var(--radius-md)] transition-colors duration-150 ease-out',
                  'hover:bg-gray-100 active:bg-gray-200',
                  focusRing,
                )}
              >
                <BrandLogo
                  size={32}
                  showName={false}
                  className={cn(
                    'transition-opacity duration-150 ease-out',
                    'group-hover/toggle:opacity-0 group-focus-visible/toggle:opacity-0',
                  )}
                  imageClassName="h-8 w-8"
                />
                <PanelLeftOpen
                  aria-hidden
                  className={cn(
                    'absolute h-5 w-5 text-gray-700 opacity-0 transition-opacity duration-150 ease-out',
                    'group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100',
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              展开侧栏
              <ShortcutHint chord={shortcut} />
            </TooltipContent>
          </Tooltip>
        ) : (
          <>
            <Link
              href="/dashboard"
              onClick={onNavigate}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] text-sm font-semibold text-gray-800',
                collapsed && 'mx-auto',
                focusRing,
              )}
              aria-label="开项 KaiPilot 首页"
            >
              <BrandLogo size={32} showName={!collapsed} imageClassName="h-8 w-8" />
            </Link>
            {hideCollapseToggle ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    aria-label="折叠侧栏"
                    aria-expanded
                    onClick={toggleSidebarCollapsed}
                    className="ml-auto text-gray-500"
                  >
                    <PanelLeftClose className="h-5 w-5" aria-hidden />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex items-center gap-2">
                  折叠侧栏
                  <ShortcutHint chord={shortcut} />
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>

      {/* 工作区选择器 */}
      <div className={cn('px-3 pt-3', collapsed && 'px-2')}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      {/* 主导航（两组） */}
      <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-3">
        {primaryNavGroups.map((group) => {
          const visibleItems = group.items.filter(isVisible)
          if (visibleItems.length === 0) return null
          return (
            <div key={group.id} className="mb-4 last:mb-0">
              {collapsed ? null : (
                <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-gray-400">
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
        })}
      </nav>

      {/* 底部：设置/帮助 + UserMenu */}
      <div className={cn('border-t border-border px-2 pb-2 pt-2', collapsed && 'px-2')}>
        <ul className="space-y-0.5 pb-2">
          {secondaryNavItems.filter(isVisible).map((item) => (
            <li key={item.href}>
              <NavItem item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <div className={cn('border-t border-border pt-2', collapsed && 'flex justify-center')}>
          <UserMenu compact={collapsed} />
        </div>
      </div>
    </aside>
  )
}
