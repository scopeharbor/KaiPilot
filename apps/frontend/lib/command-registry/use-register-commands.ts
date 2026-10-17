'use client'

import * as React from 'react'
import { useCommandRegistryStore } from './store'
import type { RegisteredCommand } from './types'

/**
 * 上下文命令注册 hook（design.md D3 / spec「上下文命令随组件挂载注册」）。
 *
 * - 组件挂载时批量注册 `commands`，卸载时按其 ID 批量注销；
 * - **Strict Mode 幂等**：React Strict Mode 下 effect 双调用（mount → unmount → mount），
 *   因 cleanup 在首次 unmount 时已注销、二次 mount 时重新注册，注册表中只保留一份；
 *   且 `addCommands` 按 ID 去重，杜绝重复条目与泄漏。
 *
 * @param commands 命令数组或返回命令数组的工厂（工厂可读取 props/state 形成闭包）
 * @param deps 重新注册的依赖列表（与 effect 一致；变化时先注销旧命令再注册新命令）
 */
export function useRegisterCommands(
  commands: RegisteredCommand[] | (() => RegisteredCommand[]),
  deps: unknown[] = [],
): void {
  const addCommands = useCommandRegistryStore((s) => s.addCommands)
  const removeCommands = useCommandRegistryStore((s) => s.removeCommands)

  // 用 ref 持有最近注册的命令 ID，确保 cleanup 注销的是真正注册过的那批，
  // 即便 deps 期间 commands 引用变化也能正确清理。
  const registeredIdsRef = React.useRef<string[]>([])

  React.useEffect(() => {
    const cmds = typeof commands === 'function' ? commands() : commands
    addCommands(cmds)
    registeredIdsRef.current = cmds.map((c) => c.id)
    return () => {
      removeCommands(registeredIdsRef.current)
      registeredIdsRef.current = []
    }
    // commands 工厂可能每次 render 都是新引用；只按 deps 触发重新注册。
  }, deps)
}
