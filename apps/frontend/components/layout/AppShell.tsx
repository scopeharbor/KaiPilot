'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent } from '@/components/ui/Sheet'
import { useUiStore } from '@/stores/ui-store'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPaletteProvider } from './CommandPalette'
import { PluginCommandHostBridge } from './PluginCommandHostBridge'
import { CopilotSidebarPanel } from '@/components/copilot/CopilotSidebarPanel'
import { CopilotOnboardingGuide } from '@/components/copilot/CopilotOnboardingGuide'
import { useDeclareCopilotDemoCapability } from '@/lib/copilot/demo-capability'
import { WorkspaceEditionBoundary } from './WorkspaceEditionBoundary'

export interface AppShellProps {
  children: React.ReactNode
}

/**
 * AppShell（build-app-shell-layout / spec app-shell-navigation）：
 *
 * 布局：`grid-cols-[auto_minmax(0,1fr)]` —— 侧栏列宽由内部 aside 决定（240 常驻 / 64 折叠）；
 *      内容列独占滚动容器；顶栏 sticky 在内容列内部。
 *
 * 断点：
 *   Mobile (<768px)：侧栏隐藏（`md:` 显示），改用汉堡 + Sheet 抽屉承载同一份导航；
 *   Tablet (768–1024)：侧栏折叠 64（强制），忽略用户偏好；
 *   Desktop (>=1024)：按 `ui-store.sidebarCollapsed` 用户偏好决定 240↔64；
 *   Large  (>=1440)：内容 1440 居中（内容区自己 mx-auto max-w-[1440px]）。
 *
 * 移动抽屉的开关走 `ui-store.mobileNavOpen`（会话态，不持久化）。
 * 路由切换后自动关抽屉——避免选完菜单还挡着视线。
 */
export function AppShell({ children }: AppShellProps) {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const scrollContainerRef = React.useRef<HTMLElement | null>(null)
  const pathname = usePathname()

  // 演示能力的**唯一**声明点（v3-copilot-productized-operating-entry D7）：
  // 只读构建期显式开关；声明本身不进入演示，还需用户在入口显式选择。
  useDeclareCopilotDemoCapability()

  // 路由变化时自动关移动抽屉。
  React.useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname, setMobileNavOpen])

  return (
    <PluginCommandHostBridge>
      <CommandPaletteProvider>
        <div className="grid h-dvh grid-cols-[minmax(0,1fr)] md:grid-cols-[auto_minmax(0,1fr)]">
          {/*
          桌面/平板侧栏：md~lg 断点强制折叠；lg 起按 ui-store 用户偏好。
          用 CSS 隔离两套断点内的样式，避免在 JS 里读断点（首屏无 SSR 数据）。
        */}
          <div className="hidden md:block lg:hidden">
            <Sidebar forceCollapsed hideCollapseToggle />
          </div>
          <div className="hidden lg:block">
            <Sidebar />
          </div>

          {/* 移动抽屉 —— <768px 唤起，承载同一份导航 */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent side="left" className="w-64 max-w-[80vw] p-0">
              <Sidebar
                forceCollapsed={false}
                hideCollapseToggle
                onNavigate={() => setMobileNavOpen(false)}
              />
            </SheetContent>
          </Sheet>

          {/* Copilot 全局侧栏壳（v3-copilot-sidebar-shell）：与 main 同级，右侧固定覆盖 */}
          <CopilotSidebarPanel />

          {/* Copilot 新手引导（v3-copilot-mode-adaptation §5）：首次使用时显示 */}
          <CopilotOnboardingGuide />

          {/* 内容列——独立滚动容器 */}
          <main
            ref={scrollContainerRef as React.RefObject<HTMLElement>}
            className={cn(
              'relative flex min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden bg-background',
            )}
            data-app-shell-scroll
          >
            <Topbar scrollContainerRef={scrollContainerRef as React.RefObject<HTMLElement>} />
            {/*
            内容中性容器（决策 D9）：
            - 提供统一的滚动 + 间距；
            - 页面只负责垂直节奏，横向边距与最大宽度由 AppShell 统一管理；
            - 超宽屏（>1440px）时对齐令牌：内容 1440 居中，左右加至 48px 边距。
          */}
            <div className="min-h-[calc(100dvh-56px)] min-w-0 px-3 md:px-6 xl:px-10 2xl:px-12">
              <div className="mx-auto w-full 2xl:max-w-[1440px]">
                <WorkspaceEditionBoundary>{children}</WorkspaceEditionBoundary>
              </div>
            </div>
          </main>
        </div>
      </CommandPaletteProvider>
    </PluginCommandHostBridge>
  )
}
