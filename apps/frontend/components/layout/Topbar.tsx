'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Menu, Rocket, Search, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { IconButton } from '@/components/ui/IconButton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { useUiStore } from '@/stores/ui-store'
import { useCopilotStore } from '@/stores/copilot-store'
import { useCopilotToggleShortcutDisplay } from '@/lib/copilot/panel-shortcut'
import { setCopilotTriggerElement } from '@/lib/copilot/trigger-focus'
import { useCopilotReadiness } from '@/hooks/use-copilot-readiness'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { isNextUiEnabledForOrg } from '@/lib/feature-flags/next-ui-gate'
import { useNextTrackStore } from '@/stores/next-track-store'
import { Breadcrumb } from './Breadcrumb'
import { UserMenu } from './UserMenu'
import { ThemeDensityMenu } from './ThemeDensityMenu'
import { useCommandPalette } from './CommandPalette'
import { NotificationPanel, useUnreadNotificationCount } from './NotificationPanel'

export interface TopbarProps {
  /** 内容区滚动容器 ref——用于监听滚动方向以隐藏/显示顶栏。 */
  scrollContainerRef: React.RefObject<HTMLElement>
}

/**
 * 通知铃铛组件（tasks 4.2/4.3）：
 * - 显示未读数量徽章（99+ 封顶）
 * - 展开 NotificationPanel
 */
