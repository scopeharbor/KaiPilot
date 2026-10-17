/**
 * v3-ui-next-settings-admin-domains W1 · tasks 1.2 —— 设置域节卡注册表纯函数单测
 * （spec「设置空间门户与信息架构」要求 1/2，design D-IA / D-PERM / RL-14）。
 *
 * 覆盖：
 * - 五组分组完整性：节 id 全覆盖 16 个设置节，注册表不含任何管理后台控制台条目
 *   （admin 6 条由 W6 `next-admin-consoles.test.ts` 独立全覆盖，D-IA 单一真相）；
 * - 检索词收敛（「密钥」「用量」「审计」）；
 * - 无权限节被过滤、免费档企业节收敛为锁定占位且不携带任何数据请求标记；
 * - 空串返回全量可用节。
 */
import { describe, expect, test } from 'vitest'
import {
  SETTINGS_SECTIONS,
  filterSettingsSections,
  resolveLockedSettingsSections,
} from '@/lib/next/settings/settings-sections'

function canWith(permissions: string[]) {
  return (permission: string) => permissions.includes(permission)
}

const ALL_SETTINGS_PERMISSIONS = [
  'org:view',
  'org:manage',
  'org:member:manage',
  'audit:view',
  'multitenant:console:view',
  'ai:connection:manage',
  'ai:usage:view',
  'ai:compiler:skill:view',
  'integration:connect',
  'compliance:readiness:view',
  'dlp:policy:view',
  'kms:key:view',
  'sso:saml:view',
  'sso:oidc:view',
  'sso:scim:view',
]

/** 节卡元数据字段全集（证明注册表为纯静态元数据，不携带任何请求/加载器标记）。 */
const SECTION_METADATA_KEYS = [
  'description',
  'group',
  'iconName',
  'id',
  'keywords',
  'path',
  'planGated',
  'title',
  'viewPermission',
]

describe('设置节卡注册表（settings-sections）', () => {
  test('注册表不含任何管理后台控制台条目（D-IA 两注册表单一真相）', () => {
    // 管理后台 6 控制台只归 lib/next/admin/admin-consoles.ts（W6），不得在此登记。
    const adminPaths = [
      '/next/admin',
      '/next/admin/users',
      '/next/admin/audit-logs',
      '/next/admin/multitenancy',
      '/next/admin/ai-quality-cost',
      '/next/admin/compiler-routing',
      '/next/admin/release-trust',
    ]
    for (const section of SETTINGS_SECTIONS) {
      expect(adminPaths).not.toContain(section.path)
      expect(section.path.startsWith('/next/settings')).toBe(true)
      expect(section.id.startsWith('admin-')).toBe(false)
      expect(section.group).not.toBe('admin')
    }
    // 反向：admin 控制台字面量不得出现在设置注册表任何字段里（检索漂移防线）。
    const serialized = JSON.stringify(SETTINGS_SECTIONS)
    expect(serialized).not.toContain('平台治理')
    expect(serialized).not.toContain('release-trust')
    expect(serialized).not.toContain('compiler-routing')
    expect(serialized).not.toContain('ai-quality-cost')
  })

  test('节卡元数据字段封闭：不含任何数据请求标记', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(Object.keys(section).sort()).toEqual(SECTION_METADATA_KEYS)
    }
  })

  test('检索「审计」收敛到组织审计日志节（不含管理后台全局审计）', () => {
    const hit = filterSettingsSections('审计', canWith(ALL_SETTINGS_PERMISSIONS), 'enterprise')
    expect(hit.map((section) => section.id)).toEqual(['organization-audit-logs'])
    expect(hit.every((section) => section.path.startsWith('/next/settings'))).toBe(true)
  })

  test('无权限节被过滤（RL-06：不渲染、检索不命中）', () => {
    const can = canWith(['org:view'])
    const visible = filterSettingsSections('', can, 'enterprise')
    const ids = visible.map((section) => section.id)

    expect(ids).toContain('personal-profile')
    expect(ids).toContain('personal-two-factor')
    expect(ids).toContain('organization-settings')
    expect(ids).not.toContain('organization-audit-logs')
    expect(ids).not.toContain('security-kms')
    expect(ids).not.toContain('ai-connections')

    // 检索亦不命中：无权节的检索词在结果集里彻底消失。
    expect(filterSettingsSections('密钥', can, 'enterprise')).toEqual([])
    expect(filterSettingsSections('审计', can, 'enterprise')).toEqual([])
  })

  test('付费档下无权限节直接隐藏（不再有升级引导）', () => {
    const can = canWith([])
    expect(filterSettingsSections('', can, 'enterprise')).toHaveLength(4)
    expect(resolveLockedSettingsSections('', can, 'enterprise')).toEqual([])
    expect(resolveLockedSettingsSections('', can, 'team')).toEqual([])
  })
})
