import { useCommandRegistryStore } from './store'
import type { RegisteredCommand } from './types'

/**
 * 静态命令注册（design.md D3）。
 *
 * 在 `"use client"` 模块顶层调用，应用生命周期内常驻。为避免 SSR 问题与重复注册，
 * 仅在客户端（`typeof window !== 'undefined'`）执行注册；服务端渲染期跳过。
 *
 * 幂等性：`addCommands` 按 ID 去重，重复 import 同一模块不会产生重复条目。
 *
 * @param commands 静态命令列表（如 navigation / theme / density）
 */
export function registerStaticCommands(commands: RegisteredCommand[]): void {
  // SSR 守卫：服务端不注册，避免模块副作用污染。
  if (typeof window === 'undefined') return
  if (commands.length === 0) return
  useCommandRegistryStore.getState().addCommands(commands)
}
