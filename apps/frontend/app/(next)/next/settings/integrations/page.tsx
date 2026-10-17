'use client'

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { IntegrationsWorkspace } from '@/components/next/settings/integrations/IntegrationsWorkspace'

/**
 * 第三方集成管理页入口（/next/settings/integrations，
 * v3-ui-next-settings-admin-domains W5 · tasks 5.10，spec「第三方集成与回调契约」）。
 *
 * - 准入 `integration:connect`（体验层守卫；后端 routes permissions 为最终边界）：
 *   无权限时渲染受限横幅，工作区不挂载，底层 `/integrations` 接口零请求（RL-06）；
 * - 诚实披露仅校验回调链路、不交换 token；
 * - 挂载集成工作区（GitHub/GitLab/日历等预连接 + 断开二次确认 + focusCategory 聚焦）。
 */
export function NextSettingsIntegrationsPage() {
  return (
    <PermissionGuard
      require="integration:connect"
      fallback={
        <div
          data-permission-fallback
          className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
        >
          <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
            没有第三方集成管理权限
          </h3>
          <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
            配置第三方 OAuth 集成连接需要 integration:connect 权限。请联系组织管理员为你授权。
          </p>
        </div>
      }
    >
      <IntegrationsWorkspace />
    </PermissionGuard>
  )
}

export default NextSettingsIntegrationsPage
