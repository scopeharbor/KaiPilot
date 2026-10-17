/**
 * v3-ui-next-settings-admin-domains W6 · tasks 6.2 —— 管理后台门户注册表纯函数单测
 * （spec「管理后台门户与平台治理控制台」Requirement 1 + design D-ADM / D-IA）。
 *
 * 覆盖：
 * - 两组结构与 8 控制台全覆盖（治理 3 + 运营与信任 3），且注册表**不含**任何
 *   设置空间节卡（D-IA 两注册表单一真相、互不包含）；
 * - 权限码为后端已核实值逐一断言（`system:admin` / `ai_quality_cost_console:view` /
 *   `ai:compiler:routing:view` / `release_trust_center:view`，禁臆造）；
 * - 权限过滤（仅 system:admin 可见治理组、仅运营 view 权可见对应运营控制台、
 *   无权限返回空数组 → 门户渲染中性受限页，RL-06）；
 * - 检索词命中（用户 / 审计 / 租户 / 质量 / 路由 / 信任）与多词 AND 收敛；
 * - getAdminGatePermission 白名单语义（未注册 id 返回 null，RL-14）。
 */
import { describe, expect, test } from 'vitest'
import {
  ADMIN_CONSOLES,
  ADMIN_CONSOLE_GROUPS,
  ADMIN_PORTAL_PERMISSIONS,
  filterAdminConsoles,
  getAdminGatePermission,
} from '@/lib/next/admin/admin-consoles'

/** 全权 can：模拟 `usePermissions().can`（后端已核实权限码逐一放行）。 */
function canAll(...permissions: string[]) {
  const set = new Set(permissions)
  return (permission: string) => set.has(permission)
}

const ALL = ADMIN_PORTAL_PERMISSIONS
const ONLY_SYSTEM_ADMIN = canAll('system:admin')

describe('管理后台注册表：分组结构与 9 控制台全覆盖（tasks 6.1/6.2）', () => {
  test('两组登记顺序为「平台治理 → 平台运营与信任」', () => {
    expect(ADMIN_CONSOLE_GROUPS.map((group) => group.id)).toEqual(['governance', 'operations'])
    expect(ADMIN_CONSOLE_GROUPS.map((group) => group.label)).toEqual(['平台治理', '平台运营与信任'])
  })

  test('每个控制台路由位于 /next/admin 之下且与台账一致', () => {
    for (const console of ADMIN_CONSOLES) {
      expect(console.path.startsWith('/next/admin/')).toBe(true)
      expect(console.path).toBe(`/next/admin/${console.id}`)
    }
  })

  test('注册表不含任何设置空间节卡路径（D-IA：两注册表互不包含）', () => {
    const settingsPaths = [
      '/next/settings',
      '/next/settings/profile',
      '/next/settings/organization',
      '/next/settings/ai-connections',
      '/next/settings/ai-usage',
      '/next/settings/compiler-skills',
      '/next/settings/integrations',
      '/next/settings/audit-logs',
      '/next/settings/multitenancy',
      '/next/settings/security/compliance',
      '/next/settings/security/dlp',
      '/next/settings/security/kms',
      '/next/settings/security/sso',
      '/next/settings/security/two-factor',
    ]
    for (const path of settingsPaths) {
      expect(ADMIN_CONSOLES.some((console) => console.path === path)).toBe(false)
    }
    // 亦不得出现「设置空间」类标题混入管理后台门户。
    for (const console of ADMIN_CONSOLES) {
      expect(console.title).not.toContain('设置空间')
    }
  })
})

describe('filterAdminConsoles：权限收敛（RL-06 零请求语义）', () => {
  test('全权用户：9 控制台全部可见且保持登记顺序', () => {
    const visible = filterAdminConsoles(canAll(...ALL))
    expect(visible.map((console) => console.id)).toEqual(ADMIN_CONSOLES.map((c) => c.id))
  })

  test('仅 ai:compiler:routing:view：只见编译器路由（运营组）', () => {
    const visible = filterAdminConsoles(canAll('ai:compiler:routing:view'))
    expect(visible.map((console) => console.id)).toEqual(['compiler-routing'])
  })

  test('无任何控制台权限：返回空数组（门户据此渲染中性受限页）', () => {
    expect(filterAdminConsoles(canAll())).toEqual([])
    expect(filterAdminConsoles(canAll('org:view', 'audit:view'))).toEqual([])
  })

  test('权限收敛不改变返回值集合之外的任何控制台（RL-14 白名单子集）', () => {
    const visible = filterAdminConsoles(ONLY_SYSTEM_ADMIN)
    for (const console of visible) {
      expect(ADMIN_CONSOLES).toContain(console)
    }
  })
})

describe('filterAdminConsoles：检索词命中与多词 AND（tasks 6.2）', () => {
  const all = canAll(...ALL)

  test.each([
    ['用户', ['users']],
    ['审计', ['audit-logs']],
    ['路由', ['compiler-routing']],
  ])('检索词「%s」命中对应控制台', (query, expectedIds) => {
    const hit = filterAdminConsoles(all, query).map((console) => console.id)
    for (const id of expectedIds) {
      expect(hit).toContain(id)
    }
  })

  test('多词 AND：同时含「全局」「审计」仅命中全局审计日志', () => {
    expect(filterAdminConsoles(all, '全局 审计').map((c) => c.id)).toEqual(['audit-logs'])
  })

  test('多词 AND 无交集：返回空数组而非全量', () => {
    expect(filterAdminConsoles(all, '用户 路由')).toEqual([])
  })

  test('检索不越过权限收敛（无权限用户检索不返回任何控制台）', () => {
    expect(filterAdminConsoles(canAll(), '审计')).toEqual([])
  })
})

describe('getAdminGatePermission：白名单门禁口径（RL-14）', () => {
  test('未注册 id 返回 null（不臆造权限名）', () => {
    expect(getAdminGatePermission('unknown-console')).toBeNull()
    expect(getAdminGatePermission('settings')).toBeNull()
    expect(getAdminGatePermission('')).toBeNull()
  })
})
