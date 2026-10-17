'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCustomView } from '@/hooks/use-custom-views'
import type { CustomViewResponse } from '@aiproj/types'
import { viewConfigAdapters } from '@/lib/view-config'

const BASE_VIEW_ROUTES: Record<string, string> = {
  kanban: 'kanban',
  list: 'list',
  calendar: 'calendar',
  gantt: 'gantt',
  wbs: 'wbs',
  resource: 'resources',
}

/**
 * 自定义视图切换 hook（v2-custom-views-view-config）。
 *
 * 管理当前激活的自定义视图：
 * - 从 URL query param `customView` 读取 activeViewId
 * - `switchToView(view)`：读取视图配置 → 导航到对应基础视图路由 → 应用搜索参数
 * - `clearCustomView()`：回到基础视图，清除 customView param
 */
export function useCustomViewSwitch(projectId: number) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const activeViewId = useMemo(() => {
    const raw = searchParams?.get('customView')
    if (!raw) return null
    const id = Number(raw)
    return Number.isFinite(id) && id > 0 ? id : null
  }, [searchParams])

  const { data: activeView } = useCustomView(projectId, activeViewId ?? 0)

  /**
   * 切换到指定自定义视图。
   * 1. 读取视图配置
   * 2. 确定目标基础视图路由
   * 3. 构造包含配置的 URL search params
   * 4. 导航（路由变化时触发全导航；相同路由时用 replace 更新参数）
   */
  const switchToView = useCallback(
    (view: CustomViewResponse) => {
      const baseRoute = BASE_VIEW_ROUTES[view.baseViewType]
      if (!baseRoute) return

      const adapter = viewConfigAdapters[view.baseViewType]
      let viewParams: URLSearchParams
      if (adapter) {
        viewParams = adapter.toSearchParams(view.config)
      } else {
        viewParams = new URLSearchParams()
      }

      // 附加 customView ID
      viewParams.set('customView', String(view.id))

      const targetPath = `/projects/${projectId}/${baseRoute}`
      const queryString = viewParams.toString()
      const targetUrl = queryString ? `${targetPath}?${queryString}` : targetPath

      if (pathname === targetPath) {
        // 同路由内切换：replace 避免新增历史条目
        router.replace(targetUrl)
      } else {
        router.push(targetUrl)
      }
    },
    [projectId, pathname, router],
  )

  /**
   * 清除自定义视图，回到基础视图的默认状态。
   * 仅移除 `customView` param，保留其他搜索参数。
   */
  const clearCustomView = useCallback(() => {
    if (!searchParams) {
      const baseRoute = pathname?.split('/').pop()
      router.push(`/projects/${projectId}/${baseRoute ?? 'kanban'}`)
      return
    }

    const params = new URLSearchParams(searchParams.toString())
    params.delete('customView')

    const queryString = params.toString()
    const targetUrl = queryString ? `${pathname}?${queryString}` : pathname
    router.replace(targetUrl)
  }, [pathname, projectId, router, searchParams])

  return {
    activeViewId,
    activeView,
    switchToView: switchToView,
    clearCustomView,
  }
}
