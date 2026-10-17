'use client'

import { Sparkles } from 'lucide-react'
import { getRoleHomeConfig, ROLE_BUCKET_LABELS, type RoleBucket } from '@/lib/next/role-bucket'

interface RoleWelcomeBannerProps {
  bucket: RoleBucket
  /** 登录用户全名（低敏）；未识别 / 未登录时为 null。 */
  userName?: string | null
  /** 当前组织名（低敏展示标识）；未解析到时为 null。 */
  organizationName?: string | null
}

/**
 * 角色化欢迎横幅（v3-ui-next-shell-space-map D6 / tasks 3.6）。
 *
 * 按四桶视角渲染差异化问候语、视角定位徽标与组织低敏标识；纯展示组件，
 * 零后端接口调用（RL-01 / RL-06）。
 */
export function RoleWelcomeBanner({ bucket, userName, organizationName }: RoleWelcomeBannerProps) {
  const config = getRoleHomeConfig(bucket)
  return (
    <section
      data-role-welcome-banner
      data-role-bucket={bucket}
      className="relative z-[1] flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2.5 py-1 text-xs font-medium text-[var(--nx-text-secondary)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--nx-ai)]" aria-hidden />
          {ROLE_BUCKET_LABELS[bucket]}视角
        </span>
        {organizationName ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-1 text-xs text-[var(--nx-text-muted)]">
            当前工作区 · {organizationName}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-[var(--nx-text-secondary)]">
        {userName ? `你好，${userName}` : '欢迎回来'}
      </p>
      <h1 className="text-2xl font-semibold leading-snug tracking-[0.02em] text-[var(--nx-text-primary)] md:text-3xl">
        {config.title}
      </h1>
      <p className="max-w-xl text-sm leading-6 text-[var(--nx-text-muted)]">{config.subtitle}</p>
    </section>
  )
}
