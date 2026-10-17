'use client'

import * as React from 'react'
import { ShieldAlert } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { AiConnectionsWorkspace } from '@/components/next/settings/ai/AiConnectionsWorkspace'

/**
 * AI 模型连接管理页入口（/next/settings/ai-connections，
 * v3-ui-next-settings-admin-domains W5 · tasks 5.10，spec「AI 模型连接与用量」）。
 *
 * - 准入 `ai:connection:manage`（体验层守卫；后端路由 permissions `ai:connection:manage` 为最终边界）：
 *   无权限时渲染受限横幅，工作区不挂载，底层 `/ai/connections` 接口零请求（RL-06）；
 * - 个人版默认不签发 `ai:connection:manage`（平台统一 AI 配置），此时横幅改为说明
 *   「由平台统一配置，无需填写 API key」，而不是权限不足；
 * - API Key 密码态输入与服务端加密存储，前端永不明文回显；
 * - 挂载 AI 模型连接工作区（CRUD + 连通性测试 + 删除二次确认）。
 */
export function NextSettingsAiConnectionsPage() {
  // 平台统一 AI 配置（私有 SaaS）：个人版用户无连接管理权时说明「由平台统一配置」；
  // 开源个人版没有平台统一配置，使用者自带 AI Key，只保留普通的权限不足提示。
  const fallbacks: { platformManaged?: React.ReactNode } = {}

  return (
    <PermissionGuard
      require="ai:connection:manage"
      fallback={
        fallbacks.platformManaged ?? (
          <div
            data-permission-fallback
            className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
          >
            <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
            <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
              没有 AI 连接管理权限
            </h3>
            <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
              管理 AI 模型网关连接需要 ai:connection:manage 权限。请联系组织管理员为你授权。
            </p>
          </div>
        )
      }
    >
      <AiConnectionsWorkspace />
    </PermissionGuard>
  )
}

export default NextSettingsAiConnectionsPage
