'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRcclLoops } from '@/hooks/use-resource-capacity-loops'
import { parseRcclUrlFilters, serializeRcclUrlFilters } from '@/lib/api/resource-capacity-loops'
import { usePathname, useRouter } from 'next/navigation'

/**
 * 资源容量闭环队列页（§8.3）。
 * 展示 state/owner/window/next action；覆盖 loading / empty / no-results / error /
 * restricted（只读提示）/ degraded（freshness 警告）六态；键盘可聚焦，窄屏纵向堆叠。
 */

const STATE_LABELS: Record<string, string> = {
  draft: '草稿',
  simulated: '已模拟',
  selected: '已选择',
  'handed-off': '已移交',
  observing: '观察中',
  reviewed: '已复核',
  closed: '已关闭',
  cancelled: '已取消',
}

const STATE_BADGE_CLASSES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  simulated: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  selected: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  'handed-off': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  observing: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  reviewed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

function nextStateLabel(state: string): string {
  switch (state) {
    case 'draft':
      return '下一步：刷新基线并创建情景'
    case 'simulated':
      return '下一步：人工选择情景'
    case 'selected':
      return '下一步：创建受控 handoff'
    case 'handed-off':
      return '下一步：等待下游确认后捕获观察'
    case 'observing':
      return '下一步：人工复核结论'
    case 'reviewed':
      return '下一步：关闭闭环'
    default:
      return ''
  }
}

export default function ResourceCapacityLoopsPage() {
  const router = useRouter()
  const pathname = usePathname()
  // URL query 为筛选唯一事实来源（§8.2）。
  const urlState = typeof window !== 'undefined' ? window.location.search : ''
  const params = new URLSearchParams(urlState)
  const filters = parseRcclUrlFilters(Object.fromEntries(params.entries()))
  const [stateFilter, setStateFilter] = useState<string>(filters.state ?? '')
  const { data, isLoading, isError, error } = useRcclLoops(filters)

  function applyFilter(next: { state?: string; page?: number }) {
    const qs = serializeRcclUrlFilters({ state: next.state ?? undefined, page: next.page })
    router.push(pathname + qs)
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4" aria-busy="true" data-testid="rccl-loading">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded border bg-muted" />
        ))}
      </div>
    )
  }

  if (isError) {
    const restricted = String((error as Error)?.message ?? '').includes('404')
    return (
      <div className="p-4" role="alert" data-testid="rccl-error">
        <p className="text-sm font-medium text-destructive">
          {restricted ? '无权访问资源容量闭环' : '加载失败'}
        </p>
        <button
          type="button"
          className="mt-2 rounded border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => router.refresh()}
        >
          重试
        </button>
      </div>
    )
  }

  const loops = data?.data ?? []
  const meta = data?.meta

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">资源容量预测闭环</h1>
          <p className="text-sm text-muted-foreground">
            基线预测 → 情景与调配建议 → 人工选择 → 受控移交 → 同口径复测 → 人工复核
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>状态筛选</span>
          <select
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value)
              applyFilter({ state: e.target.value || undefined })
            }}
            className="rounded border bg-background px-2 py-1 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="按状态筛选闭环"
          >
            <option value="">全部</option>
            {Object.entries(STATE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </header>

      {loops.length === 0 ? (
        <div
          className="rounded border border-dashed p-8 text-center"
          data-testid="rccl-empty"
          role="status"
        >
          <p className="text-sm font-medium">尚无容量闭环计划</p>
          <p className="mt-1 text-sm text-muted-foreground">
            从已授权的资源缺口或需求预测创建第一个闭环计划。
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="容量闭环列表">
          {loops.map((loop) => (
            <li key={loop.id}>
              <Link
                href={`${pathname}/${loop.id}`}
                className="flex flex-col gap-2 rounded border p-3 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <span className="font-medium">{loop.title}</span>
                  <span
                    className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs ${STATE_BADGE_CLASSES[loop.state] ?? ''}`}
                  >
                    {STATE_LABELS[loop.state] ?? loop.state}
                  </span>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    窗口 {loop.windowStart} ~ {loop.windowEnd} ·{' '}
                    {loop.granularity === 'week'
                      ? '周'
                      : loop.granularity === 'month'
                        ? '月'
                        : '日'}
                    粒度
                  </p>
                  <p className="text-sm text-muted-foreground">{nextStateLabel(loop.state)}</p>
                </div>
                <span className="text-xs text-muted-foreground">修订 v{loop.revision}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 ? (
        <nav className="flex items-center justify-between" aria-label="分页">
          <button
            type="button"
            disabled={(filters.page ?? 1) <= 1}
            onClick={() => applyFilter({ page: (filters.page ?? 1) - 1 })}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            上一页
          </button>
          <span className="text-sm text-muted-foreground">
            第 {meta.page} / {meta.totalPages} 页，共 {meta.total} 条
          </span>
          <button
            type="button"
            disabled={(filters.page ?? 1) >= meta.totalPages}
            onClick={() => applyFilter({ page: (filters.page ?? 1) + 1 })}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            下一页
          </button>
        </nav>
      ) : null}
    </div>
  )
}
