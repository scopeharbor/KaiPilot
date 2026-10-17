'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { KnowledgeOperationsView } from '@/components/knowledge/operating/KnowledgeOperationsView'
import { usePermissions } from '@/hooks/use-permissions'

/**
 * 知识库运营视图别名路由（/next/knowledge/operations，
 * v3-ui-next-help-knowledge-domain W2 · tasks 2.7）。
 *
 * - 与主路由 `?view=operations` 双入口 100% 渲染同一个 `KnowledgeOperationsView`，
 *   零代码分叉（既有运营层组件自带 permission/feature-flag 守卫）；
 * - 无 knowledge_memory_operating:view 时渲染受限警告卡片并引导返回四层知识浏览
 *   （RBAC 矩阵口径；本页不挂载运营视图、零业务请求）。
 */
export default function KnowledgeOperationsAliasPage() {
  const router = useRouter()
  const { can } = usePermissions()

  if (!can('knowledge_memory_operating:view')) {
    return (
      <div
        data-knowledge-operations-permission-fallback
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">
          无权限访问知识库运营视图
        </h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          需要 knowledge_memory_operating:view 权限方可查看知识与记忆运营透视。
        </p>
        <button
          type="button"
          data-knowledge-operations-back-to-browse
          onClick={() => router.push('/next/knowledge')}
          className="flex h-9 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
        >
          返回四层知识浏览
        </button>
      </div>
    )
  }

  return <KnowledgeOperationsView />
}
