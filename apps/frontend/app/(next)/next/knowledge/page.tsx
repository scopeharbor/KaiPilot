'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { KnowledgeOperationsView } from '@/components/knowledge/operating/KnowledgeOperationsView'
import { usePermissions } from '@/hooks/use-permissions'
import { KnowledgeWorkspace } from '@/components/next/knowledge/KnowledgeWorkspace'

/**
 * 四层知识库新轨工作台路由（/next/knowledge，
 * v3-ui-next-help-knowledge-domain W2 · tasks 2.7）。
 *
 * - 准入守卫（RL-06 零业务请求）：无 knowledge:view 渲染受限 EmptyState「无权限访问
 *   知识库」，底册/抽屉一律不挂载、零外发；
 * - URL 参数 `?view=operations` 且具备 knowledge_memory_operating:view 时，无缝切换
 *   渲染既有运营层视图 `KnowledgeOperationsView`（双入口 100% 复用，零逻辑分叉），
 *   并提供「返回四层知识浏览」出口；无该权限时参数视为无效回落底册（切换按钮在
 *   工作台内本就按权限隐藏）；
 * - 写入口（新建 knowledge:author / 治理 knowledge:manage）由工作台与抽屉按权限
 *   物理隐藏，后端策略为最终边界。
 */
export default function KnowledgePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = usePermissions()

  const isOperations = searchParams.get('view') === 'operations'
  const canViewKnowledge = can('knowledge:view')
  const canViewOperating = can('knowledge_memory_operating:view')

  if (isOperations && canViewOperating) {
    return (
      <div data-knowledge-operations-mode className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            知识与记忆运营透视（只读）· 别名路由 /next/knowledge/operations 等价承载
          </p>
          <button
            type="button"
            data-knowledge-operations-back
            onClick={() => router.replace('/next/knowledge')}
            className="flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            返回四层知识浏览
          </button>
        </div>
        <KnowledgeOperationsView />
      </div>
    )
  }

  if (!canViewKnowledge) {
    return (
      <div
        data-knowledge-permission-fallback
        className="flex flex-col items-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] px-8 py-14 text-center"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--nx-status-warning)]" aria-hidden />
        <h3 className="text-base font-medium text-[var(--nx-text-primary)]">无权限访问知识库</h3>
        <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
          需要 knowledge:view 权限方可查看四层知识底座。请联系组织管理员授予权限。
        </p>
      </div>
    )
  }

  return <KnowledgeWorkspace />
}
