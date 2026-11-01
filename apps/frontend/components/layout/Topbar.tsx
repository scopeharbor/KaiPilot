'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Bell,
  ChevronDown,
  FolderKanban,
  LayoutGrid,
  Menu,
  Plus,
  Rocket,
  Search,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { IconButton } from '@/components/ui/IconButton'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { useUiStore } from '@/stores/ui-store'
import { useCopilotStore } from '@/stores/copilot-store'
import { useCopilotToggleShortcutDisplay } from '@/lib/copilot/panel-shortcut'
import { setCopilotTriggerElement } from '@/lib/copilot/trigger-focus'
import { useCopilotReadiness } from '@/hooks/use-copilot-readiness'
import { usePermissions } from '@/hooks/use-permissions'
import { selectEffectiveOrganizationId, useAuthStore } from '@/stores/auth-store'
import { isNextUiEnabledForOrg } from '@/lib/feature-flags/next-ui-gate'
import { useNextTrackStore } from '@/stores/next-track-store'
import { primaryNavGroups, secondaryNavItems } from '@/lib/navigation'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import { UserMenu } from './UserMenu'
import { ThemeDensityMenu } from './ThemeDensityMenu'
import { useCommandPalette } from './CommandPalette'
import { NotificationPanel, useUnreadNotificationCount } from './NotificationPanel'
import { useNavItemVisibility } from './Sidebar'
import { useShellTone } from './use-shell-tone'

/** 顶栏按钮的色系文字与悬停底（v3-classic-ui-openproject-style）。 */
export const headerButtonClass =
  'text-[color:var(--shell-header-fg)] hover:bg-[color:var(--shell-header-hover)] hover:text-[color:var(--shell-header-fg)] active:bg-[color:var(--shell-header-hover)]'

export interface TopbarProps {
  /**
   * 内容区滚动容器 ref。v3-classic-ui-openproject-style 起顶栏位于滚动容器之外常驻可见，
   * 不再监听滚动；保留该字段以兼容既有调用方。
   */
  scrollContainerRef?: React.RefObject<HTMLElement>
}

/**
 * 通知铃铛组件（tasks 4.2/4.3）：
 * - 显示未读数量徽章（99+ 封顶）
 * - 展开 NotificationPanel
 */
function NotificationBell({ className }: { className?: string }) {
  const { data } = useUnreadNotificationCount()
  const unreadCount = data?.unreadCount ?? 0

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <IconButton
              aria-label={`通知${unreadCount > 0 ? `，${unreadCount} 条未读` : ''}`}
              className={className}
            >
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
export function CopilotTopbarTrigger({
  shortcut,
  className,
}: {
  shortcut: string | null
  className?: string
}) {
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
          className={className}
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
export function NextTrackEntryButton({ className }: { className?: string } = {}) {
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
        className,
      )}
    >
      <Rocket className="h-4 w-4 text-ai" aria-hidden />
      <span className="sr-only md:not-sr-only">进入新页面</span>
    </button>
  )
}

