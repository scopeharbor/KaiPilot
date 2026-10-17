import { registerNavigationCommands } from './navigation'
import { registerThemeCommands } from './theme'
import { registerDensityCommands } from './density'
import { registerLayoutCommands } from './layout'
import { registerCopilotCommands } from './copilot'

/**
 * 内置命令注册统一入口（design.md D5 / spec「静态命令在面板中可见」）。
 *
 * 在 `CommandPaletteProvider` 中 import 此模块（副作用），应用启动时触发
 * navigation / theme / density / layout / copilot 五组静态命令注册。各 `register*` 函数幂等，
 * SSR 守卫由 `registerStaticCommands` 保证。
 */
export function registerBuiltInCommands(): void {
  registerNavigationCommands()
  registerThemeCommands()
  registerDensityCommands()
  registerLayoutCommands()
  registerCopilotCommands()
}

// 模块加载即注册——`CommandPaletteProvider` import 本模块后自动触发。
registerBuiltInCommands()
