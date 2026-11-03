import { BarChart3, Building2, Network, UserRound, Users } from 'lucide-react'
import { secondaryNavItems, type NavItemConfig } from '@/lib/navigation'

/**
 * 设置与管理菜单（v3-classic-ui-openproject-pages，OpenProject 式 Administration 侧栏）。
 *
 * 进入 `/settings`、`/admin` 时，旧版侧栏改为本菜单。条目分三组：个人、组织、平台管理。
 * 组织与平台管理组从 `secondaryNavItems` 按路径前缀派生——企业版条目（DLP / KMS / SSO / 合规 / 多租户等）
 * 仍由 navigation.ts 的版本标记决定是否存在，本文件不重复列举；可见性仍走侧栏同一套权限 / 套餐过滤。
 */
export interface SettingsMenuGroup {
  id: 'personal' | 'organization' | 'platform'
  label: string
  items: NavItemConfig[]
}

const PROFILE: NavItemConfig = {
  label: '个人资料',
  href: '/settings/profile',
  icon: UserRound,
}

const ORGANIZATION: NavItemConfig = {
  label: '组织设置',
  href: '/settings/organization',
  icon: Building2,
  requiresPermission: ['org:view'],
}

const AI_USAGE: NavItemConfig = {
  label: 'AI 用量',
  href: '/settings/ai-usage',
  icon: BarChart3,
}

const USERS: NavItemConfig = {
  label: '用户管理',
  href: '/admin/users',
  icon: Users,
  requiresPermission: ['system:admin'],
}

const COMPILER_ROUTING: NavItemConfig = {
  label: '编译路由',
  href: '/admin/compiler-routing',
  icon: Network,
  requiresPermission: ['ai:compiler:routing:view', 'ai:compiler:routing:manage'],
}

const TWO_FACTOR_HREF = '/settings/security/two-factor'

export function settingsMenuGroups(): SettingsMenuGroup[] {
  const twoFactor = secondaryNavItems.filter((item) => item.href === TWO_FACTOR_HREF)
  const orgItems = secondaryNavItems.filter(
    (item) => item.href.startsWith('/settings/') && item.href !== TWO_FACTOR_HREF,
  )
  const adminItems = secondaryNavItems.filter((item) => item.href.startsWith('/admin/'))
  return [
    { id: 'personal', label: '个人', items: [PROFILE, ...twoFactor] },
    { id: 'organization', label: '组织', items: [ORGANIZATION, AI_USAGE, ...orgItems] },
    { id: 'platform', label: '平台管理', items: [USERS, COMPILER_ROUTING, ...adminItems] },
  ]
}

/** `/settings`、`/admin` 及其子路径使用设置与管理菜单。 */
export function isSettingsPath(pathname: string): boolean {
  return /^\/(settings|admin)(?:\/|$)/.test(pathname)
}

/** 当前条目：路径等于或以条目路径为前缀，取最长命中。 */
export function activeSettingsHref(pathname: string, items: NavItemConfig[]): string | null {
  let best: string | null = null
  for (const item of items) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.length) best = item.href
    }
  }
  return best
}

/** 非项目路径段的中文名（面包屑兜底，避免显示英文 slug）。 */
export const GENERIC_SEGMENT_LABELS: Record<string, string> = {
  settings: '设置',
  admin: '平台管理',
  profile: '个人资料',
  organization: '组织',
  'ai-usage': 'AI 用量',
  'ai-connections': 'AI 连接',
  integrations: '集成设置',
  callback: '授权回调',
  'audit-logs': '审计日志',
  'compiler-skills': 'Skill Registry',
  'compiler-routing': '编译路由',
  security: '安全',
  'two-factor': '两步验证',
  users: '用户管理',
  multitenancy: '多租户治理',
  bi: 'BI 分析',
  dashboards: '仪表盘',
  trends: '趋势',
  'risk-heatmap': '风险热力图',
  okrs: 'OKR',
  'plugin-directory': '插件目录',
  'plugin-policies': '插件策略',
  'resource-pool': '资源池',
  'resource-gaps': '资源缺口',
  'resource-contentions': '资源争用',
  'resource-demand-forecasting': '资源需求预测',
  'resource-capacity-loops': '产能闭环',
  'cross-project-resource-allocation': '跨项目资源分配',
  decisions: '决策',
  dependencies: '依赖',
  'grouping-views': '分组视图',
  'impact-analysis': '影响分析',
  'priority-scoring': '优先级评分',
  'traffic-light': '交通灯',
  'ai-priority-recommendations': 'AI 优先级建议',
  'skill-matrix': '技能矩阵',
  articles: '文章',
  search: '搜索',
  operations: '运营',
  new: '新建',
}
