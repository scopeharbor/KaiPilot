import type { PlanTier } from '@/stores/auth-store'

/**
 * 设置空间节卡静态注册表（v3-ui-next-settings-admin-domains W1 · tasks 1.1，
 * spec「设置空间门户与信息架构」要求 1，design D-IA / D-PERM / RL-14）。
 *
 * - **仅登记设置空间节**：14 条设置路由（台账第 2–15 行，即除门户自身
 *   `/next/settings` 之外的全部设置路由）+ 1 条「界面呈现」偏好入口（D-IA ⑤
 *   呈现偏好：新旧轨偏好卡内嵌于个人资料页）= 15 个设置节；
 * - **6 个管理后台控制台不在本注册表登记**：它们只归
 *   `lib/next/admin/admin-consoles.ts`（W6 · tasks 6.1）、由 `/next/admin` 门户渲染
 *   （D-IA 裁决：两注册表单一真相、互不包含）；
 * - RL-14 确定性白名单：注册表为静态只读数据，禁止运行时注入未注册节；节卡只指向
 *   设置空间深层路由，不提供跨域导航；
 * - 权限口径全部对齐 `apps/backend/start/rbac/permissions.ts` 已核实权限码
 *   （design 权限矩阵），前端仅为体验层，后端 Policy 与 Plan Policy 仍是最终边界；
 * - 企业版节（`planGated`）在 `planTier === 'free'` 且查看权限缺失时收敛为「锁定占位」
 *   （`resolveLockedSettingsSections`），渲染升级引导且绝不发起数据请求（RL-06）。
 */

/** 设置空间五组（顺序即门户与侧栏的呈现顺序，D-IA）。 */
export type SettingsSectionGroup =
  'personal' | 'organization' | 'ai-integrations' | 'security-compliance' | 'presentation'

export interface SettingsSectionGroupMeta {
  group: SettingsSectionGroup
  label: string
  description: string
}

/** 分组元数据（五组常量，顺序固定；标签为简体中文原生，禁止运行时改写）。 */
export const SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroupMeta[] = [
  {
    group: 'personal',
    label: '个人',
    description: '本人账号身份与登录安全',
  },
  {
    group: 'organization',
    label: '组织',
    description: '当前会话组织的资料、成员与治理概览',
  },
  {
    group: 'ai-integrations',
    label: 'AI 与集成',
    description: '模型网关连接、用量态势与第三方集成',
  },
  {
    group: 'security-compliance',
    label: '安全合规',
    description: '企业版安全策略、凭据与合规准备度',
  },
  {
    group: 'presentation',
    label: '呈现偏好',
    description: '当前设备的界面呈现偏好（新旧 UI 轨）',
  },
] as const

/** 节卡图标名（联合类型契约，由门户/侧栏映射到 lucide 图标，RL-14 静态映射）。 */
export type SettingsSectionIconName =
  | 'User'
  | 'ShieldCheck'
  | 'Building2'
  | 'ScrollText'
  | 'Layers'
  | 'Boxes'
  | 'Gauge'
  | 'Wand2'
  | 'Plug'
  | 'Link2'
  | 'Scale'
  | 'ShieldAlert'
  | 'KeyRound'
  | 'Fingerprint'
  | 'Palette'

export interface SettingsSection {
  /** 稳定节 id（含分组语义前缀，单测与埋点以此为准）。 */
  id: string
  title: string
  /** 设置空间内的深层路由；偏好卡为页内锚点（带 `#` 片段，非独立路由）。 */
  path: string
  group: SettingsSectionGroup
  description: string
  keywords: string[]
  /**
   * 查看准入权限码（后端已核实，禁止臆造）。
   *
   * - `null`：登录即可（本人账号能力）；
   * - `string`：单一权限；
   * - `readonly string[]`：任一权限（any-of）——SSO 节为
   *   `sso:saml|oidc|scim:view` 任一（design 权限矩阵），单字符串无法表达。
   */
  viewPermission: string | readonly string[] | null
  /** 企业版节标记：`planTier === 'free'` 且权限缺失时收敛为锁定占位（D-PERM）。 */
  planGated: boolean
  iconName: SettingsSectionIconName
}

