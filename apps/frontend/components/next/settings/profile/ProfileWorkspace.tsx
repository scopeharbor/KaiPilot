'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowDownToLine,
  ChevronRight,
  LogOut,
  Mail,
  Palette,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isSaasPersonalWorkspace } from '@/lib/workspace-edition'
import { selectPlanTier, useAuthStore, type AuthOrganization } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { signOutSession } from '@/lib/auth/sign-out'

/**
 * 个人资料工作区（`/next/settings/profile`，v3-ui-next-settings-admin-domains
 * W1 · tasks 1.7，spec「个人资料与新旧 UI 轨偏好入口」）。
 *
 * - 只读身份卡（头像缩写 / 姓名 / 邮箱 / 系统管理员徽标）+ 所属组织列表
 *   （当前组织标记 + 组织角色标签），数据全部来自已水合的 `useAuthStore`
 *   （`auth/me` 契约），**本页不发起任何业务请求**；
 * - 「账号安全」快捷入口直达 `/next/settings/security/two-factor`；
 * - 「界面呈现」偏好卡（D-PREF / D2）：展示当前新轨态，点击「回到旧版」调用
 *   `useNextTrackStore.setTrack('legacy', 'settings_profile')` 持久化用户级偏好
 *   （localStorage `aiproj-next-track`，按设备）并跳转旧轨 `/settings/profile`——
 *   与旧轨 Topbar「进入新页面」按钮共用同一契约，语义对等（用户级、按设备、
 *   绝不自动重定向）；
 * - 「退出登录」：新版顶栏没有用户菜单，这里是新版的退出入口（与旧轨用户菜单同一实现）；
 * - 旧轨「界面文字变体切换器（简/繁/港）」**不迁移**（Non-Goal 2：多语言属明确
 *   不做清单，新轨简体中文原生）；
 * - 会话未水合前渲染骨架屏（`aria-busy="true"`），未登录态由壳层守卫接管。
 */

/** 组织角色 → 中文标签（与 `organization_members.role` 取值对齐，旧轨 `ORG_ROLE_LABELS` 同源）。 */
const ORG_ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

/** 组织角色标签解析（未知取值原样回显，绝不猜测语义）。 */
export function resolveOrgRoleLabel(role: string): string {
  return ORG_ROLE_LABELS[role] ?? role
}

/** 由会话身份派生展示用缩写（优先服务端回传，退化到姓名/邮箱首字）。 */
export function resolveProfileInitials(
  user: Pick<
    NonNullable<ReturnType<typeof useAuthStore.getState>['user']>,
    'initials' | 'fullName' | 'email'
  >,
): string {
  if (user.initials) return user.initials
  if (user.fullName) return user.fullName.slice(0, 2).toUpperCase()
  return user.email.slice(0, 2).toUpperCase()
}

