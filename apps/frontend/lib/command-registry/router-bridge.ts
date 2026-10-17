'use client'

import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

/**
 * 静态命令的 router 桥接（design.md D3：「router 通过闭包或回调引用」）。
 *
 * 静态命令在模块 import 时注册，没有 React 上下文，无法直接拿 `useRouter()`。
 * `CommandPaletteDialog`（始终在客户端挂载）用 `useRouter()` 获取 router 后调用
 * `setCommandRouter(router)` 注入；静态导航命令的 `execute` 通过 `commandPush(href)`
 * 间接跳转，保持 SPA 行为（不整页刷新）。
 *
 * 未注入时回退到 `window.location.assign`，保证命令仍可用（仅在面板尚未挂载的边角情况）。
 */
let routerRef: AppRouterInstance | null = null

export function setCommandRouter(router: AppRouterInstance | null): void {
  routerRef = router
}

/** 静态导航命令统一调用此函数跳转。 */
export function commandPush(href: string): void {
  if (routerRef) {
    routerRef.push(href)
    return
  }
  if (typeof window !== 'undefined') {
    window.location.assign(href)
  }
}
