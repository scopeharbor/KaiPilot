import {
  LayoutDashboard,
  FolderKanban,
  Sparkles,
  CheckSquare,
  BarChart3,
  ShieldAlert,
  Users,
  Calendar,
  Settings,
  HelpCircle,
  ScrollText,
  FileEdit,
  Bell,
  Plug,
  Search,
  Lightbulb,
  Activity,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import type { PlanTier } from '@/stores/auth-store'
import { canUseEnterpriseFeatures } from '@/lib/workspace-edition'

/**
 * 集中式导航配置（build-app-shell-layout D6 / spec app-shell-navigation）。
 *
 * - 唯一事实来源：Sidebar 与 CommandPalette 均从此驱动；禁止其他处硬编码路由/图标。
 * - 权限过滤：Sidebar/CommandPalette 渲染前按 `usePermissions` 过滤 `requiresPermission`。
 * - 套餐过滤：`enterpriseOnly` 标记的条目在 `planTier` 为 free/缺失时不渲染
 *   （个人免费组织不出现企业能力入口；服务端仍是最終边界）。
 * - 路由/图标名对齐 `docs/v1/ai-project-os-spec/stage2a_ui_ux_spec.md` §2.1.1。
 * - `pro`（专业项）在新手模式下按 UI 偏好隐藏——V1 先留字段；专业/新手模式落地后启用。
 */

export interface NavItemConfig {
  /** 中文短标签，侧栏与命令面板共用；折叠态 hover tooltip 也用此。 */
  label: string
  /** 目的路由（Next.js App Router 绝对路径）。 */
  href: string
  /** Lucide 图标——集中导入，防止散落 import。 */
  icon: LucideIcon
  /**
   * 展示层权限门槛（`use-permissions` 判定）。
   * `undefined` 表示任何登录用户可见；数组任一命中即可。
   */
  requiresPermission?: string[]
  /** 组织级功能门；关闭或不可读取时不进入导航与命令面板。 */
  featureGate?: 'release-trust'
  /**
   * 企业能力入口标记（SSO/KMS/DLP/合规/多租户/AI 质量成本/发布信任等）。
   * `planTier` 为 `free`（或缺失）时，Sidebar 与 CommandPalette 均跳过该条目。
   */
  enterpriseOnly?: boolean
  /**
   * 是否属专业模式项。V1 先记录字段，实际过滤由后续「新手/专业模式」change 落地。
   */
  pro?: boolean
  /**
   * 命令面板搜索关键字（除 label 外的补充命中，纯中文用户友好）。
   */
  keywords?: string[]
}

/**
 * 企业能力入口是否在当前套餐下可见：仅 `team`/`enterprise` 可见，
 * `free` 或缺失/未知（`null`/`undefined`）一律隐藏（最保守）。
 */
export function isEnterpriseEntryVisible(
  planTier: PlanTier | null | undefined,
  isSuperAdmin = false,
): boolean {
  return canUseEnterpriseFeatures(planTier, isSuperAdmin)
}

export interface NavGroupConfig {
  /** 分组 ID，稳定用于 React key。 */
  id: string
  /** 分组标题（折叠态不显示）。 */
  label: string
  items: NavItemConfig[]
}

/** 第一组——核心功能（stage2a §2.1.1 第一组）。 */
const coreGroup: NavGroupConfig = {
  id: 'core',
  label: '核心功能',
  items: [
    {
      label: '仪表盘',
      href: '/dashboard',
      icon: LayoutDashboard,
      keywords: ['dashboard', 'home'],
    },
    {
      label: '高级搜索',
      href: '/search',
      icon: Search,
      keywords: ['search', '搜索', '查找'],
    },
    {
      label: '通知中心',
      href: '/notifications',
      icon: Bell,
      keywords: ['notifications', '通知', 'bell', '提醒'],
    },
    {
      label: '项目列表',
      href: '/projects',
      icon: FolderKanban,
      requiresPermission: ['project:view'],
      keywords: ['projects', '项目'],
    },
    {
      label: 'AI 快速创建',
      href: '/ai-create',
      icon: Sparkles,
      requiresPermission: ['project:create'],
      keywords: ['ai', '一句话', 'create'],
    },
    {
      label: '任务',
      href: '/tasks',
      icon: CheckSquare,
      requiresPermission: ['task:view'],
      keywords: ['tasks', '待办'],
    },
  ],
}

/** 第二组——分析与资源（stage2a §2.1.1 第二组）。 */
const analyticsGroup: NavGroupConfig = {
  id: 'analytics',
  label: '分析与资源',
  items: [
    {
      label: '报表与甘特',
      href: '/reports',
      icon: BarChart3,
      pro: true,
      keywords: ['reports', '甘特', 'gantt'],
    },
    {
      label: '风险管理',
      href: '/risks',
      icon: ShieldAlert,
      requiresPermission: ['risk:view'],
      pro: true,
      keywords: ['risks', '风险'],
    },
    {
      label: '变更管理',
      href: '/change-requests',
      icon: FileEdit,
      requiresPermission: ['change_request:create'],
      keywords: ['change', '变更', '审批'],
    },
    {
      label: '资源管理',
      href: '/resources',
      icon: Users,
      pro: true,
      keywords: ['resources', '成员', '负载'],
    },
    {
      label: '智能推荐',
      href: '/recommendations',
      icon: Lightbulb,
      requiresPermission: ['recommendation:view'],
      pro: true,
      keywords: ['recommendations', '推荐', '建议', 'insights'],
    },
    {
      label: 'PMO 组合',
      href: '/pmo',
      icon: Activity,
      requiresPermission: ['portfolio:view'],
      pro: true,
      keywords: ['pmo', 'portfolio', '组合', '管理层', 'dashboard'],
    },
    {
      label: '日历视图',
      href: '/calendar',
      icon: Calendar,
      keywords: ['calendar', '日程'],
    },
  ],
}

/** 主导航（两组）。 */
export const primaryNavGroups: NavGroupConfig[] = [coreGroup, analyticsGroup]

/** 底部区域——设置/帮助（用户菜单独立由 UserMenu 组件承载）。 */
export const secondaryNavItems: NavItemConfig[] = [
  {
    label: 'Skill Registry',
    href: '/settings/compiler-skills',
    icon: Sparkles,
    requiresPermission: ['ai:compiler:skill:view'],
    keywords: ['skill', 'compiler', '技能', '知识', '领域'],
  },
  {
    label: '集成设置',
    href: '/settings/integrations',
    icon: Plug,
    requiresPermission: ['integration:connect'],
    keywords: ['integrations', '集成', '日历绑定', 'slack', '飞书', '钉钉'],
  },
  {
    label: 'AI 连接',
    href: '/settings/ai-connections',
    icon: Sparkles,
    requiresPermission: ['ai:connection:manage', 'ai:trigger'],
    keywords: ['ai', 'connection', '模型', 'key', 'openai', 'anthropic'],
  },
  {
    label: '审计日志（组织）',
    href: '/settings/audit-logs',
    icon: ScrollText,
    requiresPermission: ['audit:view'],
    keywords: ['audit', '审计', '日志', '操作记录'],
  },
  {
    label: '审计日志（全局）',
    href: '/admin/audit-logs',
    icon: ScrollText,
    requiresPermission: ['system:admin'],
    keywords: ['audit', '审计', '日志', '操作记录', 'admin'],
  },
  {
    // 个人账号安全，不是企业能力：不加 enterpriseOnly、不设权限门，
    // 任何登录用户都应当能给自己的账号加一道锁。
    label: '两步验证',
    href: '/settings/security/two-factor',
    icon: ShieldCheck,
    keywords: [
      '2fa',
      'two factor',
      'totp',
      'mfa',
      '两步验证',
      '双因子',
      '验证码',
      '认证器',
      '恢复码',
      '安全',
      'security',
    ],
  },
  {
    label: '设置',
    href: '/settings',
    icon: Settings,
    keywords: ['settings', '偏好'],
  },
  {
    label: '帮助与文档',
    href: '/help',
    icon: HelpCircle,
    keywords: ['help', '文档', 'docs'],
  },
]

/** 全部导航项打平——命令面板跳转命令用。 */
export const allNavItems: NavItemConfig[] = [
  ...primaryNavGroups.flatMap((group) => group.items),
  ...secondaryNavItems,
]

/**
 * 判断给定路径是否命中导航项（含子路径）。
 * 例：href = /projects → /projects、/projects/123、/projects/new 均视为命中；
 *     href = /dashboard → 仅严格前缀命中（避免与 / 冲突）。
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * 当前路径应高亮的唯一导航 href——所有命中项里取前缀最长的一个。
 * 解决共享前缀父项误亮问题（如停留 `/settings/audit-logs` 时不再高亮 `/settings`「设置」）。
 * （polish-v1-ui-and-assignment / D2）
 */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null
  for (const item of allNavItems) {
    if (isNavItemActive(item.href, pathname)) {
      if (best === null || item.href.length > best.length) best = item.href
    }
  }
  return best
}

