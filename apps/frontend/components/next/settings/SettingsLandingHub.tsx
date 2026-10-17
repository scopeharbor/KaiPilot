'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Lock, Search, Settings2, ShieldAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { selectPlanTier, useAuthStore } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { SourceCodeLink } from '@/components/edition/SourceCodeLink'
import {
  filterSettingsSections,
  resolveLockedSettingsSections,
  resolveSettingsSectionsByGroup,
  type SettingsSection,
} from '@/lib/next/settings/settings-sections'
import { SETTINGS_SECTION_ICONS } from './SettingsSpaceNav'

/**
 * 设置空间门户（`/next/settings`，v3-ui-next-settings-admin-domains W1 · tasks 1.5，
 * spec「设置空间门户与信息架构」要求 1、2、3，design D-IA / D-PERM）。
 *
 * - 三段式：欢迎条（当前身份/组织摘要 + 可用节计数）→ 全宽即时检索框 → 五组节卡网格；
 * - 节卡来源 100% 为 `settings-sections.ts` 静态白名单（RL-14），按标题/描述/关键词
 *   多词 AND 即时过滤；无查看权限的节既不渲染也不被检索命中（RL-06）；
 * - 免费档企业节渲染锁定占位卡（锁定说明 + 升级引导），**零数据请求**——锁定卡不是
 *   导航入口，不携带任何底层接口调用；
 * - 空态：检索无结果与「无任何可用节」分别渲染中性说明，「无任何可用节」额外提供
 *   「返回角色首页」引导；
 * - 精确档（`precise`）剥离氛围光晕，纯色仪器面板 + 1px 发丝线（RL-15）；
 * - 本页为纯静态渲染，唯一网络依赖是标题所用会话摘要（来自已水合的 auth store），
 *   门户本身不发起任何业务请求。
 */
export interface SettingsLandingHubProps {
  /**
   * 节卡来源（可选注入点，默认 = `settings-sections.ts` 静态白名单）。
   *
   * 门户本身不改写注册表语义；该注入点仅用于渲染边界的显式验证与同一网格复用
   * （例如嵌进别的门户外壳）。生产路径不传此参数（RL-14 白名单仍为唯一真相）。
   */
  registry?: readonly SettingsSection[]
}

