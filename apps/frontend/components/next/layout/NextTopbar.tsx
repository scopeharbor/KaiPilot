'use client'

import * as React from 'react'
import { ArrowLeft, HelpCircle, Map, MoreHorizontal, Sparkles } from 'lucide-react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { nextSpaceMapShortcutLabel, useNextShortcuts } from '@/hooks/use-next-shortcuts'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { taskKeys } from '@/lib/api/tasks'
import { AiColleaguePanel } from '@/components/next/ai/AiColleaguePanel'
import { AiColleagueTrigger } from './AiSummonPlaceholder'
import { ImmersionTierMenu } from './ImmersionTierMenu'
import { NxThemeToggle } from './NxThemeToggle'
import { TextVariantSwitcher } from '@/components/locale/text-variant-switcher'
import { NextTopbarNotificationTrigger } from './NextTopbarNotificationTrigger'
import { NotificationDrawer } from '@/components/next/notifications/NotificationDrawer'
import { useNotificationDrawerStore } from '@/components/next/notifications/use-notification-drawer'
import { useRealtimeNotifications } from '@/hooks/use-realtime-notifications'

/** 新轨坐标展示文本：预置坐标 → 深层子路由兜底 → 原样返回。 */
const COORDINATE_LABEL_MAP: Record<string, string> = {
  '/next': '角色首页',
  '/next/create': '生成剧场',
  '/next/charts': '图表馆',
}

function deriveCoordinateLabel(pathname: string): string {
  const known = COORDINATE_LABEL_MAP[pathname]
  if (known) return `${pathname} · ${known}`
  if (pathname.startsWith('/next/')) return `${pathname} · 空间探索`
  return pathname
}

/**
 * 新轨常驻极薄顶栏（v3-ui-next-shell-space-map D1 + v3-ui-next-ai-colleague W4 总装）。
 *
 * - sticky 吸顶：手机 56px / 桌面 48px，窄屏低频操作收纳到更多设置；
 * - 右侧操作区依序：沉浸档位切换（ImmersionTierMenu）→ 空间地图呼出 →
 *   AI 同事唤起（AiColleagueTrigger）→ 帮助中心常驻入口（HelpCircle，直达
 *   /next/help）→ 回到旧版；
 * - **快捷键唯一注册点**：内部单点挂载 `useNextShortcuts`（Ctrl+/ 切 AI 同事面板、
 *   Cmd/Ctrl+M 呼出空间地图），onToggleAiSummon 统一分发至 Store `toggleOpen`；
 * - **AI 同事总装**：挂载 `AiColleaguePanel` 并注入当前 `pathname` 与
 *   `useProjectSpaceEntityStore` 派生出的情境上下文（entityProjectId/entityTitle；
 *   面板自带 Store 订阅，不传 open/onOpenChange）；
 * - **写操作确认缓存失效**：订阅消息时间线，`toolExecution.status === 'committed'`
 *   时失效 `taskKeys.lists(projectId)` 与 `taskKeys.all`，驱动看板/甘特图就地刷新
 *   （projectId 取自消息携带的 `parameters.projectId`，按消息 id 去重防重复失效）；
 * - 「回到旧版」默认内部执行偏好持久化（track=legacy, source=shell_switch）+ 跳转
 *   `/dashboard`，宿主可用 `onBackToLegacy` 覆盖。
 */
export interface NextTopbarProps {
  /** 呼出空间地图（宿主接线到 SpaceMapOverlay 的打开回调）。 */
  onOpenSpaceMap?: () => void
  /** 回到旧版行为覆盖；缺省执行内部偏好切换 + 跳转旧轨。 */
  onBackToLegacy?: () => void
  /** 坐标回显覆盖文本；缺省由 usePathname 派生（见 deriveCoordinateLabel）。 */
  coordinateLabel?: string
  /** 通知抽屉受控开关（可选）。 */
  notificationDrawerOpen?: boolean
  /** 通知抽屉开关变化回调（可选）。 */
  onNotificationDrawerOpenChange?: (open: boolean) => void
}

