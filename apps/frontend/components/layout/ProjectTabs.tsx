'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { useParams, usePathname, useSearchParams } from 'next/navigation'
import { projectViewTabs, CUSTOM_VIEW_PARAM, isCustomViewActive } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { useCustomViewsList } from '@/hooks/use-custom-views'
import { Skeleton } from '@/components/ui/Skeleton'
import type { CustomViewResponse } from '@/lib/api/custom-views'

/**
 * 项目内视图 Tab（build-app-shell-layout / spec project-view-tabs）：
 *
 * - 前 6 个为基础视图 Tab（kanban/list/gantt/calendar/timeline/wbs）；
 * - 之后是分隔线与「我的视图」自定义视图列表（v2-custom-views-view-config）。
 *
 * 路由驱动——用 `usePathname` 匹配当前基础视图段，用 `customView` search param 匹配自定义视图。
 * 自定义视图点击后导航到对应基础视图路由并附加 `?customView=ID`。
 */
export function ProjectTabs() {
  const params = useParams()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const id = String(params.id ?? '')
  const projectId = Number(params.id)

  const customViewsQuery = useCustomViewsList(Number.isFinite(projectId) ? projectId : 0)

  const buildCustomViewHref = useCallback(
    (view: CustomViewResponse): string => {
      const targetBase = projectViewTabs.find((t) => t.value === view.baseViewType)
      const baseRoute = targetBase ? targetBase.value : 'kanban'
      return `/projects/${id}/${baseRoute}?${CUSTOM_VIEW_PARAM}=${view.id}`
    },
    [id],
  )

  return (
    <nav aria-label="项目视图切换" className="border-b border-border">
      <ol className="-mb-px flex items-center gap-1 overflow-x-auto">
        {/* ── 基础视图 Tab ─────────────────────────────── */}
        {projectViewTabs.map((tab) => {
          const href = `/projects/${id}/${tab.value}`
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={tab.value}>
              <Link
                href={href}
                data-state={active ? 'active' : 'inactive'}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-gray-500',
                  'transition-colors hover:text-gray-800',
                  'data-[state=active]:border-primary-500 data-[state=active]:text-primary-600',
                  focusRing,
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}

        {/* ── 健康与风险（v3-project-health-risk-command-center）── */}
        <li role="separator" aria-hidden="true">
          <span className="mx-2 block h-5 w-px bg-border" />
        </li>
        {(() => {
          const href = `/projects/${id}/health-risk-command-center`
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li>
              <Link
                href={href}
                data-state={active ? 'active' : 'inactive'}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-10 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-gray-500',
                  'transition-colors hover:text-gray-800',
                  'data-[state=active]:border-primary-500 data-[state=active]:text-primary-600',
                  focusRing,
                )}
              >
                健康与风险
              </Link>
            </li>
          )
        })()}

        {/* ── 自定义视图（加载态：骨架屏） ───────────── */}
        {customViewsQuery.isLoading && (
          <li className="ml-1 flex items-center gap-1">
            <span className="mx-2 h-5 w-px bg-border" role="separator" />
            {Array.from({ length: 2 }, (_, idx) => (
              <Skeleton key={idx} className="h-8 w-16 rounded" />
            ))}
          </li>
        )}

        {/* ── 自定义视图（数据态） ────────────────────── */}
        {customViewsQuery.isSuccess &&
          (() => {
            const personal = customViewsQuery.data?.personal ?? []
            const shared = customViewsQuery.data?.shared ?? []
            const allViews = [...personal, ...shared]
            if (allViews.length === 0) return null

            return (
              <>
                <li role="separator" aria-hidden="true">
                  <span className="mx-2 block h-5 w-px bg-border" />
                </li>
                <li className="flex items-center gap-1 text-xs text-gray-400">我的视图</li>
                {allViews.map((view) => {
                  const href = buildCustomViewHref(view)
                  const active = isCustomViewActive(view.id, pathname, searchParams)
                  return (
                    <li key={view.id}>
                      <Link
                        href={href}
                        data-state={active ? 'active' : 'inactive'}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'relative inline-flex h-10 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm font-medium text-gray-500',
                          'transition-colors hover:text-gray-800',
                          'data-[state=active]:border-primary-500 data-[state=active]:text-primary-600',
                          focusRing,
                        )}
                      >
                        <span className="truncate max-w-[10ch]">{view.name}</span>
                        {view.visibility === 'shared' && (
                          <span className="inline-flex items-center rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium text-gray-500 leading-none">
                            共享
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </>
            )
          })()}

        {/* ── 自定义视图（错误态：简洁提示） ──────────── */}
        {customViewsQuery.isError && (
          <li className="ml-2 flex items-center gap-1 text-xs text-gray-400">
            <span className="mx-1 h-4 w-px bg-border" role="separator" />
            视图加载失败
          </li>
        )}
      </ol>
    </nav>
  )
}