/** 「项目」下拉：打开时才读取最近项目（最多 8 个）。 */
export function ProjectQuickSwitcher({ className }: { className?: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const recent = useQuery({
    queryKey: [...projectKeys.lists(), 'quick-switcher'],
    queryFn: () => projectsApi.list({ perPage: 8 }),
    enabled: open,
  })
  const projects = recent.data?.data ?? []
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* 可访问名用「切换项目」：页面内筛选用的项目下拉（风险、资源、问题工作台）叫「选择项目」，
          同名会让读屏用户分不清，也会让按标签定位的测试命中两个控件 */}
      <DropdownMenuTrigger
        aria-label="切换项目"
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-sm font-medium',
          headerButtonClass,
          focusRing,
          className,
        )}
      >
        <FolderKanban className="h-4 w-4" aria-hidden />
        <span>项目</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="min-w-64">
        <DropdownMenuLabel>最近项目</DropdownMenuLabel>
        {recent.isLoading ? <DropdownMenuItem disabled>正在加载…</DropdownMenuItem> : null}
        {recent.isError ? <DropdownMenuItem disabled>项目加载失败</DropdownMenuItem> : null}
        {recent.isSuccess && projects.length === 0 ? (
          <DropdownMenuItem disabled>暂无项目</DropdownMenuItem>
        ) : null}
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => router.push(`/projects/${project.id}`)}
          >
            <span className="flex-1 truncate">{project.name}</span>
            {project.code ? (
              <span className="font-mono text-xs text-gray-500">{project.code}</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/projects')}>查看全部项目</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 「新建」菜单：只链接既有路由。 */
export function CreateMenu({ className }: { className?: string }) {
  const router = useRouter()
  const { canAny } = usePermissions()
  if (!canAny(['project:create'])) return null
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="新建" className={cn(headerButtonClass, className)}>
              <Plus className="h-5 w-5" aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>新建</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-48">
        <DropdownMenuItem onSelect={() => router.push('/ai-create')}>
          <Sparkles className="h-4 w-4 text-ai" aria-hidden />
          AI 快速创建项目
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/projects/new')}>
          <FolderKanban className="h-4 w-4" aria-hidden />
          新建项目
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 全局模块菜单：与侧栏同源、同过滤规则，便于在项目内跳到全局功能。 */
export function GlobalModulesMenu({ className }: { className?: string }) {
  const router = useRouter()
  const isVisible = useNavItemVisibility()
  const groups = [
    ...primaryNavGroups,
    { id: 'secondary', label: '管理与帮助', items: secondaryNavItems },
  ]
    .map((group) => ({ ...group, items: group.items.filter(isVisible) }))
    .filter((group) => group.items.length > 0)
  if (groups.length === 0) return null
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label="全局模块" className={cn(headerButtonClass, className)}>
              <LayoutGrid className="h-4 w-4" aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>全局模块</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-56">
        {groups.map((group, index) => (
          <React.Fragment key={group.id}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <DropdownMenuItem key={item.href} onSelect={() => router.push(item.href)}>
                  <Icon className="h-4 w-4" aria-hidden />
                  {item.label}
                </DropdownMenuItem>
              )
            })}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 顶栏（v3-classic-ui-openproject-style，OpenProject 式全宽顶栏）：
 *
 * 结构（48px 高，横跨整个视窗，位于内容滚动容器之外，常驻可见）：
 *   左：窄屏（<1024px）「打开导航」抽屉 + logo + 「项目」下拉（桌面折叠开关在侧栏内，对齐 OpenProject 16.2）
 *   中：搜索触发（Cmd+K，唤起命令面板）
 *   右：新建 / 全局模块 / 通知 / Copilot / 新页面入口 / 外观（主题、色系、密度）/ 用户菜单
 *
 * 底色与文字取当前色系的顶栏令牌；面包屑与 Dashboard 问候移到内容区页面工具列（AppShell）。
 */
export function Topbar(_props: TopbarProps = {}) {
  const { setOpen: setPaletteOpen } = useCommandPalette()
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const copilotShortcut = useCopilotToggleShortcutDisplay()
  const { headerOnDark } = useShellTone()

  return (
    <header
      className={cn(
        'z-[var(--z-sticky)] flex h-12 shrink-0 items-center gap-1 border-b border-[color:var(--shell-header-border)] px-2 sm:gap-2 sm:px-3',
        'bg-[color:var(--shell-header-bg)] text-[color:var(--shell-header-fg)]',
      )}
      data-topbar
    >
      {/* 窄屏（<1024px）：汉堡唤起抽屉 */}
      <IconButton
        aria-label="打开导航"
        size="sm"
        className={cn(headerButtonClass, 'lg:hidden')}
        onClick={() => setMobileNavOpen(true)}
      >
        <Menu className="h-5 w-5" aria-hidden />
      </IconButton>

      <Link
        href="/dashboard"
        aria-label="开项 KaiPilot 首页"
        className={cn(
          'flex min-w-0 shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-1 text-sm font-semibold',
          focusRing,
        )}
      >
        <BrandLogo size={28} onDark={headerOnDark} showName={false} imageClassName="h-7 w-7" />
        <span className="hidden truncate sm:inline">开项 AI</span>
      </Link>

      <ProjectQuickSwitcher className="ml-1 hidden md:inline-flex" />

      <div className="flex min-w-0 flex-1 justify-center px-2">
        {/* 全局搜索触发 = 打开命令面板 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="搜索或运行命令"
              className={cn(
                'hidden h-8 w-full max-w-[420px] items-center gap-2 rounded-[var(--radius-md)] px-3 text-left text-sm',
                'border border-[color:var(--shell-header-hover)] bg-[color:var(--shell-header-hover)] text-[color:var(--shell-header-fg)]',
                'opacity-90 transition-opacity hover:opacity-100',
                'md:inline-flex',
                focusRing,
              )}
            >
              <Search className="h-4 w-4" aria-hidden />
              <span className="flex-1 truncate">搜索或运行命令</span>
              <kbd className="rounded-[var(--radius-sm)] border border-current px-1.5 py-0.5 text-[10px] font-medium opacity-70">
                Cmd K
              </kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent>命令面板 (Cmd/Ctrl + K)</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {/* 小屏只显示图标按钮 */}
        <IconButton
          aria-label="搜索或运行命令"
          className={cn(headerButtonClass, 'md:hidden')}
          onClick={() => setPaletteOpen(true)}
        >
          <Search className="h-4 w-4" aria-hidden />
        </IconButton>

        <CreateMenu className="hidden sm:inline-flex" />
        <GlobalModulesMenu className="hidden sm:inline-flex" />

        {/* 通知铃铛（tasks 4.2/4.3） */}
        <NotificationBell className={headerButtonClass} />

        {/* Copilot 触发——状态感知入口（v3-copilot-productized-operating-entry 任务 5.4）：
            保留既有触发器身份、快捷键与关闭后精确焦点回归；只增加低噪声状态表达。 */}
        <CopilotTopbarTrigger shortcut={copilotShortcut} className={headerButtonClass} />

        {/* 新 UI 入口（v3-ui-next-track-foundation 任务 5.1）：Flag 开启且已认证时显示 */}
        <NextTrackEntryButton className="border-[color:var(--shell-header-hover)] text-[color:var(--shell-header-fg)] hover:border-[color:var(--shell-header-fg)] hover:text-[color:var(--shell-header-fg)]" />

        <ThemeDensityMenu triggerClassName={headerButtonClass} />

        <UserMenu
          compact
          triggerClassName="hover:bg-[color:var(--shell-header-hover)] text-[color:var(--shell-header-fg)]"
        />
      </div>
    </header>
  )
}
