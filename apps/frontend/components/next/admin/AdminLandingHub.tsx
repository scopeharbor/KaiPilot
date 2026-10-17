'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  BarChart3,
  Gauge,
  Network,
  Route,
  ScrollText,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCog,
} from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  ADMIN_CONSOLES,
  ADMIN_CONSOLE_GROUPS,
  filterAdminConsoles,
  type AdminConsole,
  type AdminConsoleIconName,
} from '@/lib/next/admin/admin-consoles'

/**
 * 管理后台门户工作区（/next/admin，v3-ui-next-settings-admin-domains W6 · tasks 6.3，
 * spec「管理后台门户与平台治理控制台」Requirement 1 + design D-ADM / D-HUB）。
 *
 * - 节卡数据 100% 来自静态注册表 `lib/next/admin/admin-consoles.ts`（RL-14），
 *   按「平台治理 / 平台运营与信任」两组渲染；权限收敛纯函数 `filterAdminConsoles`
 *   在渲染前完成，无权限控制台节点根本不挂载（RL-06 零请求）；
 * - **无任何控制台权限** → 中性受限页：不渲染任何控制台名称、不泄露清单存在性
 *   （D-ADM / RL-05），且本页自身零业务请求（门户为入口页，不订阅任何服务端态）；
 * - 检索框即时过滤（本地纯函数、零网络），节卡点击 `router.push` 直达控制台；
 * - 页头提供「← 返回角色首页」统一回退（与 PMO / 组织域页面同一动线）；
 * - 暗黑仪器感：精确档 `precise` 下剥离氛围光晕，纯色工作面 + 1px 发丝线（RL-15）。
 */

const CONSOLE_ICONS: Record<AdminConsoleIconName, typeof ShieldAlert> = {
  ScrollText,
  Network,
  UserCog,
  Gauge,
  Route,
  ShieldCheck,
  BarChart3,
}

export function AdminLandingHub() {
  const router = useRouter()
  const tier = useImmersionTier()
  const { can } = usePermissions()
  const [query, setQuery] = React.useState('')

  // 静态白名单上的纯集合运算：直接求值即可，无需 memo（且避免权限函数身份波动）。
  const visibleConsoles = filterAdminConsoles(can, query)
  const hasAnyConsole = filterAdminConsoles(can).length > 0

  const shellClass = cn(
    'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
    tier === 'precise'
      ? 'bg-[var(--nx-workspace-bg)]'
      : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
  )

  // 中性受限页：无任何控制台权限（不泄露清单，零请求）。
  if (!hasAnyConsole) {
    return (
      <div data-admin-landing data-admin-landing-restricted className={shellClass}>
        <div
          data-permission-fallback
          className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h1 className="text-base font-medium text-[var(--nx-text-primary)]">暂无可用控制台</h1>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            当前账号没有平台治理或运营控制台的访问权限。如需访问，请联系平台管理员授予相应权限。
          </p>
          <button
            type="button"
            data-admin-back-home
            onClick={() => router.push('/next')}
            className="mt-1 flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
        </div>
      </div>
    )
  }

  return (
    <div data-admin-landing className={shellClass}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            data-admin-back-home
            onClick={() => router.push('/next')}
            className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <ShieldAlert className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1
              data-admin-landing-title
              className="text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              管理后台
            </h1>
            <p data-admin-landing-meta className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              平台级治理与运营控制台 · 共 {visibleConsoles.length} / {ADMIN_CONSOLES.length} 项可用
            </p>
          </div>
        </div>
      </header>

      {/* 全宽即时检索：本地纯函数过滤，零网络请求（RL-06） */}
      <div className="flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
        <input
          data-admin-search
          type="search"
          aria-label="检索控制台"
          placeholder="检索控制台（用户 / 审计 / 租户 / 质量 / 路由 / 信任）"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-9 w-full bg-transparent text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:outline-none"
        />
      </div>

      {visibleConsoles.length === 0 ? (
        <div
          data-admin-search-empty
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-12 text-center"
        >
          <Search className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">没有匹配的控制台</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            当前检索词在你的可用控制台中无命中；清空检索框可恢复全部可用控制台。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {ADMIN_CONSOLE_GROUPS.map((group) => {
            const groupConsoles = visibleConsoles.filter((console) => console.group === group.id)
            if (groupConsoles.length === 0) return null
            return (
              <section key={group.id} data-admin-group={group.id} className="flex flex-col gap-2.5">
                <header className="flex flex-wrap items-baseline gap-2 border-b border-[var(--nx-border-hairline)] pb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--nx-text-secondary)]">
                    {group.label}
                  </h2>
                  <span className="text-[10px] text-[var(--nx-text-muted)]">
                    {group.description}
                  </span>
                </header>
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {groupConsoles.map((console) => (
                    <AdminConsoleCard
                      key={console.id}
                      item={console}
                      onOpen={() => router.push(console.path)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AdminConsoleCard({ item, onOpen }: { item: AdminConsole; onOpen: () => void }) {
  const Icon = CONSOLE_ICONS[item.iconName]
  return (
    <button
      type="button"
      data-admin-console={item.id}
      aria-label={`打开${item.title}`}
      onClick={onOpen}
      className="flex h-full flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3.5 text-left transition-colors hover:border-[var(--nx-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
    >
      <span className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
          <Icon className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-[var(--nx-text-primary)]">
          {item.title}
        </span>
      </span>
      <span className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
        {item.description}
      </span>
      <span className="mt-auto flex flex-wrap gap-1">
        {item.keywords.slice(0, 3).map((keyword) => (
          <span
            key={keyword}
            className="rounded-sm border border-[var(--nx-border-hairline)] px-1 py-px text-[9px] leading-none text-[var(--nx-text-muted)]"
          >
            {keyword}
          </span>
        ))}
      </span>
    </button>
  )
}

export default AdminLandingHub
