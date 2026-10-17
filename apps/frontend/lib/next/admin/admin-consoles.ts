/**
 * 管理后台控制台注册表与过滤纯函数（v3-ui-next-settings-admin-domains W6 · tasks 6.1，
 * design D-ADM「管理后台门户」/ D-IA「两注册表单一真相、互不包含」）。
 *
 * - **静态确定性白名单（RL-14）**：9 个平台级控制台在此一处登记，禁止运行时动态注入；
 *   设置空间节卡由 `lib/next/settings/settings-sections.ts` 独立登记，两注册表互不包含
 *   （D-IA：8 个管理后台控制台只归本文件，经 `/next/admin` 门户渲染）；
 * - **权限码为后端已核实值**（`apps/backend/start/rbac/permissions.ts`）：
 *   `system:admin`（全局审计 / 全局多租户 / 用户管理）、`ai_quality_cost_console:view`、
 *   `ai:compiler:routing:view`、`release_trust_center:view`——本文件不得臆造权限名；
 * - **RL-06 零请求语义**：`filterAdminConsoles` 只做静态集合运算，无权控制台既不渲染
 *   也不触发任何底层接口请求；门户页在无任何控制台权限时渲染中性受限页；
 * - 纯函数、零 DOM、零网络，页面与单测共用（jsdom / SSR 均安全）。
 */

/** 控制台分组（门户按「平台治理 / 平台运营与信任」两组呈现，D-ADM）。 */
export type AdminConsoleGroupId = 'governance' | 'operations'

export interface AdminConsoleGroup {
  id: AdminConsoleGroupId
  label: string
  description: string
}

/** 分组登记顺序即门户渲染顺序（治理在前、运营与信任在后）。 */
export const ADMIN_CONSOLE_GROUPS: readonly AdminConsoleGroup[] = [
  {
    id: 'governance',
    label: '平台治理',
    description: '平台级审计、租户隔离与用户治理控制台',
  },
  {
    id: 'operations',
    label: '平台运营与信任',
    description: 'AI 质量成本、编译器路由与发布信任运营控制台',
  },
]

/**
 * 图标名称联合类型：与 `components/next/admin/AdminLandingHub.tsx` 的 lucide 静态映射
 * 保持同步（RL-14 静态映射，禁止按标题动态解析图标）。
 */
export type AdminConsoleIconName =
  'ScrollText' | 'Network' | 'UserCog' | 'Gauge' | 'Route' | 'ShieldCheck' | 'BarChart3'

export interface AdminConsole {
  /** 稳定控制台 id（门户节卡 `data-admin-console` 与测试锚点）。 */
  id: string
  title: string
  /** 新轨路由（`/next/admin/...`，D-RT 路由双轨映射）。 */
  path: string
  group: AdminConsoleGroupId
  description: string
  /** 查看准入权限码（后端已核实；写操作门由各控制台页面自持）。 */
  viewPermission: string
  iconName: AdminConsoleIconName
  keywords: string[]
}

/**
 * 9 个平台级控制台（design 迁移台账 16–21 行 + 平台 AI 用量总览）。
 *
 * 治理组三项均以 `system:admin` 为准（`start/rbac/routes.ts`：`users.*`、
 * `audit_logs.index` 全局口径、多租户全局台 `multitenant:console:global` 供服务端判定，
 * 而 panel 内实际守卫仍为 `system:admin`——与旧轨一致）；运营组三项用各族 view 权限。
 */
export const ADMIN_CONSOLES: readonly AdminConsole[] = [
  {
    id: 'audit-logs',
    title: '全局审计日志',
    path: '/next/admin/audit-logs',
    group: 'governance',
    description: '跨全部组织的不可篡改操作流水检索（含企业审计摘要）',
    viewPermission: 'system:admin',
    iconName: 'ScrollText',
    keywords: ['审计日志', '平台审计', '全局审计', '系统审计', '操作日志', 'audit'],
  },
  {
    id: 'users',
    title: '用户管理',
    path: '/next/admin/users',
    group: 'governance',
    description: '平台用户底册（含 Google 登录用户筛选）、AI 使用查看、账号启用停用与两步验证重置',
    viewPermission: 'system:admin',
    iconName: 'UserCog',
    keywords: [
      '用户管理',
      '账号管理',
      'Google 登录账号',
      'Google 登录用户',
      'AI 使用',
      '启用账号',
      '禁用账号',
      '用户',
      'users',
    ],
  },
  {
    id: 'compiler-routing',
    title: '编译器路由',
    path: '/next/admin/compiler-routing',
    group: 'operations',
    description: '编译器路由规则查看、模拟与受控编排',
    viewPermission: 'ai:compiler:routing:view',
    iconName: 'Route',
    keywords: ['编译器路由', '路由规则', 'ai 路由', '路由', 'routing'],
  },
]

/**
 * 门户准入门禁权限集合（任一即通过）：`PermissionGuard(mode='any')` 消费。
 * 注：`system:admin` 用户经 auth store 的哨兵判定对任意权限码放行，天然包含在内。
 */
export const ADMIN_PORTAL_PERMISSIONS: readonly string[] = Array.from(
  new Set(ADMIN_CONSOLES.map((console) => console.viewPermission)),
)

/** 多词（空格分隔）不区分大小写的 AND 匹配：title / description / keywords / 路径尾段。 */
function matchesAdminConsole(console: AdminConsole, term: string): boolean {
  if (console.title.toLowerCase().includes(term)) return true
  if (console.description.toLowerCase().includes(term)) return true
  if (console.keywords.some((keyword) => keyword.toLowerCase().includes(term))) return true
  const normalizedTerm = term.replace(/^\/+/, '')
  return console.path.replace(/^\/+/, '').toLowerCase().endsWith(normalizedTerm)
}

/**
 * 按权限（必需）与检索词（可选）收敛控制台清单。
 *
 * - `can`：`usePermissions().can` 形态的展示层判定（后端 Policy 仍为最终边界）；
 * - `query` 省略或空白 → 仅按权限过滤；多词按 AND 收敛，与设置空间门户
 *   `filterSettingsSections` 同一检索语义（检索零网络，RL-06）；
 * - 返回值恒为 `ADMIN_CONSOLES` 的白名单子集，绝不产生未注册控制台（RL-14）。
 */
export function filterAdminConsoles(
  can: (permission: string) => boolean,
  query = '',
): AdminConsole[] {
  const permitted = ADMIN_CONSOLES.filter((console) => can(console.viewPermission))
  const trimmed = query.trim().toLowerCase()
  if (trimmed === '') return permitted
  const terms = trimmed.split(/\s+/)
  return permitted.filter((console) => terms.every((term) => matchesAdminConsole(console, term)))
}

/**
 * 取某控制台的准入权限码；未注册 id 返回 null（RL-14：绝不臆造未登记控制台的权限名）。
 * 供控制台页与接线层以声明式方式持有门禁口径，避免权限名散落硬编码。
 */
export function getAdminGatePermission(consoleId: string): string | null {
  const matched = ADMIN_CONSOLES.find((console) => console.id === consoleId)
  return matched ? matched.viewPermission : null
}
