/**
 * PluginCommandHostBridge.tsx —— 生产 PluginCommandHostProvider 挂载桥（任务 3.3）。
 *
 * - dashboard shell 内唯一挂载点：auth/tenant 就绪后启用快照查询
 * - 单一 HttpPluginSnapshotSource 实例（组织感知，TanStack Query 缓存）
 * - 未认证 / 组织未解析 → 不发请求、不注册任何插件命令（零行为变化）
 * - selectionEpoch 作为 sessionId：组织切换后强制重新拉取并全量同步 owner
 *
 * 本组件只做装配，不渲染 UI；插件不得绕过此 provider 直连 store。
 */
'use client'

import * as React from 'react'
import {
  PluginCommandHostProvider,
  usePluginCommandHost,
} from '@/lib/command-registry/plugin-command-host'
import { HttpPluginSnapshotSource } from '@/lib/command-registry/plugin-http-snapshot-source'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'

/** 快照同步副作用组件（无渲染输出）。 */
function PluginCommandHostSync(props: {
  enabled: boolean
  organizationId: string
  actorId: string
  sessionId: string
}) {
  usePluginCommandHost({
    organizationId: props.organizationId,
    projectId: undefined,
    actorId: props.actorId,
    sessionId: props.sessionId,
    enabled: props.enabled,
  })
  return null
}

export function PluginCommandHostBridge({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const organizationId = useAuthStore(selectEffectiveOrganizationId)
  const selectionEpoch = useAuthStore((s) => s.selectionEpoch)

  // 单一 source 实例：跨渲染稳定，避免 QueryClient 语义漂移
  const source = React.useMemo(() => new HttpPluginSnapshotSource(), [])

  const enabled = isAuthenticated && organizationId != null

  return (
    <PluginCommandHostProvider source={source}>
      <PluginCommandHostSync
        enabled={enabled}
        organizationId={organizationId != null ? String(organizationId) : ''}
        actorId={user?.id != null ? String(user.id) : ''}
        sessionId={String(selectionEpoch)}
      />
      {children}
    </PluginCommandHostProvider>
  )
}
