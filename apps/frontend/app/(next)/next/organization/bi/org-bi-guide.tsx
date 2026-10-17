'use client'

import { Building2, ShieldAlert } from 'lucide-react'

/**
 * 组织 BI 三页共用引导/受限态（v3-ui-next-org-portfolio-domains W3 域内私有）。
 *
 * - OrgBiPermissionFallback：无 `org:view`/`portfolio:view` 任一权限的受限横幅
 *   （data-permission-fallback 与项目级页面守卫同探针契约）——受限渲染时工作台
 *   不挂载，底层数据接口零请求（RL-06）；
 * - OrgBiGuideState：未选择组织（auth store 无有效租户上下文）时的中性引导态，
 *   零数据请求。
 */

export function OrgBiPermissionFallback({ domainLabel }: { domainLabel: string }) {
  return (
    <div
      data-permission-fallback
      className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
    >
      <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
        你没有查看{domainLabel}的权限
      </h3>
      <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
        请联系组织管理员授予 org:view 或 portfolio:view 权限。
      </p>
    </div>
  )
}

export function OrgBiGuideState({ domainLabel }: { domainLabel: string }) {
  return (
    <div
      data-org-guide-state
      className="flex flex-col items-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
    >
      <Building2 className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
      <p className="text-sm font-medium text-[var(--nx-text-primary)]">请先选择组织</p>
      <p className="max-w-sm text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
        组织级{domainLabel}数据来自当前租户上下文。请先从右上角切换或选择组织后再访问本页。
      </p>
    </div>
  )
}