/**
 * 16 个设置节全量登记（五组：个人 2 / 组织 3 / AI 与集成 5 / 安全合规 4 / 呈现偏好 2）。
 *
 * 检索词纪律：专属词只归专属节（「密钥」只归 KMS、「用量」只归 AI 用量、「审计」只归
 * 组织审计日志），避免门户检索命中漂移；本注册表不含任何管理后台控制台条目。
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // ① 个人
  {
    id: 'personal-profile',
    title: '个人资料',
    path: '/next/settings/profile',
    group: 'personal',
    description: '姓名、邮箱、所属组织与账号安全快捷入口',
    keywords: ['个人资料', '我的账号', '账户信息', '身份', 'profile'],
    viewPermission: null,
    planGated: false,
    iconName: 'User',
  },
  {
    id: 'personal-two-factor',
    title: '两步验证',
    path: '/next/settings/security/two-factor',
    group: 'personal',
    description: '用认证器应用为登录再加一道验证，并管理恢复码',
    keywords: ['两步验证', '2fa', '动态口令', '恢复码', '认证器', 'totp'],
    viewPermission: null,
    planGated: false,
    iconName: 'ShieldCheck',
  },

  // ② 组织
  {
    id: 'organization-settings',
    title: '组织设置',
    path: '/next/settings/organization',
    group: 'organization',
    description: '组织资料、成员底册与所有权治理',
    keywords: ['组织设置', '组织资料', '组织成员', '成员管理', '邀请成员', '角色'],
    viewPermission: 'org:view',
    planGated: false,
    iconName: 'Building2',
  },
  {
    id: 'organization-audit-logs',
    title: '审计日志',
    path: '/next/settings/audit-logs',
    group: 'organization',
    description: '本组织不可篡改的操作流水检索（只读）',
    keywords: ['审计日志', '审计', '操作流水', 'audit'],
    viewPermission: 'audit:view',
    planGated: false,
    iconName: 'ScrollText',
  },

  // ③ AI 与集成
  {
    id: 'ai-connections',
    title: 'AI 连接',
    path: '/next/settings/ai-connections',
    group: 'ai-integrations',
    description: '模型网关连接、凭据加密存储与连通性测试',
    keywords: ['ai 连接', '模型连接', '模型网关', 'api key', '凭据', '连通性'],
    viewPermission: 'ai:connection:manage',
    planGated: false,
    iconName: 'Boxes',
  },
  {
    id: 'ai-compiler-skills',
    title: '编译器技能',
    path: '/next/settings/compiler-skills',
    group: 'ai-integrations',
    description: '编译器技能注册表、能力标签与受控启停',
    keywords: ['编译器技能', '技能注册', 'skill', '能力标签'],
    viewPermission: 'ai:compiler:skill:view',
    planGated: false,
    iconName: 'Wand2',
  },
  {
    id: 'integrations',
    title: '集成',
    path: '/next/settings/integrations',
    group: 'ai-integrations',
    description: '第三方 OAuth 预连接与连接状态（仅校验回调链路，不交换令牌）',
    keywords: ['集成', '第三方集成', 'oauth 连接', '日历集成', '连接'],
    viewPermission: 'integration:connect',
    planGated: false,
    iconName: 'Plug',
  },
  {
    id: 'integrations-callback',
    title: '集成回调',
    path: '/next/settings/integrations/callback',
    group: 'ai-integrations',
    description: '外部 Provider 回跳结果的契约镜像渲染页（手工直达等价物）',
    keywords: ['集成回调', 'callback', 'oauth 回跳', '回调'],
    viewPermission: 'integration:connect',
    planGated: false,
    iconName: 'Link2',
  },

  // ⑤ 呈现偏好
  {
    id: 'presentation-calendar',
    title: '日历与曆法',
    path: '/next/settings/calendar',
    group: 'presentation',
    description: '日历主曆与副曆（公历 / 农历 / 藏历 / 回历、节气、假日…）；个人 > 项目 > 组织',
    keywords: ['日历', '曆法', '历法', '农历', '藏历', '回历', '节气', '假日', 'calendar'],
    viewPermission: null,
    planGated: false,
    iconName: 'Palette',
  },
  {
    id: 'presentation-interface',
    title: '界面呈现',
    path: '/next/settings/profile#interface-presentation',
    group: 'presentation',
    description: '新旧 UI 轨偏好（用户级、按设备，绝不自动重定向）',
    keywords: ['界面呈现', '新旧轨', '回到旧版', '轨道偏好', 'ui 轨'],
    viewPermission: null,
    planGated: false,
    iconName: 'Palette',
  },
] as const

export interface SettingsSectionGroupBlock {
  group: SettingsSectionGroup
  label: string
  description: string
  sections: SettingsSection[]
}

/** 节是否满足查看准入（`null` 无门；数组为 any-of，对齐 SSO 三权限任一判定）。 */
export function canOpenSettingsSection(
  section: SettingsSection,
  can: (permission: string) => boolean,
): boolean {
  const permission = section.viewPermission
  if (permission === null) return true
  return typeof permission === 'string' ? can(permission) : permission.some((item) => can(item))
}

/**
 * 免费档企业节收敛：仅当 `planTier` 为 `free`（或缺失/未知，按最保守的免费处理）
 * 且查看权限缺失时，`planGated` 节转为锁定占位；付费档下无权限节直接隐藏
 * （无可升级内容，不再展示升级引导）。
 */
function isLockedEnterpriseSection(
  section: SettingsSection,
  can: (permission: string) => boolean,
  planTier: PlanTier | null,
): boolean {
  if (!section.planGated) return false
  if (planTier === 'team' || planTier === 'enterprise') return false
  return !canOpenSettingsSection(section, can)
}

