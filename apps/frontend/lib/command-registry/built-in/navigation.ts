import { allNavItems } from '@/lib/navigation'
import { registerStaticCommands } from '../register'
import { commandPush } from '../router-bridge'
import type { RegisteredCommand } from '../types'

/**
 * 内置导航命令（design.md D5）：将 `lib/navigation.ts` 的 `allNavItems` 映射为
 * 静态 navigate 命令。权限过滤由面板渲染时按 `requiresPermission` 完成，
 * 这里仅声明权限元数据。
 *
 * `execute` 通过 `commandPush` 走 router 桥接（保持 SPA 跳转）。
 */
export function buildNavigationCommands(): RegisteredCommand[] {
  return allNavItems.map((item) => ({
    id: `nav.${item.href}`,
    label: item.label,
    keywords: item.keywords,
    icon: item.icon,
    group: 'navigation',
    effect: 'navigate',
    requiresPermission: item.requiresPermission,
    featureGate: item.featureGate,
    enterpriseOnly: item.enterpriseOnly,
    execute: () => commandPush(item.href),
  }))
}

let registered = false

/** 注册内置导航命令（幂等，仅在客户端）。 */
export function registerNavigationCommands(): void {
  if (registered) return
  registered = true
  registerStaticCommands(buildNavigationCommands())
}
