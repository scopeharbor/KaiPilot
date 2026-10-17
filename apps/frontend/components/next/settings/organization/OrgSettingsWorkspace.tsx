'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Building2, RefreshCw, ShieldAlert, Users } from 'lucide-react'
import { membersApi, organizationsApi } from '@/lib/api-client'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import { OrgDangerZone } from './OrgDangerZone'
import { OrgMembersPanel } from './OrgMembersPanel'
import { OrgProfileForm, orgProfileKey } from './OrgProfileForm'
import { orgMembersQueryKey } from './org-member-helpers'

/**
 * 组织设置工作区（v3-ui-next-settings-admin-domains W2 · tasks 2.5，
 * spec「组织设置与成员治理」/ design D-ORG「组织隔离呈现」）。
 *
 * - **只使用当前会话组织**：`organizationId` 由页面从 `selectEffectiveOrganizationId`
 *   传入，本工作区不接受任何路径段/查询参数形式的组织 ID（RL-05，无跨租户探测面）；
 * - 组合三区：组织资料表单（`OrgProfileForm`）/ 成员底册与治理（`OrgMembersPanel`）/
 *   危险操作区（`OrgDangerZone`），三区共享同一组织上下文与查询缓存；
 * - 三态闭环：组织详情骨架（几何同构）/ 错误重试卡（触发既有 refetch）/ 成员区
 *   自带骨架与空态；跨组织或不存在组织由后端统一 404 中性掩蔽，页面只呈中性文案；
 * - 精确档（`precise`）剥离空间层氛围光晕，降级为 1px 发丝线纯色面板（RL-15）。
 */

export interface OrgSettingsWorkspaceProps {
  /** 当前会话组织 ID（唯一组织事实来源，页面负责解析）。 */
  organizationId: number
}

export function OrgSettingsWorkspace({ organizationId }: OrgSettingsWorkspaceProps) {
  const tier = useImmersionTier()

  const organizationQuery = useQuery({
    queryKey: orgProfileKey(organizationId),
    queryFn: () => organizationsApi.get(organizationId),
  })

  // 成员底册由危险区（转让候选）与成员面板共用：同一 query key 命中同一份缓存，
  // 危险区不会因为多挂一个消费者而多发一次请求。组织未就绪前不请求（RL-06）。
  const membersQuery = useQuery({
    queryKey: orgMembersQueryKey(organizationId),
    queryFn: () => membersApi.list(organizationId),
    enabled: organizationQuery.isSuccess,
  })

  return (
    <div
      data-org-settings-workspace
      data-org-id={organizationId}
      data-immersion={tier}
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-workspace-surface)]',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Building2 className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-[var(--nx-text-primary)]">
              组织设置
            </h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              当前会话组织资料、成员治理与高风险操作；组织切换请使用账户级入口。
            </p>
          </div>
        </div>
        <Link
          href="/next/settings"
          data-org-settings-back-to-settings
          className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
        >
          返回设置空间
        </Link>
      </header>

      {organizationQuery.isPending ? (
        <OrgSettingsSkeleton />
      ) : organizationQuery.isError ? (
        <OrgSettingsError
          message="组织信息加载失败"
          onRetry={() => void organizationQuery.refetch()}
        />
      ) : (
        <>
          <OrgProfileForm organization={organizationQuery.data} />

          <section
            data-org-settings-summary
            className="grid grid-cols-2 gap-3 lg:max-w-md"
            aria-label="组织概况"
          >
            <div className="flex items-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3">
              <Users className="h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                  组织成员
                </p>
                <p
                  data-org-settings-member-count
                  className="truncate text-base font-semibold text-[var(--nx-text-primary)]"
                >
                  {membersQuery.data
                    ? organizationQuery.data?.maxMembers
                      ? `${membersQuery.data.length} / ${organizationQuery.data.maxMembers} 人`
                      : `共 ${membersQuery.data.length} 人`
                    : '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3">
              <Building2 className="h-4 w-4 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
                  组织标识
                </p>
                <p
                  data-org-settings-slug
                  className="truncate font-mono text-base font-semibold text-[var(--nx-text-primary)]"
                >
                  {organizationQuery.data.slug}
                </p>
              </div>
            </div>
          </section>

          <OrgMembersPanel organizationId={organizationId} />

          <OrgDangerZone organization={organizationQuery.data} members={membersQuery.data ?? []} />
        </>
      )}
    </div>
  )
}

/** 组织设置加载骨架（与组织信息 + 成员底册几何同构）。 */
export function OrgSettingsSkeleton() {
  return (
    <div
      data-org-settings-skeleton
      role="status"
      aria-busy="true"
      aria-label="正在加载组织设置"
      className="flex flex-col gap-4"
    >
      <div className="h-40 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
      <div className="grid grid-cols-2 gap-3 lg:max-w-md">
        <div className="h-16 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
        <div className="h-16 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
    </div>
  )
}

/** 组织信息错误重试卡（触发既有 TanStack Query refetch，中性文案）。 */
export function OrgSettingsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      data-org-settings-error
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-6 py-12 text-center"
    >
      <ShieldAlert className="h-7 w-7 text-[var(--nx-status-warning)]" aria-hidden />
      <p className="text-sm text-[var(--nx-text-secondary)]">{message}</p>
      <button
        type="button"
        data-org-settings-retry
        onClick={onRetry}
        className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        重新载入
      </button>
    </div>
  )
}

export default OrgSettingsWorkspace