/** 检索命中判定：title / description / keywords 不区分大小写子串匹配。 */
function matchesQuery(section: SettingsSection, term: string): boolean {
  return (
    section.title.toLowerCase().includes(term) ||
    section.description.toLowerCase().includes(term) ||
    section.keywords.some((keyword) => keyword.toLowerCase().includes(term))
  )
}

/** 多词 AND 检索（空白切词；空查询命中全部）。 */
function matchesSettingsQuery(section: SettingsSection, query: string): boolean {
  const trimmed = query.trim()
  if (trimmed === '') return true
  const terms = trimmed.toLowerCase().split(/\s+/)
  return terms.every((term) => matchesQuery(section, term))
}

/** 一次遍历同时切出「可进入节」与「免费档锁定占位节」两个视图分区。 */
function resolveSettingsSectionView(
  query: string,
  can: (permission: string) => boolean,
  planTier: PlanTier | null,
  registry: readonly SettingsSection[],
): { sections: SettingsSection[]; lockedSections: SettingsSection[] } {
  const sections: SettingsSection[] = []
  const lockedSections: SettingsSection[] = []

  for (const section of registry) {
    if (!matchesSettingsQuery(section, query)) continue
    if (canOpenSettingsSection(section, can)) {
      sections.push(section)
    } else if (isLockedEnterpriseSection(section, can, planTier)) {
      lockedSections.push(section)
    }
  }

  return { sections, lockedSections }
}

/**
 * 门户/侧栏可进入节过滤（tasks 1.1）：
 * - 多词 AND 检索（title/description/keywords，不区分大小写）；
 * - 权限收敛：查看权限缺失的节一律不返回（RL-06：不渲染、检索不命中、零数据请求）；
 * - 套餐收敛：免费档下 `planGated` 且无权限的节不返回（改由
 *   `resolveLockedSettingsSections` 以锁定占位呈现，同样零数据请求）。
 *
 * 第四参 `registry` 为可选注入点（默认 = `SETTINGS_SECTIONS` 静态白名单），供渲染
 * 边界验证复用；生产调用一律缺省，注册表仍是唯一真相（RL-14）。
 */
export function filterSettingsSections(
  query: string,
  can: (permission: string) => boolean,
  planTier: PlanTier | null,
  registry: readonly SettingsSection[] = SETTINGS_SECTIONS,
): SettingsSection[] {
  return resolveSettingsSectionView(query, can, planTier, registry).sections
}

/**
 * 免费档企业节锁定占位清单（D-PERM / spec 要求 2）：与 `filterSettingsSections` 同一
 * 入口切分，二者互斥且并集为「检索命中的全部节」中的可见部分。锁定节**不构成导航
 * 入口**，门户只渲染锁定说明与升级引导，绝不发起对应数据请求。
 */
export function resolveLockedSettingsSections(
  query: string,
  can: (permission: string) => boolean,
  planTier: PlanTier | null,
  registry: readonly SettingsSection[] = SETTINGS_SECTIONS,
): SettingsSection[] {
  return resolveSettingsSectionView(query, can, planTier, registry).lockedSections
}

/**
 * 按五组归位（tasks 1.1）：始终返回五组（顺序固定、标签同源），空组保留空数组，
 * 由消费方决定是否折叠/隐藏，保证分组顺序在任何权限组合下都确定（RL-14）。
 */
export function resolveSettingsSectionsByGroup(
  sections: readonly SettingsSection[],
): SettingsSectionGroupBlock[] {
  return SETTINGS_SECTION_GROUPS.map((meta) => ({
    group: meta.group,
    label: meta.label,
    description: meta.description,
    sections: sections.filter((section) => section.group === meta.group),
  }))
}

/** 按 id 取节（导航高亮与面包屑等消费方使用；未注册 id 返回 `null`）。 */
export function findSettingsSectionById(id: string): SettingsSection | null {
  return SETTINGS_SECTIONS.find((section) => section.id === id) ?? null
}

/**
 * 由当前 pathname 解析高亮节（侧栏当前节高亮，tasks 1.3）：
 * 取「路径段最长」的匹配，保证 `/next/settings/integrations/callback` 命中回调镜像节
 * 而非其父级集成节。
 */
export function resolveActiveSettingsSection(pathname: string): SettingsSection | null {
  const normalized = pathname.replace(/#.*$/, '').replace(/\/+$/, '')
  let active: SettingsSection | null = null

  for (const section of SETTINGS_SECTIONS) {
    const sectionPath = section.path.replace(/#.*$/, '').replace(/\/+$/, '')
    if (normalized === sectionPath || normalized.startsWith(`${sectionPath}/`)) {
      if (active === null || sectionPath.length > active.path.length) active = section
    }
  }

  return active
}
