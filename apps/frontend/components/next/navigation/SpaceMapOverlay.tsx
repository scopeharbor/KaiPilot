'use client'

/**
 * 空间地图薄层（v3-ui-next-shell-space-map D2 / spec「空间地图呼出与关闭交互」）。
 * 扩展升级为 Layer 1 3D 星系拓扑沙盘与 2D 空间地图双视角体系（v3-next-layer1-spacemap-3d-m2）：
 *
 * - proposal.md §1~§5, design.md Decision 1~9, tasks.md 5.1~5.3
 * - 顶部工具栏集成「3D 星系 / 2D 地图」双重视角分段切换器 (SpaceMapViewToggle)；
 * - 快捷键：浮层开启态下按 Ctrl+M / Meta+M 互切 3D/2D；Ctrl+G / Meta+G 一键直达 3D 星系；
 * - 检索词与选中项双向受控同步 (useSpaceMapViewSync)；
 * - 异步懒加载 3D 星图画布容器 (LazySpaceMap3DCanvas, ssr: false)，保持主包 0.00KB 增量；
 * - 三档降级矩阵：遇到无 WebGL / 软渲染器 / 精确档 / 上下文丢失自动降级至既有 2D 空间地图；
 * - DOM + WebGL 分层模型与星体详情无障碍等价面板 (SpaceMapStarDetailPanel)。
 */

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Search, X, Sparkles } from 'lucide-react'
import { SpaceMapCard } from './SpaceMapCard'
import { SpaceMapProjectListLens } from './SpaceMapProjectListLens'
import { SpaceMapGlobalSearchLens, resolveEntityDirectUrl } from './SpaceMapGlobalSearchLens'
import { CrossProjectTasksHudLens } from '@/components/next/tasks/CrossProjectTasksHudLens'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import {
  filterSpaceCoordinates,
  resolveSpaceCoordinatePath,
  type SpaceCoordinate,
} from '@/lib/next/space-coordinates'
import type { Project } from '@/lib/api/projects'
import type { Task } from '@/lib/api/tasks'
import type { SearchResultItem } from '@aiproj/types'
import {
  useSpaceMapViewSync,
  type SpaceMapViewMode,
} from '@/components/next/3d/spacemap/useSpaceMapViewSync'
import { SpaceMapViewToggle } from '@/components/next/3d/spacemap/SpaceMapViewToggle'
import { useSpaceMapSceneState } from '@/components/next/3d/spacemap/useSpaceMapSceneState'
import { SpaceMapStarDetailPanel } from '@/components/next/3d/spacemap/SpaceMapStarDetailPanel'
import { SpaceMapStarTooltip } from '@/components/next/3d/spacemap/SpaceMapStarTooltip'
import type { StarVisualState } from '@/components/next/3d/spacemap/spacemap-state-mapper'
import { useAuthStore } from '@/stores/auth-store'

/** 路由级懒加载 3D 画布容器 (ssr: false, 维持主包 0.00KB 增量) */
const LazySpaceMap3DCanvas = dynamic(
  () =>
    import('@/components/next/3d/spacemap/SpaceMap3DCanvas').then((mod) => mod.SpaceMap3DCanvas),
  { ssr: false },
)

export type SpaceMapLensMode = 'spaces' | 'projects' | 'tasks'

export interface SpaceMapOverlayProps {
  /** 受控开关：由装配方（NextAppShell）以顶栏按钮或 Cmd/Ctrl+M 快捷键驱动。 */
  open: boolean
  /** 关闭信号（Esc / 遮罩点击 / 关闭按钮 / 可用坐标跳转）统一经此回调上报。 */
  onOpenChange?: (open: boolean) => void
  /** 兼容 onClose 回调 */
  onClose?: () => void
  /** 默认/初始镜头视图：'spaces'（空间拓扑）或 'projects'（项目清单）。默认 'spaces'。 */
  defaultLens?: SpaceMapLensMode
  /** 外部传入的项目集（用于测试或外部注入） */
  projects?: Project[]
  /** 外部传入的任务集（用于测试或外部注入） */
  tasks?: Task[]
  /** 外部触发放置立项的回调 */
  onOpenPlacement?: () => void
  /** 预填初始检索词（用于同化路由 /next/search?q=... 唤起） */
  initialQuery?: string
  /** 兼容测试传入的 onSelectCoordinate */
  onSelectCoordinate?: (coordinate: SpaceCoordinate) => void
  /** 初始视角模式：'3d' | '2d'（未显式指定则自适应探针） */
  defaultViewMode?: SpaceMapViewMode
  /** 强制 3D 档位（用于测试与降级校验） */
  forceTier?: 'high' | 'low' | 'fallback'
}