/**
 * 项目内 6 视图 Tab（build-app-shell-layout / spec project-view-tabs）。
 * 顺序即 Tab 显示顺序；默认视图重定向到 `defaultProjectView`。
 *
 * 自定义视图不在此列表中——它们在 ProjectTabs 中以动态列表形式附加。
 * V2 扩展（v2-custom-views-view-config）：自定义视图通过 `?customView=ID` search param 表达。
 */
export const projectViewTabs: Array<{
  /** 路由段（与 `(views)/<value>` 目录同名）。 */
  value: 'kanban' | 'list' | 'gantt' | 'calendar' | 'timeline' | 'wbs'
  label: string
}> = [
  { value: 'kanban', label: '看板' },
  { value: 'list', label: '列表' },
  { value: 'gantt', label: '甘特图' },
  { value: 'calendar', label: '日历' },
  { value: 'timeline', label: '时间线' },
  { value: 'wbs', label: 'WBS' },
]

export const defaultProjectView = 'kanban' as const

/** 自定义视图 search param 键名（v2-custom-views-view-config）。 */
export const CUSTOM_VIEW_PARAM = 'customView' as const

/** 基础视图路由段集合——用于判断当前是否在某一基础视图中。 */
export const baseViewValues = new Set(projectViewTabs.map((t) => t.value))

