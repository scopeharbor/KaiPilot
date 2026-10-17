/**
 * v3-personal-edition-open-source-export §4.1 —— 核心入口的顺序与完整性（私有版与个人版共用）。
 *
 * 企业与平台条目搬进 `lib/edition/enterprise-entries.ts` 后，三份列表里的**核心条目**
 * 顺序必须和改造前一致；企业条目是否存在取决于版本（私有版有、个人版被剥离）。
 * 这里只看核心条目：去掉个人版不提供的路由后，剩下的顺序固定。
 */
import { describe, expect, it } from 'vitest'
import { secondaryNavItems } from '@/lib/navigation'
import { ADMIN_CONSOLES } from '@/lib/next/admin/admin-consoles'
import { SETTINGS_SECTIONS } from '@/lib/next/settings/settings-sections'
import { isEditionExcludedRoute } from '@/lib/workspace-edition'

const core = <T>(items: readonly T[], pathOf: (item: T) => string) =>
  items.filter((item) => !isEditionExcludedRoute(pathOf(item).replace(/#.*$/, '')))

describe('核心入口顺序（与改造前一致）', () => {
  it('旧版侧边栏次要导航', () => {
    expect(core(secondaryNavItems, (i) => i.href).map((i) => i.href)).toEqual([
      '/settings/compiler-skills',
      '/settings/integrations',
      '/settings/ai-connections',
      '/settings/audit-logs',
      '/admin/audit-logs',
      '/settings/security/two-factor',
      '/settings',
      '/help',
    ])
  })

  it('新版平台管理控制台：实例管理员保留用户管理、全局审计与编译器路由', () => {
    expect(core(ADMIN_CONSOLES, (c) => c.path).map((c) => c.id)).toEqual([
      'audit-logs',
      'users',
      'compiler-routing',
    ])
  })

  it('新版设置门户', () => {
    expect(core(SETTINGS_SECTIONS, (s) => s.path).map((s) => s.id)).toEqual([
      'personal-profile',
      'personal-two-factor',
      'organization-settings',
      'organization-audit-logs',
      'ai-connections',
      'ai-compiler-skills',
      'integrations',
      'integrations-callback',
      'presentation-calendar',
      'presentation-interface',
    ])
  })
})
