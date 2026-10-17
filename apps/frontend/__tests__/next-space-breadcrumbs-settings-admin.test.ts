/**
 * 面包屑回显单测——设置空间 / 管理后台深层前缀回显（W9 · tasks 9.4）。
 *
 * 测试 `resolveSpaceBreadcrumb` 对设置门户、管理后台门户的精确路径回显；
 * 对 `/next/settings/security/kms`、`/next/admin/users` 等深层子路由的前缀回显；
 * 对项目设置深链在 entityTitle 下的回显；以及无关路径仍走原兜底。
 */
import { describe, expect, it } from 'vitest'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'

describe('resolveSpaceBreadcrumb – settings/admin 门户精确回显', () => {
  it('/next/settings → /next/settings · 设置空间', () => {
    expect(resolveSpaceBreadcrumb('/next/settings')).toBe('/next/settings · 设置空间')
  })

  it('/next/admin → /next/admin · 管理后台', () => {
    expect(resolveSpaceBreadcrumb('/next/admin')).toBe('/next/admin · 管理后台')
  })
})

describe('resolveSpaceBreadcrumb – settings/admin 深层前缀回显', () => {
  it('/next/settings/security/kms → · 设置空间', () => {
    expect(resolveSpaceBreadcrumb('/next/settings/security/kms')).toBe(
      '/next/settings/security/kms · 设置空间',
    )
  })

  it('/next/settings/profile → · 设置空间', () => {
    expect(resolveSpaceBreadcrumb('/next/settings/profile')).toBe(
      '/next/settings/profile · 设置空间',
    )
  })

  it('/next/settings/security/sso → · 设置空间', () => {
    expect(resolveSpaceBreadcrumb('/next/settings/security/sso')).toBe(
      '/next/settings/security/sso · 设置空间',
    )
  })

  it('/next/settings/integrations/callback → · 设置空间', () => {
    expect(resolveSpaceBreadcrumb('/next/settings/integrations/callback')).toBe(
      '/next/settings/integrations/callback · 设置空间',
    )
  })

  it('/next/admin/users → · 管理后台', () => {
    expect(resolveSpaceBreadcrumb('/next/admin/users')).toBe('/next/admin/users · 管理后台')
  })

  it('/next/admin/ai-quality-cost → · 管理后台', () => {
    expect(resolveSpaceBreadcrumb('/next/admin/ai-quality-cost')).toBe(
      '/next/admin/ai-quality-cost · 管理后台',
    )
  })

  it('/next/admin/compiler-routing → · 管理后台', () => {
    expect(resolveSpaceBreadcrumb('/next/admin/compiler-routing')).toBe(
      '/next/admin/compiler-routing · 管理后台',
    )
  })
})

describe('resolveSpaceBreadcrumb – 项目设置深链', () => {
  it('项目设置有实体标题 → 项目名 · 项目设置回显', () => {
    // 项目设置经 DomainPageHeader 注册实体标题（entityTitle），项目空间正则覆盖
    expect(resolveSpaceBreadcrumb('/next/projects/42/settings', '开项主站 · 项目设置')).toBe(
      '/next/projects/42 · 开项主站 · 项目设置',
    )
  })

  it('项目设置无实体标题 → 项目空间兜底', () => {
    expect(resolveSpaceBreadcrumb('/next/projects/42/settings')).toBe(
      '/next/projects/42 · 项目空间',
    )
  })
})

describe('resolveSpaceBreadcrumb – 无关路径回归', () => {
  it('/next/unknown 仍走空间探索兜底', () => {
    expect(resolveSpaceBreadcrumb('/next/unknown')).toBe('/next/unknown · 空间探索')
  })

  it('/next 仍走角色首页', () => {
    expect(resolveSpaceBreadcrumb('/next')).toBe('/next · 角色首页')
  })

  it('非新轨路径原样返回', () => {
    expect(resolveSpaceBreadcrumb('/settings')).toBe('/settings')
  })
})
