'use client'

import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Boxes,
  Building2,
  ChevronDown,
  Fingerprint,
  Gauge,
  KeyRound,
  Layers,
  Link2,
  Palette,
  Plug,
  Scale,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  User,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { selectPlanTier, useAuthStore } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import {
  filterSettingsSections,
  resolveActiveSettingsSection,
  resolveSettingsSectionsByGroup,
  type SettingsSection,
  type SettingsSectionIconName,
} from '@/lib/next/settings/settings-sections'

/**
 * 节卡图标映射（与 `SettingsSectionIconName` 联合类型契约同步，RL-14 静态映射）。
 * 门户节卡复用同一份映射，杜绝两处维护导致的图标漂移。
 */
type SettingsSectionIcon = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

export const SETTINGS_SECTION_ICONS: Record<SettingsSectionIconName, SettingsSectionIcon> = {
  User,
  ShieldCheck,
  Building2,
  ScrollText,
  Layers,
  Boxes,
  Gauge,
  Wand2,
  Plug,
  Link2,
  Scale,
  ShieldAlert,
  KeyRound,
  Fingerprint,
  Palette,
}

/**
 * 设置空间节导航侧栏（v3-ui-next-settings-admin-domains W1 · tasks 1.3，
 * spec「设置空间门户与信息架构」要求 1）。
 *
 * - 分组与节序 100% 由 `settings-sections.ts` 静态白名单驱动（RL-14）：不渲染任何
 *   未注册节，也不渲染管理后台控制台（D-IA 两注册表互不包含）；
 * - 权限收敛（RL-06）：查看权限缺失的节**不出现**在侧栏；免费档企业节为锁定占位、
 *   不构成导航入口，同样不上侧栏（锁定说明只在门户以节卡形式呈现）；
 * - 当前节高亮：由 pathname 经 `resolveActiveSettingsSection` 解析（最长前缀匹配）；
 * - 可折叠分组：组头为原生 button（`aria-expanded` / `aria-controls`），键盘可达；
 * - 精确档降级（RL-15）：`precise` 下剥离全部过渡与动效类，纯色仪器面板 + 1px 发丝线；
 * - 侧栏底部常驻「返回角色首页」入口，任何设置节都可一键回到角色工作落点。
 */
export interface SettingsSpaceNavProps {
  className?: string
}

export function SettingsSpaceNav({ className }: SettingsSpaceNavProps) {
  const router = useRouter()
  const pathname = usePathname() ?? '/next/settings'
  const tier = useImmersionTier()
  const permissions = useAuthStore((state) => state.permissions)
  // store 上的 `hasPermission` 是稳定引用（含 system:admin / 超管哨兵放行），
  // 以权限集合作为重算锚点即可，无需依赖每次渲染都会重建的 `usePermissions().can` 闭包。
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const planTier = useAuthStore(selectPlanTier)

  const visibleSections = React.useMemo(
    () => filterSettingsSections('', hasPermission, planTier),
    [hasPermission, permissions, planTier],
  )
  const blocks = React.useMemo(
    () => resolveSettingsSectionsByGroup(visibleSections),
    [visibleSections],
  )
  const activeSection = React.useMemo(() => resolveActiveSettingsSection(pathname), [pathname])

  // 默认五组全部展开；折叠是本地视图态，不写任何存储（导航偏好不进持久化）。
  const [collapsedGroups, setCollapsedGroups] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )

  const toggleGroup = (group: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const mobile = useMobileWorkspace()
  const precise = tier === 'precise'

  if (mobile)
    return (
      <nav
        data-settings-nav
        aria-label="设置节导航"
        className="rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3"
      >
        <label
          htmlFor="mobile-settings-section"
          className="mb-2 block text-sm text-[var(--nx-text-muted)]"
        >
          设置导航
        </label>
        <select
          id="mobile-settings-section"
          value={activeSection?.path ?? '/next/settings'}
          onChange={(event) => router.push(event.target.value)}
          className="min-h-12 w-full rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-base text-[var(--nx-text-primary)]"
        >
          <option value="/next/settings">设置空间首页</option>
          {blocks.map((block) => (
            <optgroup key={block.group} label={block.label}>
              {block.sections.map((section) => (
                <option key={section.id} value={section.path}>
                  {section.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </nav>
    )
  return (
    <nav
      data-settings-nav
      aria-label="设置节导航"
      className={cn(
        'flex h-full flex-col gap-3 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-3',
        className,
      )}
    >
      <div className="px-1">
        <p className="text-[11px] font-medium tracking-wide text-[var(--nx-text-muted)]">
          设置空间
        </p>
        <p className="mt-0.5 text-xs text-[var(--nx-text-secondary)]">
          {visibleSections.length} 个可进入节
        </p>
      </div>

      <div className="flex flex-col gap-2" data-settings-nav-groups>
        {blocks.map((block) => {
          if (block.sections.length === 0) return null
          const collapsed = collapsedGroups.has(block.group)
          const panelId = `settings-nav-group-${block.group}`

          return (
            <div
              key={block.group}
              data-settings-nav-group={block.group}
              className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]"
            >
              <button
                type="button"
                data-settings-nav-group-toggle={block.group}
                aria-expanded={!collapsed}
                aria-controls={panelId}
                onClick={() => toggleGroup(block.group)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left',
                  'hover:bg-[var(--nx-bg-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                  !precise && 'transition-colors',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-[var(--nx-text-primary)]">
                    {block.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--nx-text-muted)]">
                    {block.description}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]',
                    !precise && 'transition-transform',
                    collapsed && '-rotate-90',
                  )}
                  aria-hidden
                />
              </button>

              {collapsed ? null : (
                <ul id={panelId} className="flex flex-col gap-0.5 px-1.5 pb-1.5">
                  {block.sections.map((section) => (
                    <SettingsNavItem
                      key={section.id}
                      section={section}
                      active={activeSection?.id === section.id}
                      precise={precise}
                      onSelect={() => router.push(section.path)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        data-settings-nav-back-home
        onClick={() => router.push('/next')}
        className={cn(
          'mt-auto flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)]',
          'hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
          !precise && 'transition-colors',
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        返回角色首页
      </button>
    </nav>
  )
}

function SettingsNavItem({
  section,
  active,
  precise,
  onSelect,
}: {
  section: SettingsSection
  active: boolean
  precise: boolean
  onSelect: () => void
}) {
  const Icon = SETTINGS_SECTION_ICONS[section.iconName]

  return (
    <li>
      <button
        type="button"
        data-settings-nav-section={section.id}
        data-active={active ? 'true' : 'false'}
        aria-current={active ? 'page' : undefined}
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
          !precise && 'transition-colors',
          active
            ? 'border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
            : 'border border-transparent text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-hairline)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]',
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{section.title}</span>
      </button>
    </li>
  )
}

export default SettingsSpaceNav
