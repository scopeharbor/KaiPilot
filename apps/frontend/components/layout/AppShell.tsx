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
import { Breadcrumb } from './Breadcrumb'
import { useClassicPaletteAttribute } from './use-shell-tone'

export interface AppShellProps {
  children: React.ReactNode
}

/**
 * AppShell（v3-classic-ui-openproject-style，OpenProject 式版面）：
 *
 * 布局：两行——全宽顶栏（48px，常驻）在上；下方 `grid-cols-[auto_minmax(0,1fr)]` 为侧栏 + 内容列，
 *      内容列独占滚动容器，顶部是页面工具列（面包屑 / Dashboard 问候）。
 *
 * 色系：挂载时把 `ui-store.classicPalette` 写到 `<html data-classic-palette>`，卸载时移除——
 *      客户端跳到新版界面时不残留旧版色系（首帧由根布局脚本写入）。
 *
 * 断点：
 *   Mobile (<768px)：侧栏隐藏，顶栏汉堡 + Sheet 抽屉承载同一份导航；
 *   Tablet (768–1024)：侧栏折叠 64（强制），顶栏汉堡可唤起完整抽屉；
 *   Desktop (>=1024)：按 `ui-store.sidebarCollapsed` 用户偏好决定 240↔64，开关在顶栏；
 *   Large  (>=1440)：内容 1440 居中。
 *
 * 移动抽屉的开关走 `ui-store.mobileNavOpen`（会话态，不持久化），路由切换后自动关闭。
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

  // 旧版色系：挂载写入、切换更新、卸载移除。
  useClassicPaletteAttribute()

  return (
    <PluginCommandHostBridge>
      <CommandPaletteProvider>
        <div data-classic-shell className="flex h-dvh flex-col bg-background">
          <Topbar scrollContainerRef={scrollContainerRef as React.RefObject<HTMLElement>} />

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[auto_minmax(0,1fr)]">
            {/*
            桌面/平板侧栏：md~lg 断点强制折叠；lg 起按 ui-store 用户偏好。
            用 CSS 隔离两套断点内的样式，避免在 JS 里读断点（首屏无 SSR 数据）。
          */}
            <div className="hidden min-h-0 md:block lg:hidden">
              <Sidebar forceCollapsed />
            </div>
            <div className="hidden min-h-0 lg:block">
              <Sidebar />
            </div>

            {/* 移动 / 平板抽屉 —— 顶栏汉堡唤起，承载同一份导航（抽屉盖住顶栏，因此带品牌行） */}
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetContent side="left" className="w-64 max-w-[80vw] p-0">
                <Sidebar
                  forceCollapsed={false}
                  showBrand
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
              {/* 页面工具列：面包屑 / Dashboard 问候 */}
              <div
                data-page-toolbar
                className="flex min-h-11 shrink-0 items-center border-b border-border bg-gray-0 px-3 md:px-6 xl:px-10 2xl:px-12"
              >
                <div className="mx-auto w-full min-w-0 2xl:max-w-[1440px]">
                  <Breadcrumb />
                </div>
              </div>
              {/*
              内容中性容器（决策 D9）：
              - 提供统一的滚动 + 间距；
              - 页面只负责垂直节奏，横向边距与最大宽度由 AppShell 统一管理；
              - 超宽屏（>1440px）时对齐令牌：内容 1440 居中，左右加至 48px 边距。
            */}
              <div className="min-w-0 flex-1 px-3 md:px-6 xl:px-10 2xl:px-12">
                <div data-page-content className="mx-auto w-full 2xl:max-w-[1440px]">
                  <WorkspaceEditionBoundary>{children}</WorkspaceEditionBoundary>
                </div>
              </div>
            </main>
          </div>
        </div>
      </CommandPaletteProvider>
    </PluginCommandHostBridge>
  )
}
