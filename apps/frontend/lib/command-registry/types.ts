import type { LucideIcon } from 'lucide-react'

/**
 * 命令副作用类型（typed command registry / spec command-palette）。
 *
 * **写操作边界**：本枚举**不含 `'write'`**——类型系统直接禁止注册直接执行业务写操作
 * （create/update/delete/apply/sync/AI 落库）的命令。命令面板只允许以下四类副作用：
 *
 * - `navigate`：路由跳转（安全，直接执行）。
 * - `ui-setting`：本地 UI 偏好切换（主题/密度，安全，直接执行）。
 * - `open-form`：导航到预填表单页或打开已有表单 Dialog（**不直接落库**）。
 * - `open-confirm`：打开已有确认 Dialog（**不直接落库**）。
 */
export type CommandEffect = 'navigate' | 'ui-setting' | 'open-form' | 'open-confirm'

/**
 * 命令分组 ID。内置分组顺序见 `GROUP_ORDER`；`plugin` 为已启用官方插件的
 * 「插件能力」独立分组（v3-command-palette-plugin-action-pack）；`custom` 供
 * 其他模块扩展，排在所有内置分组之后。
 */
export type CommandGroup =
  'contextual' | 'navigation' | 'search' | 'theme' | 'density' | 'plugin' | 'custom'

/**
 * 命令执行时传入的路由上下文。由 `CommandPaletteDialog` 用
 * `usePathname` / `useParams` / `useSearchParams` 构建后传给 `when` 与 `execute`。
 */
export interface CommandContext {
  pathname: string
  params: Record<string, string | string[]>
  searchParams: URLSearchParams
}

/**
 * 一条已注册命令。所有命令项由 registry 统一提供，禁止在面板组件体内硬编码。
 */
export interface RegisteredCommand {
  /** 稳定 ID。命名约定：`nav.<href>`、`theme.<name>`、`ctx.<scope>.<action>`、`ext.<module>.<action>`。 */
  id: string
  /** 中文标签。 */
  label: string
  /** 搜索关键词补充（除 label 外的命中词）。 */
  keywords?: string[]
  /** Lucide 图标组件。 */
  icon: LucideIcon
  /** 命令分组 ID。 */
  group: CommandGroup
  /** 副作用类型（类型层面禁止 `'write'`）。 */
  effect: CommandEffect
  /** RBAC 展示层权限门槛；`undefined`/空数组表示任何登录用户可见。任一命中即可。 */
  requiresPermission?: string[]
  /** 组织级功能门；由命令面板读取对应只读状态后过滤。 */
  featureGate?: 'release-trust'
  /**
   * 企业能力入口标记（与 `lib/navigation.ts` 的 `enterpriseOnly` 对齐）。
   * `planTier` 为 `free`（或缺失）时不进入命令面板。
   */
  enterpriseOnly?: boolean
  /** 上下文可见条件；返回 false 时该命令不出现在面板。 */
  when?: (ctx: CommandContext) => boolean
  /** 快捷键提示文本（仅显示，不绑定实际快捷键）。 */
  shortcut?: string
  /** 执行动作。`open-form`/`open-confirm` 的 execute 只能做路由跳转或 Dialog 开关。 */
  execute: (ctx: CommandContext) => void
}

/**
 * 内置分组渲染顺序（design.md D4 / spec「分组排序」）：
 * 快捷操作（上下文）→ 跳转页面 → 搜索建议 → 主题 → 密度 → 插件能力 → 自定义。
 * 分组顺序不得被单条命令覆盖。
 */
export const GROUP_ORDER: CommandGroup[] = [
  'contextual',
  'navigation',
  'search',
  'theme',
  'density',
  'plugin',
  'custom',
]

/** 分组中文标题。`search` 由面板运行时动态插入，标题在面板内定义。 */
export const GROUP_LABEL: Record<CommandGroup, string> = {
  contextual: '快捷操作',
  navigation: '跳转页面',
  search: '搜索建议',
  theme: '主题',
  density: '密度',
  plugin: '插件能力',
  custom: '更多',
}
