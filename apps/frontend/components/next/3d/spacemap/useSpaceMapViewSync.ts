'use client'

/**
 * 3D 星系 ↔ 2D 地图双视角状态双向同步 Hook
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §3 (全要素双向状态同步: 检索词/选中项/筛选器)
 * - design.md §3 (快捷键选定方案: 浮层内 Ctrl+M 切换视角, Ctrl+G 直达 3D), Decision 5
 * - tasks.md 5.1
 * - RL-14: 确定性受控状态驱动
 */

import * as React from 'react'
import { probeWebGLCapabilities } from '@/lib/next/3d/webgl-capabilities'

export type SpaceMapViewMode = '3d' | '2d'

export interface UseSpaceMapViewSyncOptions {
  open: boolean
  defaultViewMode?: SpaceMapViewMode
  initialQuery?: string
  initialSelectedId?: number | null
  onViewModeChange?: (mode: SpaceMapViewMode) => void
  onQueryChange?: (query: string) => void
  onSelectedIdChange?: (id: number | null) => void
}

export interface UseSpaceMapViewSyncReturn {
  viewMode: SpaceMapViewMode
  setViewMode: React.Dispatch<React.SetStateAction<SpaceMapViewMode>>
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  selectedId: number | null
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>
  toggleViewMode: () => void
  selectProject: (id: number | null) => void
}

export function useSpaceMapViewSync(
  options: UseSpaceMapViewSyncOptions,
): UseSpaceMapViewSyncReturn {
  const {
    open,
    defaultViewMode,
    initialQuery = '',
    initialSelectedId = null,
    onViewModeChange,
    onQueryChange,
    onSelectedIdChange,
  } = options

  const resolvedDefaultMode = React.useMemo<SpaceMapViewMode>(() => {
    if (defaultViewMode) return defaultViewMode
    if (typeof window !== 'undefined') {
      try {
        const caps = probeWebGLCapabilities()
        if (caps.tier === 'fallback') return '2d'
      } catch {
        return '2d'
      }
    }
    return '3d'
  }, [defaultViewMode])

  const [viewMode, setViewModeState] = React.useState<SpaceMapViewMode>(resolvedDefaultMode)
  const [query, setQueryState] = React.useState<string>(initialQuery)
  const [selectedId, setSelectedIdState] = React.useState<number | null>(initialSelectedId)

  const setViewMode = React.useCallback(
    (action: React.SetStateAction<SpaceMapViewMode>) => {
      setViewModeState((prev) => {
        const next = typeof action === 'function' ? action(prev) : action
        onViewModeChange?.(next)
        return next
      })
    },
    [onViewModeChange],
  )

  const setQuery = React.useCallback(
    (action: React.SetStateAction<string>) => {
      setQueryState((prev) => {
        const next = typeof action === 'function' ? action(prev) : action
        onQueryChange?.(next)
        return next
      })
    },
    [onQueryChange],
  )

  const setSelectedId = React.useCallback(
    (action: React.SetStateAction<number | null>) => {
      setSelectedIdState((prev) => {
        const next = typeof action === 'function' ? action(prev) : action
        onSelectedIdChange?.(next)
        return next
      })
    },
    [onSelectedIdChange],
  )

  const toggleViewMode = React.useCallback(() => {
    setViewMode((prev) => (prev === '3d' ? '2d' : '3d'))
  }, [setViewMode])

  const selectProject = React.useCallback(
    (id: number | null) => {
      setSelectedId(id)
    },
    [setSelectedId],
  )

  // 浮层开启时同步外部显式传入的初始属性
  React.useEffect(() => {
    if (open) {
      if (options.initialQuery !== undefined) setQuery(options.initialQuery)
      if (options.initialSelectedId !== undefined) setSelectedId(options.initialSelectedId)
    }
  }, [open, options.initialQuery, options.initialSelectedId, setQuery, setSelectedId])

  // 快捷键监听：浮层开启状态下，Ctrl+M / Meta+M 切换双视角；Ctrl+G / Meta+G 直达 3D
  React.useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey
      if (!isCtrlOrMeta) return

      const key = e.key.toLowerCase()

      if (key === 'm') {
        // 情境复用 Ctrl+M：浮层开启态下互切 3D 星系 / 2D 地图
        e.preventDefault()
        e.stopPropagation()
        toggleViewMode()
      } else if (key === 'g') {
        // 直达快捷键 Ctrl+G (Galaxy)
        e.preventDefault()
        e.stopPropagation()
        setViewMode('3d')
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, toggleViewMode, setViewMode])

  return {
    viewMode,
    setViewMode,
    query,
    setQuery,
    selectedId,
    setSelectedId,
    toggleViewMode,
    selectProject,
  }
}
