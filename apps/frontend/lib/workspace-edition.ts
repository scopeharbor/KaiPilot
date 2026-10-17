import type { PlanTier } from '@/stores/auth-store'

export type WorkspaceEdition = 'personal' | 'team' | 'enterprise'

/**
 * 产品版本由组织套餐决定。缺失或未知值按个人版处理，避免在会话恢复期间泄露企业入口。
 */
export function resolveWorkspaceEdition(planTier: PlanTier | null | undefined): WorkspaceEdition {
  if (planTier === 'enterprise') return 'enterprise'
  if (planTier === 'team') return 'team'
  return 'personal'
}

/**
 * 私有 SaaS 的「个人空间」语义：免费套餐组织是 Google 登录自动建立的单人空间，界面显示为
 * 「个人空间」、不展示组织名与组织资料。开源个人版没有这个概念——组织就是团队协作的单位，
 * 导出时把本常量替换为 false（v3-personal-edition-open-source-export，7.2 冒烟发现）。
 */
export const SAAS_PERSONAL_WORKSPACES = false

/** 该组织是否按私有 SaaS 的「个人空间」展示。 */
export function isSaasPersonalWorkspace(planTier: PlanTier | null | undefined): boolean {
  return SAAS_PERSONAL_WORKSPACES && resolveWorkspaceEdition(planTier) === 'personal'
}

export function canUseEnterpriseFeatures(
  planTier: PlanTier | null | undefined,
  isSuperAdmin = false,
): boolean {
  return isSuperAdmin || resolveWorkspaceEdition(planTier) !== 'personal'
}

/**
 * 企业版界面的统一路由边界。导航隐藏只是体验优化，本列表负责拦截收藏夹、历史记录和直链。
 */
export const ENTERPRISE_ROUTE_PREFIXES = [
  '/admin/ai-quality-cost',
  '/admin/multitenancy',
  '/admin/release-trust',
  // 私有 SaaS 里插件目录与策略包属于付费能力；开源个人版插件子系统不受套餐门控（design D6）
  '/settings/ai-usage',
  '/settings/multitenancy',
  '/settings/security/compliance',
  '/settings/security/dlp',
  '/settings/security/kms',
  '/settings/security/sso',
] as const

export function isEnterpriseRoute(pathname: string): boolean {
  return ENTERPRISE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/**
 * SaaS 平台运营控制台（只在新版 `/next/admin/...` 下）。私有部署由超级管理员使用；
 * 个人版不提供，直链访问时和企业路由一样显示「企业版说明」。
 */
export const PLATFORM_ROUTE_PREFIXES = [
  '/admin/ai-models',
  '/admin/ai-usage',
  '/admin/organizations',
] as const

/**
 * 是否为个人版不提供的路由（企业功能或平台运营）。新版路径先去掉 `/next` 前缀再判断。
 * 只用于 404 页面区分「企业版说明」与普通 404，不参与套餐门控。
 */
export function isEditionExcludedRoute(pathname: string): boolean {
  const path = pathname === '/next' ? '/' : pathname.replace(/^\/next(?=\/)/, '')
  return (
    isEnterpriseRoute(path) ||
    PLATFORM_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  )
}

export function personalSafeDestination(pathname: string): string {
  return pathname.startsWith('/settings') ? '/settings/profile' : '/dashboard'
}