export function NextTopbar({
  onOpenSpaceMap,
  onBackToLegacy,
  coordinateLabel,
  notificationDrawerOpen,
  onNotificationDrawerOpenChange,
}: NextTopbarProps) {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const [moreOpen, setMoreOpen] = React.useState(false)
  React.useEffect(() => setMoreOpen(false), [pathname])
  const setTrack = useNextTrackStore((state) => state.setTrack)
  const queryClient = useQueryClient()
  // 新通知实时到达：铃铛未读数与抽屉列表即时刷新，无需手动刷新页面
  useRealtimeNotifications()

  // 通知抽屉：受控状态 + Store 联动
  const storeDrawerOpen = useNotificationDrawerStore((state) => state.isOpen)
  const [internalDrawerOpen, setInternalDrawerOpen] = React.useState(false)

  const isDrawerControlled = notificationDrawerOpen !== undefined
  const drawerOpen = isDrawerControlled
    ? notificationDrawerOpen
    : internalDrawerOpen || storeDrawerOpen

  const handleDrawerOpenChange = (open: boolean) => {
    if (!isDrawerControlled) {
      setInternalDrawerOpen(open)
    }
    if (open) {
      useNotificationDrawerStore.getState().openDrawer()
    } else {
      useNotificationDrawerStore.getState().closeDrawer()
    }
    onNotificationDrawerOpenChange?.(open)
  }

  // AI 同事：Store 直连（触发按钮 + 面板开关 + 确认后缓存失效均收敛于此）。
  const toggleAiColleague = useNextAiColleagueStore((state) => state.toggleOpen)
  const colleagueMessages = useNextAiColleagueStore((state) => state.messages)
  const entityProjectId = useProjectSpaceEntityStore((state) => state.projectId)
  const entityTitle = useProjectSpaceEntityStore((state) => state.entityTitle)

  useNextShortcuts({
    onToggleAiSummon: toggleAiColleague,
    onOpenSpaceMap,
  })

  // 写操作确认成功（status='committed'）→ 失效任务列表与全量任务缓存，
  // 看板/甘特图工作面就地刷新（RL-01 落库后同步；按消息 id 去重）。
  const invalidatedCommittedIds = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    for (const message of colleagueMessages) {
      const execution = message.toolExecution
      if (!execution || execution.status !== 'committed') continue
      if (invalidatedCommittedIds.current.has(message.id)) continue
      const rawProjectId = execution.parameters?.projectId
      if (typeof rawProjectId !== 'number' || !Number.isFinite(rawProjectId) || rawProjectId <= 0) {
        continue
      }
      invalidatedCommittedIds.current.add(message.id)
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists(rawProjectId) })
      void queryClient.invalidateQueries({ queryKey: taskKeys.all })
    }
  }, [colleagueMessages, queryClient])

  const handleBackToLegacy = () => {
    if (onBackToLegacy) {
      onBackToLegacy()
      return
    }
    setTrack('legacy', 'shell_switch')
    router.push('/dashboard')
  }

  const displayCoordinate = coordinateLabel ?? deriveCoordinateLabel(pathname)

  return (
    <>
      <header
        data-next-topbar
        className="sticky top-0 z-40 flex h-14 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/95 px-3 backdrop-blur-sm xl:h-12 xl:px-6"
      >
        {/* 品牌 + 空间坐标回显 */}
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--nx-ai)]" aria-hidden />
          <span className="truncate text-sm font-semibold tracking-[0.02em]">开项 Kaiplan</span>
          <span
            data-next-coordinate
            className="hidden truncate font-mono text-xs text-[var(--nx-text-muted)] xl:inline-block"
          >
            {displayCoordinate}
          </span>
        </div>

        {/* 操作区 */}
        <div className="flex shrink-0 items-center gap-1 xl:gap-2">
          <div className="hidden items-center gap-2 xl:flex">
            <TextVariantSwitcher />
            <NxThemeToggle />
            <ImmersionTierMenu />
          </div>

          <NextTopbarNotificationTrigger
            open={drawerOpen}
            onClick={() => handleDrawerOpenChange(!drawerOpen)}
          />

          <button
            type="button"
            data-next-space-map-trigger
            aria-label="空间地图"
            aria-haspopup="dialog"
            onClick={onOpenSpaceMap}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)] xl:h-9"
          >
            <Map className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">空间地图</span>
            <kbd className="hidden rounded-[4px] border border-[var(--nx-border-hairline)] px-1 font-mono text-[10px] leading-4 text-[var(--nx-text-muted)] lg:inline-block">
              {nextSpaceMapShortcutLabel()}
            </kbd>
          </button>

          <AiColleagueTrigger />

          {/* 常驻帮助入口（v3-ui-next-help-knowledge-domain W3 · tasks 3.7，
              design Decision 1 通道三）：HelpCircle 问号图标，紧邻 AI 同事唤起、
              置于「回到旧版」之前；点击纯客户端导航 router.push('/next/help')，
              零网络请求、零数据拉取、零 RBAC 判断（帮助中心登录全员可见）。 */}
          <button
            type="button"
            data-next-help-trigger
            aria-label="帮助中心"
            onClick={() => router.push('/next/help')}
            className="hidden h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)] xl:flex"
          >
            <HelpCircle className="h-4 w-4" aria-hidden />
          </button>

          <button
            type="button"
            data-next-back-to-legacy
            onClick={handleBackToLegacy}
            className="hidden h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)] xl:flex"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            回到旧版
          </button>
          <PopoverPrimitive.Root open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label="更多设置与帮助"
                className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] xl:hidden"
              >
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Content
                data-next-track
                data-next-mobile-settings
                aria-label="更多设置与帮助"
                align="end"
                sideOffset={8}
                collisionPadding={12}
                className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-72 max-w-[calc(100vw-24px)] flex-col gap-4 overflow-y-auto rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-4 text-[var(--nx-text-primary)] shadow-xl xl:hidden"
              >
                <TextVariantSwitcher />
                <NxThemeToggle />
                <ImmersionTierMenu />
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false)
                    router.push('/next/help')
                  }}
                  className="flex min-h-11 items-center gap-2 rounded-md px-2 text-left hover:bg-[var(--nx-bg-2)]"
                >
                  <HelpCircle className="h-4 w-4" aria-hidden />
                  帮助中心
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false)
                    handleBackToLegacy()
                  }}
                  className="flex min-h-11 items-center gap-2 rounded-md px-2 text-left hover:bg-[var(--nx-bg-2)]"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  回到旧版
                </button>
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          </PopoverPrimitive.Root>
        </div>
      </header>

      <AiColleaguePanel
        pathname={pathname}
        entityProjectId={entityProjectId}
        entityTitle={entityTitle}
      />

      <NotificationDrawer open={drawerOpen} onOpenChange={handleDrawerOpenChange} />
    </>
  )
}
