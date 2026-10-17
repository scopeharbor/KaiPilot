'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import type {
  PortfolioTrafficLightItem,
  PortfolioTrafficLightSortKey,
  TrafficLightStatus,
} from '@aiproj/types'
import { PmoTrafficLightCountsCard } from './PmoTrafficLightCountsCard'
import { PmoTrafficLightTable } from './PmoTrafficLightTable'
import { PmoTrafficLightReviewModal } from './PmoTrafficLightReviewModal'

/**
 * PMO 红绿灯报告工作台容器（v3-ui-next-pmo-domain W2 · tasks 2.1）。
 *
 * - 页头「← 返回角色首页」（/next）动线（Decision 2 组织层统一回退）；
 * - 集成：四色计数卡（可点选即状态筛选）+ 过滤工具栏（状态/排序/顺序/分页）
 *   + 高密度表格 + 复核弹窗状态管理（reviewTarget）；
 * - 复核写入口仅对 `portfolio:manage` 用户呈现（Decision 5 门禁矩阵），
 *   其余用户全程零写请求（RL-01/RL-06）；
 * - 视觉按 D18 Layer 2 暗黑仪器感执行，precise 档剥离空间氛围光晕
 *   （Decision 7 / useImmersionTier）。
 */

export function PmoTrafficLightWorkspace() {
  const router = useRouter()
  const tier = useImmersionTier()
  const { canAny } = usePermissions()
  const canReview = canAny(['portfolio:manage'])

  // 列表查询受控状态（镜像旧页默认：交通灯降序、每页 20）
  const [filterStatus, setFilterStatus] = React.useState<TrafficLightStatus | null>(null)
  const [sort, setSort] = React.useState<PortfolioTrafficLightSortKey>('traffic_light')
  const [order, setOrder] = React.useState<'asc' | 'desc'>('desc')
  const [page, setPage] = React.useState(1)
  const [reviewTarget, setReviewTarget] = React.useState<PortfolioTrafficLightItem | null>(null)

  const handleStatusChange = React.useCallback((status: TrafficLightStatus | null) => {
    setFilterStatus(status)
    setPage(1)
  }, [])
  const handleSortChange = React.useCallback((nextSort: PortfolioTrafficLightSortKey) => {
    setSort(nextSort)
    setPage(1)
  }, [])
  const handleOrderToggle = React.useCallback(() => {
    setOrder((current) => (current === 'desc' ? 'asc' : 'desc'))
    setPage(1)
  }, [])
  const handlePageChange = React.useCallback((nextPage: number) => {
    setPage(nextPage)
  }, [])
  const handleBackHome = React.useCallback(() => {
    router.push('/next')
  }, [router])
  const handleOpenProject = React.useCallback(
    (projectId: number) => {
      router.push(`/next/projects/${projectId}`)
    },
    [router],
  )

  return (
    <div
      data-pmo-traffic-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头：返回角色首页 + 标题 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-pmo-back-home
            aria-label="返回角色首页"
            onClick={handleBackHome}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
          <span aria-hidden className="h-6 w-px bg-[var(--nx-border-hairline)]" />
          <div className="min-w-0">
            <h2
              data-pmo-traffic-title
              className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              PMO 红绿灯报告
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
              组合项目交通灯快照 · 规则评分与人工复核
            </p>
          </div>
        </div>
      </header>

      {/* 四色计数卡（点击即状态筛选） */}
      <PmoTrafficLightCountsCard active={filterStatus} onSelect={handleStatusChange} />

      {/* 高密度列表（含过滤工具栏/三态/分页） */}
      <PmoTrafficLightTable
        filterStatus={filterStatus}
        onFilterStatusChange={handleStatusChange}
        sort={sort}
        onSortChange={handleSortChange}
        order={order}
        onOrderToggle={handleOrderToggle}
        page={page}
        onPageChange={handlePageChange}
        canReview={canReview}
        onReview={setReviewTarget}
        onOpenProject={handleOpenProject}
        onBackHome={handleBackHome}
      />

      {/* 人工复核弹窗（仅 manage 入口打开；零自动提交路径） */}
      {reviewTarget ? (
        <PmoTrafficLightReviewModal item={reviewTarget} onClose={() => setReviewTarget(null)} />
      ) : null}
    </div>
  )
}

export default PmoTrafficLightWorkspace