export function ProfileWorkspace() {
  const router = useRouter()
  const tier = useImmersionTier()
  const user = useAuthStore((state) => state.user)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const planTier = useAuthStore(selectPlanTier)
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const setTrack = useNextTrackStore((state) => state.setTrack)
  const [signingOut, setSigningOut] = React.useState(false)

  const precise = tier === 'precise'

  // 会话水合前：几何匹配骨架屏，绝不对未恢复的会话态下结论（零业务请求）。
  if (!hasHydrated) {
    return <ProfileSkeleton precise={precise} />
  }

  // 未登录：中性提示（正常路径由壳层守卫接管，此处为渲染安全网）。
  if (!user) {
    return (
      <div
        data-profile-unauthenticated
        role="status"
        className={cn(
          'flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-[var(--nx-border-hairline)] p-8 text-center',
          precise ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
        )}
      >
        <UserIcon className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">请先登录</h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          登录后即可查看你的账号身份与所属组织。
        </p>
      </div>
    )
  }

  const displayName = user.fullName?.trim() || user.email
  const isPersonal = isSaasPersonalWorkspace(planTier) && !user.isSuperAdmin

  /** 退出登录：清会话后由新轨登录守卫带回登录页。 */
  async function handleSignOut() {
    setSigningOut(true)
    await signOutSession()
    router.replace('/next-login')
  }

  /** 「回到旧版」：偏好持久化 + 显式跳转旧轨（绝不自动重定向，D2/D-PREF）。 */
  function handleBackToLegacy() {
    setTrack('legacy', 'settings_profile')
    router.push('/settings/profile')
  }

  return (
    <div
      data-profile-workspace
      data-immersion={tier}
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        precise ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <UserIcon className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1
              data-profile-title
              className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              个人资料
            </h1>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
              {isPersonal ? '管理个人账号与界面偏好' : '查看你的账户身份与所属组织'}
            </p>
          </div>
        </div>
      </header>

      {/* 只读身份卡 */}
      <section
        data-profile-identity
        aria-labelledby="profile-identity-title"
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <h2 id="profile-identity-title" className="sr-only">
          账号身份
        </h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span
            data-profile-initials
            aria-hidden
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)] text-lg font-medium text-[var(--nx-accent)]"
          >
            {resolveProfileInitials(user)}
          </span>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-base font-semibold text-[var(--nx-text-primary)]">
                {displayName}
              </span>
              {user.isSuperAdmin ? (
                <span
                  data-profile-super-admin-badge
                  className="rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-accent)]"
                >
                  系统管理员
                </span>
              ) : null}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-[var(--nx-text-secondary)]">
              <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
              <span data-profile-email className="truncate">
                {user.email}
              </span>
            </p>
            {isPersonal ? (
              <p
                data-profile-personal-edition
                className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
              >
                个人空间：项目、任务、WBS、甘特图、报表与 AI
                草案等能力可用；不适用的企业管理入口会自动隐藏。
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* 所属组织列表 */}
      <section
        data-profile-organizations
        aria-labelledby="profile-organizations-title"
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <h2
          id="profile-organizations-title"
          className="flex items-center gap-2 text-sm font-medium text-[var(--nx-text-primary)]"
        >
          <Sparkles className="h-4 w-4 text-[var(--nx-text-muted)]" aria-hidden />
          所属组织
        </h2>
        {user.organizations.length === 0 ? (
          <p
            data-profile-organizations-empty
            className="mt-3 text-xs leading-relaxed text-[var(--nx-text-muted)]"
          >
            尚未加入任何组织。
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--nx-border-hairline)]">
            {user.organizations.map((organization: AuthOrganization) => (
              <li
                key={organization.id}
                data-profile-organization={organization.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--nx-text-primary)]">
                    {organization.name}
                  </p>
                  <p className="truncate font-mono text-[11px] text-[var(--nx-text-muted)]">
                    {organization.slug}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {organization.id === currentOrganizationId ? (
                    <span
                      data-profile-organization-current={organization.id}
                      className="rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-accent)]"
                    >
                      当前
                    </span>
                  ) : null}
                  <span
                    data-profile-organization-role={organization.id}
                    className="rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-text-secondary)]"
                  >
                    {resolveOrgRoleLabel(organization.role)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 账号安全快捷入口 */}
      <Link
        data-profile-two-factor-entry
        href="/next/settings/security/two-factor"
        className={cn(
          'group flex items-center justify-between gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4',
          'hover:border-[var(--nx-border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
          !precise && 'transition-colors',
        )}
      >
        <span className="min-w-0 space-y-1">
          <span className="flex items-center gap-2 text-sm font-medium text-[var(--nx-text-primary)]">
            <ShieldCheck className="h-4 w-4 text-[var(--nx-text-muted)]" aria-hidden />
            两步验证
          </span>
          <span className="block text-xs leading-relaxed text-[var(--nx-text-secondary)]">
            用认证器应用为登录再加一道验证。即使密码泄露，别人也进不来。
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
      </Link>

      {/* 界面呈现偏好卡（D-PREF / D2：与旧轨 Topbar 共用 aiproj-next-track 契约） */}
      <section
        id="interface-presentation"
        data-profile-presentation-card
        aria-labelledby="profile-presentation-title"
        className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2
              id="profile-presentation-title"
              className="flex items-center gap-2 text-sm font-medium text-[var(--nx-text-primary)]"
            >
              <Palette className="h-4 w-4 text-[var(--nx-text-muted)]" aria-hidden />
              界面呈现
            </h2>
            <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
              当前正在使用新页面（沉浸式工作台）。该选择是你本人的用户级偏好，保存在本机浏览器 （
              <span className="font-mono text-[11px]">aiproj-next-track</span>），不会自动跳转。
            </p>
          </div>
          <span
            data-profile-track-state="next"
            className="shrink-0 rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2 py-0.5 text-[10px] leading-none text-[var(--nx-accent)]"
          >
            新页面生效中
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-profile-back-to-legacy
            onClick={handleBackToLegacy}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-xs text-[var(--nx-text-secondary)]',
              'hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
              !precise && 'transition-colors',
            )}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
            回到旧版
          </button>
          <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            回到旧版后，旧版导航不再出现新页面入口；你随时可以在旧版顶栏重新进入新页面。
          </p>
        </div>
      </section>

      {/* 退出登录（新版顶栏没有用户菜单，这里是新版的退出入口） */}
      <section
        id="sign-out"
        data-profile-sign-out
        aria-labelledby="profile-sign-out-title"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <div className="min-w-0 space-y-1">
          <h2
            id="profile-sign-out-title"
            className="flex items-center gap-2 text-sm font-medium text-[var(--nx-text-primary)]"
          >
            <LogOut className="h-4 w-4 text-[var(--nx-text-muted)]" aria-hidden />
            退出登录
          </h2>
          <p className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
            退出当前账号，并清除本机的登录状态与离线缓存。也可以直接对 AI 同事说「帮我退出登录」。
          </p>
        </div>
        <button
          type="button"
          data-profile-sign-out-button
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 text-xs text-[var(--nx-text-secondary)]',
            'hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)] disabled:opacity-60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
            !precise && 'transition-colors',
          )}
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          {signingOut ? '正在退出…' : '退出登录'}
        </button>
      </section>
    </div>
  )
}

/** 会话水合前骨架屏（几何匹配，`aria-busy`，零数据请求）。 */
function ProfileSkeleton({ precise }: { precise: boolean }) {
  return (
    <div
      data-profile-skeleton
      role="status"
      aria-label="正在加载个人资料"
      aria-busy="true"
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        precise ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      <div className="h-9 w-56 rounded-md bg-[var(--nx-bg-1)]" aria-hidden />
      <div
        className="h-24 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        aria-hidden
      />
      <div
        className="h-32 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        aria-hidden
      />
      <div
        className="h-16 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
        aria-hidden
      />
    </div>
  )
}

export default ProfileWorkspace
