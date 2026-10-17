'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Database, LayoutDashboard, Plus } from 'lucide-react'
import { knowledgeApi } from '@/lib/api/knowledge'
import { KNOWLEDGE_QUERY_KEYS } from '@/hooks/use-knowledge'
import { usePermissions } from '@/hooks/use-permissions'
import type { KnowledgeItemLowSensitiveProjection } from '@aiproj/types'
import { KnowledgeListTable } from './KnowledgeListTable'
import { KnowledgeCreateDrawer, KnowledgeReviewDrawer } from './KnowledgeManageDrawers'
import { resolveErrorMessage } from './KnowledgeManageDrawers'

/**
 * 四层知识库主工作台骨架（v3-ui-next-help-knowledge-domain W2 · tasks 2.7，
 * spec「四层知识库底册表格浏览与多维过滤」/「知识库记录新建、编辑与生命周期受控治理」）。
 *
 * - 底册数据 100% 复用既有端点 GET /api/v1/knowledge（knowledgeApi.list，{data,meta}
 *   信封）：因端点语义「status 未指定 = 仅 active」，为支持本地多维治理筛选
 *   （draft/pending/deprecated/outdated 可见、层级/状态多选收敛），按五生命周期状态
 *   各遍历一次（perPage 100 上限内翻页）并集去重成治理账本——所有请求参数均为合法
 *   枚举值，重置筛选只清本地态，绝不向后端发送空串；
 * - 账本查询键挂在既有 KNOWLEDGE_QUERY_KEYS.list 前缀下，新建/确认/推进 mutation
 *   的 ['knowledge','list'] 失效自动联动刷新（RL-04 缓存一致性）；
 * - 顶部操作区：运营视图切换按钮（knowledge_memory_operating:view 才渲染，切到
 *   ?view=operations 由路由页接管）与新建知识按钮（knowledge:author 才渲染，RL-06
 *   物理隐藏）；无写权限只读浏览；
 * - 点击行打开审查治理抽屉（knowledge:manage 门禁在抽屉内二次守卫）；
 * - 加载骨架 / 空态 / 错误重试三态由 KnowledgeListTable 闭环。
 */
export function KnowledgeWorkspace() {
  const router = useRouter()
  const { can } = usePermissions()
  const canAuthor = can('knowledge:author')
  const canManage = can('knowledge:manage')
  const canViewOperating = can('knowledge_memory_operating:view')

  const [createOpen, setCreateOpen] = React.useState(false)
  const [reviewId, setReviewId] = React.useState<number | null>(null)

  const {
    data: ledger,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: KNOWLEDGE_QUERY_KEYS.list({ mode: 'next-workspace-ledger' }),
    queryFn: fetchKnowledgeLedger,
  })

  const items = ledger ?? []

  return (
    <div
      data-knowledge-workspace
      aria-busy={isLoading || isFetching}
      className="flex flex-col gap-4"
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <Database className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">知识库</h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              四层知识底座：L1 规范 · L2 观察 · L3 合成（仅 Eval）· L4 现实 —— AI
              编译器执行与模型评测的知识基石
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canViewOperating ? (
            <button
              type="button"
              data-knowledge-operations-toggle
              aria-label="切换至知识与记忆运营视图"
              onClick={() => router.replace('/next/knowledge?view=operations')}
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
            >
              <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
              运营视图
            </button>
          ) : null}
          {canAuthor ? (
            <button
              type="button"
              data-knowledge-create-open
              onClick={() => setCreateOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建知识
            </button>
          ) : null}
        </div>
      </header>

      {/* 四层底册 + 多维检索 */}
      <KnowledgeListTable
        items={items}
        isLoading={isLoading}
        isError={isError}
        errorMessage={error ? resolveErrorMessage(error, '') || null : null}
        onRetry={() => void refetch()}
        canManage={canManage}
        canAuthor={canAuthor}
        onOpenReview={(knowledgeId) => setReviewId(knowledgeId)}
        onRequestCreate={() => setCreateOpen(true)}
      />

      {/* 新建抽屉（knowledge:author 已由按钮隐藏守卫；抽屉内 Zod 校验 + 二次确认） */}
      <KnowledgeCreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* 审查治理抽屉（knowledge:manage 操作在抽屉内守卫） */}
      <KnowledgeReviewDrawer
        knowledgeId={reviewId}
        open={reviewId !== null}
        onClose={() => setReviewId(null)}
      />
    </div>
  )
}

/**
 * 治理账本拉取：五生命周期状态并集 + 分页遍历去重。
 *
 * 端点契约（api-contract 冻结点）：GET /api/v1/knowledge 未指定 status 时只返回
 * active；显式传合法枚举可查治理视图（validator 拒绝空串/非法枚举）。此处显式传
 * 五状态枚举，永不出现空串查询参数；每请求 perPage=100（服务端上限），按
 * meta.totalPages 翻页，账本上限 2000 条防失控。
 */
export async function fetchKnowledgeLedger(): Promise<KnowledgeItemLowSensitiveProjection[]> {
  const statuses = ['draft', 'pending', 'active', 'deprecated', 'outdated'] as const
  const merged = new Map<number, KnowledgeItemLowSensitiveProjection>()
  await Promise.all(
    statuses.map(async (status) => {
      let page = 1
      let totalPages = 1
      while (page <= totalPages) {
        const envelope = await knowledgeApi.list({ status, page, perPage: 100 })
        const rows = envelope?.data ?? []
        for (const item of rows) merged.set(item.id, item)
        const meta = envelope?.meta
        totalPages = meta?.totalPages ?? Math.max(1, Math.ceil((meta?.total ?? rows.length) / 100))
        page += 1
        if (merged.size >= 2000) return
      }
    }),
  )
  return Array.from(merged.values()).sort((a, b) => {
    const at = new Date(a.updatedAt).getTime()
    const bt = new Date(b.updatedAt).getTime()
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0
    if (Number.isNaN(at)) return 1
    if (Number.isNaN(bt)) return -1
    return bt - at
  })
}

export default KnowledgeWorkspace