function NotificationBell() {
  const { data } = useUnreadNotificationCount()
  const unreadCount = data?.unreadCount ?? 0

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <IconButton aria-label={`通知${unreadCount > 0 ? `，${unreadCount} 条未读` : ''}`}>
              <div className="relative">
                <Bell className="h-4 w-4" aria-hidden />
                {unreadCount > 0 && (
                  <span
                    className={cn(
                      'absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-500',
                      'px-1 text-[10px] font-medium text-white',
                      unreadCount > 99 && 'min-w-[20px] text-[9px]',
                    )}
                    aria-hidden
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
            </IconButton>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {unreadCount > 0 ? `通知（${unreadCount} 条未读）` : '通知'}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-0">
        <NotificationPanel />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Copilot 顶栏触发器（v3-copilot-productized-operating-entry 任务 5.4）。
 *
 * 与原实现的差别只有两点：
 * 1. 图标右下角加一个 2px 状态点（`ready` / `degraded` / `unavailable`），
 *    并在 `aria-label` 与 tooltip 里用文字重复同一状态——不靠颜色单通道传达；
 * 2. tooltip 追加状态词。
 *
 * 触发器身份、`toggleOpen` 语义、快捷键与焦点回归注册**保持不变**。
 */
export function CopilotTopbarTrigger({ shortcut }: { shortcut: string | null }) {
  const query = useCopilotReadiness()
  const mode = useCopilotStore((state) => state.mode)

  const status: 'loading' | 'ready' | 'degraded' | 'unavailable' | 'demonstration' =
    mode === 'demonstration'
      ? 'demonstration'
      : query.isLoading
        ? 'loading'
        : query.error || !query.data
          ? 'unavailable'
          : query.data.state === 'ready'
            ? 'ready'
            : query.data.state === 'degraded'
              ? 'degraded'
              : 'unavailable'

  const statusLabel: Record<typeof status, string> = {
    loading: '正在检查',
    ready: '可用',
    degraded: '部分可用',
    unavailable: '暂不可用',
    demonstration: '演示模式',
  }
  const statusDot: Record<typeof status, string> = {
    loading: 'bg-gray-300',
    ready: 'bg-success',
    degraded: 'bg-warning',
    unavailable: 'bg-gray-400',
    demonstration: 'bg-ai',
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          aria-label={`AI Copilot，${statusLabel[status]}`}
          data-copilot-trigger-status={status}
          onClick={(event) => {
            setCopilotTriggerElement(event.currentTarget)
            useCopilotStore.getState().toggleOpen()
          }}
        >
          <span className="relative inline-flex">
            <Sparkles className="h-4 w-4 text-ai" aria-hidden />
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-gray-0',
                statusDot[status],
              )}
              aria-hidden
            />
          </span>
        </IconButton>
      </TooltipTrigger>
      <TooltipContent>
        AI Copilot（{statusLabel[status]}
        {shortcut ? `，${shortcut}` : ''}）
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * 「进入新页面」顶栏入口（v3-ui-next-track-foundation 任务 5.1 / spec「旧 UI 进入新 UI 的入口」）。
 *
 * 仅当用户已认证且所在组织的新 UI Feature Flag 开启时渲染（Flag 判定按
 * `organization_id` 维度，禁止按用户随机哈希）。点击时把切换偏好持久化为
 * `next`（source `topbar_button`）并导航至 `/next` 起始页。
 */
export function NextTrackEntryButton() {
  const router = useRouter()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const user = useAuthStore((state) => state.user)
  const setTrack = useNextTrackStore((state) => state.setTrack)

  const visible = React.useMemo(
    () =>
      isAuthenticated &&
      isNextUiEnabledForOrg(selectEffectiveOrganizationId({ currentOrganizationId, user })),
    [isAuthenticated, currentOrganizationId, user],
  )

  if (!visible) return null

  return (
    <button
      type="button"
      data-next-track-entry
      aria-label="进入新页面"
      onClick={() => {
        setTrack('next', 'topbar_button')
        router.push('/next')
      }}
      className={cn(
        // 各宽度常驻可见（此前 <md 被 hidden，窄屏无入口）；<md 仅图标，文字经 sr-only 保留可读名
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-2.5 text-sm text-gray-600 md:px-3',
        'transition-colors hover:border-border-strong hover:text-gray-900',
        focusRing,
      )}
    >
      <Rocket className="h-4 w-4 text-ai" aria-hidden />
      <span className="sr-only md:not-sr-only">进入新页面</span>
    </button>
  )
}

/**
 * 顶栏（build-app-shell-layout / spec app-shell-navigation）：
 *
 * 结构（56px 高，sticky）：
 *   左：移动端汉堡（<md 显示） + 面包屑（Dashboard 处替换为问候语+日期）
 *   右：搜索触发（Cmd+K，唤起命令面板）
 *       通知铃铛（notification-feedback-minimum）
 *       Copilot 触发（状态感知入口，v3-copilot-productized-operating-entry 任务 5.4 已落地）
 *       外观菜单（主题 + 密度）
 *       用户菜单（compact，仅头像）
 *
 * 行为：向下滚动隐藏（`transform: translateY(-100%)`），向上立即复位；
 * `prefers-reduced-motion: reduce` 时**常驻**，不做位移（无障碍）。
 */
export function Topbar({ scrollContainerRef }: TopbarProps) {
  const { setOpen: setPaletteOpen } = useCommandPalette()
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const copilotShortcut = useCopilotToggleShortcutDisplay()
  const [hidden, setHidden] = React.useState(false)

  // 滚动隐藏——监听内容区（非 window）滚动方向。
  React.useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    if (typeof window === 'undefined') return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reducedMotion.matches) return

    let lastScroll = container.scrollTop
    const threshold = 8 // px；避免抖动
    function onScroll() {
      if (!container) return
      const current = container.scrollTop
      const delta = current - lastScroll
      if (Math.abs(delta) < threshold) return
      if (delta > 0 && current > 56) {
        setHidden(true)
      } else {
        setHidden(false)
      }
      lastScroll = current
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [scrollContainerRef])

  return (
    <header
      className={cn(
        'sticky top-0 z-[var(--z-sticky)] flex h-14 shrink-0 items-center gap-1 border-b border-border bg-gray-0 px-2 sm:gap-2 sm:px-4',
        'transition-transform duration-200 ease-out',
        hidden ? '-translate-y-full' : 'translate-y-0',
        // 减弱动画：常驻——覆盖 hidden 状态的 transform，禁用位移过渡。
        'motion-reduce:!translate-y-0 motion-reduce:!transition-none',
      )}
      data-topbar
    >
      {/* 移动端汉堡（<md 显示） */}
      <IconButton
        aria-label="打开导航"
        size="sm"
        className="md:hidden"
        onClick={() => setMobileNavOpen(true)}
      >
        <Menu className="h-5 w-5" aria-hidden />
      </IconButton>

      <div className="min-w-0 flex-1">
        <Breadcrumb />
      </div>

      <div className="flex items-center gap-1">
        {/* 全局搜索触发 = 打开命令面板（业务数据搜索属后续 change） */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="搜索或运行命令"
              className={cn(
                'hidden h-9 min-w-[220px] items-center gap-2 rounded-[var(--radius-md)] border border-border bg-gray-50 px-3 text-left text-sm text-gray-500',
                'hover:border-border-strong hover:text-gray-700',
                'md:inline-flex',
                focusRing,
              )}
            >
              <Search className="h-4 w-4" aria-hidden />
              <span className="flex-1 truncate">搜索或运行命令</span>
              <kbd className="rounded-[var(--radius-sm)] border border-border bg-gray-0 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                Cmd K
              </kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent>命令面板 (Cmd/Ctrl + K)</TooltipContent>
        </Tooltip>
        {/* 小屏只显示图标按钮 */}
        <IconButton
          aria-label="搜索或运行命令"
          className="md:hidden"
          onClick={() => setPaletteOpen(true)}
        >
          <Search className="h-4 w-4" aria-hidden />
        </IconButton>

        {/* 通知铃铛（tasks 4.2/4.3） */}
        <NotificationBell />

        {/* Copilot 触发——状态感知入口（v3-copilot-productized-operating-entry 任务 5.4）：
            保留既有触发器身份、快捷键与关闭后精确焦点回归；只增加低噪声状态表达。
            完整 readiness 文案留在 Dashboard 工作区块，窄顶栏只给一个点 + 可读 tooltip。 */}
        <CopilotTopbarTrigger shortcut={copilotShortcut} />

        {/* 新 UI 入口（v3-ui-next-track-foundation 任务 5.1）：Flag 开启且已认证时显示，
            点击持久化偏好并进入 /next。插在 Copilot 触发器与外观菜单之间（design D1 插槽）。 */}
        <NextTrackEntryButton />

        <ThemeDensityMenu />

        <UserMenu compact />
      </div>
    </header>
  )
}
