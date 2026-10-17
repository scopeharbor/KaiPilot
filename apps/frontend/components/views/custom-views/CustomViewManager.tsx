'use client'

import * as React from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { CUSTOM_VIEW_PARAM } from '@/lib/navigation'
import { useCustomView } from '@/hooks/use-custom-views'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import type { CustomViewConfig } from '@aiproj/types'

/**
 * CustomViewManager 上下文——子视图通过此 context 读取当前激活的自定义视图配置。
 */
export interface CustomViewManagerContextValue {
  /** 当前激活的自定义视图 ID（来自 URL），无激活时为 null */
  activeViewId: number | null
  /** 当前激活的自定义视图配置，无激活时为 null */
  activeConfig: CustomViewConfig | null
  /** 当前激活的自定义视图名称，无激活时为 null */
  activeViewName: string | null
  /** 清除自定义视图——回到无自定义配置的基础视图 */
  clearCustomView: () => void
  /** 是否正在加载自定义视图配置 */
  isLoading: boolean
  /** 加载自定义视图配置是否出错 */
  isError: boolean
}

export const CustomViewManagerCtx = React.createContext<CustomViewManagerContextValue>({
  activeViewId: null,
  activeConfig: null,
  activeViewName: null,
  clearCustomView: () => {},
  isLoading: false,
  isError: false,
})

/**
 * 自定义视图管理器（v2-custom-views-view-config）。
 *
 * 读取 URL `?customView=ID` 参数，获取对应的自定义视图配置，
 * 并通过 React Context 注入给子视图组件，供各基础视图适配器应用。
 *
 * 挂载位置：`apps/frontend/app/(dashboard)/projects/[id]/layout.tsx`，
 * 使其对 6 视图页面（kanban/list/gantt/calendar/timeline/wbs）均可见。
 */
export function CustomViewManager({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const rawViewId = searchParams.get(CUSTOM_VIEW_PARAM)
  const activeViewId = rawViewId ? Number(rawViewId) : null

  const projectIdMatch = pathname.match(/\/projects\/(\d+)/)
  const projectId = projectIdMatch ? Number(projectIdMatch[1]) : 0

  const {
    data: viewDetail,
    isLoading,
    isError,
  } = useCustomView(Number.isFinite(projectId) ? projectId : 0, activeViewId ?? 0)

  // 当 URL 不含 customView 参数时，无需查询，直接透传
  const isActive = activeViewId !== null && Number.isFinite(activeViewId)

  const clearCustomView = React.useCallback(() => {
    // 移除 search params 中的 customView，保留其他参数
    const newParams = new URLSearchParams(searchParams.toString())
    newParams.delete(CUSTOM_VIEW_PARAM)
    const newSearch = newParams.toString()
    const newUrl = newSearch ? `${pathname}?${newSearch}` : pathname
    router.replace(newUrl)
  }, [pathname, searchParams, router])

  const contextValue: CustomViewManagerContextValue = React.useMemo(() => {
    if (!isActive) {
      return {
        activeViewId: null,
        activeConfig: null,
        activeViewName: null,
        clearCustomView,
        isLoading: false,
        isError: false,
      }
    }

    return {
      activeViewId,
      activeConfig: viewDetail?.config ?? null,
      activeViewName: viewDetail?.name ?? null,
      clearCustomView,
      isLoading,
      isError,
    }
  }, [isActive, activeViewId, viewDetail, clearCustomView, isLoading, isError])

  return (
    <CustomViewManagerCtx.Provider value={contextValue}>
      {/* 自定义视图激活 Banner */}
      {isActive && (
        <div className="flex items-center gap-2 border-b border-primary-200 bg-primary-50/60 px-4 py-1.5 text-sm">
          {isLoading ? (
            <>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-16 rounded" />
            </>
          ) : isError ? (
            <>
              <span className="text-gray-500">自定义视图加载失败</span>
              <Button variant="ghost" size="sm" onClick={clearCustomView}>
                返回默认视图
              </Button>
            </>
          ) : (
            <>
              <span className="font-medium text-primary-700">
                当前视图：{viewDetail?.name ?? '未知'}
              </span>
              <Badge variant="primary" className="text-[10px]">
                {viewDetail?.visibility === 'shared' ? '共享视图' : '个人视图'}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCustomView}
                className="ml-auto text-gray-500 hover:text-gray-800"
              >
                清除自定义视图
              </Button>
            </>
          )}
        </div>
      )}

      {children}
    </CustomViewManagerCtx.Provider>
  )
}

/**
 * 获取当前自定义视图上下文——供子视图组件读取配置。
 */
export function useCustomViewManager(): CustomViewManagerContextValue {
  return React.useContext(CustomViewManagerCtx)
}
