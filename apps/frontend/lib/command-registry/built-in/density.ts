import { Rows2, Rows3 } from 'lucide-react'
import { registerStaticCommands } from '../register'
import { commandSetDensity } from '../settings-bridge'
import type { RegisteredCommand } from '../types'

/**
 * 内置密度切换命令（design.md D5）：舒适/紧凑，`effect: 'ui-setting'`，
 * `execute` 经 settings-bridge 调 `ui-store` 的 `setDensity`。
 */
export function buildDensityCommands(): RegisteredCommand[] {
  return [
    {
      id: 'density.comfortable',
      label: '舒适密度',
      keywords: ['密度', '舒适', 'comfortable'],
      icon: Rows3,
      group: 'density',
      effect: 'ui-setting',
      execute: () => commandSetDensity('comfortable'),
    },
    {
      id: 'density.compact',
      label: '紧凑密度',
      keywords: ['密度', '紧凑', 'compact'],
      icon: Rows2,
      group: 'density',
      effect: 'ui-setting',
      execute: () => commandSetDensity('compact'),
    },
  ]
}

let registered = false

/** 注册内置密度命令（幂等，仅在客户端）。 */
export function registerDensityCommands(): void {
  if (registered) return
  registered = true
  registerStaticCommands(buildDensityCommands())
}