/**
 * 判断自定义视图是否激活：当 pathname 命中任一基础视图且 searchParams 含 `CUSTOM_VIEW_PARAM` 且值为指定 ID 时返回 true。
 * 用于 Tab 高亮。
 */
export function isCustomViewActive(
  customViewId: number,
  pathname: string,
  searchParams: URLSearchParams,
): boolean {
  const paramViewId = searchParams.get(CUSTOM_VIEW_PARAM)
  if (!paramViewId) return false
  if (String(customViewId) !== paramViewId) return false
  // 确认当前正在某个基础视图路由内（自定义视图不独自占路由段）
  const segments = pathname.split('/').filter(Boolean)
  const lastSegment = segments[segments.length - 1]
  return baseViewValues.has(lastSegment as typeof defaultProjectView)
}

/**
 * 解析项目默认入口：若当前用户设定了默认自定义视图则生成带 search param 的 URL，否则返回基础默认视图 URL。
 *
 * §6.5 P0：renderer-backed 默认入口先尝试解析，失败则回退到基础默认视图。
 *
 * @param projectId - 项目 ID
 * @param defaultCustomViewId - 当前用户的默认自定义视图 ID（可选）
 * @param rendererBacked - 是否为 renderer-backed 视图（可选）
 */
export function resolveDefaultEntry(
  projectId: number,
  defaultCustomViewId?: number | null,
  rendererBacked?: boolean,
): string {
  if (defaultCustomViewId) {
    const base = `/projects/${projectId}/${defaultProjectView}`
    if (rendererBacked) {
      // renderer-backed 视图：添加 renderer 标记
      return `${base}?${CUSTOM_VIEW_PARAM}=${defaultCustomViewId}&renderer=true`
    }
    return `${base}?${CUSTOM_VIEW_PARAM}=${defaultCustomViewId}`
  }
  return `/projects/${projectId}/${defaultProjectView}`
}

/**
 * §6.4 P0：判断导航 entry 是否为 renderer-backed 视图。
 */
export function isRendererBackedView(searchParams: URLSearchParams): boolean {
  return searchParams.get('renderer') === 'true'
}

/**
 * §6.5 P0：生成 renderer-backed 视图的回退 URL。
 * 当默认的 renderer 视图不可用时，返回基础默认视图。
 */
export function resolveRendererDefaultFallback(projectId: number): string {
  return `/projects/${projectId}/${defaultProjectView}`
}