export function SettingsLandingHub({ registry }: SettingsLandingHubProps = {}) {
  const router = useRouter()
  const tier = useImmersionTier()
  const permissions = useAuthStore((state) => state.permissions)
  // store 上的 `hasPermission` 是稳定引用（含 system:admin / 超管哨兵放行），
  // 以权限集合作为重算锚点即可，无需依赖每次渲染都会重建的 `usePermissions().can` 闭包。
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const planTier = useAuthStore(selectPlanTier)
  const user = useAuthStore((state) => state.user)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  // 会话水合门：未水合时不渲染任何节卡（否则会用空权限集把全部节判成「无权」而闪出空态）。
  const hasHydrated = useAuthStore((state) => state.hasHydrated)

  const [query, setQuery] = React.useState('')

  // 检索词 + 权限/套餐收敛：见 settings-sections.ts 纯函数（纯静态、零网络）。
  const sections = React.useMemo(
    () => filterSettingsSections(query, hasPermission, planTier, registry),
    [query, hasPermission, permissions, planTier, registry],
  )
  const lockedSections = React.useMemo(
    () => resolveLockedSettingsSections(query, hasPermission, planTier, registry),
    [query, hasPermission, permissions, planTier, registry],
  )
  const blocks = React.useMemo(() => resolveSettingsSectionsByGroup(sections), [sections])

  const precise = tier === 'precise'
  const hasAnySection = sections.length > 0
  const hasAnyRenderable = hasAnySection || lockedSections.length > 0
  const hasQuery = query.trim() !== ''
  const visibleSectionCount = sections.length + lockedSections.length

  const currentOrganization = user?.organizations.find(
    (organization) => organization.id === currentOrganizationId,
  )

  // 骨架屏：会话水合前不渲染节卡（几何匹配的仪器面板骨架，aria-busy）。
  if (!hasHydrated) {
    return <SettingsLandingSkeleton precise={precise} />
  }

  return (
    <div
      data-settings-landing-hub
      data-immersion={tier}
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        precise ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 欢迎条：当前组织/身份摘要 + 可用节计数 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Settings2 className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1
              data-settings-landing-title
              className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              设置空间
            </h1>
            <p
              data-settings-landing-meta
              className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]"
            >
              {currentOrganization
                ? `${currentOrganization.name} · ${currentOrganization.slug}`
                : '未选择组织'}
              {user?.email ? ` · ${user.email}` : ''}
              {` · ${visibleSectionCount} 个设置节`}
            </p>
          </div>
        </div>
        <button
          type="button"
          data-settings-landing-back-home
          onClick={() => router.push('/next')}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)]',
            'hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
            !precise && 'transition-colors',
          )}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          返回角色首页
        </button>
      </header>

      {/* 全宽即时检索框 */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--nx-text-muted)]"
          aria-hidden
        />
        <input
          type="search"
          data-settings-landing-search
          aria-label="检索设置节"
          placeholder="检索设置节，例如「密钥」「用量」「审计」…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={cn(
            'h-10 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] pl-9 pr-9 text-sm text-[var(--nx-text-primary)]',
            'placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none',
            !precise && 'transition-colors',
          )}
        />
        {hasQuery ? (
          <button
            type="button"
            data-settings-landing-search-clear
            aria-label="清空检索"
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* 空态：无任何可用节（权限全缺；锁定占位不算可用内容）——中性说明 + 返回角色首页 */}
      {!hasAnyRenderable && !hasQuery ? (
        <div
          data-settings-landing-empty
          role="status"
          className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">暂无可管理内容</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            当前账号在本组织内没有可进入的设置节。如需治理组织、连接模型或配置安全策略，
            请联系组织管理员授予权限。
          </p>
          <button
            type="button"
            data-settings-landing-empty-back-home
            onClick={() => router.push('/next')}
            className="mt-1 flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
        </div>
      ) : null}

      {/* 五组节卡网格（含锁定占位） */}
      {hasAnyRenderable ? (
        <div data-settings-landing-groups className="flex flex-col gap-4">
          {blocks.map((block) => {
            const lockedInGroup = lockedSections.filter((section) => section.group === block.group)
            if (block.sections.length === 0 && lockedInGroup.length === 0) return null

            return (
              <section
                key={block.group}
                data-settings-landing-group={block.group}
                aria-labelledby={`settings-landing-group-${block.group}`}
                className="flex flex-col gap-2"
              >
                <div className="flex items-baseline gap-2">
                  <h2
                    id={`settings-landing-group-${block.group}`}
                    className="text-sm font-medium text-[var(--nx-text-primary)]"
                  >
                    {block.label}
                  </h2>
                  <p className="text-[11px] text-[var(--nx-text-muted)]">{block.description}</p>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                  {block.sections.map((section) => (
                    <SettingsSectionCard
                      key={section.id}
                      section={section}
                      precise={precise}
                      onSelect={() => router.push(section.path)}
                    />
                  ))}
                  {lockedInGroup.map((section) => (
                    <LockedSettingsSectionCard
                      key={section.id}
                      section={section}
                      precise={precise}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : null}

      {/* 空态：检索无结果（本次检索未命中任何可进入节或锁定占位） */}
      {hasQuery && !hasAnyRenderable ? (
        <div
          data-settings-landing-no-match
          role="status"
          className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-8 py-14 text-center"
        >
          <Search className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">没有匹配的设置节</h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            试着换一个关键词，或清空检索查看全部可进入的设置节。
          </p>
          <button
            type="button"
            data-settings-landing-no-match-clear
            onClick={() => setQuery('')}
            className="mt-1 flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            清空检索
          </button>
        </div>
      ) : null}

      {/* 源代码入口（AGPL 第 13 条）：未配置地址时不渲染 */}
      <SourceCodeLink className="mt-auto self-end" />
    </div>
  )
}

/** 可进入节卡：标题 + 描述 + 关键词微标，点击直达设置空间深层路由。 */
function SettingsSectionCard({
  section,
  precise,
  onSelect,
}: {
  section: SettingsSection
  precise: boolean
  onSelect: () => void
}) {
  const Icon = SETTINGS_SECTION_ICONS[section.iconName]

  return (
    <button
      type="button"
      data-settings-section-card={section.id}
      onClick={onSelect}
      className={cn(
        'flex h-full flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-left',
        'hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-space-surface)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)]',
        !precise && 'transition-colors',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <Icon className="h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
      </span>
      <span className="text-sm font-semibold leading-snug text-[var(--nx-text-primary)]">
        {section.title}
      </span>
      <span className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
        {section.description}
      </span>
      <span className="mt-auto flex flex-wrap gap-1">
        {section.keywords.slice(0, 3).map((keyword) => (
          <span
            key={keyword}
            data-settings-section-keyword
            className="rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-text-muted)]"
          >
            {keyword}
          </span>
        ))}
      </span>
      <span className="font-mono text-[11px] tracking-wide text-[var(--nx-text-muted)]">
        {section.path}
      </span>
    </button>
  )
}

/**
 * 免费档企业节锁定占位卡（D-PERM / spec 要求 2）：
 * 渲染锁定说明与升级引导，**不构成导航入口**、不发起任何数据请求（RL-06）。
 */
function LockedSettingsSectionCard({
  section,
  precise,
}: {
  section: SettingsSection
  precise: boolean
}) {
  const Icon = SETTINGS_SECTION_ICONS[section.iconName]

  return (
    <div
      data-settings-section-locked={section.id}
      aria-disabled="true"
      className={cn(
        'flex h-full flex-col gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 opacity-90',
        !precise && 'transition-colors',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <Icon className="h-4 w-4 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
        <span className="flex items-center gap-1 rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-text-muted)]">
          <Lock className="h-3 w-3" aria-hidden />
          企业版能力
        </span>
      </span>
      <span className="text-sm font-semibold leading-snug text-[var(--nx-text-secondary)]">
        {section.title}
      </span>
      <span className="text-xs leading-relaxed text-[var(--nx-text-muted)]">
        {section.description}
      </span>
      <span className="mt-auto text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
        当前套餐未包含该能力，且当前账号没有对应权限。升级到企业版并申请授权后即可使用；
        本卡片不会加载任何数据。
      </span>
    </div>
  )
}

/** 门户骨架屏：会话水合前的几何匹配占位（`role=status` + `aria-busy`，零数据请求）。 */
function SettingsLandingSkeleton({ precise }: { precise: boolean }) {
  return (
    <div
      data-settings-landing-skeleton
      role="status"
      aria-label="正在加载设置空间"
      aria-busy="true"
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        precise ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-9 w-64 rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
        <div className="h-8 w-32 rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
      </div>
      <div
        className="h-10 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        aria-hidden
      />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div
            key={index}
            className="h-28 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            aria-hidden
          />
        ))}
      </div>
    </div>
  )
}

export default SettingsLandingHub