export function SpaceMapOverlay({
  open,
  onOpenChange,
  onClose,
  defaultLens = 'spaces',
  projects,
  tasks,
  onOpenPlacement,
  initialQuery,
  onSelectCoordinate,
  defaultViewMode,
  forceTier,
}: SpaceMapOverlayProps) {
  const router = useRouter()
  const notifyOpen = React.useCallback(
    (val: boolean) => {
      onOpenChange?.(val)
      if (!val) onClose?.()
    },
    [onOpenChange, onClose],
  )

  const [lens, setLens] = React.useState<SpaceMapLensMode>(defaultLens)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const entityProjectId = useProjectSpaceEntityStore((state) => state.projectId)

  // 1. 双视角状态双向同步 (viewMode, query, selectedId)
  const { viewMode, setViewMode, query, setQuery, selectedId, setSelectedId } = useSpaceMapViewSync(
    {
      open,
      defaultViewMode,
      initialQuery,
    },
  )

  // 2. 空间场景状态自适应 (聚合项目、信号与 3D 拓扑)
  // 星系中心标签：当前组织名
  const orgName = useAuthStore(
    (state) =>
      state.user?.organizations.find((org) => org.id === state.currentOrganizationId)?.name ?? null,
  )
  const sceneState = useSpaceMapSceneState({
    projects,
    query,
    selectedId,
  })

  // 2D 模式下的过滤坐标白名单
  const coordinates = React.useMemo(() => filterSpaceCoordinates(query), [query])

  // 3D 星体 Hover 悬浮 Tooltip 状态 (Task 5.2 / BLOCKER-2 修复)
  const [hoveredStar, setHoveredStar] = React.useState<StarVisualState | null>(null)
  const [hoverPos, setHoverPos] = React.useState<{ clientX: number; clientY: number }>({
    clientX: 0,
    clientY: 0,
  })

  // 当关闭浮层或离开 3D 视角时重置 hover 状态
  React.useEffect(() => {
    if (!open || viewMode !== '3d') {
      setHoveredStar(null)
    }
  }, [open, viewMode])

  const isTriggerPrefillRef = React.useRef(false)

  // 每次唤起时同步镜头模式与重置检索词
  React.useEffect(() => {
    if (open) {
      setLens(defaultLens)
      if (isTriggerPrefillRef.current) {
        isTriggerPrefillRef.current = false
      } else {
        setQuery(initialQuery ?? '')
      }
    }
  }, [open, defaultLens, initialQuery, setQuery])

  // 监听全局唤起自定义事件
  React.useEffect(() => {
    const handleTrigger = (event: Event) => {
      const custom = event as CustomEvent<{
        query?: string
        lens?: SpaceMapLensMode
        viewMode?: SpaceMapViewMode
      }>
      if (custom.detail?.query !== undefined) {
        isTriggerPrefillRef.current = true
        setQuery(custom.detail.query)
      }
      if (custom.detail?.lens) {
        setLens(custom.detail.lens)
      }
      if (custom.detail?.viewMode) {
        setViewMode(custom.detail.viewMode)
      }
      notifyOpen(true)
    }
    window.addEventListener('space-map-trigger', handleTrigger)

    // 检查是否有路由同化暂存检索词
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const prefill = window.sessionStorage.getItem('space-map-prefill')
        if (prefill) {
          window.sessionStorage.removeItem('space-map-prefill')
          setQuery(prefill)
          setLens('spaces')
          notifyOpen(true)
        }
      }
    } catch {
      // 忽略存储访问异常
    }

    return () => window.removeEventListener('space-map-trigger', handleTrigger)
  }, [notifyOpen, setQuery, setViewMode])

  // 快捷键快速切换镜头模式（Ctrl+L / Meta+L）
  React.useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        setLens((prev) => {
          if (prev === 'spaces') return 'projects'
          if (prev === 'projects') return 'tasks'
          return 'spaces'
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const handleSelectCoordinate = (coordinate: SpaceCoordinate) => {
    notifyOpen(false)
    if (onSelectCoordinate) {
      onSelectCoordinate(coordinate)
    } else {
      router.push(resolveSpaceCoordinatePath(coordinate.path, entityProjectId))
    }
  }

  const handleSelectProject = (project: Project) => {
    notifyOpen(false)
    router.push(`/next/projects/${project.id}`)
  }

  const handleSelectProjectId = (projectId: number) => {
    notifyOpen(false)
    router.push(`/next/projects/${projectId}`)
  }

  const handleSelectSearchResult = (item: SearchResultItem) => {
    notifyOpen(false)
    if (item.entityType === 'task') {
      let projectId = item.projectId
      if (!projectId && item.target) {
        const match = /projects\/(\d+)/.exec(item.target)
        if (match?.[1]) projectId = Number(match[1])
      }
      router.push(`/next/projects/${projectId ?? 1}?focusTask=${item.entityId}`)
    } else {
      router.push(resolveEntityDirectUrl(item))
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={notifyOpen}>
      <DialogPrimitive.Portal>
        {/* 背景遮罩 */}
        <DialogPrimitive.Overlay
          data-testid="space-map-scrim"
          className={`fixed inset-0 z-[var(--z-modal-backdrop)] ${'bg-black/60 backdrop-blur-md'}`}
        />

        <DialogPrimitive.Content
          aria-label="空间地图"
          aria-modal="true"
          data-space-map-overlay=""
          data-active-lens={lens}
          data-view-mode={viewMode}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (lens === 'spaces') {
              searchInputRef.current?.focus()
            }
          }}
          className="fixed inset-0 z-[var(--z-modal)] outline-none overflow-hidden"
        >
          {/* 3D 星体 Hover 悬浮 Tooltip (Layer 1 顶层浮窗，BLOCKER-2 修复) */}
          {viewMode === '3d' && hoveredStar && (
            <SpaceMapStarTooltip
              star={hoveredStar}
              clientX={hoverPos.clientX}
              clientY={hoverPos.clientY}
            />
          )}

          {/* Layer 1 (z-10): 语义化 DOM 层，承载全部交互与无障碍等价能力 */}
          <div
            data-next-track
            className="relative z-10 flex h-dvh items-center justify-center px-3 py-3 pointer-events-none sm:px-4 sm:py-8"
          >
            <div
              role="presentation"
              className={`pointer-events-auto flex w-full ${
                viewMode === '3d' && lens === 'spaces'
                  ? 'max-w-6xl'
                  : lens === 'tasks'
                    ? 'max-w-5xl'
                    : lens === 'projects'
                      ? 'max-w-4xl'
                      : 'max-w-2xl'
              } max-h-full min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain rounded-[var(--radius-lg)] border border-[var(--nx-border-hairline)] ${'bg-[var(--nx-workspace-surface)]'} p-3 shadow-[var(--shadow-lg)] transition-all sm:p-5`}
            >
              {/* 顶部标题、模式切换器、视角分段器与关闭按钮 */}
              <header className="flex shrink-0 items-start justify-between gap-2 sm:gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <div>
                    <DialogPrimitive.Title className="text-base font-semibold text-[var(--nx-text-primary)]">
                      空间地图
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="mt-0.5 text-xs text-[var(--nx-text-muted)]">
                      {viewMode === '3d'
                        ? '3D 星系拓扑沙盘与全景飞行导航，点击星体展开详情。'
                        : lens === 'spaces'
                          ? '搜索并直达新轨工作空间与跨实体，规划中的坐标将陆续上线。'
                          : lens === 'projects'
                            ? '组织内全量项目高密度扫视与一键切入工作面。'
                            : '组织内跨项目任务高密度 HUD 表格与即时过滤直达。'}
                    </DialogPrimitive.Description>
                  </div>

                  {/* 镜头模式切换器 */}
                  <div
                    role="tablist"
                    aria-label="空间地图镜头模式"
                    className="flex items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-0.5 text-xs"
                  >
                    <button
                      type="button"
                      role="tab"
                      data-lens-tab="spaces"
                      aria-selected={lens === 'spaces'}
                      onClick={() => setLens('spaces')}
                      className={`rounded px-2.5 py-1 font-medium transition-colors ${
                        lens === 'spaces'
                          ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)] shadow-sm'
                          : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-secondary)]'
                      }`}
                    >
                      空间拓扑
                    </button>
                    <button
                      type="button"
                      role="tab"
                      data-lens-tab="projects"
                      aria-selected={lens === 'projects'}
                      onClick={() => setLens('projects')}
                      className={`rounded px-2.5 py-1 font-medium transition-colors ${
                        lens === 'projects'
                          ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)] shadow-sm'
                          : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-secondary)]'
                      }`}
                    >
                      项目清单
                    </button>
                    <button
                      type="button"
                      role="tab"
                      data-lens-tab="tasks"
                      aria-selected={lens === 'tasks'}
                      onClick={() => setLens('tasks')}
                      className={`rounded px-2.5 py-1 font-medium transition-colors ${
                        lens === 'tasks'
                          ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)] shadow-sm'
                          : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-secondary)]'
                      }`}
                    >
                      全域任务
                    </button>
                  </div>

                  {/* 一等公民双视角分段切换器 [3D 星系 / 2D 地图] */}
                  <SpaceMapViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
                </div>

                <DialogPrimitive.Close
                  aria-label="关闭空间地图"
                  className="shrink-0 rounded-md p-1.5 text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                >
                  <X className="h-4 w-4" aria-hidden />
                </DialogPrimitive.Close>
              </header>

              {/* 空间拓扑镜头（3D 星系 或 2D 原生卡片网格） */}
              {lens === 'spaces' && (
                <>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--nx-text-muted)]"
                      aria-hidden
                    />
                    <input
                      ref={searchInputRef}
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      aria-label="搜索空间坐标"
                      placeholder={
                        viewMode === '3d'
                          ? '在星系沙盘中检索项目名称、代号或部门…'
                          : '搜索空间名称、路径或描述…'
                      }
                      className="h-10 w-full rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] pl-9 pr-3 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--nx-border-focus)]"
                    />
                  </div>

                  {/* 3D 视角下的 DOM 面板与等价群星列表 */}
                  {viewMode === '3d' ? (
                    <div className="space-y-4">
                      {/* 全域搜索联动 */}
                      {query.trim() !== '' && (
                        <SpaceMapGlobalSearchLens
                          showInput={false}
                          query={query}
                          onSelectResult={handleSelectSearchResult}
                          onClose={() => notifyOpen(false)}
                        />
                      )}

                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                        {/* 星系舞台：画布就在弹窗里，而不是压在卡片背后 */}
                        <div
                          data-testid="spacemap-galaxy-stage"
                          className="relative h-[56vh] min-h-[360px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--nx-border-hairline)] bg-[#05070d]"
                        >
                          <LazySpaceMap3DCanvas
                            variant="stage"
                            coreLabel={orgName ?? '组织核心'}
                            stars={sceneState.stars}
                            sectors={sceneState.sectors}
                            selectedId={selectedId}
                            onSelectStar={(id) => setSelectedId(id)}
                            onPointerOverStar={(e, star) => {
                              setHoveredStar(star)
                              setHoverPos({ clientX: e.clientX, clientY: e.clientY })
                            }}
                            onPointerOutStar={() => {
                              setHoveredStar(null)
                            }}
                            forceTier={forceTier}
                            onDegradeToFallback={() => setViewMode('2d')}
                          />
                          {/* 图例 */}
                          <div
                            data-testid="spacemap-galaxy-legend"
                            className="pointer-events-none absolute left-3 top-3 z-10 space-y-1 rounded-md border border-white/10 bg-black/55 px-2.5 py-2 text-[10px] leading-4 text-slate-300"
                          >
                            <div className="font-medium text-slate-100">怎么看</div>
                            <div className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full bg-[#38bdf8]" />
                              健康
                              <span className="ml-1 h-2 w-2 rounded-full bg-[#f59e0b]" />
                              有风险
                              <span className="ml-1 h-2 w-2 rounded-full bg-[#ef4444]" />
                              严重
                              <span className="ml-1 h-2 w-2 rounded-full bg-[#64748b]" />
                              未评估
                            </div>
                            <div>星越大 = 任务越多 · 外圈弧 = 完成进度</div>
                            <div>中心 = 组织，每颗星 = 一个项目</div>
                          </div>
                          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] text-slate-300">
                            拖拽旋转 · 滚轮缩放 · 点击恒星查看详情
                          </div>
                          {sceneState.stars.length === 0 ? (
                            <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-400">
                              暂无项目，创建项目后会出现在星系里
                            </div>
                          ) : null}
                        </div>

                        <div className="flex min-w-0 flex-col gap-3">
                          {/* 选中星体 DOM 详情展开面板 */}
                          {sceneState.activeStar ? (
                            <SpaceMapStarDetailPanel
                              star={sceneState.activeStar}
                              onClose={() => setSelectedId(null)}
                              onNavigate={handleSelectProjectId}
                              className="w-full"
                            />
                          ) : (
                            <div
                              data-testid="spacemap-3d-hint"
                              className="w-full space-y-2 rounded-[var(--radius-lg)] border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3.5 text-xs text-[var(--nx-text-secondary)]"
                            >
                              <div className="flex items-center gap-1.5 font-semibold text-[var(--nx-text-primary)]">
                                <Sparkles className="h-4 w-4 text-[#00f0ff]" />
                                <span>项目星系</span>
                              </div>
                              <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                                点左侧的星体或下面的项目名，查看进度、成员、任务和风险信号，再一键进入项目。
                              </p>
                              <div className="flex items-center justify-between border-t border-[var(--nx-border-hairline)] pt-1.5 text-[11px]">
                                <span>共 {sceneState.totalCount} 个项目</span>
                                <button
                                  type="button"
                                  onClick={() => setViewMode('2d')}
                                  className="text-[#38bdf8] hover:underline"
                                >
                                  切至 2D 地图
                                </button>
                              </div>
                            </div>
                          )}

                          {/* DOM 树内维护键盘可达的等价项目列表 (无障碍兜底) */}
                          <ul
                            data-testid="3d-accessible-star-list"
                            aria-label="群星导航列表"
                            className="m-0 max-h-[34vh] w-full list-none space-y-1.5 overflow-y-auto p-0 pr-1"
                          >
                            <li className="mb-1 px-1 text-xs font-semibold text-[var(--nx-text-secondary)]">
                              项目 ({sceneState.matchedCount}/{sceneState.totalCount})
                            </li>
                            {sceneState.stars.length > 0 ? (
                              sceneState.stars.map((star) => (
                                <li key={star.projectId}>
                                  <button
                                    type="button"
                                    data-star-item={star.projectId}
                                    onClick={() => setSelectedId(star.projectId)}
                                    onPointerEnter={(e) => {
                                      setHoveredStar(star)
                                      setHoverPos({ clientX: e.clientX, clientY: e.clientY })
                                    }}
                                    onPointerLeave={() => {
                                      setHoveredStar(null)
                                    }}
                                    className={`flex w-full items-center justify-between rounded border p-2 text-left text-xs transition-colors ${
                                      star.isSelected
                                        ? 'border-[#38bdf8]/50 bg-[#38bdf8]/15 text-[var(--nx-text-primary)]'
                                        : star.isMatch
                                          ? 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-primary)] hover:bg-[var(--nx-bg-2)]'
                                          : 'border-transparent bg-[var(--nx-bg-1)]/40 text-[var(--nx-text-muted)] opacity-40'
                                    }`}
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <span
                                        className="h-2 w-2 shrink-0 rounded-full"
                                        style={{ backgroundColor: star.color }}
                                      />
                                      <span className="truncate font-medium">{star.name}</span>
                                      {star.code && (
                                        <span className="truncate font-mono text-[10px] text-[var(--nx-text-muted)]">
                                          {star.code}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-[var(--nx-text-muted)]">
                                      <span>{star.progressPercent}%</span>
                                    </div>
                                  </button>
                                </li>
                              ))
                            ) : (
                              <li className="py-4 text-center text-xs text-[var(--nx-text-muted)]">
                                暂无项目
                              </li>
                            )}
                          </ul>
                        </div>
                      </div>

                      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--nx-border-hairline)] pt-3 text-xs text-[var(--nx-text-muted)]">
                        <span className="flex items-center gap-1.5">
                          <kbd className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--nx-text-secondary)]">
                            Ctrl+M
                          </kbd>
                          切换 2D/3D 视角
                        </span>
                        <span className="flex items-center gap-1.5">
                          <kbd className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--nx-text-secondary)]">
                            Esc
                          </kbd>
                          关闭
                        </span>
                        <span>拖拽旋转 · 滚轮缩放 · 点击恒星查看详情</span>
                      </footer>
                    </div>
                  ) : (
                    /* 2D 空间拓扑镜头（原有卡片网格，100% 原样保留） */
                    <>
                      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
                        {/* 全域搜索联动：输入非空白关键词时呈现高密度跨实体搜索 */}
                        {query.trim() !== '' && (
                          <SpaceMapGlobalSearchLens
                            showInput={false}
                            query={query}
                            onSelectResult={handleSelectSearchResult}
                            onClose={() => notifyOpen(false)}
                          />
                        )}

                        {/* 空间坐标拓扑卡片 */}
                        {coordinates.length > 0 ? (
                          <div className="space-y-2">
                            {query.trim() !== '' && (
                              <div className="text-xs font-semibold text-[var(--nx-text-secondary)]">
                                空间坐标
                              </div>
                            )}
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              {coordinates.map((coordinate) => (
                                <SpaceMapCard
                                  key={coordinate.id}
                                  coordinate={coordinate}
                                  onSelect={handleSelectCoordinate}
                                />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div
                            data-testid="space-map-empty"
                            role="status"
                            className="flex flex-col items-center gap-2 py-8 text-center"
                          >
                            <Search className="h-5 w-5 text-[var(--nx-text-muted)]" aria-hidden />
                            <p className="text-sm text-[var(--nx-text-secondary)]">
                              未找到匹配的空间坐标
                            </p>
                            <p className="text-xs text-[var(--nx-text-muted)]">
                              试试「首页」「生成剧场」或「图表馆」
                            </p>
                          </div>
                        )}
                      </div>

                      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--nx-border-hairline)] pt-3 text-xs text-[var(--nx-text-muted)]">
                        <span className="flex items-center gap-1.5">
                          <kbd className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--nx-text-secondary)]">
                            Esc
                          </kbd>
                          关闭
                        </span>
                        <span>可用坐标点击直达</span>
                        <span>规划中坐标暂未开放</span>
                      </footer>
                    </>
                  )}
                </>
              )}

              {/* 项目清单镜头 */}
              {lens === 'projects' && (
                <SpaceMapProjectListLens
                  projects={projects}
                  onSelectProject={handleSelectProject}
                  onClose={() => notifyOpen(false)}
                  onOpenPlacement={onOpenPlacement}
                />
              )}

              {/* 全域任务 HUD 镜头 */}
              {lens === 'tasks' && (
                <CrossProjectTasksHudLens
                  embedded
                  isOpen={true}
                  tasks={tasks}
                  projects={projects}
                  onClose={() => notifyOpen(false)}
                />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export default SpaceMapOverlay
